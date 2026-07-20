'use strict';

import { loadConfig, isAllowedCheckoutUrl, ConfigurationError } from './config.js';
import { FirestoreRest } from './firestore.js';
import { FlittClient } from './flittClient.js';
import { PaymentService, PaymentError } from './paymentService.js';
import { verifyCallbackSignature } from './signature.js';
import {
  issueToken,
  verifyToken,
  verifyMemberCredentials,
  getSessionSecret,
  bearerFrom,
  isFlittAllowed,
  AuthError,
} from './auth.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function errorResponse(error, cors) {
  if (error instanceof ConfigurationError) {
    console.error(`[flitt] configuration error: ${error.message}`);
    return json({ error: 'გადახდის სისტემა კონფიგურირებული არ არის' }, 503, cors);
  }
  const status = error.httpStatus || 500;
  // Never leak stack traces or provider internals to the client.
  const message = status >= 500 ? 'დროებითი შეცდომა. სცადეთ ხელახლა.' : error.message || 'შეცდომა';
  if (status >= 500) console.error(`[flitt] ${error.code || error.name}: ${error.message}`);
  return json({ error: message, code: error.code || undefined }, status, cors);
}

function buildDb(env) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch (_) {
    throw new ConfigurationError('FIREBASE_SERVICE_ACCOUNT is missing or not valid JSON');
  }
  return new FirestoreRest({
    projectId: serviceAccount.project_id,
    serviceAccount,
  });
}

function requireEnabled(config) {
  if (!config.enabled) {
    throw new PaymentError('flitt_disabled', 'ონლაინ გადახდა დროებით მიუწვდომელია', 503);
  }
}

function buildService(env, config, db) {
  const flittClient = new FlittClient(config, { httpClient: fetch });
  return new PaymentService({ db, flittClient, config });
}

async function authenticate(request, env, db) {
  const memberId = await verifyToken(bearerFrom(request), getSessionSecret(env));
  const snap = await db.collection('members').doc(memberId).get();
  if (!snap.exists) throw new AuthError('Member not found');
  return { id: snap.id, ...snap.data() };
}

// ── route handlers ─────────────────────────────────────────────────────────

/** POST /auth/session — exchange member credentials for a session token. */
async function handleSession(request, env, config, db, cors) {
  const body = await request.json().catch(() => ({}));
  const member = await verifyMemberCredentials(db, body.email, body.password);
  const token = await issueToken(member.id, getSessionSecret(env));

  return json(
    {
      token,
      member_id: member.id,
      flitt_enabled: Boolean(config && config.enabled && isFlittAllowed(member, config)),
      flitt_mode: config ? config.mode : null,
    },
    200,
    cors
  );
}

/** POST /payments/flitt/checkout — authenticated; client sends only a plan id. */
async function handleCheckout(request, env, config, db, cors) {
  requireEnabled(config);
  const member = await authenticate(request, env, db);

  if (!isFlittAllowed(member, config)) {
    throw new PaymentError(
      'not_allowed',
      'ონლაინ გადახდა ამ ანგარიშზე ჯერ არ არის ხელმისაწვდომი',
      403
    );
  }

  const body = await request.json().catch(() => ({}));
  const planId = body.membership_plan_id;
  if (!planId || typeof planId !== 'string') {
    throw new PaymentError('plan_required', 'აირჩიეთ აბონემენტი', 400);
  }

  const service = buildService(env, config, db);
  const result = await service.createCheckout({ memberId: member.id, planId });

  // Open-redirect guard: only ever hand back a Flitt HTTPS URL.
  if (!isAllowedCheckoutUrl(result.checkoutUrl, config)) {
    console.error('[flitt] checkout_url failed host allowlist');
    throw new PaymentError('checkout_failed', 'გადახდის გვერდის შექმნა ვერ მოხერხდა', 502);
  }

  return json(
    {
      payment_id: result.paymentId,
      order_id: result.orderId,
      status: result.status,
      checkout_url: result.checkoutUrl,
    },
    200,
    cors
  );
}

/** GET /payments/{uuid}/status — members may only read their own payment. */
async function handleStatus(request, env, config, db, cors, paymentUuid) {
  const member = await authenticate(request, env, db);
  const service = buildService(env, config, db);

  const payment = await service.getPaymentForMember(paymentUuid, member.id);
  if (!payment) throw new PaymentError('not_found', 'გადახდა ვერ მოიძებნა', 404);

  const fresh = await db.collection('members').doc(member.id).get();
  const membershipStatus = fresh.exists ? fresh.data().status || 'unknown' : 'unknown';

  // Deliberately narrow: no raw callback, no provider internals.
  return json(
    {
      payment_id: payment.uuid,
      order_id: payment.orderId,
      status: payment.status,
      membership_status: membershipStatus,
    },
    200,
    cors
  );
}

/**
 * POST /payments/flitt/callback — public. No browser auth, no CSRF.
 * The signature IS the authentication.
 */
async function handleCallback(request, env, config, db) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ error: 'Invalid payload' }, 400);
  }

  // Flitt posts a flat object; tolerate a `response` wrapper just in case.
  const data =
    payload.response && typeof payload.response === 'object' ? payload.response : payload;

  if (!(await verifyCallbackSignature(data, config.secretKey))) {
    // Log the fact, never the signature source string (it contains the secret).
    console.warn(
      JSON.stringify({
        event: 'flitt.callback.signature_invalid',
        orderId: data.order_id || null,
        ts: new Date().toISOString(),
      })
    );
    return json({ error: 'Invalid signature' }, 400);
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
    const service = buildService(env, config, db);
    await service.applyProviderResult(data, { source: 'callback' });
    // 200 with an empty body stops Flitt retrying.
    return new Response('', { status: 200 });
  } catch (error) {
    if (error.code === 'order_unknown') {
      // Signature valid but no such order. Do not create anything.
      // 200 deliberately: retries cannot fix an order we never made.
      console.warn(
        JSON.stringify({
          event: 'flitt.callback.order_unknown',
          orderId: data.order_id || null,
          ts: new Date().toISOString(),
        })
      );
      return new Response('', { status: 200 });
    }
    // Genuine processing failure: non-200 so Flitt retries.
    console.error(
      JSON.stringify({
        event: 'flitt.callback.processing_failed',
        orderId: data.order_id || null,
        code: error.code || null,
        ts: new Date().toISOString(),
      })
    );
    return json({ error: 'Processing failed' }, 500);
  }
}

// ── router ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const cors = corsHeaders(request.headers.get('origin'));

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    let config;
    try {
      config = loadConfig(env);
    } catch (error) {
      return errorResponse(error, cors);
    }

    let db;
    try {
      db = buildDb(env);
    } catch (error) {
      return errorResponse(error, cors);
    }

    try {
      // Public callback first — it must never be behind auth.
      if (path === '/payments/flitt/callback' && request.method === 'POST') {
        return await handleCallback(request, env, config, db);
      }

      if (path === '/auth/session' && request.method === 'POST') {
        return await handleSession(request, env, config, db, cors);
      }

      if (path === '/payments/flitt/checkout' && request.method === 'POST') {
        return await handleCheckout(request, env, config, db, cors);
      }

      const statusMatch = path.match(/^\/payments\/([^/]+)\/status$/);
      if (statusMatch && request.method === 'GET') {
        return await handleStatus(request, env, config, db, cors, statusMatch[1]);
      }

      if (path === '/health') {
        return json({ ok: true, mode: config.mode, enabled: config.enabled }, 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      return errorResponse(error, cors);
    }
  },
};
