// LibreLinkUp adapter — Abbott's UNOFFICIAL follower API (no public docs).
// This file is the single place to patch when Abbott changes something.
//
// Things that matter as of October 2026 (verified against community
// clients; Abbott changes this without notice):
//  * Every request needs a client identity (product + version headers and a
//    matching User-Agent). Abbott's v5 rollout (early Oct 2026) moved the
//    expected identity to llu.android 5.0.1. The identity is configurable
//    through env vars so a future bump needs no code change:
//        LLU_PRODUCT (default llu.android)
//        LLU_VERSION (default 5.0.1)
//        LLU_USER_AGENT (default LibreLinkUp/<version>)
//  * After login, authenticated calls also send `Account-Id` = SHA-256 of
//    the login's user id.
//  * Login returns the account's home REGION as a redirect; we follow it
//    (only to hosts on our allow-list — never to a URL from a response).
//  * Login can answer `status: 4` + a "step" (e.g. Terms of Use must be
//    re-accepted). We do NOT accept legal terms on someone's behalf — we
//    tell them to do it in the LibreLinkUp app.
//  * Lockouts can arrive as `status: 429` inside an HTTP 200.
//  * v5 login tokens last about an hour.

const crypto = require('crypto');

const REGION_HOSTS = {
  GLOBAL: 'https://api.libreview.io',
  US: 'https://api-us.libreview.io',
  EU: 'https://api-eu.libreview.io',
  EU2: 'https://api-eu2.libreview.io',
  DE: 'https://api-de.libreview.io',
  FR: 'https://api-fr.libreview.io',
  JP: 'https://api-jp.libreview.io',
  AU: 'https://api-au.libreview.io',
  AE: 'https://api-ae.libreview.io',
  AP: 'https://api-ap.libreview.io',
  CA: 'https://api-ca.libreview.io',
  LA: 'https://api-la.libreview.io',
  GB: 'https://api-eu2.libreview.io',
  UK: 'https://api-eu2.libreview.io',
  // Less certain than the rest — only reached if Abbott redirects there.
  CN: 'https://api.libreview.cn',
  RU: 'https://api.libreview.ru',
};

const TIMEOUT_MS = 7000;

