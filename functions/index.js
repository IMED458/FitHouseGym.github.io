'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

const { loadConfig, isAllowedCheckoutUrl, ConfigurationError } = require('./src/config');
const { FlittClient } = require('./src/flittClient');
const { PaymentService, PaymentError } = require('./src/paymentService');
const { verifyCallbackSignature } = require('./src/signature');
const {
  issueToken,
  verifyToken,
  verifyMemberCredentials,
  getSessionSecret,
  bearerFrom,
  isFlittAllowed,
  AuthError,
} = require('./src/auth');

admin.initializeApp();
const db = admin.firestore();

// Fail fast and loudly on misconfiguration rather than at first payment.
let config = null;
let configError = null;
try {
  config = loadConfig();
} catch (error) {
  configError = error;
  console.error(`[flitt] configuration error: ${error.message}`);
}

function requireConfig() {
  if (configError) throw configError;
  if (!config.enabled) {
    const err = new PaymentError('flitt_disabled', 'ონლაინ გადახდა დროებით მიუწვდომელია', 503);
    throw err;
  }
  return config;
}

function buildService() {
  const cfg = requireConfig();
  const flittClient = new FlittClient(cfg, { httpClient: globalThis.fetch });
  return new PaymentService({ db, flittClient, config: cfg });
}

function sendError(res, error) {
  if (error instanceof ConfigurationError) {
    console.error(`[flitt] ${error.message}`);
    return res.status(503).json({ error: 'გადახდის სისტემა კონფიგურირებული არ არის' });
  }
  const status = error.httpStatus || 500;
  const message =
    status >= 500 ? 'დროებითი შეცდომა. სცადეთ ხელახლა.' : error.message || 'შეცდომა';
  if (status >= 500) console.error(`[flitt] ${error.code || error.name}: ${error.message}`);
  // Never leak stack traces or provider internals to the client.
  return res.status(status).json({ error: message, code: error.code || undefined });
}

// ───────────────────────────────────────────────────────────────────────────
// Authenticated API (member session token)
// ───────────────────────────────────────────────────────────────────────────
const api = express();
api.use(cors({ origin: true }));
api.use(express.json({ limit: '64kb' }));

