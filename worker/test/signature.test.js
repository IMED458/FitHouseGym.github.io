'use strict';

import {
  buildSignatureSource,
  generateSignature,
  generateCallbackSignature,
  verifyCallbackSignature,
  sha1Lower,
} from '../src/signature.js';

const SECRET = 'test';

// Official worked example from https://docs.flitt.com/api/building-signature/
const OFFICIAL_PARAMS = {
  amount: 1000,
  currency: 'GEL',
  merchant_id: 1549901,
  order_desc: 'Test payment',
  order_id: 'TestOrder2',
  server_callback_url: 'http://myshop/callback/',
};
const OFFICIAL_SOURCE = 'test|1000|GEL|1549901|Test payment|TestOrder2|http://myshop/callback/';

describe('signature source construction (official fixture)', () => {
  test('reproduces the documented signature source string exactly', () => {
    expect(buildSignatureSource(OFFICIAL_PARAMS, SECRET)).toBe(OFFICIAL_SOURCE);
  });

  /**
   * KNOWN DISCREPANCY IN FLITT'S DOCS.
   *
   * docs.flitt.com publishes signature `91ea7da493a8367410fe3d7f877fb5e0ed666490`
   * for the source string asserted above, but SHA-1 of that exact string is
   * `cd0edb710cbbdb6c2a4d965cdb91fdfabc343215`. The published digest is not
   * reproducible from the published string (verified against many variations of
   * amount/currency/description/callback-url).
   *
   * We therefore pin the string construction (the part of the algorithm that is
   * unambiguous and verifiable) and record the real digest. This test will fail
   * loudly if either ever changes, and MUST be re-validated against the Flitt
   * sandbox before any production rollout.
   */
  test('documents the actual SHA-1 of the documented source string', async () => {
    await expect(generateSignature(OFFICIAL_PARAMS, SECRET)).resolves.toBe(
      'cd0edb710cbbdb6c2a4d965cdb91fdfabc343215'
    );
    await expect(sha1Lower(OFFICIAL_SOURCE)).resolves.not.toBe(
      '91ea7da493a8367410fe3d7f877fb5e0ed666490'
    );
  });
});

describe('signature algorithm rules', () => {
  test('sorts parameters alphabetically by key, not by insertion order', () => {
    const scrambled = {
      server_callback_url: 'http://myshop/callback/',
      order_id: 'TestOrder2',
      merchant_id: 1549901,
      currency: 'GEL',
      order_desc: 'Test payment',
      amount: 1000,
    };
    expect(buildSignatureSource(scrambled, SECRET)).toBe(OFFICIAL_SOURCE);
  });

  test('excludes empty-string values', () => {
    const source = buildSignatureSource({ a: '1', b: '', c: '2' }, SECRET);
    expect(source).toBe('test|1|2');
  });

  test('excludes null and undefined values', () => {
    const source = buildSignatureSource({ a: '1', b: null, c: undefined, d: '2' }, SECRET);
    expect(source).toBe('test|1|2');
  });

  test('preserves zero values', () => {
    const source = buildSignatureSource({ a: 0, b: '0', c: 1 }, SECRET);
    expect(source).toBe('test|0|0|1');
  });

  test('excludes the signature parameter itself', () => {
    const withSig = { ...OFFICIAL_PARAMS, signature: 'deadbeef' };
    expect(buildSignatureSource(withSig, SECRET)).toBe(OFFICIAL_SOURCE);
  });

  test('produces lowercase hexadecimal SHA-1', async () => {
    const sig = await generateSignature(OFFICIAL_PARAMS, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{40}$/);
    expect(sig).toBe(sig.toLowerCase());
  });

  test('handles UTF-8 (Georgian) values', async () => {
    const source = buildSignatureSource({ order_desc: 'აბონემენტი' }, SECRET);
    expect(source).toBe('test|აბონემენტი');
    await expect(generateSignature({ order_desc: 'აბონემენტი' }, SECRET)).resolves.toMatch(
      /^[0-9a-f]{40}$/
    );
  });

  test('requires a secret key', () => {
    expect(() => buildSignatureSource(OFFICIAL_PARAMS, '')).toThrow(/secretKey/);
  });
});

describe('callback signature verification', () => {
  test('excludes response_signature_string from the calculation', async () => {
    const base = { order_id: 'GYM-1', order_status: 'approved', amount: 1000 };
    const withEcho = { ...base, response_signature_string: 'test|1000|GYM-1|approved' };
    expect(await generateCallbackSignature(withEcho, SECRET)).toBe(
      await generateCallbackSignature(base, SECRET)
    );
  });

  test('accepts a valid callback signature', async () => {
    const payload = { order_id: 'GYM-1', order_status: 'approved', amount: 1000, currency: 'GEL' };
    payload.signature = await generateCallbackSignature(payload, SECRET);
    await expect(verifyCallbackSignature(payload, SECRET)).resolves.toBe(true);
  });

  test('rejects a tampered callback signature', async () => {
    const payload = { order_id: 'GYM-1', order_status: 'approved', amount: 1000, currency: 'GEL' };
    payload.signature = await generateCallbackSignature(payload, SECRET);
    payload.amount = 1; // attacker lowers the amount after signing
    await expect(verifyCallbackSignature(payload, SECRET)).resolves.toBe(false);
  });

  test('rejects a missing signature', async () => {
    await expect(verifyCallbackSignature({ order_id: 'GYM-1' }, SECRET)).resolves.toBe(false);
  });

  test('rejects a signature of the wrong length without throwing', async () => {
    await expect(
      verifyCallbackSignature({ order_id: 'GYM-1', signature: 'abc' }, SECRET)
    ).resolves.toBe(false);
  });

  test('is case-insensitive on the received signature', async () => {
    const payload = { order_id: 'GYM-1', order_status: 'approved' };
    payload.signature = (await generateCallbackSignature(payload, SECRET)).toUpperCase();
    await expect(verifyCallbackSignature(payload, SECRET)).resolves.toBe(true);
  });
});
