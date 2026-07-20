'use strict';

import { safeEqualHex } from './signature.js';

/**
 * Minimal server-side session tokens.
 *
 * The project has no Firebase Auth — logins are custom checks against Firestore.
 * Rather than rebuild authentication, this issues a short-lived HMAC token after
 * the server re-verifies the member's credentials. The token is the only thing
 * the checkout endpoint trusts.
 */

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

class AuthError extends Error {
  constructor(message, httpStatus = 401) {
    super(message);
    this.name = 'AuthError';
    this.httpStatus = httpStatus;
  }
}

function b64url(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlFromString(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function stringFromB64url(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(padded)));
}

function getSessionSecret(env) {
  const secret = env && env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET is required and must be at least 16 characters');
  }
  return secret;
}

async function hmacHex(payloadB64, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return b64url(sig);
}

async function issueToken(memberId, secret, now = Date.now()) {
  const payloadB64 = b64urlFromString(JSON.stringify({ sub: memberId, exp: now + TOKEN_TTL_MS }));
  return `${payloadB64}.${await hmacHex(payloadB64, secret)}`;
}

async function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new AuthError('Invalid session token');
  }
  const [payloadB64, providedSig] = token.split('.');
  if (!payloadB64 || !providedSig) throw new AuthError('Invalid session token');

  const expectedSig = await hmacHex(payloadB64, secret);
  if (!safeEqualHex(expectedSig, providedSig)) throw new AuthError('Invalid session token');

  let payload;
  try {
    payload = JSON.parse(stringFromB64url(payloadB64));
  } catch (_) {
    throw new AuthError('Invalid session token');
  }

  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new AuthError('Session expired');
  }
  return payload.sub;
}

/** Constant-time-ish comparison for arbitrary strings (credentials). */
function safeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
    if (safeEqualString(expected, String(password))) {
      return { id: doc.id, ...data };
    }
  }
  throw new AuthError('Invalid credentials');
}

function bearerFrom(request) {
  const header = request.headers.get('authorization');
  if (!header || !/^Bearer\s+/i.test(header)) throw new AuthError('Missing bearer token');
  return header.replace(/^Bearer\s+/i, '').trim();
}

/** Stage-1 rollout gate: allowlisted emails only. */
function isFlittAllowed(member, config) {
  const email = String(member.email || '').trim().toLowerCase();
  return config.allowedEmails.includes(email);
}

export {
  issueToken,
  verifyToken,
  verifyMemberCredentials,
  getSessionSecret,
  bearerFrom,
  isFlittAllowed,
  safeEqualString,
  AuthError,
  TOKEN_TTL_MS,
};