/** Exchanges member credentials for a short-lived session token. */
api.post('/auth/session', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const member = await verifyMemberCredentials(db, email, password);
    const token = issueToken(member.id, getSessionSecret());
    const cfg = configError ? null : config;
    return res.json({
      token,
      member_id: member.id,
      flitt_enabled: Boolean(cfg && cfg.enabled && isFlittAllowed(member, cfg)),
      flitt_mode: cfg ? cfg.mode : null,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

async function authenticate(req) {
  const memberId = verifyToken(bearerFrom(req), getSessionSecret());
  const snap = await db.collection('members').doc(memberId).get();
  if (!snap.exists) throw new AuthError('Member not found');
  return { id: snap.id, ...snap.data() };
}

/** Creates a Flitt checkout. The client sends a plan id — never an amount. */
api.post('/payments/flitt/checkout', async (req, res) => {
  try {
    const cfg = requireConfig();
    const member = await authenticate(req);

    if (!isFlittAllowed(member, cfg)) {
      throw new PaymentError('not_allowed', 'ონლაინ გადახდა ამ ანგარიშზე ჯერ არ არის ხელმისაწვდომი', 403);
    }

    const planId = req.body && req.body.membership_plan_id;
    if (!planId || typeof planId !== 'string') {
      throw new PaymentError('plan_required', 'აირჩიეთ აბონემენტი', 400);
    }

    const service = buildService();
    const result = await service.createCheckout({ memberId: member.id, planId });

    // Open-redirect guard: only ever hand back a Flitt HTTPS URL.
    if (!isAllowedCheckoutUrl(result.checkoutUrl, cfg)) {
      console.error('[flitt] checkout_url failed host allowlist');
      throw new PaymentError('checkout_failed', 'გადახდის გვერდის შექმნა ვერ მოხერხდა', 502);
    }

    return res.json({
      payment_id: result.paymentId,
      order_id: result.orderId,
      status: result.status,
      checkout_url: result.checkoutUrl,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

/** Payment status for the result page. Members see only their own payments. */
api.get('/payments/:paymentUuid/status', async (req, res) => {
  try {
    const member = await authenticate(req);
    const service = buildService();
    const payment = await service.getPaymentForMember(req.params.paymentUuid, member.id);
    if (!payment) throw new PaymentError('not_found', 'გადახდა ვერ მოიძებნა', 404);

    const fresh = await db.collection('members').doc(member.id).get();
    const membershipStatus = fresh.exists ? fresh.data().status || 'unknown' : 'unknown';

    // Deliberately narrow: no raw callback, no provider internals.
    return res.json({
      payment_id: payment.uuid,
      order_id: payment.orderId,
      status: payment.status,
      membership_status: membershipStatus,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

exports.api = functions.https.onRequest(api);

// ───────────────────────────────────────────────────────────────────────────
// Public callback — no browser auth, no CSRF, signature is the authentication.
// Mounted as its own function so the CSRF/auth exemption cannot leak elsewhere.
// ───────────────────────────────────────────────────────────────────────────
const callbackApp = express();
callbackApp.use(express.json({ limit: '256kb' }));

callbackApp.post('*', async (req, res) => {
  let cfg;
  try {
    cfg = requireConfig();
  } catch (error) {
    return sendError(res, error);
  }

  const payload = req.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // Flitt posts a flat object; tolerate a `response` wrapper just in case.
  const data = payload.response && typeof payload.response === 'object' ? payload.response : payload;

  if (!verifyCallbackSignature(data, cfg.secretKey)) {
    // Log the fact, never the signature source string (it contains the secret).
    console.warn(
      JSON.stringify({
        event: 'flitt.callback.signature_invalid',
        orderId: data.order_id || null,
        ts: new Date().toISOString(),
      })
    );
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.info(
    JSON.stringify({
      event: 'flitt.callback.received',
      orderId: data.order_id || null,
      orderStatus: data.order_status || null,
      ts: new Date().toISOString(),
    })
  );

  try {
    const service = buildService();
    await service.applyProviderResult(data, { source: 'callback' });
    // 200 with an empty body stops Flitt retrying.
    return res.status(200).send('');
  } catch (error) {
    if (error.code === 'order_unknown') {
      // Signature was valid but we have no such order. Do not create anything.
      // 200 is returned deliberately: retries cannot fix an order we never made,
      // and a retry storm would only add noise. The event is logged for triage.
      console.warn(
        JSON.stringify({
          event: 'flitt.callback.order_unknown',
          orderId: data.order_id || null,
          ts: new Date().toISOString(),
        })
      );
      return res.status(200).send('');
    }
    // Genuine processing failure: return non-200 so Flitt retries.
    console.error(
      JSON.stringify({
        event: 'flitt.callback.processing_failed',
        orderId: data.order_id || null,
        code: error.code || null,
        ts: new Date().toISOString(),
      })
    );
    return res.status(500).json({ error: 'Processing failed' });
  }
});

exports.flittCallback = functions.https.onRequest(callbackApp);

// ───────────────────────────────────────────────────────────────────────────
// Admin-triggered reconciliation (callable, not exposed to the member frontend)
// ───────────────────────────────────────────────────────────────────────────
exports.reconcileFlittOrder = functions.https.onCall(async (data) => {
  requireConfig();
  const orderId = data && data.order_id;
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'order_id is required');

  const adminKey = data.admin_key;
  if (!process.env.ADMIN_API_KEY || adminKey !== process.env.ADMIN_API_KEY) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorised');
  }

  const service = buildService();
  const result = await service.reconcile(orderId);
  return { status: result.status, membership_activated: result.membershipActivated };
});
