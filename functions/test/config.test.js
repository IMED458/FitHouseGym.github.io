'use strict';

const { loadConfig, isAllowedCheckoutUrl, ConfigurationError } = require('../src/config');
const { gelToTetri, tetriToGel } = require('../src/money');
const { mapProviderStatus, isTerminal, grantsMembership, STATUS } = require('../src/paymentStatus');
const { computeSubscriptionPeriod } = require('../src/membership');

const VALID_ENV = {
  FLITT_ENABLED: 'true',
  FLITT_MODE: 'test',
  FLITT_API_BASE_URL: 'https://pay.flitt.com',
  FLITT_MERCHANT_ID: '1549901',
  FLITT_SECRET_KEY: 'test',
  FLITT_CURRENCY: 'GEL',
  FLITT_LANGUAGE: 'ka',
  FLITT_RESPONSE_URL: 'https://example.test/payments/flitt/result',
  FLITT_CALLBACK_URL: 'https://example.test/api/payments/flitt/callback',
  FLITT_CANCEL_URL: 'https://example.test/payments/flitt/cancel',
};

describe('configuration', () => {
  test('loads a valid test configuration', () => {
    const config = loadConfig(VALID_ENV);
    expect(config.mode).toBe('test');
    expect(config.merchantId).toBe('1549901');
    expect(config.protocolVersion).toBe('1.0.1');
  });

  test('reports every missing variable by name', () => {
    const env = { ...VALID_ENV };
    delete env.FLITT_SECRET_KEY;
    delete env.FLITT_CALLBACK_URL;
    expect(() => loadConfig(env)).toThrow(ConfigurationError);
    expect(() => loadConfig(env)).toThrow(/FLITT_SECRET_KEY.*FLITT_CALLBACK_URL/s);
  });

  test('refuses a production merchant while in test mode', () => {
    expect(() => loadConfig({ ...VALID_ENV, FLITT_MERCHANT_ID: '1396424' })).toThrow(
      /sandbox merchant/i
    );
  });

  test('refuses a non-sandbox secret while in test mode', () => {
    expect(() => loadConfig({ ...VALID_ENV, FLITT_SECRET_KEY: 'real_live_key' })).toThrow(
      /sandbox secret key/i
    );
  });

  test('refuses sandbox credentials while in production mode', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, FLITT_MODE: 'production' })
    ).toThrow(/sandbox merchant\/secret/i);
  });

  test('requires https for every callback URL', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, FLITT_CALLBACK_URL: 'http://example.test/cb' })
    ).toThrow(/https/i);
  });
});

describe('checkout url allowlist (open-redirect guard)', () => {
  const config = loadConfig(VALID_ENV);

  test('accepts a Flitt https URL', () => {
    expect(isAllowedCheckoutUrl('https://pay.flitt.com/checkout/x', config)).toBe(true);
  });

  test('rejects a foreign host', () => {
    expect(isAllowedCheckoutUrl('https://evil.example/checkout', config)).toBe(false);
  });

  test('rejects plaintext http', () => {
    expect(isAllowedCheckoutUrl('http://pay.flitt.com/checkout/x', config)).toBe(false);
  });

  test('rejects a lookalike host', () => {
    expect(isAllowedCheckoutUrl('https://pay.flitt.com.evil.example/x', config)).toBe(false);
  });
});

describe('money conversion', () => {
  test('converts GEL to integer tetri', () => {
    expect(gelToTetri(50)).toBe(5000);
    expect(gelToTetri(120)).toBe(12000);
    expect(gelToTetri(70)).toBe(7000);
  });

  test('avoids floating point drift', () => {
    expect(gelToTetri(70.1)).toBe(7010);
    expect(gelToTetri(0.07)).toBe(7);
    expect(Number.isInteger(gelToTetri(19.99))).toBe(true);
  });

  test('round-trips', () => {
    expect(tetriToGel(gelToTetri(110))).toBe(110);
  });

  test('rejects negative and non-numeric amounts', () => {
    expect(() => gelToTetri(-1)).toThrow();
    expect(() => gelToTetri('abc')).toThrow();
  });
});

describe('provider status mapping', () => {
  test.each([
    ['created', STATUS.PENDING],
    ['processing', STATUS.PROCESSING],
    ['approved', STATUS.PAID],
    ['declined', STATUS.FAILED],
    ['expired', STATUS.EXPIRED],
    ['reversed', STATUS.REVERSED],
  ])('maps %s -> %s', (provider, internal) => {
    expect(mapProviderStatus(provider)).toBe(internal);
  });

  test('returns null for an unknown status', () => {
    expect(mapProviderStatus('teleported')).toBeNull();
    expect(mapProviderStatus(undefined)).toBeNull();
  });

  test('only paid grants membership', () => {
    expect(grantsMembership(STATUS.PAID)).toBe(true);
    for (const s of [STATUS.PENDING, STATUS.PROCESSING, STATUS.FAILED, STATUS.EXPIRED, STATUS.REVERSED]) {
      expect(grantsMembership(s)).toBe(false);
    }
  });

  test('terminal states are terminal', () => {
    expect(isTerminal(STATUS.PAID)).toBe(true);
    expect(isTerminal(STATUS.FAILED)).toBe(true);
    expect(isTerminal(STATUS.PENDING)).toBe(false);
    expect(isTerminal(STATUS.PROCESSING)).toBe(false);
  });
});

describe('subscription period (mirrors app.js rules)', () => {
  test('a 30-day plan lands one month out, end of day', () => {
    const { startDate, endDate } = computeSubscriptionPeriod(
      { durationDays: 30 },
      new Date('2026-01-15T10:00:00')
    );
    const end = new Date(endDate);
    expect(new Date(startDate).getMonth()).toBe(0);
    expect(end.getMonth()).toBe(1); // February
    expect(end.getDate()).toBe(15);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  test('a single-visit plan expires the same day', () => {
    const { endDate } = computeSubscriptionPeriod(
      { durationDays: 1 },
      new Date('2026-03-10T08:00:00')
    );
    const end = new Date(endDate);
    expect(end.getDate()).toBe(10);
    expect(end.getMonth()).toBe(2);
    expect(end.getHours()).toBe(23);
  });

  test('clamps to the last day of a shorter month', () => {
    const { endDate } = computeSubscriptionPeriod(
      { durationDays: 30 },
      new Date('2026-01-31T10:00:00')
    );
    expect(new Date(endDate).getMonth()).toBe(1); // Feb
    expect(new Date(endDate).getDate()).toBe(28);
  });
});