class LibreError extends Error {
  constructor(code, message, status = 502, extra = {}) {
    super(message);
    this.name = 'LibreError';
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

function identity() {
  const version = process.env.LLU_VERSION || '5.0.1';
  return {
    product: process.env.LLU_PRODUCT || 'llu.android',
    version,
    userAgent: process.env.LLU_USER_AGENT || `LibreLinkUp/${version}`,
  };
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function buildHeaders(session) {
  const id = identity();
  const h = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
    'User-Agent': id.userAgent,
    product: id.product,
    version: id.version,
  };
  if (session && session.token) h.Authorization = `Bearer ${session.token}`;
  if (session && session.accountId) h['Account-Id'] = session.accountId;
  return h;
}

// One HTTP call. Never put the request body (it holds the password) into an error.
async function call(url, { method = 'GET', session, body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: buildHeaders(session),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new LibreError('unreachable', "Couldn't reach LibreLinkUp just now. Try again in a minute.", 502);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { http: res.status, json };
}

const RATE_LIMITED = () =>
  new LibreError('rate_limited', 'LibreLinkUp is temporarily limiting sign-ins. Wait 10–15 minutes and try again.', 429);

function stepMessage(type) {
  if (type === 'tou' || type === 'pp') {
    return (
      'LibreLinkUp needs you to accept its updated ' +
      (type === 'tou' ? 'Terms of Use' : 'Privacy Notice') +
      '. Open the LibreLinkUp app on your phone, sign in, accept it, then try again here.'
    );
  }
  return 'LibreLinkUp is asking for an extra step before it will sign you in. Open the LibreLinkUp app on your phone, sign in, finish what it asks, then try again.';
}

// Sign in. Follows the regional redirect (max 3 hops, allow-listed hosts only).
async function login(email, password, regionHint = 'GLOBAL') {
  let region = String(regionHint || 'GLOBAL').toUpperCase();
  for (let hop = 0; hop < 3; hop++) {
    const base = REGION_HOSTS[region];
    if (!base) throw new LibreError('unsupported_region', "LibreLinkUp sent Orbie to a region it doesn't support yet.", 502);

    const { http, json } = await call(`${base}/llu/auth/login`, { method: 'POST', body: { email, password } });
    const status = json && typeof json.status === 'number' ? json.status : null;

    if (http === 429 || status === 429) throw RATE_LIMITED();

    // Account lives in another region — go there and sign in again.
    if (json && json.data && json.data.redirect && json.data.region) {
      region = String(json.data.region).toUpperCase();
      continue;
    }

    if (status === 4) {
      const type = json && json.data && json.data.step && json.data.step.type;
      throw new LibreError('step_required', stepMessage(type), 403, { step: type || null });
    }

    if (status === 920 || (json && (json.minimumVersion || (json.data && json.data.minimumVersion)))) {
      throw new LibreError('client_outdated', "Abbott changed what LibreLinkUp requires and Orbie needs an update. Please try again later.", 502);
    }
    if (http === 403) {
      throw new LibreError('client_outdated', "LibreLinkUp refused Orbie's connection (Abbott may have changed something). Please try again later.", 502);
    }

    const ticket = json && json.data && json.data.authTicket;
    const userId = json && json.data && json.data.user && json.data.user.id;
    if (http === 200 && status === 0 && ticket && ticket.token && userId) {
      return {
        token: ticket.token,
        expires: Number(ticket.expires) || Math.floor(Date.now() / 1000) + 3300,
        baseUrl: base,
        accountId: sha256(userId),
      };
    }

    if (status === 2 || http === 401) {
      throw new LibreError('invalid_credentials', "LibreLinkUp didn't accept that email and password. Remember this is your LibreLinkUp login, not your LibreLink or LibreView one.", 401);
    }

    // Anything else is Abbott doing something unexpected — don't blame the password.
    console.error('LLU login: unexpected response', { http, status });
    throw new LibreError('upstream_error', 'LibreLinkUp gave an unexpected answer. If this keeps happening, Abbott may have changed something.', 502);
  }
  throw new LibreError('upstream_error', 'LibreLinkUp kept redirecting. Please try again later.', 502);
}

// Shared checks for authenticated calls (connections / graph).
function assertOk(http, json) {
  const status = json && typeof json.status === 'number' ? json.status : null;
  if (http === 429 || status === 429) throw RATE_LIMITED();
  if (http === 401 || status === 401) throw new LibreError('auth_expired', 'LibreLinkUp session expired.', 401);
  if (http === 403) throw new LibreError('client_outdated', "LibreLinkUp refused Orbie's connection (Abbott may have changed something).", 502);
  if (http >= 400 || (status !== null && status !== 0)) {
    console.error('LLU request: unexpected response', { http, status });
    throw new LibreError('upstream_error', 'LibreLinkUp gave an unexpected answer.', 502);
  }
}

const UUID = /^[0-9a-fA-F-]{20,64}$/;

async function listConnections(session) {
  const { http, json } = await call(`${session.baseUrl}/llu/connections`, { session });
  assertOk(http, json);
  const data = json && json.data;
  if (!Array.isArray(data)) throw new LibreError('upstream_error', 'LibreLinkUp gave an unexpected answer.', 502);
  return data
    .filter((c) => c && typeof c.patientId === 'string' && UUID.test(c.patientId))
    .map((c) => ({
      id: c.patientId,
      label: [c.firstName, c.lastName ? `${String(c.lastName)[0]}.` : ''].filter(Boolean).join(' ') || 'Connection',
    }));
}

// ---- shaping ----

// LibreLinkUp's own arrows: 1 falling fast … 5 rising fast.
function normalizeTrend(arrow) {
  const map = { 1: 'DoubleDown', 2: 'SingleDown', 3: 'Flat', 4: 'SingleUp', 5: 'DoubleUp' };
  return map[arrow] || 'Stale';
}

// LibreLinkUp timestamps are strings like "10/15/2026 7:04:05 PM" (FactoryTimestamp
// is UTC). The web app needs epoch milliseconds.
function parseTimestamp(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const s = String(v).trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i.exec(s);
  if (us) {
    let hour = Number(us[4]);
    if (us[7]) hour = (hour % 12) + (us[7].toUpperCase() === 'PM' ? 12 : 0);
    return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]), hour, Number(us[5]), Number(us[6]));
  }
  const iso = Date.parse(s);
  return Number.isNaN(iso) ? null : iso;
}

