'use strict';

const crypto = require('crypto');

/**
 * Flitt signature algorithm (docs.flitt.com/api/building-signature/).
 *
 * SHA-1 over: secret_key + "|" + values of all parameters sorted by key name.
 * Excluded: `signature`, null, undefined and empty-string values.
 * Zero values ARE preserved — `0` is meaningful, `''` is not.
 */

const ALWAYS_EXCLUDED = ['signature'];
// Flitt echoes back the string it signed; it is never itself part of the input.
const CALLBACK_EXCLUDED = ['signature', 'response_signature_string'];

/**
 * Builds the pipe-joined source string that gets hashed.
 * Exported separately so tests can assert the string itself, independent of the digest.
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

function sha1Lower(input) {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex').toLowerCase();
}

/** Signature for an outgoing request to Flitt. */
function generateSignature(params, secretKey) {
  return sha1Lower(buildSignatureSource(params, secretKey, ALWAYS_EXCLUDED));
}

/** Expected signature for an inbound Flitt callback / status response. */
function generateCallbackSignature(params, secretKey) {
  return sha1Lower(buildSignatureSource(params, secretKey, CALLBACK_EXCLUDED));
}

/**
 * Constant-time comparison. Returns false rather than throwing on malformed input
 * so callers can treat "bad signature" and "no signature" identically.
 */
function verifyCallbackSignature(params, secretKey) {
  const received = params && params.signature;
  if (typeof received !== 'string' || received.length === 0) return false;

  const expected = generateCallbackSignature(params, secretKey);

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received.toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  buildSignatureSource,
  generateSignature,
  generateCallbackSignature,
  verifyCallbackSignature,
  sha1Lower,
  ALWAYS_EXCLUDED,
  CALLBACK_EXCLUDED,
};
