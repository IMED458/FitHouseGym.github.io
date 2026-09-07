'use strict';

/* ============================================================================
 * FitHouse — Local Reader Agent (macOS)
 *
 * A tiny local HTTP service that bridges the browser to PC/SC smart-card
 * readers. The FitHouse web app talks to it over 127.0.0.1 only.
 *
 *   Browser (smartcard.js)  →  this agent  →  PC/SC  →  reader(s)
 *
 * Works with ANY PC/SC reader, and with several plugged in at once:
 *   - CONTACT readers (SCR3310 / Identive SCR33xx): chip cards in the slot.
 *     Identifier = card CPLC chip serial (GET DATA 9F 7F).
 *   - CONTACTLESS / RFID readers (ACR122U, uTrust/Identive 3700F, most NFC):
 *     Identifier = card UID via the PC/SC "get UID" APDU (FF CA 00 00 00).
 * A read is served by whichever reader has a card on it, so a contact and an
 * RFID reader can coexist.
 *
 * Endpoints (matches smartcard.js exactly):
 *   GET /status            → { readerConnected, readerName, readerCount, mode }
 *   GET /read?timeout=ms   → { ok, type, uid }  or  { ok:false, error, code }
 *
 * Two modes:
 *   - real  : uses the `pcsclite` native module (npm i pcsclite) to talk to
 *             real readers. Reads a stable id via FF CA 00 00 00 (contactless
 *             UID) first, then the CPLC chip serial for contact cards.
 *   - mock  : no hardware needed. `GET /read` returns a fake but stable UID so
 *             the whole enrollment/check-in flow can be tested end-to-end.
 *             Enable with  MOCK=1 npm start  (also the automatic fallback when
 *             pcsclite is not installed).
 *
 * CORS is locked to the FitHouse origins. Bind address is 127.0.0.1 only, so
 * nothing on the network can reach the reader.
 * ==========================================================================*/

const http = require('http');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 47800);
const FORCE_MOCK = process.env.MOCK === '1';

const ALLOWED_ORIGINS = new Set([
  'https://fithouse.imed.com.ge',
  'http://localhost:8899',
  'http://127.0.0.1:8899',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

// Identifier-reading APDUs, tried in order until one yields a stable id:
//   1) FF CA 00 00 00 — reader-level "get UID" for CONTACTLESS cards.
//   2) 00 CA 9F 7F 00 — GET DATA / CPLC for CONTACT smart cards (JavaCard /
//      GlobalPlatform). The 42-byte CPLC embeds the chip's unique serial, so it
//      is a stable per-card identifier. T=0 cards answer 6C<len>; we then resend
//      with the exact Le.
const APDU_GET_UID = Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]);
const APDU_GET_CPLC = Buffer.from([0x00, 0xca, 0x9f, 0x7f, 0x00]);
// Some cards (e.g. the Georgian eID "GeorgiaEIDv1") expose CPLC only under the
// proprietary class 0x80, rejecting class 0x00 with 6A88. Try this as well.
const APDU_GET_CPLC_80 = Buffer.from([0x80, 0xca, 0x9f, 0x7f, 0x00]);

// ── PC/SC backend (loaded lazily; falls back to mock if unavailable) ────────
let pcsc = null;
let mode = 'mock';
if (!FORCE_MOCK) {
  try {
    pcsc = require('pcsclite');
    mode = 'real';
  } catch (_) {
    console.warn('[agent] pcsclite not installed — running in MOCK mode.');
    console.warn('[agent] to use a real reader:  cd reader-agent && npm install pcsclite');
    mode = 'mock';
  }
}

// ── Reader state (real mode) ────────────────────────────────────────────────
// Supports MULTIPLE readers at once — e.g. a contact reader (SCR3310) AND a
// contactless/RFID reader (ACR122U, uTrust/Identive 3700F, …) plugged together.
// Each entry tracks whether a card is currently sitting in that reader.
const state = {
  readers: new Map(),    // name → { reader, present }
  reading: false,        // a connect/transmit is in flight (avoid overlap)
  waiters: [],           // resolvers waiting for a card
};

function anyReaderConnected() { return state.readers.size > 0; }
function readerNamesJoined() { return [...state.readers.keys()].join(', ') || null; }
function presentReader() {
  for (const e of state.readers.values()) if (e.present) return e.reader;
  return null;
}

function resolveWaiters(result) {
  const waiters = state.waiters;
  state.waiters = [];
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve(result);
  }
}

// Promisified transmit that also resolves the T=0 "resend with Le" (6C xx) and
// "more data" (61 xx) cases. Returns { sw1, sw2, body } or throws.
function transmit(reader, protocol, apdu) {
  return new Promise((resolve, reject) => {
    reader.transmit(apdu, 512, protocol, (err, data) => {
      if (err) return reject(err);
      if (!data || data.length < 2) return reject(new Error('short response'));
      const sw1 = data[data.length - 2];
      const sw2 = data[data.length - 1];
      const body = data.slice(0, data.length - 2);
      // T=0: card wants Le = sw2 → resend the same header with the right length.
      if (sw1 === 0x6c && apdu.length >= 5) {
        const retry = Buffer.from(apdu);
        retry[retry.length - 1] = sw2;
        return transmit(reader, protocol, retry).then(resolve, reject);
      }
      resolve({ sw1, sw2, body });
    });
  });
}

