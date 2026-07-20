'use strict';

import { STATUS, mapProviderStatus, isTerminal, grantsMembership } from './paymentStatus.js';
import { gelToTetri } from './money.js';
import { buildMembershipUpdate, buildTransactionRecord } from './membership.js';

const PAYMENTS = 'payments';
const MEMBERS = 'members';
const PLANS = 'subscription_plans';
const TRANSACTIONS = 'transactions';

class PaymentError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** `GYM-<uuid>` — opaque, carries no personal data, unique per attempt. */
function generateOrderId(uuid) {
  return `GYM-${uuid}`;
}

class PaymentService {
  constructor({ db, flittClient, config, logger = console, now = () => new Date() }) {
    this.db = db;
    this.flitt = flittClient;
    this.config = config;
    this.logger = logger;
    this.now = now;
  }

  _log(event, fields = {}) {
    // Never log secrets, signatures, or signature source strings.
    this.logger.info(JSON.stringify({ event, ...fields, ts: this.now().toISOString() }));
  }

  async _loadActivePlan(planId) {
    const snap = await this.db.collection(PLANS).doc(planId).get();
    if (!snap.exists) {
      throw new PaymentError('plan_not_found', 'აბონემენტის ტარიფი ვერ მოიძებნა', 404);
    }
    const plan = { id: snap.id, ...snap.data() };
    if (plan.active === false) {
      throw new PaymentError('plan_inactive', 'ეს ტარიფი აღარ არის აქტიური', 409);
    }
    return plan;
  }

  async _loadMember(memberId) {
    const snap = await this.db.collection(MEMBERS).doc(memberId).get();
    if (!snap.exists) {
      throw new PaymentError('member_not_found', 'მომხმარებელი ვერ მოიძებნა', 404);
    }
    return { id: snap.id, ...snap.data() };
  }

  /**
   * Creates a pending payment and returns a Flitt checkout URL.
   * The price is read from Firestore here — the client never supplies an amount.
   */
  async createCheckout({ memberId, planId }) {
    const [member, plan] = await Promise.all([
      this._loadMember(memberId),
      this._loadActivePlan(planId),
    ]);

    const priceGel = Number(plan.price);
    if (!Number.isFinite(priceGel) || priceGel <= 0) {
      throw new PaymentError('plan_price_invalid', 'ტარიფის ფასი არასწორია', 409);
    }
    const amountTetri = gelToTetri(priceGel);

    const uuid = crypto.randomUUID();
    const orderId = generateOrderId(uuid);
    const isRenewal = Boolean(member.subscriptionEndDate);
    const createdAt = this.now().toISOString();

    // Doc id == orderId gives us the uniqueness constraint for free.
    const paymentRef = this.db.collection(PAYMENTS).doc(orderId);

    const paymentDoc = {
      uuid,
      orderId,
      memberId,
      membershipPlanId: plan.id,
      provider: 'flitt',
      environment: this.config.environment,
      amount: amountTetri, // integer tetri
      currency: this.config.currency,
      priceGel,
      status: STATUS.PENDING,
      providerStatus: null,
      providerPaymentId: null,
      orderDescription: `Gym membership: ${plan.name}`,
      checkoutUrl: null,
      merchantData: uuid,
      isRenewal,
      membershipActivated: false,
      responseCode: null,
      responseDescription: null,
      maskedCard: null,
      cardType: null,
      paymentSystem: null,
      approvedAt: null,
      declinedAt: null,
      expiredAt: null,
      reversedAt: null,
      callbackReceivedAt: null,
      rawCallback: null,
      createdAt,
      updatedAt: createdAt,
    };

    // Persist BEFORE calling Flitt, so a callback can never arrive for an unknown order.
    await paymentRef.create(paymentDoc);
    this._log('flitt.checkout.requested', { orderId, paymentUuid: uuid, memberId, planId });

    let checkout;
    try {
      checkout = await this.flitt.createCheckout({
        orderId,
        amountTetri,
        description: paymentDoc.orderDescription,
        merchantData: uuid,
      });
    } catch (error) {
      // Keep the record; mark why it failed. No automatic retry — a retry would
      // create a second attempt for the same intent.
      await paymentRef.update({
        status: STATUS.FAILED,
        responseCode: error.errorCode || error.code || 'checkout_error',
        responseDescription: error.errorMessage || error.message || null,
        updatedAt: this.now().toISOString(),
      });
      this._log('flitt.checkout.failed', {
        orderId,
        paymentUuid: uuid,
        code: error.code || null,
        requestId: error.requestId || null,
      });
      throw new PaymentError('checkout_failed', 'გადახდის გვერდის შექმნა ვერ მოხერხდა', 502);
    }

    await paymentRef.update({
      checkoutUrl: checkout.checkoutUrl,
      providerPaymentId: checkout.providerPaymentId,
      updatedAt: this.now().toISOString(),
    });

    this._log('flitt.checkout.created', {
      orderId,
      paymentUuid: uuid,
      providerPaymentId: checkout.providerPaymentId,
      requestId: checkout.requestId,
    });

    return {
      paymentId: uuid,
      orderId,
      status: STATUS.PENDING,
      checkoutUrl: checkout.checkoutUrl,
    };
  }

