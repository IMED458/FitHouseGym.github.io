'use strict';

const { generateSignature, generateCallbackSignature } = require('./signature');

class FlittApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FlittApiError';
    Object.assign(this, details);
  }
}

/**
 * Thin server-to-server client for the Flitt REST API.
 * `httpClient` is injectable so tests never touch the network.
 */
class FlittClient {
  constructor(config, { httpClient = globalThis.fetch, logger = console } = {}) {
    this.config = config;
    this.httpClient = httpClient;
    this.logger = logger;
  }

  async _post(path, requestBody) {
    const url = `${this.config.apiBaseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);

    let response;
    try {
      response = await this.httpClient(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: requestBody }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new FlittApiError('Flitt request timed out', { code: 'timeout', path });
      }
      throw new FlittApiError('Flitt request failed', { code: 'network_error', path });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new FlittApiError('Flitt returned a non-2xx response', {
        code: 'http_error',
        httpStatus: response.status,
        path,
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw new FlittApiError('Flitt returned malformed JSON', { code: 'invalid_json', path });
    }

    const body = payload && payload.response;
    if (!body) {
      throw new FlittApiError('Flitt response missing `response` object', {
        code: 'invalid_response',
        path,
      });
    }
    return body;
  }

  /**
   * Creates a hosted-checkout order.
   * NOTE: `response_status: success` only means the API call succeeded —
   * it says nothing about whether money moved. Never activate on this.
   */
  async createCheckout({ orderId, amountTetri, description, merchantData }) {
    const request = {
      version: this.config.protocolVersion,
      order_id: orderId,
      merchant_id: Number(this.config.merchantId),
      order_desc: description,
      amount: amountTetri,
      currency: this.config.currency,
      response_url: this.config.responseUrl,
      server_callback_url: this.config.callbackUrl,
      cancel_url: this.config.cancelUrl,
      lang: this.config.language,
      merchant_data: merchantData,
    };

    request.signature = generateSignature(request, this.config.secretKey);

    const body = await this._post(this.config.checkoutPath, request);

    if (body.response_status !== 'success') {
      throw new FlittApiError('Flitt rejected the checkout request', {
        code: 'checkout_rejected',
        responseStatus: body.response_status || null,
        errorCode: body.error_code || null,
        errorMessage: body.error_message || null,
        requestId: body.request_id || null,
      });
    }

    if (!body.checkout_url) {
      throw new FlittApiError('Flitt response missing checkout_url', {
        code: 'missing_checkout_url',
        requestId: body.request_id || null,
      });
    }

    return {
      checkoutUrl: body.checkout_url,
      providerPaymentId: body.payment_id ? String(body.payment_id) : null,
      requestId: body.request_id || null,
      raw: body,
    };
  }

  /** Reconciliation: ask Flitt for the authoritative state of an order. */
  async getOrderStatus(orderId) {
    const request = {
      version: this.config.protocolVersion,
      order_id: orderId,
      merchant_id: Number(this.config.merchantId),
    };
    request.signature = generateSignature(request, this.config.secretKey);

    const body = await this._post(this.config.statusPath, request);

    if (body.response_status !== 'success') {
      throw new FlittApiError('Flitt rejected the status request', {
        code: 'status_rejected',
        responseStatus: body.response_status || null,
        errorCode: body.error_code || null,
      });
    }

    // Verify the response signature when Flitt supplies one.
    if (body.signature) {
      const expected = generateCallbackSignature(body, this.config.secretKey);
      if (expected !== String(body.signature).toLowerCase()) {
        throw new FlittApiError('Flitt status response signature mismatch', {
          code: 'status_signature_invalid',
        });
      }
    }

    return body;
  }
}

module.exports = { FlittClient, FlittApiError };
