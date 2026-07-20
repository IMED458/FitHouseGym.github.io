'use strict';

/**
 * Brevo transactional email client.
 *
 * The API key is a real secret (unlike EmailJS's public key), so every send
 * goes through the Worker — the browser never sees it.
 */

const BREVO_API = 'https://api.brevo.com/v3/smtp/email';

class BrevoError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BrevoError';
    Object.assign(this, details);
  }
}

/** Brevo events that mean "this address is not worth trying again". */
const HARD_FAILURE_EVENTS = new Set([
  'hard_bounce',
  'invalid_email',
  'blocked',
  'spam',
  'unsubscribed',
]);

/** Events worth recording but not immediately fatal. */
const SOFT_FAILURE_EVENTS = new Set(['soft_bounce', 'deferred']);

class BrevoClient {
  constructor({ apiKey, senderEmail, senderName, fetchImpl = fetch }) {
    if (!apiKey) throw new BrevoError('BREVO_API_KEY is not configured');
    this.apiKey = apiKey;
    this.senderEmail = senderEmail;
    this.senderName = senderName;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Sends one transactional email.
   * `text` is always included — some clients show it, and it helps spam scores.
   */
  async send({ to, toName, subject, text, html, replyTo, tags }) {
    const body = {
      sender: { email: this.senderEmail, name: this.senderName },
      to: [{ email: to, ...(toName ? { name: toName } : {}) }],
      subject,
      textContent: text,
      ...(html ? { htmlContent: html } : {}),
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      ...(tags && tags.length ? { tags } : {}),
    };

    // Detached call — Workers rejects fetch invoked as a method.
    const doFetch = this.fetchImpl;
    let res;
    try {
      res = await doFetch(BREVO_API, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (_) {
      throw new BrevoError('Brevo request failed', { code: 'network_error' });
    }

    if (res.status === 429) {
      throw new BrevoError('Brevo rate limit / daily quota reached', {
        code: 'rate_limited',
        httpStatus: 429,
      });
    }

    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.message || j?.code || '';
      } catch (_) { /* non-JSON error body */ }
      throw new BrevoError('Brevo rejected the message', {
        code: 'send_rejected',
        httpStatus: res.status,
        detail,
      });
    }

    const json = await res.json().catch(() => ({}));
    return { messageId: json.messageId || null };
  }
}

/**
 * Classifies an inbound Brevo webhook event.
 * Returns 'hard' | 'soft' | 'ok' | null (null = event we do not act on).
 */
function classifyWebhookEvent(event) {
  const name = String(event || '').toLowerCase();
  if (HARD_FAILURE_EVENTS.has(name)) return 'hard';
  if (SOFT_FAILURE_EVENTS.has(name)) return 'soft';
  if (name === 'delivered' || name === 'request') return 'ok';
  return null;
}

export { BrevoClient, BrevoError, classifyWebhookEvent, HARD_FAILURE_EVENTS, SOFT_FAILURE_EVENTS };
