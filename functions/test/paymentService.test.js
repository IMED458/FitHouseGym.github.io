'use strict';

const { FakeFirestore } = require('./helpers/fakeFirestore');
const { PaymentService } = require('../src/paymentService');
const { FlittApiError } = require('../src/flittClient');
const { generateCallbackSignature } = require('../src/signature');
const { STATUS } = require('../src/paymentStatus');

const SECRET = 'test';

const CONFIG = {
  enabled: true,
  mode: 'test',
  environment: 'test',
  apiBaseUrl: 'https://pay.flitt.com',
  checkoutPath: '/api/checkout/url',
  statusPath: '/api/status/order_id',
  merchantId: '1549901',
  secretKey: SECRET,
  currency: 'GEL',
  language: 'ka',
  protocolVersion: '1.0.1',
  responseUrl: 'https://example.test/payments/flitt/result',
  callbackUrl: 'https://example.test/api/payments/flitt/callback',
  cancelUrl: 'https://example.test/payments/flitt/cancel',
  httpTimeoutMs: 5000,
  allowedEmails: ['member@example.test'],
};

const SILENT = { info: () => {}, warn: () => {}, error: () => {} };

function seed(overrides = {}) {
  return new FakeFirestore({
    members: {
      m1: {
        firstName: 'გიორგი',
        lastName: 'ტესტი',
        email: 'member@example.test',
        personalId: '01001',
        status: 'expired',
        ...overrides.member,
      },
      m2: { firstName: 'სხვა', lastName: 'წევრი', email: 'other@example.test', status: 'active' },
    },
    subscription_plans: {
      unlimited: {
        name: 'ულიმიტო',
        type: 'unlimited',
        price: 110,
        durationDays: 30,
        remainingVisits: null,
        active: true,
        order: 3,
        ...overrides.plan,
      },
      retired: {
        name: 'ძველი',
        type: 'legacy',
        price: 50,
        durationDays: 30,
        remainingVisits: null,
        active: false,
        order: 9,
      },
    },
  });
}

/** Flitt double that always succeeds. */
function okFlitt(extra = {}) {
  return {
    createCheckout: jest.fn(async () => ({
      checkoutUrl: 'https://pay.flitt.com/checkout/abc123',
      providerPaymentId: '555000',
      requestId: 'req-1',
      raw: {},
      ...extra,
    })),
    getOrderStatus: jest.fn(),
  };
}

function buildService(db, flitt, config = CONFIG) {
  return new PaymentService({ db, flittClient: flitt, config, logger: SILENT });
}

/** Signs a callback payload the way Flitt would. */
function signedCallback(fields) {
  const payload = { merchant_id: '1549901', currency: 'GEL', ...fields };
  payload.signature = generateCallbackSignature(payload, SECRET);
  return payload;
}

async function createPaidCheckout(db, flitt) {
  const service = buildService(db, flitt);
  const checkout = await service.createCheckout({ memberId: 'm1', planId: 'unlimited' });
  return { service, checkout };
}

// ───────────────────────────────────────────── checkout ─────────────────────