// -> { reading: {value, trend, timestamp(ms), source}, history: [mg/dL oldest→newest, last 4 h] }
function shapeSnapshot(current, graphData) {
  if (!current || typeof current.ValueInMgPerDl !== 'number') {
    throw new LibreError('no_reading', 'No current glucose reading yet — the sensor may still be warming up, or sharing may be paused in LibreLink.', 404);
  }
  const ts = parseTimestamp(current.FactoryTimestamp) ?? parseTimestamp(current.Timestamp) ?? Date.now();
  const reading = { value: current.ValueInMgPerDl, trend: normalizeTrend(current.TrendArrow), timestamp: ts, source: 'librelinkup' };

  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  const pts = [];
  for (const g of Array.isArray(graphData) ? graphData : []) {
    const t = g ? parseTimestamp(g.FactoryTimestamp) ?? parseTimestamp(g.Timestamp) : null;
    if (t !== null && typeof g.ValueInMgPerDl === 'number' && t >= cutoff) pts.push([t, g.ValueInMgPerDl]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  if (!pts.length || pts[pts.length - 1][0] < ts) pts.push([ts, reading.value]);
  return { reading, history: pts.map((p) => p[1]) };
}

async function fetchGraph(session, patientId) {
  // patientId comes from storage/user input and goes into a URL path.
  if (typeof patientId !== 'string' || !UUID.test(patientId)) {
    throw new LibreError('bad_patient', 'That connection is not valid.', 400);
  }
  const { http, json } = await call(`${session.baseUrl}/llu/connections/${patientId}/graph`, { session });
  assertOk(http, json);
  const data = json && json.data;
  return shapeSnapshot(data && data.connection && data.connection.glucoseMeasurement, data && data.graphData);
}

// ---- single-owner mode (DATA_SOURCE=librelinkup with env vars) ----
// Sessions are cached PER ACCOUNT (the old version kept one global login,
// which only ever worked for a single account).
const ownerSessions = new Map();

async function ownerRead(session) {
  const conns = await listConnections(session);
  if (!conns.length) throw new LibreError('no_connections', 'No LibreLinkUp connections found — has someone shared readings with this account?', 404);
  return (await fetchGraph(session, conns[0].id)).reading;
}

async function fetchFromLibreLinkUp(email, password, region = 'GLOBAL') {
  if (!email || !password) throw new Error('Missing LIBRE_EMAIL or LIBRE_PASSWORD.');
  const key = sha256(String(email).toLowerCase());
  let session = ownerSessions.get(key);
  if (!session || session.expires * 1000 - Date.now() < 90000) {
    session = await login(email, password, region);
    ownerSessions.set(key, session);
  }
  try {
    return await ownerRead(session);
  } catch (err) {
    if (err.code !== 'auth_expired') throw err;
    session = await login(email, password, region);
    ownerSessions.set(key, session);
    return ownerRead(session);
  }
}

// Region key (e.g. "EU2") for a base URL, so we can remember it and skip the redirect hop next time.
function regionOf(baseUrl) {
  const hit = Object.entries(REGION_HOSTS).find(([, host]) => host === baseUrl);
  return hit ? hit[0] : 'GLOBAL';
}

module.exports = {
  regionOf, LibreError, login, listConnections, fetchGraph, fetchFromLibreLinkUp,
  normalizeTrend, parseTimestamp, shapeSnapshot, identity,
};