  /**
   * Applies a verified provider result (from callback or reconciliation).
   * Idempotent and transactional: membership activation and the payment status
   * update either both land or neither does.
   *
   * The caller MUST have verified the signature before calling this.
   */
  async applyProviderResult(payload, { source = 'callback' } = {}) {
    const orderId = payload.order_id;
    const paymentRef = this.db.collection(PAYMENTS).doc(String(orderId));

    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(paymentRef);
      if (!snap.exists) {
        this._log('flitt.callback.order_unknown', { orderId, source });
        throw new PaymentError('order_unknown', 'Unknown order', 404);
      }
      const payment = snap.data();

      // --- Verification against our own record -------------------------------
      if (String(payload.merchant_id) !== String(this.config.merchantId)) {
        this._log('flitt.callback.merchant_mismatch', { orderId, source });
        throw new PaymentError('merchant_mismatch', 'Merchant mismatch', 400);
      }

      const callbackAmount = Number(payload.amount);
      if (!Number.isFinite(callbackAmount) || callbackAmount !== Number(payment.amount)) {
        this._log('flitt.callback.amount_mismatch', {
          orderId,
          source,
          expected: payment.amount,
          received: payload.amount,
        });
        throw new PaymentError('amount_mismatch', 'Amount mismatch', 400);
      }

      if (String(payload.currency).toUpperCase() !== String(payment.currency).toUpperCase()) {
        this._log('flitt.callback.currency_mismatch', { orderId, source });
        throw new PaymentError('currency_mismatch', 'Currency mismatch', 400);
      }

      // actual_* reflect what was really charged; treat a mismatch as suspicious.
      if (payload.actual_amount !== undefined && payload.actual_amount !== null) {
        if (Number(payload.actual_amount) !== Number(payment.amount)) {
          this._log('flitt.callback.amount_mismatch', { orderId, source, field: 'actual_amount' });
          throw new PaymentError('amount_mismatch', 'Actual amount mismatch', 400);
        }
      }
      if (payload.actual_currency && String(payload.actual_currency).toUpperCase() !== String(payment.currency).toUpperCase()) {
        this._log('flitt.callback.currency_mismatch', { orderId, source, field: 'actual_currency' });
        throw new PaymentError('currency_mismatch', 'Actual currency mismatch', 400);
      }

      if (payment.merchantData && payload.merchant_data && payload.merchant_data !== payment.merchantData) {
        this._log('flitt.callback.merchant_data_mismatch', { orderId, source });
        throw new PaymentError('merchant_data_mismatch', 'merchant_data mismatch', 400);
      }

      const nextStatus = mapProviderStatus(payload.order_status);
      if (!nextStatus) {
        throw new PaymentError('unknown_status', `Unknown order_status: ${payload.order_status}`, 400);
      }

      // --- Idempotency -------------------------------------------------------
      // A terminal payment never changes again. A repeat approved callback is a
      // success no-op, which is what Flitt needs to stop retrying.
      if (isTerminal(payment.status)) {
        this._log('flitt.callback.duplicate', {
          orderId,
          source,
          storedStatus: payment.status,
          incomingStatus: nextStatus,
        });
        return {
          alreadyProcessed: true,
          status: payment.status,
          membershipActivated: Boolean(payment.membershipActivated),
        };
      }

      const nowIso = this.now().toISOString();
      const update = {
        status: nextStatus,
        providerStatus: String(payload.order_status),
        providerPaymentId: payload.payment_id ? String(payload.payment_id) : payment.providerPaymentId,
        responseCode: payload.response_code !== undefined ? String(payload.response_code) : null,
        responseDescription: payload.response_description || null,
        maskedCard: payload.masked_card || null, // masked only — never PAN/CVV/expiry
        cardType: payload.card_type || null,
        paymentSystem: payload.payment_system || null,
        callbackReceivedAt: nowIso,
        rawCallback: this._sanitizeRawCallback(payload),
        updatedAt: nowIso,
      };

      if (nextStatus === STATUS.PAID) update.approvedAt = nowIso;
      if (nextStatus === STATUS.FAILED) update.declinedAt = nowIso;
      if (nextStatus === STATUS.EXPIRED) update.expiredAt = nowIso;
      if (nextStatus === STATUS.REVERSED) update.reversedAt = nowIso;

      let membershipActivated = false;

      if (grantsMembership(nextStatus) && !payment.membershipActivated) {
        const memberRef = this.db.collection(MEMBERS).doc(payment.memberId);
        const planRef = this.db.collection(PLANS).doc(payment.membershipPlanId);
        const [memberSnap, planSnap] = await Promise.all([tx.get(memberRef), tx.get(planRef)]);

        if (!memberSnap.exists) {
          throw new PaymentError('member_not_found', 'Member missing at activation', 409);
        }
        if (!planSnap.exists) {
          throw new PaymentError('plan_not_found', 'Plan missing at activation', 409);
        }

        const member = { id: memberSnap.id, ...memberSnap.data() };
        const plan = { id: planSnap.id, ...planSnap.data() };

        // Charge what we recorded, not what the plan costs today — the plan
        // price may have changed between checkout and callback.
        const priceGel = Number(payment.priceGel);

        tx.update(
          memberRef,
          buildMembershipUpdate({
            plan,
            priceGel,
            isRenewal: Boolean(payment.isRenewal),
            now: this.now(),
          })
        );

        const txRef = this.db.collection(TRANSACTIONS).doc();
        tx.set(
          txRef,
          buildTransactionRecord({
            member,
            plan,
            priceGel,
            isRenewal: Boolean(payment.isRenewal),
            orderId,
            now: this.now(),
          })
        );

        update.membershipActivated = true;
        update.membershipActivatedAt = nowIso;
        update.transactionId = txRef.id;
        membershipActivated = true;
      }

      tx.update(paymentRef, update);

      this._log(
        nextStatus === STATUS.PAID
          ? 'flitt.payment.approved'
          : nextStatus === STATUS.FAILED
            ? 'flitt.payment.declined'
            : nextStatus === STATUS.EXPIRED
              ? 'flitt.payment.expired'
              : 'flitt.payment.updated',
        { orderId, source, memberId: payment.memberId, status: nextStatus, membershipActivated }
      );

      return { alreadyProcessed: false, status: nextStatus, membershipActivated };
    });
  }

  /** Strips anything card-sensitive before persisting the provider payload. */
  _sanitizeRawCallback(payload) {
    const FORBIDDEN = ['card_number', 'pan', 'cvv', 'cvv2', 'expiry_date', 'expiry', 'signature'];
    const clean = {};
    for (const [key, value] of Object.entries(payload)) {
      if (FORBIDDEN.includes(key)) continue;
      clean[key] = value;
    }
    return clean;
  }

  /** Reconciliation — reuses the exact same idempotent path as the callback. */
  async reconcile(orderId) {
    const status = await this.flitt.getOrderStatus(orderId);
    const result = await this.applyProviderResult(
      { ...status, order_id: orderId },
      { source: 'reconciliation' }
    );
    this._log('flitt.status.reconciled', { orderId, status: result.status });
    return result;
  }

  async getPaymentForMember(paymentUuid, memberId) {
    const query = await this.db
      .collection(PAYMENTS)
      .where('uuid', '==', paymentUuid)
      .limit(1)
      .get();

    if (query.empty) return null;
    const doc = query.docs[0];
    const payment = doc.data();
    // Authorisation: a member may only ever see their own payment.
    if (payment.memberId !== memberId) return null;
    return payment;
  }
}

export { PaymentService, PaymentError, generateOrderId };