describe('checkout creation', () => {
  test('reads the price from Firestore and converts GEL to tetri', async () => {
    const db = seed();
    const flitt = okFlitt();
    const { checkout } = await createPaidCheckout(db, flitt);

    expect(flitt.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amountTetri: 11000 }) // 110 GEL
    );
    expect(checkout.checkout_url || checkout.checkoutUrl).toBe(
      'https://pay.flitt.com/checkout/abc123'
    );

    const stored = db.getDoc('payments', checkout.orderId);
    expect(stored.amount).toBe(11000);
    expect(stored.priceGel).toBe(110);
    expect(stored.currency).toBe('GEL');
  });

  test('ignores any amount supplied by the caller', async () => {
    const db = seed();
    const flitt = okFlitt();
    const service = buildService(db, flitt);

    // A hostile client tries to pay 1 tetri.
    const checkout = await service.createCheckout({
      memberId: 'm1',
      planId: 'unlimited',
      amount: 1,
      subscriptionPrice: 1,
    });

    expect(db.getDoc('payments', checkout.orderId).amount).toBe(11000);
  });

  test('creates the payment record as pending before calling Flitt', async () => {
    const db = seed();
    let statusAtCallTime = null;
    const flitt = {
      createCheckout: jest.fn(async ({ orderId }) => {
        statusAtCallTime = db.getDoc('payments', orderId).status;
        return { checkoutUrl: 'https://pay.flitt.com/c/1', providerPaymentId: '1', raw: {} };
      }),
    };
    await createPaidCheckout(db, flitt);
    expect(statusAtCallTime).toBe(STATUS.PENDING);
  });

  test('generates a unique order_id per attempt containing no personal data', async () => {
    const db = seed();
    const flitt = okFlitt();
    const service = buildService(db, flitt);

    const a = await service.createCheckout({ memberId: 'm1', planId: 'unlimited' });
    const b = await service.createCheckout({ memberId: 'm1', planId: 'unlimited' });

    expect(a.orderId).not.toBe(b.orderId);
    expect(a.orderId).toMatch(/^GYM-[0-9a-f-]{36}$/);
    expect(a.orderId).not.toContain('01001'); // personalId
    expect(a.orderId).not.toContain('member@example.test');
  });

  test('rejects an unknown plan', async () => {
    const service = buildService(seed(), okFlitt());
    await expect(service.createCheckout({ memberId: 'm1', planId: 'nope' })).rejects.toMatchObject({
      code: 'plan_not_found',
    });
  });

  test('rejects an inactive plan', async () => {
    const service = buildService(seed(), okFlitt());
    await expect(
      service.createCheckout({ memberId: 'm1', planId: 'retired' })
    ).rejects.toMatchObject({ code: 'plan_inactive' });
  });

  test('records the failure but keeps the payment when Flitt errors', async () => {
    const db = seed();
    const flitt = {
      createCheckout: jest.fn(async () => {
        throw new FlittApiError('rejected', { code: 'checkout_rejected', errorCode: '1017' });
      }),
    };
    const service = buildService(db, flitt);

    await expect(
      service.createCheckout({ memberId: 'm1', planId: 'unlimited' })
    ).rejects.toMatchObject({ code: 'checkout_failed' });

    const payments = Object.values(db.dump('payments'));
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe(STATUS.FAILED);
    expect(payments[0].responseCode).toBe('1017');
  });

  test('handles a network timeout without activating anything', async () => {
    const db = seed();
    const flitt = {
      createCheckout: jest.fn(async () => {
        throw new FlittApiError('timed out', { code: 'timeout' });
      }),
    };
    await expect(
      buildService(db, flitt).createCheckout({ memberId: 'm1', planId: 'unlimited' })
    ).rejects.toMatchObject({ code: 'checkout_failed' });

    expect(db.getDoc('members', 'm1').status).toBe('expired');
  });
});

// ───────────────────────────────────────────── callback ─────────────────────

