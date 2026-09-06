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
    // CPLC serials are zero-padded at the end; a trailing "0000" is the same for
    // many cards. Trim trailing zeros so the visible tail actually distinguishes.
    const trimmed = s.replace(/0+$/, '');
    const base = trimmed.length >= 4 ? trimmed : s;
    return `•••• ${base.slice(-4)}`;
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

  // ── Storage backend selector ──────────────────────────────────────────────
  // PRODUCTION uses Firestore for everything — credentials must be shared across
  // machines (enroll on one PC, check-in on another). Local storage is kept in
  // code only as a dormant dev fallback and is HARD-DISABLED here, so the live
  // app never stores credentials locally.
  const LOCAL_MODE_ALLOWED = false; // never store credentials locally in prod
  const LOCAL_FLAG = 'fh_smartcard_local';
  const LOCAL_KEY = 'fh_smartcard_credentials';
  function isLocal() {
    if (!LOCAL_MODE_ALLOWED) return false;
    try { return localStorage.getItem(LOCAL_FLAG) === 'true'; } catch (_) { return false; }
  }
  function setLocal(on) {
    if (!LOCAL_MODE_ALLOWED) return;
    try { localStorage.setItem(LOCAL_FLAG, on ? 'true' : 'false'); } catch (_) {}
  }
  function localReadAll() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (_) { return []; }
  }
  function localWriteAll(arr) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(arr)); } catch (_) {}
  }
  function localNewId() {
    return 'loc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
    if (isLocal()) {
      return localReadAll()
        .filter((c) => c.memberId === memberId)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    const docs = await runQuery({
      from: [{ collectionId: CREDENTIALS }],
      where: { fieldFilter: { field: { fieldPath: 'memberId' }, op: 'EQUAL', value: { stringValue: memberId } } },
      limit: 25,
    });
    return docs.map(docToCredential).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  /** The active credential matching a card hash, or null. Used for uniqueness + check-in. */
  async function findActiveByHash(hash) {
    if (isLocal()) {
      return localReadAll().find((c) => c.credentialIdHash === hash && c.status === 'active') || null;
    }
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
    if (isLocal()) {
      const all = localReadAll();
      const rec = {
        id: localNewId(),
        memberId: c.memberId,
        memberCode: c.memberCode || '',
        type: c.type,
        credentialIdHash: c.credentialIdHash,
        maskedId: c.maskedId,
        status: c.status || 'active',
        createdAt: c.createdAt || new Date().toISOString(),
        createdByFullName: c.createdByFullName || '',
        disabledReason: c.disabledReason || '',
      };
      all.push(rec);
      localWriteAll(all);
      return rec;
    }
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
    if (isLocal()) {
      const all = localReadAll();
      const i = all.findIndex((c) => c.id === id);
      if (i >= 0) {
        for (const [k, v] of Object.entries(fields)) {
          all[i][k] = (v && typeof v === 'object' && 'stringValue' in v) ? v.stringValue : v;
        }
        localWriteAll(all);
      }
      return true;
    }
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
    if (isLocal()) {
      localWriteAll(localReadAll().filter((c) => c.id !== id));
      return true;
    }
    const res = await fetch(`${FS}/${CREDENTIALS}/${id}`, { method: 'DELETE' });
    return res.ok || res.status === 404; // 404 = already gone → treat as deleted
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
    REJECTED: 'rejected',
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
   * Replace the card behind an existing credential: read a NEW card and point
   * the same record at it. Enforces uniqueness against other active cards.
   * Returns { result, credential? }.
   */
  async function replaceCredential(id, member) {
    const read = await Reader.readCard();
    if (!read.ok) {
      if (read.code === 'no_stable_id') return { result: RESULT.NO_STABLE_ID };
      if (read.error === 'timeout') return { result: RESULT.TIMEOUT };
      return { result: RESULT.READER_UNAVAILABLE };
    }
    const hash = await sha256Hex(read.uid);
    const existing = await findActiveByHash(hash).catch(() => null);
    if (existing && existing.id !== id) {
      return { result: RESULT.DUPLICATE, sameMember: member && existing.memberId === member.id };
    }
    await patchCredential(id, {
      credentialIdHash: hash,
      maskedId: maskCredential(read.uid),
      type: read.type,
      status: 'active',
      disabledReason: '',
    });
    return { result: RESULT.OK };
  }

  /**
   * Smart-card check-in. Resolves the card to its member, then hands off to the
   * app's EXISTING processCheckIn — no membership rules are duplicated here.
   * Returns { result, member? }.
   */
  async function checkInByCard() {
    const read = await Reader.readCard();
    return checkInByCardWithRead(read);
  }

  /** Check-in from an already-read card (used by the auto-listener too). */
  async function checkInByCardWithRead(read) {
    if (!read || !read.ok) {
      if (read && read.code === 'no_stable_id') return { result: RESULT.NO_STABLE_ID };
      if (read && read.error === 'timeout') return { result: RESULT.TIMEOUT };
      return { result: RESULT.READER_UNAVAILABLE };
    }
    const hash = await sha256Hex(read.uid);
    const cred = await findActiveByHash(hash);
    if (!cred) return { result: RESULT.ERROR, code: 'unknown_card' };

    const member = (window.members || []).find((m) => m.id === cred.memberId);
    if (!member) return { result: RESULT.ERROR, code: 'member_not_found' };

    // Show the member exactly like manual/QR check-in (name, surname, data,
    // allow/reject status) and learn the decision — no rules duplicated here.
    let access = { allowed: true, msg: '' };
    if (typeof window.checkMemberAccess === 'function') {
      try { access = (await window.checkMemberAccess(member)) || access; } catch (_) {}
    }
    if (!access.allowed) {
      return { result: RESULT.REJECTED, member, msg: access.msg };
    }

    // Approved → record the visit through the SAME engine everyone uses.
    if (typeof window.processCheckIn === 'function') {
      await window.processCheckIn(member.id, { source: 'smart_card' });
    }
    return { result: RESULT.OK, member };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UI LAYER
  // Everything below renders only when the feature flag is on. app.js calls the
  // mount* hooks; if this file is absent those calls are simply skipped.
  // ══════════════════════════════════════════════════════════════════════════

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
  }

  // ── Card-reading overlay (shared by enroll + check-in) ─────────────────────
  function showCardOverlay(title) {
    let el = document.getElementById('smartcard-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'smartcard-overlay';
      el.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.82);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:20px;max-width:400px;width:100%;padding:30px 26px;text-align:center;">
        <div id="smartcard-overlay-body">
          <div style="width:72px;height:72px;border-radius:50%;background:rgba(59,130,246,0.14);border:2px solid rgba(59,130,246,0.4);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;">
            <i class="fas fa-id-card" style="color:#60a5fa;font-size:1.6rem;"></i>
          </div>
          <h3 style="color:#fff;font-size:1.15rem;font-weight:900;margin:0 0 8px;">${title}</h3>
          <p style="color:#94a3b8;font-size:0.9rem;margin:0;">გთხოვთ ჩადოთ ბარათი წამკითხველში</p>
          <p style="color:#64748b;font-size:0.78rem;margin-top:6px;">Please insert the card into the reader</p>
        </div>
        <button onclick="window.FitSmartCard._closeOverlay()" style="margin-top:20px;padding:9px 22px;background:transparent;border:1px solid #334155;color:#94a3b8;border-radius:10px;font-weight:800;cursor:pointer;">გაუქმება</button>
      </div>`;
    el.style.display = 'flex';
  }
  function setOverlayBody(html) {
    const b = document.getElementById('smartcard-overlay-body');
    if (b) b.innerHTML = html;
  }
  function closeOverlay() {
    const el = document.getElementById('smartcard-overlay');
    if (el) el.style.display = 'none';
  }

  // Custom confirm — the native confirm() dialog is unreliable in embedded
  // webviews (returns false / never shows), which made card deletion look
  // "blocked". This always works. Returns a Promise<boolean>.
  function askConfirm(message) {
    return new Promise((resolve) => {
      let el = document.getElementById('smartcard-confirm');
      if (!el) {
        el = document.createElement('div');
        el.id = 'smartcard-confirm';
        el.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.82);z-index:100010;display:flex;align-items:center;justify-content:center;padding:20px;';
        document.body.appendChild(el);
      }
      el.style.display = 'flex';
      el.innerHTML = `
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:20px;max-width:380px;width:100%;padding:26px 24px;text-align:center;">
          <div style="width:60px;height:60px;border-radius:50%;background:rgba(239,68,68,0.14);border:2px solid rgba(239,68,68,0.4);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;"><i class="fas fa-triangle-exclamation" style="color:#f87171;font-size:1.4rem;"></i></div>
          <p style="color:#e2e8f0;font-size:1rem;font-weight:800;margin:0 0 20px;">${message}</p>
          <div style="display:flex;gap:10px;">
            <button id="smartcard-confirm-no" style="flex:1;padding:11px;background:transparent;border:1px solid #334155;color:#94a3b8;border-radius:10px;font-weight:800;cursor:pointer;">გაუქმება</button>
            <button id="smartcard-confirm-yes" style="flex:1;padding:11px;background:#dc2626;border:none;color:#fff;border-radius:10px;font-weight:800;cursor:pointer;">დიახ, წაშლა</button>
          </div>
        </div>`;
      const done = (val) => { el.style.display = 'none'; resolve(val); };
      el.querySelector('#smartcard-confirm-yes').onclick = () => done(true);
      el.querySelector('#smartcard-confirm-no').onclick = () => done(false);
    });
  }
  function overlayIcon(color, icon) {
    return `<div style="width:72px;height:72px;border-radius:50%;background:${color}22;border:2px solid ${color};display:flex;align-items:center;justify-content:center;margin:0 auto 18px;"><i class="fas ${icon}" style="color:${color};font-size:1.6rem;"></i></div>`;
  }
  function overlayResult(color, icon, titleKa, textKa) {
    setOverlayBody(`${overlayIcon(color, icon)}
      <h3 style="color:${color};font-size:1.15rem;font-weight:900;margin:0 0 8px;">${titleKa}</h3>
      <p style="color:#94a3b8;font-size:0.9rem;margin:0;">${textKa || ''}</p>`);
    setTimeout(closeOverlay, 3000);
  }

  // ── Profile: member access credentials ─────────────────────────────────────
  async function renderMemberCredentials(memberId) {
    const slot = document.getElementById(`smartcard-profile-${memberId}`);
    if (!slot || !isEnabled()) { if (slot) slot.innerHTML = ''; return; }
    slot.innerHTML = '<div style="color:#64748b;font-size:0.82rem;padding:8px 0;"><i class="fas fa-spinner fa-spin"></i> ბარათები იტვირთება...</div>';

    // Distinguish "no cards" from "could not load" — otherwise a transient
    // Firestore error (e.g. quota/429) looks like the member has no cards and
    // hides the manage buttons. On failure we show a retry, not a fake empty list.
    let creds = [];
    let loadFailed = false;
    try { creds = await listMemberCredentials(memberId); } catch (_) { loadFailed = true; }
    if (loadFailed) {
      slot.innerHTML = `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border,#e2e8f0);">
          <div style="font-weight:800;color:var(--text,#1e293b);font-size:0.9rem;margin-bottom:8px;"><i class="fas fa-id-card" style="color:var(--accent,#3b82f6);margin-right:6px;"></i> შესასვლელი ბარათები</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-radius:10px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);">
            <span style="color:#f87171;font-size:0.84rem;"><i class="fas fa-triangle-exclamation"></i> ბარათები ვერ ჩაიტვირთა (სერვერი დროებით მიუწვდომელია)</span>
            <button onclick="window.FitSmartCard._reload('${memberId}')" class="btn bg-blue-600 hover:bg-blue-700 text-sm px-3 py-1"><i class="fas fa-rotate-right"></i> თავიდან</button>
          </div>
        </div>`;
      return;
    }

    // QR is implicit and always present.
    const qrRow = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-radius:10px;background:rgba(148,163,184,0.08);border:1px solid var(--border,#e2e8f0);margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;"><i class="fas fa-qrcode" style="color:var(--text-light,#64748b);"></i>
          <div><div style="font-weight:800;color:var(--text,#1e293b);font-size:0.88rem;">QR კოდი</div>
          <div style="font-size:0.72rem;color:var(--text-light,#64748b);">ავტომატური</div></div></div>
        <span style="font-size:0.7rem;font-weight:800;color:#34d399;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);padding:2px 10px;border-radius:9999px;">აქტიური</span>
      </div>`;

    const cardRows = creds.map((c) => {
      const active = c.status === 'active';
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-radius:10px;background:rgba(148,163,184,0.08);border:1px solid ${active ? 'var(--border,#e2e8f0)' : 'rgba(239,68,68,0.35)'};margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;"><i class="fas fa-id-card" style="color:${active ? 'var(--accent,#3b82f6)' : 'var(--text-light,#64748b)'};"></i>
            <div style="min-width:0;"><div style="font-weight:800;color:var(--text,#1e293b);font-size:0.88rem;">${TYPE_LABEL_KA[c.type] || 'ბარათი'} <span style="font-family:ui-monospace,monospace;color:var(--text-light,#64748b);">${c.maskedId}</span></div>
            <div style="font-size:0.72rem;color:var(--text-light,#64748b);">${c.createdByFullName || ''}</div></div></div>
          <div style="display:flex;align-items:center;gap:6px;white-space:nowrap;">
            <span style="font-size:0.7rem;font-weight:800;color:${active ? '#34d399' : '#f87171'};background:${active ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'};border:1px solid ${active ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'};padding:2px 10px;border-radius:9999px;">${active ? 'აქტიური' : 'გათიშული'}</span>
            <button title="ბარათის შეცვლა" onclick="window.FitSmartCard._replace('${c.id}','${memberId}')" style="background:none;border:none;color:#60a5fa;cursor:pointer;padding:4px;"><i class="fas fa-pen"></i></button>
            ${active
              ? `<button title="გათიშვა" onclick="window.FitSmartCard._disable('${c.id}','${memberId}')" style="background:none;border:none;color:#fbbf24;cursor:pointer;padding:4px;"><i class="fas fa-ban"></i></button>`
              : `<button title="ჩართვა" onclick="window.FitSmartCard._enable('${c.id}','${memberId}')" style="background:none;border:none;color:#34d399;cursor:pointer;padding:4px;"><i class="fas fa-rotate-left"></i></button>`}
            <button title="წაშლა" onclick="window.FitSmartCard._remove('${c.id}','${memberId}')" style="background:none;border:none;color:#f87171;cursor:pointer;padding:4px;"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
    }).join('');

    slot.innerHTML = `
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border,#e2e8f0);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
          <div style="font-weight:800;color:var(--text,#1e293b);font-size:0.9rem;"><i class="fas fa-id-card" style="color:var(--accent,#3b82f6);margin-right:6px;"></i> შესასვლელი ბარათები</div>
          <button onclick="window.FitSmartCard._assign('${memberId}')" class="btn bg-blue-600 hover:bg-blue-700 text-sm px-4 py-2"><i class="fas fa-plus"></i> ბარათის მიბმა</button>
        </div>
        ${qrRow}${cardRows}
      </div>`;
  }

  async function assignToMember(memberId) {
    const member = (window.members || []).find((m) => m.id === memberId);
    if (!member) return;
    showCardOverlay('ბარათის მიბმა');
    const res = await enrollCard(member);
    handleEnrollResult(res, () => renderMemberCredentials(memberId));
  }

  function handleEnrollResult(res, onSuccess) {
    switch (res.result) {
      case RESULT.OK:
        overlayResult('#10b981', 'fa-check', 'ბარათი წარმატებით მიება', 'Card successfully linked.');
        toast('ბარათი წარმატებით მიება მომხმარებელს', 'success');
        if (onSuccess) onSuccess();
        break;
      case RESULT.DUPLICATE:
        if (res.sameMember) {
          overlayResult('#f59e0b', 'fa-circle-info', 'ბარათი უკვე მიბმულია', 'ეს ბარათი უკვე ამ წევრზეა.');
        } else {
          overlayResult('#ef4444', 'fa-triangle-exclamation', 'ბარათი დაკავებულია', 'ეს ბარათი უკვე მიბმულია სხვა მომხმარებელზე.');
        }
        break;
      case RESULT.NO_STABLE_ID:
        overlayResult('#ef4444', 'fa-xmark', 'ბარათი მიუღებელია', 'ამ ტიპის ბარათის გამოყენება შესასვლელ ბარათად შეუძლებელია.');
        break;
      case RESULT.TIMEOUT:
        overlayResult('#94a3b8', 'fa-clock', 'დრო ამოიწურა', 'ბარათი ვერ წაიკითხა. სცადეთ ხელახლა.');
        break;
      case RESULT.READER_UNAVAILABLE:
      default:
        overlayResult('#94a3b8', 'fa-plug-circle-xmark', 'წამკითხველი მიუწვდომელია', 'Reader unavailable — შეამოწმეთ, ჩართულია თუ არა ლოკალური აგენტი.');
        break;
    }
  }

  // ── Check-in tab: card button ──────────────────────────────────────────────
  function renderCheckinButton() {
    const slot = document.getElementById('smartcard-checkin-slot');
    if (!slot) return;
    if (!isEnabled()) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <button onclick="window.FitSmartCard._checkin()" class="btn bg-blue-600 hover:bg-blue-700 w-full text-lg py-3" style="margin-top:10px;">
        <i class="fas fa-id-card"></i> ბარათით შესვლა
      </button>`;
  }

  function renderCheckinResult(res) {
    const name = res.member ? `${res.member.firstName || ''} ${res.member.lastName || ''}`.trim() : '';
    if (res.result === RESULT.OK) {
      overlayResult('#10b981', 'fa-check', 'შესვლა დადასტურდა', name);
    } else if (res.result === RESULT.REJECTED) {
      overlayResult('#ef4444', 'fa-ban', 'შესვლა უარყოფილია', `${name}${name && res.msg ? ' — ' : ''}${res.msg || ''}`);
    } else if (res.result === RESULT.ERROR && res.code === 'unknown_card') {
      overlayResult('#ef4444', 'fa-xmark', 'უცნობი ბარათი', 'ეს ბარათი არცერთ წევრზე არ არის მიბმული.');
    } else if (res.result === RESULT.NO_STABLE_ID) {
      overlayResult('#ef4444', 'fa-xmark', 'ბარათი მიუღებელია', 'ამ ტიპის ბარათის გამოყენება შესასვლელ ბარათად შეუძლებელია.');
    } else if (res.result === RESULT.TIMEOUT) {
      overlayResult('#94a3b8', 'fa-clock', 'დრო ამოიწურა', '');
    } else {
      overlayResult('#94a3b8', 'fa-plug-circle-xmark', 'წამკითხველი მიუწვდომელია', 'Reader unavailable.');
    }
  }

  async function checkinFlow() {
    showCardOverlay('ბარათით შესვლა');
    renderCheckinResult(await checkInByCard());
  }

  // ── Auto-listener ──────────────────────────────────────────────────────────
  // While the check-in or search tab is open, keep waiting for a card so the
  // operator just taps/inserts it — no button click needed. One listener at a
  // time; a generation token discards results from a superseded listener.
  let autoGen = 0;
  let autoMode = null; // 'checkin' | 'search' | null

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function stopAutoListen() { autoGen++; autoMode = null; }

  function startAutoListen(mode) {
    if (!isEnabled()) { stopAutoListen(); return; }
    if (autoMode === mode) return; // already listening in this mode
    autoGen++;
    const gen = autoGen;
    autoMode = mode;
    (async () => {
      while (gen === autoGen) {
        let read;
        try { read = await Reader.readCard(15000); } catch (_) { read = { ok: false, code: 'agent_unavailable' }; }
        if (gen !== autoGen) return;                    // superseded → drop result
        if (read.ok) {
          if (mode === 'checkin') await autoCheckin(read);
          else if (mode === 'search') await autoSearch(read);
          await sleep(1800);                            // debounce the same tap
        } else if (read.code === 'agent_unavailable' || read.error === 'reader_unavailable' || read.code === 'reader_unavailable') {
          await sleep(3000);                            // reader/agent down → back off
        }
        // timeout → just loop and keep waiting
      }
    })();
  }

  async function autoCheckin(read) {
    showCardOverlay('ბარათით შესვლა');
    renderCheckinResult(await checkInByCardWithRead(read));
  }

  async function autoSearch(read) {
    const hash = await sha256Hex(read.uid);
    let cred = null;
    try { cred = await findActiveByHash(hash); } catch (_) {}
    if (!cred) { toast('ეს ბარათი არცერთ წევრზე არ არის მიბმული', 'error'); return; }
    const member = (window.members || []).find((m) => m.id === cred.memberId);
    if (!member) { toast('წევრი ვერ მოიძებნა', 'error'); return; }
    if (typeof window.showMemberFromCard === 'function') window.showMemberFromCard(member);
  }

  // ── Registration: pending card (linked after the member is created) ────────
  let pendingRegisterCard = null; // { type, uid }

  function renderRegisterSlot() {
    const slot = document.getElementById('smartcard-register-slot');
    if (!slot) return;
    if (!isEnabled()) { slot.innerHTML = ''; pendingRegisterCard = null; return; }
    const has = pendingRegisterCard;
    slot.innerHTML = `
      <div style="margin-top:22px;border:2px dashed ${has ? 'rgba(16,185,129,0.4)' : 'rgba(59,130,246,0.3)'};border-radius:16px;padding:18px;background:${has ? 'rgba(16,185,129,0.05)' : 'rgba(59,130,246,0.04)'};">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:12px;">
            <i class="fas fa-id-card" style="color:${has ? 'var(--success,#10b981)' : 'var(--accent,#3b82f6)'};font-size:1.3rem;"></i>
            <div><div style="font-weight:800;color:var(--text,#1e293b);">შესასვლელი ბარათი <span style="color:var(--text-light,#64748b);font-weight:400;font-size:0.85rem;">(არჩევითი)</span></div>
              <div style="font-size:0.78rem;color:var(--text-light,#64748b);">${has ? 'ბარათი მზადაა — რეგისტრაციისას მიება წევრს' : 'შეგიძლიათ მიაბათ smart ბარათი ან გამოტოვოთ'}</div></div>
          </div>
          ${has
            ? `<div style="display:flex;align-items:center;gap:10px;"><span style="font-family:ui-monospace,monospace;font-weight:800;color:#34d399;">${maskCredential(has.uid)}</span><button type="button" onclick="window.FitSmartCard._clearRegisterCard()" style="background:none;border:none;color:#f87171;cursor:pointer;"><i class="fas fa-times"></i></button></div>`
            : `<button type="button" onclick="window.FitSmartCard._readRegisterCard()" class="btn bg-blue-600 hover:bg-blue-700 px-5 py-2"><i class="fas fa-id-card"></i> ბარათის მიბმა</button>`}
        </div>
      </div>`;
  }

  async function readRegisterCard() {
    showCardOverlay('ბარათის მიბმა');
    const read = await Reader.readCard();
    if (!read.ok) {
      if (read.code === 'no_stable_id') overlayResult('#ef4444', 'fa-xmark', 'ბარათი მიუღებელია', 'ამ ტიპის ბარათის გამოყენება შესასვლელ ბარათად შეუძლებელია.');
      else if (read.error === 'timeout') overlayResult('#94a3b8', 'fa-clock', 'დრო ამოიწურა', '');
      else overlayResult('#94a3b8', 'fa-plug-circle-xmark', 'წამკითხველი მიუწვდომელია', 'Reader unavailable.');
      return;
    }
    // Uniqueness check up front, so the operator learns immediately.
    const hash = await sha256Hex(read.uid);
    const existing = await findActiveByHash(hash).catch(() => null);
    if (existing) {
      overlayResult('#ef4444', 'fa-triangle-exclamation', 'ბარათი დაკავებულია', 'ეს ბარათი უკვე მიბმულია სხვა მომხმარებელზე.');
      return;
    }
    pendingRegisterCard = { type: read.type, uid: read.uid };
    overlayResult('#10b981', 'fa-check', 'ბარათი აღმოჩენილია', maskCredential(read.uid));
    renderRegisterSlot();
  }

  /** Called by app.js right after a new member is created. */
  async function commitPendingEnrollment(member) {
    if (!pendingRegisterCard || !member?.id) return;
    const card = pendingRegisterCard;
    pendingRegisterCard = null;
    try {
      const hash = await sha256Hex(card.uid);
      const existing = await findActiveByHash(hash);
      if (existing) { toast('ბარათი უკვე მიბმულია სხვა წევრზე — გამოტოვდა', 'error'); return; }
      await createCredential({
        memberId: member.id,
        memberCode: member.memberCode || '',
        type: card.type,
        credentialIdHash: hash,
        maskedId: maskCredential(card.uid),
        status: 'active',
        createdAt: new Date().toISOString(),
        createdByFullName: (window.getCurrentUserDisplayName && window.getCurrentUserDisplayName()) || 'admin',
      });
      toast('ბარათი წარმატებით მიება მომხმარებელს', 'success');
    } catch (_) {
      toast('ბარათის მიბმა ვერ მოხერხდა', 'error');
    }
    renderRegisterSlot();
  }

  // ── Settings: feature toggle + agent status ────────────────────────────────
  async function mountSettingsPanel() {
    const panel = document.getElementById('smartcard-settings-panel');
    if (!panel) return;
    const on = isEnabled();
    panel.style.display = 'block';
    panel.innerHTML = `
      <h3 class="panel-title" style="margin:0 0 8px;">Smart Card — შესასვლელი ბარათები</h3>
      <p style="color:var(--text-muted,#94a3b8);font-size:0.88rem;margin:0 0 16px;">
        ბარათით შესვლა და რეგისტრაციისას ბარათის მიბმა. საჭიროებს ლოკალურ წამკითხველ აგენტს.
      </p>
      <label style="display:flex;align-items:center;gap:12px;cursor:pointer;margin-bottom:14px;">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="window.FitSmartCard._toggle(this.checked)" style="width:20px;height:20px;accent-color:#3b82f6;">
        <span style="font-weight:800;color:var(--text,#e2e8f0);">ფუნქცია ${on ? 'ჩართულია' : 'გამორთულია'}</span>
      </label>
      <p style="color:var(--text-muted,#94a3b8);font-size:0.8rem;margin:-6px 0 16px;">
        ბარათები ინახება მონაცემთა ბაზაში (Firebase) — ხელმისაწვდომია ყველა კომპიუტერიდან.
      </p>
      <div id="smartcard-agent-status" style="font-size:0.85rem;color:#64748b;"></div>`;
    refreshAgentStatus();
  }

  async function refreshAgentStatus() {
    const el = document.getElementById('smartcard-agent-status');
    if (!el) return;
    el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> აგენტი მოწმდება...';
    const s = await Reader.status();
    if (s.connected) {
      el.innerHTML = `<span style="color:#34d399;"><i class="fas fa-circle-check"></i> წამკითხველი: ${s.readerName || 'დაკავშირებული'}${s.mode === 'mock' ? ' (mock)' : ''}</span>`;
    } else {
      el.innerHTML = `<span style="color:#f59e0b;"><i class="fas fa-circle-exclamation"></i> აგენტი მიუწვდომელია (${agentUrl()})</span>`;
    }
  }

  // ── Public surface ────────────────────────────────────────────────────────
  window.FitSmartCard = {
    CRED_TYPE,
    TYPE_LABEL_KA,
    RESULT,
    isEnabled,
    setEnabled,
    isLocal,
    setLocal,
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
    replaceCredential,
    checkInByCard,

    // UI mount hooks (called by app.js; no-ops when flag off / slot absent)
    renderMemberCredentials,
    renderCheckinButton,
    renderRegisterSlot,
    mountSettingsPanel,
    commitPendingEnrollment,
    hasPendingRegisterCard: () => Boolean(pendingRegisterCard),
    startAutoListen,
    stopAutoListen,

    // onclick handlers used by the rendered markup
    _assign: assignToMember,
    _checkin: checkinFlow,
    _readRegisterCard: readRegisterCard,
    _clearRegisterCard: () => { pendingRegisterCard = null; renderRegisterSlot(); },
    _reload: (memberId) => renderMemberCredentials(memberId),
    _closeOverlay: closeOverlay,
    _toggle: (on) => { setEnabled(on); if (!on) stopAutoListen(); mountSettingsPanel(); renderRegisterSlot(); renderCheckinButton(); toast(on ? 'Smart Card ჩაირთო' : 'Smart Card გამოირთო'); },
    _toggleLocal: (on) => { setLocal(on); mountSettingsPanel(); toast(on ? 'ლოკალური რეჟიმი ჩაირთო (ბაზის გარეშე)' : 'Firestore რეჟიმი ჩაირთო'); },
    _replace: async (id, memberId) => {
      const member = (window.members || []).find((m) => m.id === memberId) || { id: memberId };
      showCardOverlay('ბარათის შეცვლა');
      let res;
      try { res = await replaceCredential(id, member); } catch (_) { res = { result: RESULT.ERROR }; }
      if (res.result === RESULT.OK) {
        overlayResult('#10b981', 'fa-check', 'ბარათი შეიცვალა', 'ახალი ბარათი მიება.');
        toast('ბარათი წარმატებით შეიცვალა', 'success');
      } else if (res.result === RESULT.DUPLICATE) {
        overlayResult('#ef4444', 'fa-triangle-exclamation', 'ბარათი დაკავებულია', 'ეს ბარათი უკვე მიბმულია სხვა მომხმარებელზე.');
      } else if (res.result === RESULT.NO_STABLE_ID) {
        overlayResult('#ef4444', 'fa-xmark', 'ბარათი მიუღებელია', 'ამ ტიპის ბარათის გამოყენება შესასვლელ ბარათად შეუძლებელია.');
      } else if (res.result === RESULT.TIMEOUT) {
        overlayResult('#94a3b8', 'fa-clock', 'დრო ამოიწურა', '');
      } else if (res.result === RESULT.READER_UNAVAILABLE) {
        overlayResult('#94a3b8', 'fa-plug-circle-xmark', 'წამკითხველი მიუწვდომელია', 'Reader unavailable.');
      } else {
        overlayResult('#ef4444', 'fa-xmark', 'შეცდომა', 'ბარათის შეცვლა ვერ მოხერხდა.');
      }
      renderMemberCredentials(memberId);
    },
    _disable: async (id, memberId) => { try { await disableCredential(id); toast('ბარათი გაითიშა'); } catch (_) { toast('შეცდომა', 'error'); } renderMemberCredentials(memberId); },
    _enable: async (id, memberId) => { try { await reEnableCredential(id); toast('ბარათი ჩაირთო'); } catch (_) { toast('შეცდომა', 'error'); } renderMemberCredentials(memberId); },
    _remove: async (id, memberId) => {
      const ok = await askConfirm('ბარათის წაშლა?');
      if (!ok) return;
      try {
        const done = await removeCredential(id);
        if (done) toast('ბარათი წაიშალა'); else toast('წაშლა ვერ მოხერხდა', 'error');
      } catch (_) { toast('წაშლა ვერ მოხერხდა', 'error'); }
      renderMemberCredentials(memberId);
    },
  };
})();
