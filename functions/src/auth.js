'use strict';

const crypto = require('crypto');

/**
 * Minimal server-side session tokens.
 *
 * The project has no Firebase Auth — logins are custom checks against Firestore.
 * Rather than rebuild authentication (invasive, and out of scope for stage 1),
 * this issues a short-lived HMAC token after the server re-verifies the member's
 * credentials. The token is the only thing the checkout endpoint trusts.
 */

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

class AuthError extends Error {
  constructor(message, httpStatus = 401) {
    super(message);
    this.name = 'AuthError';
    this.httpStatus = httpStatus;
  }
}

function getSessionSecret(env = process.env) {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET is required and must be at least 16 characters');
  }
  return secret;
}

function sign(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function issueToken(memberId, secret, now = Date.now()) {
  const payload = { sub: memberId, exp: now + TOKEN_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new AuthError('Invalid session token');
  }
  const [payloadB64, providedSig] = token.split('.');
  if (!payloadB64 || !providedSig) throw new AuthError('Invalid session token');

  const expectedSig = sign(payloadB64, secret);
  const a = Buffer.from(expectedSig, 'utf8');
  const b = Buffer.from(providedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AuthError('Invalid session token');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_) {
    throw new AuthError('Invalid session token');
  }

  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new AuthError('Session expired');
  }
  return payload.sub;
}

/**
 * Re-verifies member credentials against Firestore, server-side.
 * Mirrors the member portal's rule: the `password` field wins when set,
 * otherwise `personalId` is the fallback for members who never changed it.
 */
async function verifyMemberCredentials(db, email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !password) throw new AuthError('Email and password are required');

  const snap = await db.collection('members').where('email', '==', normalized).limit(10).get();
  if (snap.empty) throw new AuthError('Invalid credentials');

  for (const doc of snap.docs) {
    const data = doc.data();
    const expected = data.password ? data.password : data.personalId;
    if (typeof expected !== 'string' || expected.length === 0) continue;

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(password), 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { id: doc.id, ...data };
    }
  }
  throw new AuthError('Invalid credentials');
}

function bearerFrom(req) {
  const header = req.get ? req.get('authorization') : req.headers?.authorization;
  if (!header || !/^Bearer\s+/i.test(header)) throw new AuthError('Missing bearer token');
  return header.replace(/^Bearer\s+/i, '').trim();
}

/** Stage-1 rollout gate: allowlisted emails only. */
function isFlittAllowed(member, config) {
  const email = String(member.email || '').trim().toLowerCase();
  return config.allowedEmails.includes(email);
}

module.exports = {
  issueToken,
  verifyToken,
  verifyMemberCredentials,
  getSessionSecret,
  bearerFrom,
  isFlittAllowed,
  AuthError,
  TOKEN_TTL_MS,
};
