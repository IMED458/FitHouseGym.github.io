'use strict';

/**
 * Firestore REST client for Cloudflare Workers.
 *
 * Workers cannot run firebase-admin (it needs Node APIs and gRPC), so this
 * speaks the Firestore REST API directly, authenticated as a service account.
 * That gives admin-level access, which is what lets the `payments` collection
 * stay completely closed to browsers in firestore.rules.
 *
 * It exposes the same shape the payment service already expected from
 * firebase-admin, so the business logic ports over unchanged.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

// ── value codec ────────────────────────────────────────────────────────────

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fromValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toValue(v);
  return fields;
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromValue(v);
  return out;
}

// ── access token (cached across requests within an isolate) ────────────────

let cachedToken = null;

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function b64url(input) {
  const b64 = typeof input === 'string' ? btoa(input) : btoa(String.fromCharCode(...new Uint8Array(input)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(serviceAccount, now = Date.now()) {
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;

  const iat = Math.floor(now / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };

  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) throw new Error(`Failed to obtain Firestore access token (${res.status})`);
  const json = await res.json();

  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in || 3600) * 1000,
  };
  return cachedToken.token;
}

// ── document / query / transaction wrappers ────────────────────────────────

class DocRef {
  constructor(client, collectionPath, id) {
    this.client = client;
    this.collectionPath = collectionPath;
    this.id = id;
    this.path = `${collectionPath}/${id}`;
  }

  async get() {
    const res = await this.client._request('GET', `/${this.path}`);
    if (res.status === 404) return { exists: false, id: this.id, data: () => undefined };
    const doc = await res.json();
    return { exists: true, id: this.id, data: () => fromFields(doc.fields) };
  }

  /** Fails if the document already exists — our order_id uniqueness guarantee. */
  async create(data) {
    const res = await this.client._request(
      'POST',
      `/${this.collectionPath}?documentId=${encodeURIComponent(this.id)}`,
      { fields: toFields(data) }
    );
    if (res.status === 409) {
      const err = new Error(`Document already exists: ${this.path}`);
      err.code = 'already-exists';
      throw err;
    }
    await this.client._assertOk(res);
    return res.json();
  }

  async set(data) {
    const res = await this.client._request('PATCH', `/${this.path}`, { fields: toFields(data) });
    await this.client._assertOk(res);
  }

  async update(patch) {
    const mask = Object.keys(patch)
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join('&');
    const res = await this.client._request('PATCH', `/${this.path}?${mask}`, {
      fields: toFields(patch),
    });
    await this.client._assertOk(res);
  }
}

class Query {
  constructor(client, collectionPath, filters = [], limitCount = null) {
    this.client = client;
    this.collectionPath = collectionPath;
    this.filters = filters;
    this.limitCount = limitCount;
  }

  where(field, op, value) {
    if (op !== '==') throw new Error(`Only '==' is supported, got '${op}'`);
    return new Query(
      this.client,
      this.collectionPath,
      [...this.filters, { field, value }],
      this.limitCount
    );
  }

  limit(n) {
    return new Query(this.client, this.collectionPath, this.filters, n);
  }

  async get() {
    const structuredQuery = { from: [{ collectionId: this.collectionPath }] };

    if (this.filters.length === 1) {
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: this.filters[0].field },
          op: 'EQUAL',
          value: toValue(this.filters[0].value),
        },
      };
    } else if (this.filters.length > 1) {
      structuredQuery.where = {
        compositeFilter: {
          op: 'AND',
          filters: this.filters.map((f) => ({
            fieldFilter: {
              field: { fieldPath: f.field },
              op: 'EQUAL',
              value: toValue(f.value),
            },
          })),
        },
      };
    }
    if (this.limitCount !== null) structuredQuery.limit = this.limitCount;

    const res = await this.client._request('POST', ':runQuery', { structuredQuery });
    await this.client._assertOk(res);
    const rows = await res.json();

    const docs = (Array.isArray(rows) ? rows : [])
      .filter((r) => r.document)
      .map((r) => {
        const id = r.document.name.split('/').pop();
        return { id, data: () => fromFields(r.document.fields) };
      });

    return { empty: docs.length === 0, size: docs.length, docs };
  }
}

class CollectionRef extends Query {
  constructor(client, path) {
    super(client, path);
    this.pathValue = path;
  }

  doc(id) {
    return new DocRef(this.client, this.pathValue, id || crypto.randomUUID());
  }
}

/**
 * Transaction handle. Reads go through the transaction id so Firestore can
 * detect conflicts; writes are buffered and sent atomically on commit.
 */
class Transaction {
  constructor(client, transactionId) {
    this.client = client;
    this.transactionId = transactionId;
    this.writes = [];
  }

  async get(ref) {
    const res = await this.client._request(
      'GET',
      `/${ref.path}?transaction=${encodeURIComponent(this.transactionId)}`
    );
    if (res.status === 404) return { exists: false, id: ref.id, data: () => undefined };
    const doc = await res.json();
    return { exists: true, id: ref.id, data: () => fromFields(doc.fields) };
  }

  update(ref, patch) {
    this.writes.push({
      update: {
        name: this.client._docName(ref.path),
        fields: toFields(patch),
      },
      updateMask: { fieldPaths: Object.keys(patch) },
      currentDocument: { exists: true },
    });
  }

  set(ref, data) {
    this.writes.push({
      update: { name: this.client._docName(ref.path), fields: toFields(data) },
    });
  }
}

export class FirestoreRest {
  constructor({ projectId, serviceAccount, fetchImpl = fetch }) {
    this.projectId = projectId;
    this.serviceAccount = serviceAccount;
    this.fetchImpl = fetchImpl;
    this.baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  }

  _docName(path) {
    return `projects/${this.projectId}/databases/(default)/documents/${path}`;
  }

  async _request(method, suffix, body) {
    const token = await getAccessToken(this.serviceAccount);
    // Detached call: invoking fetch as `this.fetchImpl(...)` binds `this` to
    // this instance, which Workers rejects with "Illegal invocation".
    const doFetch = this.fetchImpl;
    return doFetch(`${this.baseUrl}${suffix}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async _assertOk(res) {
    if (res.ok) return;
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || '';
    } catch (_) { /* body not json */ }
    throw new Error(`Firestore request failed (${res.status}): ${detail}`);
  }

  collection(path) {
    return new CollectionRef(this, path);
  }

  /**
   * Runs `fn` inside a real Firestore transaction. On any throw the
   * transaction is rolled back and nothing is written — which is what keeps
   * membership activation and payment status from ever diverging.
   */
  async runTransaction(fn) {
    const beginRes = await this._request('POST', ':beginTransaction', {
      options: { readWrite: {} },
    });
    await this._assertOk(beginRes);
    const { transaction: transactionId } = await beginRes.json();

    const tx = new Transaction(this, transactionId);

    let result;
    try {
      result = await fn(tx);
    } catch (error) {
      await this._request('POST', ':rollback', { transaction: transactionId }).catch(() => {});
      throw error;
    }

    const commitRes = await this._request('POST', ':commit', {
      transaction: transactionId,
      writes: tx.writes,
    });
    await this._assertOk(commitRes);

    return result;
  }
}

export { toValue, fromValue, toFields, fromFields, getAccessToken };
