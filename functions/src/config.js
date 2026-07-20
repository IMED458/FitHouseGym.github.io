'use strict';

/**
 * Flitt configuration. Values come from environment variables only —
 * nothing here may ever be bundled into the frontend.
 */

const REQUIRED_VARS = [
  'FLITT_API_BASE_URL',
  'FLITT_MERCHANT_ID',
  'FLITT_SECRET_KEY',
  'FLITT_CURRENCY',
  'FLITT_RESPONSE_URL',
  'FLITT_CALLBACK_URL',
  'FLITT_CANCEL_URL',
];

const PROTOCOL_VERSION = '1.0.1';

// Flitt's documented sandbox merchant. Guards below make sure a test-mode
// deployment can never accidentally transact against a real merchant.
const TEST_MERCHANT_ID = '1549901';
const TEST_SECRET_KEY = 'test';

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function isEnabled(env = process.env) {
  return String(env.FLITT_ENABLED || '').toLowerCase() === 'true';
}

function loadConfig(env = process.env) {
  const missing = REQUIRED_VARS.filter((key) => !env[key] || String(env[key]).trim() === '');
  if (missing.length > 0) {
    throw new ConfigurationError(
      `Flitt configuration incomplete. Missing environment variables: ${missing.join(', ')}`
    );
  }

  const mode = String(env.FLITT_MODE || 'test').toLowerCase();
  if (mode !== 'test' && mode !== 'production') {
    throw new ConfigurationError(`FLITT_MODE must be "test" or "production", got "${mode}"`);
  }

  const merchantId = String(env.FLITT_MERCHANT_ID).trim();
  const secretKey = String(env.FLITT_SECRET_KEY);

  // Stage 1 is test-only. Refuse to start against anything but the sandbox merchant.
  if (mode === 'test') {
    if (merchantId !== TEST_MERCHANT_ID) {
      throw new ConfigurationError(
        `Refusing to start: FLITT_MODE=test but FLITT_MERCHANT_ID is not the sandbox merchant (${TEST_MERCHANT_ID}). ` +
          'Production merchants must not be used in test mode.'
      );
    }
    if (secretKey !== TEST_SECRET_KEY) {
      throw new ConfigurationError(
        'Refusing to start: FLITT_MODE=test requires the sandbox secret key. ' +
          'A production secret key must never be used in test mode.'
      );
    }
  }

  // The inverse guard: never let sandbox credentials handle real money.
  if (mode === 'production' && (merchantId === TEST_MERCHANT_ID || secretKey === TEST_SECRET_KEY)) {
    throw new ConfigurationError(
      'Refusing to start: FLITT_MODE=production but sandbox merchant/secret detected.'
    );
  }

  const urls = {
    responseUrl: String(env.FLITT_RESPONSE_URL).trim(),
    callbackUrl: String(env.FLITT_CALLBACK_URL).trim(),
    cancelUrl: String(env.FLITT_CANCEL_URL).trim(),
  };

  // Flitt will not call back to plaintext HTTP, and an http:// response_url would
  // downgrade the user's session mid-payment.
  for (const [name, value] of Object.entries(urls)) {
    if (!/^https:\/\//i.test(value)) {
      throw new ConfigurationError(`${name} must be an https:// URL, got "${value}"`);
    }
  }

  const apiBaseUrl = String(env.FLITT_API_BASE_URL).trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(apiBaseUrl)) {
    throw new ConfigurationError(`FLITT_API_BASE_URL must be https://, got "${apiBaseUrl}"`);
  }

  return {
    enabled: isEnabled(env),
    mode,
    environment: mode,
    apiBaseUrl,
    checkoutPath: '/api/checkout/url',
    statusPath: '/api/status/order_id',
    merchantId,
    secretKey,
    currency: String(env.FLITT_CURRENCY || 'GEL').trim().toUpperCase(),
    language: String(env.FLITT_LANGUAGE || 'ka').trim(),
    protocolVersion: PROTOCOL_VERSION,
    ...urls,
    httpTimeoutMs: Number(env.FLITT_HTTP_TIMEOUT_MS || 20000),
    // Stage-1 rollout allowlist. Empty => nobody except admins.
    allowedEmails: String(env.FLITT_ALLOWED_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    // Documented Flitt callback source IPs — defence in depth only, never the
    // primary authentication mechanism.
    callbackIpAllowlist: ['54.154.216.60', '3.75.125.89'],
  };
}

/** Host allowlist for the checkout URL we hand to the browser (open-redirect guard). */
function isAllowedCheckoutUrl(url, config) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const apiHost = new URL(config.apiBaseUrl).hostname;
    return parsed.hostname === apiHost || parsed.hostname.endsWith('.flitt.com');
  } catch (_) {
    return false;
  }
}

module.exports = {
  loadConfig,
  isEnabled,
  isAllowedCheckoutUrl,
  ConfigurationError,
  REQUIRED_VARS,
  PROTOCOL_VERSION,
  TEST_MERCHANT_ID,
};