// Connect to the card sitting in `reader`, read a stable identifier, resolve
// waiters. Tries the contactless UID first, then the contact-card CPLC serial.
// Safe whether the card was just inserted or was already present.
async function readPresentCard(reader) {
  if (state.reading) return;          // one attempt at a time
  if (!state.waiters.length) return;  // nobody is waiting — don't hold the card
  state.reading = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let result = { ok: false, error: 'no_stable_id', code: 'no_stable_id' };

  // Contact chips (especially the Georgian eID) can seat imperfectly and fail an
  // APDU exchange that succeeds on the very next try. Retry a few times, resetting
  // the card between attempts, before giving up — so a flaky contact still reads.
  for (let attempt = 0; attempt < 4 && !result.ok; attempt++) {
    let protocol;
    try {
      protocol = await new Promise((res, rej) =>
        reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (e, p) => (e ? rej(e) : res(p))));
    } catch (err) {
      // "No smart card inserted" → genuinely no card; clear stale present, stop.
      if (/no smart card/i.test(err.message || '')) {
        const e = state.readers.get(reader.name);
        if (e) e.present = false;
        break;
      }
      await sleep(180); // transient connect error → retry
      continue;
    }

    try {
      // 1) Contactless UID (FF CA). Reader-handled; contact cards usually reject.
      try {
        const uidr = await transmit(reader, protocol, APDU_GET_UID);
        if (uidr.sw1 === 0x90 && uidr.sw2 === 0x00 && uidr.body.length) {
          result = { ok: true, type: 'GENERIC_SMART_CARD', uid: uidr.body.toString('hex').toUpperCase() };
        }
      } catch (_) { /* try CPLC */ }

      // 2) CPLC (GET DATA 9F7F). Class 0x00 first, then 0x80 (Georgian eID).
      if (!result.ok) {
        for (const apdu of [APDU_GET_CPLC, APDU_GET_CPLC_80]) {
          try {
            const cplc = await transmit(reader, protocol, apdu);
            if (cplc.sw1 === 0x90 && cplc.sw2 === 0x00 && cplc.body.length >= 16) {
              result = { ok: true, type: 'FIT_MANAGER_SMART_CARD', uid: cplc.body.toString('hex').toUpperCase() };
              break;
            }
          } catch (_) { /* try next */ }
        }
      }
    } finally {
      // Keep the card powered on success; reset it on failure to re-seat contact.
      reader.disconnect(result.ok ? reader.SCARD_LEAVE_CARD : reader.SCARD_RESET_CARD, () => {});
    }
    if (!result.ok) await sleep(200);
  }

  state.reading = false;
  resolveWaiters(result);
}

if (mode === 'real') {
  const p = pcsc();
  p.on('reader', (reader) => {
    const isRfid = /contactless|picc|rfid|nfc|prox|cl\b/i.test(reader.name);
    state.readers.set(reader.name, { reader, present: false });
    console.log(`[agent] reader connected: ${reader.name}${isRfid ? '  (contactless/RFID)' : ''}`);

    reader.on('error', (err) => console.error('[agent] reader error:', err.message));
    reader.on('end', () => {
      console.log(`[agent] reader removed: ${reader.name}`);
      state.readers.delete(reader.name);
    });

    reader.on('status', (status) => {
      const present = Boolean(status.state & reader.SCARD_STATE_PRESENT);
      const e = state.readers.get(reader.name);
      if (e) e.present = present;
      const changed = reader.state ^ status.state;
      // On a fresh card (insert / RFID tap), read immediately (serves a waiter).
      if ((changed & reader.SCARD_STATE_PRESENT) && present) {
        readPresentCard(reader);
      }
    });
  });
  p.on('error', (err) => console.error('[agent] PCSC error:', err.message));
}

// ── Read a card (returns a Promise) ─────────────────────────────────────────
function readCard(timeoutMs) {
  if (mode === 'mock') {
    // Deterministic-enough fake UID so enrollment + check-in can be exercised.
    // Overridable with MOCK_UID for testing "same card again".
    const uid = (process.env.MOCK_UID || 'MOCK04A93F2C').toUpperCase();
    return Promise.resolve({ ok: true, type: 'FIT_MANAGER_SMART_CARD', uid });
  }
  if (!anyReaderConnected()) {
    return Promise.resolve({ ok: false, error: 'reader_unavailable', code: 'reader_unavailable' });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.waiters = state.waiters.filter((w) => w.resolve !== resolve);
      resolve({ ok: false, error: 'timeout', code: 'timeout' });
    }, timeoutMs);
    state.waiters.push({ resolve, timer });
    // If a card is ALREADY on any reader (contact slot or RFID field), read it
    // now instead of waiting for an insertion event that will never come.
    const pr = presentReader();
    if (pr) readPresentCard(pr);
  });
}

// ── HTTP server ─────────────────────────────────────────────────────────────
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Private Network Access: an HTTPS page (https://fithouse.imed.com.ge) calling
  // this local http://127.0.0.1 service is a "public → local" request. Chrome
  // sends a preflight with Access-Control-Request-Private-Network and blocks the
  // call unless we grant it here. Without this the LIVE site can't reach the reader.
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === '/status') {
    return sendJson(res, 200, {
      readerConnected: mode === 'mock' ? true : anyReaderConnected(),
      readerName: mode === 'mock' ? 'Mock Reader' : readerNamesJoined(),
      readerCount: mode === 'mock' ? 1 : state.readers.size,
      mode,
    });
  }

  if (url.pathname === '/read') {
    const timeout = Math.min(Math.max(Number(url.searchParams.get('timeout')) || 20000, 1000), 60000);
    const result = await readCard(timeout);
    return sendJson(res, 200, result);
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[agent] FitHouse reader agent listening on http://${HOST}:${PORT}  (mode: ${mode})`);
  if (mode === 'mock') console.log('[agent] MOCK mode — /read returns a fake card UID.');
});
