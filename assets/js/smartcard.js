/* ============================================================================
 * FitHouse — Smart Card layer (isolated, additive, feature-flagged)
 *
 * This module is fully self-contained. It never rewrites existing check-in,
 * membership, or QR logic — a smart-card check-in resolves a card to a member
 * and then calls the app's EXISTING processCheckIn(). If this file is removed
 * or the feature flag is off, the rest of FitHouse behaves exactly as before.
 *
 * Layers:
 *   Browser (this file)  ↔  Local Reader Agent (127.0.0.1)  ↔  PC/SC  ↔  SCR3310
 *
 * The reader agent is a separate local program (built later). Everything here
 * degrades gracefully when it is absent: a reader failure only ever surfaces
 * inside the smart-card UI, never in member pages, QR, payments or the API.
 * ==========================================================================*/
(function () {
  'use strict';

  const PROJECT_ID = 'fit-house-gym-d3595';
  const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const CREDENTIALS = 'member_credentials';

  // Credential types (extensible). QR is implicit for every member and is NOT
  // stored here — existing QR check-in already covers it. Only physical cards
  // get a member_credentials record.
  const CRED_TYPE = {
    GEORGIAN_EID: 'GEORGIAN_EID',
    FIT_MANAGER_SMART_CARD: 'FIT_MANAGER_SMART_CARD',
    GENERIC_SMART_CARD: 'GENERIC_SMART_CARD',
    QR: 'QR',
  };

  const TYPE_LABEL_KA = {
    GEORGIAN_EID: ' საქართველოს ID ბარათი',
    FIT_MANAGER_SMART_CARD: 'Fit Manager ბარათი',
    GENERIC_SMART_CARD: 'Smart ბარათი',
    QR: 'QR კოდი',
  };

  // ── Feature flag ──────────────────────────────────────────────────────────
  // Off by default: with the flag off, FitHouse is unchanged. Stored locally so
  // it can be toggled per-machine; a gym-wide setting can layer on top later.
  const FLAG_KEY = 'fh_smartcard_enabled';
  function isEnabled() {
    try { return localStorage.getItem(FLAG_KEY) === 'true'; } catch (_) { return false; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(FLAG_KEY, on ? 'true' : 'false'); } catch (_) {}
  }

  // ── Reader agent config ───────────────────────────────────────────────────
  const AGENT_KEY = 'fh_smartcard_agent_url';
  const DEFAULT_AGENT_URL = 'http://127.0.0.1:47800';
  function agentUrl() {
    try { return localStorage.getItem(AGENT_KEY) || DEFAULT_AGENT_URL; } catch (_) { return DEFAULT_AGENT_URL; }
  }
  function setAgentUrl(url) {
    try { localStorage.setItem(AGENT_KEY, url || DEFAULT_AGENT_URL); } catch (_) {}
  }

  // ── Small utils ───────────────────────────────────────────────────────────
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** "•••• A93F" — never show the full card UID in the UI. */
  function maskCredential(uid) {
    const s = String(uid || '').replace(/\s+/g, '').toUpperCase();
    if (s.length <= 4) return `•••• ${s}`;
    return `•••• ${s.slice(-4)}`;
  }

  function fsNum(v) {
    if (v == null) return null;
    if (v.integerValue != null) return Number(v.integerValue);
    if (v.doubleValue != null) return Number(v.doubleValue);
    return null;
  }
  function docToCredential(doc) {
    const f = doc.fields || {};
    return {
      id: doc.name.split('/').pop(),
      memberId: f.memberId?.stringValue || '',
      memberCode: f.memberCode?.stringValue || '',
      type: f.type?.stringValue || CRED_TYPE.GENERIC_SMART_CARD,
      credentialIdHash: f.credentialIdHash?.stringValue || '',
      maskedId: f.maskedId?.stringValue || '',
      status: f.status?.stringValue || 'active',
      createdAt: f.createdAt?.stringValue || '',
      createdByFullName: f.createdByFullName?.stringValue || '',
      disabledReason: f.disabledReason?.stringValue || '',
    };
  }
  function credentialToFields(c) {
    return {
      memberId: { stringValue: c.memberId },
      memberCode: { stringValue: c.memberCode || '' },
      type: { stringValue: c.type },
      credentialIdHash: { stringValue: c.credentialIdHash },
      maskedId: { stringValue: c.maskedId },
      status: { stringValue: c.status || 'active' },
      createdAt: { stringValue: c.createdAt || new Date().toISOString() },
      createdByFullName: { stringValue: c.createdByFullName || '' },
      disabledReason: { stringValue: c.disabledReason || '' },
    };
  }

  // ── Firestore access (REST — same pattern as the rest of the app) ─────────
  async function runQuery(structuredQuery) {
    const res = await fetch(`${FS}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ structuredQuery }),
    });
    if (!res.ok) throw new Error(`runQuery ${res.status}`);
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : []).filter((r) => r.document).map((r) => r.document);
  }

  /** All credentials for one member (physical cards only). */
  async function listMemberCredentials(memberId) {
    const docs = await runQuery({
      from: [{ collectionId: CREDENTIALS }],
      where: { fieldFilter: { field: { fieldPath: 'memberId' }, op: 'EQUAL', value: { stringValue: memberId } } },
      limit: 25,
    });
    return docs.map(docToCredential).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  /** The active credential matching a card hash, or null. Used for uniqueness + check-in. */
  async function findActiveByHash(hash) {
    const docs = await runQuery({
      from: [{ collectionId: CREDENTIALS }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'credentialIdHash' }, op: 'EQUAL', value: { stringValue: hash } } },
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'active' } } },
          ],
        },
      },
      limit: 5,
    });
    return docs.length ? docToCredential(docs[0]) : null;
  }

  async function createCredential(c) {
    const res = await fetch(`${FS}/${CREDENTIALS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: credentialToFields(c) }),
    });
    if (!res.ok) throw new Error(`create credential ${res.status}`);
    const doc = await res.json();
    return docToCredential(doc);
  }

  async function patchCredential(id, fields) {
    const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
    const body = { fields: {} };
    for (const [k, v] of Object.entries(fields)) {
      body.fields[k] = typeof v === 'string' ? { stringValue: v } : v;
    }
    const res = await fetch(`${FS}/${CREDENTIALS}/${id}?${mask}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`patch credential ${res.status}`);
    return true;
  }

  async function deleteCredential(id) {
    const res = await fetch(`${FS}/${CREDENTIALS}/${id}`, { method: 'DELETE' });
    return res.ok;
  }

  // ── Reader agent client ───────────────────────────────────────────────────
  // Every call fails soft: any network/agent error returns a structured result
  // rather than throwing, so a missing reader never breaks the caller.
  const Reader = {
    async status() {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch(`${agentUrl()}/status`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) return { connected: false, error: `agent ${res.status}` };
        const data = await res.json();
        return { connected: Boolean(data.readerConnected), readerName: data.readerName || null };
      } catch (_) {
        return { connected: false, error: 'agent_unavailable' };
      }
    },

    /**
     * Waits for a card and reads a stable identifier.
     * Returns { ok, type, uid } or { ok:false, error, code }.
     * code 'no_stable_id' → the card cannot be used as a credential.
     */
    async readCard(timeoutMs = 20000) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs + 2000);
        const res = await fetch(`${agentUrl()}/read?timeout=${timeoutMs}`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) return { ok: false, error: 'agent_error', code: `http_${res.status}` };
        const data = await res.json();
        if (!data.ok) return { ok: false, error: data.error || 'read_failed', code: data.code || null };
        if (!data.uid) return { ok: false, error: 'no_stable_id', code: 'no_stable_id' };
        return { ok: true, type: data.type || CRED_TYPE.GENERIC_SMART_CARD, uid: String(data.uid) };
      } catch (e) {
        return { ok: false, error: e.name === 'AbortError' ? 'timeout' : 'agent_unavailable', code: 'agent_unavailable' };
      }
    },
  };

  // ── Enrollment / management ───────────────────────────────────────────────
  const RESULT = {
    OK: 'ok',
    DUPLICATE: 'duplicate',
    NO_STABLE_ID: 'no_stable_id',
    READER_UNAVAILABLE: 'reader_unavailable',
    TIMEOUT: 'timeout',
    ERROR: 'error',
  };

  /**
   * Reads a card and links it to a member. Enforces uniqueness against other
   * ACTIVE credentials before writing. Returns { result, credential?, holder? }.
   */
  async function enrollCard(member) {
    const read = await Reader.readCard();
    if (!read.ok) {
      if (read.code === 'no_stable_id') return { result: RESULT.NO_STABLE_ID };
      if (read.error === 'timeout') return { result: RESULT.TIMEOUT };
      return { result: RESULT.READER_UNAVAILABLE };
    }

    const hash = await sha256Hex(read.uid);

    // Uniqueness: is this card already active on someone?
    const existing = await findActiveByHash(hash);
    if (existing) {
      if (existing.memberId === member.id) {
        return { result: RESULT.DUPLICATE, credential: existing, sameMember: true };
      }
      return { result: RESULT.DUPLICATE, credential: existing, sameMember: false };
    }

    const credential = await createCredential({
      memberId: member.id,
      memberCode: member.memberCode || '',
      type: read.type,
      credentialIdHash: hash,
      maskedId: maskCredential(read.uid),
      status: 'active',
      createdAt: new Date().toISOString(),
      createdByFullName: (window.getCurrentUserDisplayName && window.getCurrentUserDisplayName()) || 'admin',
    });
    return { result: RESULT.OK, credential };
  }

  async function disableCredential(id) { return patchCredential(id, { status: 'disabled', disabledReason: 'disabled_by_admin' }); }
  async function reEnableCredential(id) { return patchCredential(id, { status: 'active', disabledReason: '' }); }
  async function removeCredential(id) { return deleteCredential(id); }

  /**
   * Smart-card check-in. Resolves the card to its member, then hands off to the
   * app's EXISTING processCheckIn — no membership rules are duplicated here.
   * Returns { result, member? }.
   */
  async function checkInByCard() {
    const read = await Reader.readCard();
    if (!read.ok) {
      if (read.code === 'no_stable_id') return { result: RESULT.NO_STABLE_ID };
      if (read.error === 'timeout') return { result: RESULT.TIMEOUT };
      return { result: RESULT.READER_UNAVAILABLE };
    }
    const hash = await sha256Hex(read.uid);
    const cred = await findActiveByHash(hash);
    if (!cred) return { result: RESULT.ERROR, code: 'unknown_card' };

    const member = (window.members || []).find((m) => m.id === cred.memberId);
    if (!member) return { result: RESULT.ERROR, code: 'member_not_found' };

    // Central validation + visit recording lives in the existing app.
    if (typeof window.processCheckIn === 'function') {
      await window.processCheckIn(member.id, { source: 'smart_card' });
    }
    return { result: RESULT.OK, member };
  }

  // ── Public surface ────────────────────────────────────────────────────────
  window.FitSmartCard = {
    CRED_TYPE,
    TYPE_LABEL_KA,
    RESULT,
    isEnabled,
    setEnabled,
    agentUrl,
    setAgentUrl,
    maskCredential,
    Reader,
    listMemberCredentials,
    findActiveByHash,
    enrollCard,
    disableCredential,
    reEnableCredential,
    removeCredential,
    checkInByCard,
  };
})();