describe('callback processing', () => {
  test('approved callback activates the membership', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    const result = await service.applyProviderResult(
      signedCallback({
        order_id: checkout.orderId,
        order_status: 'approved',
        amount: 11000,
        payment_id: '999',
        masked_card: '444455XXXXXX1111',
      })
    );

    expect(result.membershipActivated).toBe(true);
    const member = db.getDoc('members', 'm1');
    expect(member.status).toBe('active');
    expect(member.subscriptionType).toBe('unlimited');
    expect(member.subscriptionPrice).toBe(110);
    expect(new Date(member.subscriptionEndDate).getTime()).toBeGreaterThan(Date.now());

    const payment = db.getDoc('payments', checkout.orderId);
    expect(payment.status).toBe(STATUS.PAID);
    expect(payment.providerStatus).toBe('approved');
    expect(payment.maskedCard).toBe('444455XXXXXX1111');
  });

  test('writes a finance transaction matching the app shape', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    await service.applyProviderResult(
      signedCallback({ order_id: checkout.orderId, order_status: 'approved', amount: 11000 })
    );

    const txs = Object.values(db.dump('transactions'));
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      category: 'membership',
      amount: 110, // whole GEL, as the finance module expects
      memberId: 'm1',
      paymentMethod: 'FLITT',
      subscriptionType: 'unlimited',
    });
  });

  test('declined callback does not activate the membership', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    const result = await service.applyProviderResult(
      signedCallback({ order_id: checkout.orderId, order_status: 'declined', amount: 11000 })
    );

    expect(result.membershipActivated).toBe(false);
    expect(db.getDoc('members', 'm1').status).toBe('expired');
    expect(db.getDoc('payments', checkout.orderId).status).toBe(STATUS.FAILED);
  });

  test('expired callback does not activate the membership', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    await service.applyProviderResult(
      signedCallback({ order_id: checkout.orderId, order_status: 'expired', amount: 11000 })
    );

    expect(db.getDoc('members', 'm1').status).toBe('expired');
    expect(db.getDoc('payments', checkout.orderId).status).toBe(STATUS.EXPIRED);
  });

  test('amount mismatch does not activate the membership', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    await expect(
      service.applyProviderResult(
        signedCallback({ order_id: checkout.orderId, order_status: 'approved', amount: 100 })
      )
    ).rejects.toMatchObject({ code: 'amount_mismatch' });

    expect(db.getDoc('members', 'm1').status).toBe('expired');
    expect(db.getDoc('payments', checkout.orderId).status).toBe(STATUS.PENDING);
  });

  test('currency mismatch does not activate the membership', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    await expect(
      service.applyProviderResult(
        signedCallback({
          order_id: checkout.orderId,
          order_status: 'approved',
          amount: 11000,
          currency: 'USD',
        })
      )
    ).rejects.toMatchObject({ code: 'currency_mismatch' });

    expect(db.getDoc('members', 'm1').status).toBe('expired');
  });

  test('actual_amount mismatch does not activate the membership', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    await expect(
      service.applyProviderResult(
        signedCallback({
          order_id: checkout.orderId,
          order_status: 'approved',
          amount: 11000,
          actual_amount: 1,
        })
      )
    ).rejects.toMatchObject({ code: 'amount_mismatch' });

    expect(db.getDoc('members', 'm1').status).toBe('expired');
  });

  test('merchant_id mismatch does not activate the membership', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    await expect(
      service.applyProviderResult(
        signedCallback({
          order_id: checkout.orderId,
          order_status: 'approved',
          amount: 11000,
          merchant_id: '9999999',
        })
      )
    ).rejects.toMatchObject({ code: 'merchant_mismatch' });

    expect(db.getDoc('members', 'm1').status).toBe('expired');
  });

  test('unknown order does not create a payment or membership', async () => {
    const db = seed();
    const service = buildService(db, okFlitt());

    await expect(
      service.applyProviderResult(
        signedCallback({ order_id: 'GYM-does-not-exist', order_status: 'approved', amount: 11000 })
      )
    ).rejects.toMatchObject({ code: 'order_unknown' });

    expect(Object.keys(db.dump('payments'))).toHaveLength(0);
    expect(db.getDoc('members', 'm1').status).toBe('expired');
  });

  test('merchant_data mismatch is rejected', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    await expect(
      service.applyProviderResult(
        signedCallback({
          order_id: checkout.orderId,
          order_status: 'approved',
          amount: 11000,
          merchant_data: 'someone-elses-uuid',
        })
      )
    ).rejects.toMatchObject({ code: 'merchant_data_mismatch' });
  });

  test('never persists raw card data from the callback', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    await service.applyProviderResult(
      signedCallback({
        order_id: checkout.orderId,
        order_status: 'approved',
        amount: 11000,
        card_number: '4444555566661111',
        cvv: '123',
        expiry_date: '1230',
      })
    );

    const raw = db.getDoc('payments', checkout.orderId).rawCallback;
    expect(raw.card_number).toBeUndefined();
    expect(raw.cvv).toBeUndefined();
    expect(raw.expiry_date).toBeUndefined();
    expect(raw.signature).toBeUndefined();
    expect(JSON.stringify(db.getDoc('payments', checkout.orderId))).not.toContain(
      '4444555566661111'
    );
  });
});

