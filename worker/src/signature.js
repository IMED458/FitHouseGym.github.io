'use strict';

/**
 * Flitt signature algorithm (docs.flitt.com/api/building-signature/).
 *
 * SHA-1 over: secret_key + "|" + values of all parameters sorted by key name.
 * Excluded: `signature`, null, undefined and empty-string values.
 * Zero values ARE preserved — `0` is meaningful, `''` is not.
 *
 * Workers has no node:crypto, so hashing goes through WebCrypto and the
 * digest-producing functions are async.
 */

const ALWAYS_EXCLUDED = ['signature'];
// Flitt echoes back the string it signed; it is never itself part of the input.
const CALLBACK_EXCLUDED = ['signature', 'response_signature_string'];

/**
 * Builds the pipe-joined source string that gets hashed.
 * Synchronous and pure, so tests can assert it independently of the digest.
 */
function buildSignatureSource(params, secretKey, excludedKeys = ALWAYS_EXCLUDED) {
  if (typeof secretKey !== 'string' || secretKey.length === 0) {
    throw new Error('signature: secretKey is required');
  }

  const excluded = new Set(excludedKeys);
  const keys = Object.keys(params)
    .filter((key) => !excluded.has(key))
    .filter((key) => {
      const value = params[key];
      if (value === null || value === undefined) return false;
      // Preserve 0 / false, drop only genuinely empty strings.
      if (typeof value === 'string' && value.length === 0) return false;
      return true;
    })
    .sort();

  const values = keys.map((key) => String(params[key]));
  return [secretKey, ...values].join('|');
}

async function sha1Lower(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Signature for an outgoing request to Flitt. */
async function generateSignature(params, secretKey) {
  return sha1Lower(buildSignatureSource(params, secretKey, ALWAYS_EXCLUDED));
}

/** Expected signature for an inbound Flitt callback / status response. */
async function generateCallbackSignature(params, secretKey) {
  return sha1Lower(buildSignatureSource(params, secretKey, CALLBACK_EXCLUDED));
}

/** Length-safe, constant-time-ish comparison of two hex digests. */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies an inbound callback signature.
 * Returns false rather than throwing so callers can treat "bad signature"
 * and "no signature" identically.
 */
async function verifyCallbackSignature(params, secretKey) {
  const received = params && params.signature;
  if (typeof received !== 'string' || received.length === 0) return false;
  const expected = await generateCallbackSignature(params, secretKey);
  return safeEqualHex(expected, received.toLowerCase());
}

export {
  buildSignatureSource,
  generateSignature,
  generateCallbackSignature,
  verifyCallbackSignature,
  safeEqualHex,
  sha1Lower,
  ALWAYS_EXCLUDED,
  CALLBACK_EXCLUDED,
};