// ───────────────────────────────────────── idempotency ──────────────────────

describe('idempotency', () => {
  test('duplicate approved callback activates the membership only once', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());
    const payload = signedCallback({
      order_id: checkout.orderId,
      order_status: 'approved',
      amount: 11000,
    });

    const first = await service.applyProviderResult(payload);
    const second = await service.applyProviderResult(payload);
    const third = await service.applyProviderResult(payload);

    expect(first.membershipActivated).toBe(true);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.membershipActivated).toBe(true);
    expect(third.alreadyProcessed).toBe(true);

    // Exactly one finance transaction — no double-charging the books.
    expect(Object.values(db.dump('transactions'))).toHaveLength(1);
  });

  test('a later callback cannot overwrite a terminal payment', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());

    await service.applyProviderResult(
      signedCallback({ order_id: checkout.orderId, order_status: 'approved', amount: 11000 })
    );
    // A spoofed/late "declined" must not revoke a paid membership.
    await service.applyProviderResult(
      signedCallback({ order_id: checkout.orderId, order_status: 'declined', amount: 11000 })
    );

    expect(db.getDoc('payments', checkout.orderId).status).toBe(STATUS.PAID);
    expect(db.getDoc('members', 'm1').status).toBe('active');
  });

  test('retry after a failure activates exactly once', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());
    const payload = signedCallback({
      order_id: checkout.orderId,
      order_status: 'approved',
      amount: 11000,
    });

    // Simulate the first delivery failing mid-transaction.
    const original = db.runTransaction.bind(db);
    db.runTransaction = async () => {
      throw new Error('simulated infrastructure failure');
    };
    await expect(service.applyProviderResult(payload)).rejects.toThrow('simulated');
    expect(db.getDoc('members', 'm1').status).toBe('expired'); // rolled back

    // Flitt retries.
    db.runTransaction = original;
    const retry = await service.applyProviderResult(payload);

    expect(retry.membershipActivated).toBe(true);
    expect(db.getDoc('members', 'm1').status).toBe('active');
    expect(Object.values(db.dump('transactions'))).toHaveLength(1);
  });

  test('reconciliation reuses the callback path and cannot double-activate', async () => {
    const db = seed();
    const flitt = okFlitt();
    const { service, checkout } = await createPaidCheckout(db, flitt);

    await service.applyProviderResult(
      signedCallback({ order_id: checkout.orderId, order_status: 'approved', amount: 11000 })
    );

    flitt.getOrderStatus = jest.fn(async () => ({
      order_id: checkout.orderId,
      order_status: 'approved',
      amount: 11000,
      currency: 'GEL',
      merchant_id: '1549901',
    }));

    const result = await service.reconcile(checkout.orderId);

    expect(result.alreadyProcessed).toBe(true);
    expect(Object.values(db.dump('transactions'))).toHaveLength(1);
  });
});

// ───────────────────────────────────── status authorisation ─────────────────

describe('payment status authorisation', () => {
  test('a member can read their own payment', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());
    const payment = await service.getPaymentForMember(checkout.paymentId, 'm1');
    expect(payment.orderId).toBe(checkout.orderId);
  });

  test('a member cannot read another member payment', async () => {
    const db = seed();
    const { service, checkout } = await createPaidCheckout(db, okFlitt());
    expect(await service.getPaymentForMember(checkout.paymentId, 'm2')).toBeNull();
  });
});
