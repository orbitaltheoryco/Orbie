// Dexcom Share adapter — Dexcom's UNOFFICIAL "Share" interface (community-documented;
// pydexcom, Nightscout's share bridge, etc.). Single place to patch if Dexcom changes it.
//
// Important differences from LibreLinkUp:
//  * It needs the credentials of the PUBLISHER account (the person wearing the
//    sensor — the one used in the Dexcom G6/G7 app), NOT a follower login.
//    There is no "secondary login" option, so this is a bigger ask of the user.
//  * Dexcom Share must be switched on (adding at least one follower does that;
//    it can be the user themselves).
//  * The account's region matters: us / ous (outside US) / jp.
// Flow: AuthenticatePublisherAccount -> accountId; LoginPublisherAccountById ->
// sessionId; ReadPublisherLatestGlucoseValues -> readings (newest first).

const BASE = {
  us: 'https://share2.dexcom.com/ShareWebServices/Services',
  ous: 'https://shareous1.dexcom.com/ShareWebServices/Services',
  jp: 'https://share.dexcom.jp/ShareWebServices/Services',
};
const APP_ID = {
  us: 'd89443d2-327c-4a6f-89e5-496bbb0317db',
  ous: 'd89443d2-327c-4a6f-89e5-496bbb0317db',
  jp: 'd8665ade-9673-4e27-9ff6-92db4ce13d13',
};
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 7000;

class DexcomError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'DexcomError';
    this.code = code;
    this.status = status;
    this.expose = true;
  }
}

const userAgent = () => process.env.DEXCOM_USER_AGENT || 'Dexcom Share/3.0.2.11 CFNetwork/711.2.23 Darwin/14.0.0';

async function post(url, json, query) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(u.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': userAgent() },
      body: JSON.stringify(json || {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DexcomError('unreachable', "Couldn't reach Dexcom just now. Try again in a minute.", 502);
  }
  let body = null;
  try { body = JSON.parse(await res.text()); } catch { /* not JSON */ }
  return { http: res.status, body };
}

// Dexcom reports most problems as HTTP 500 + {Code, Message}.
function classify(http, body, during) {
  const code = String((body && (body.Code || body.code)) || '');
  if (http === 429 || /MaxAttempts/i.test(code)) {
    return new DexcomError('rate_limited', 'Dexcom is temporarily locking sign-ins for this account. Wait about 30 minutes and try again.', 429);
  }
  if (/SessionIdNotFound|SessionNotValid/i.test(code)) return new DexcomError('auth_expired', 'Dexcom session expired.', 401);
  if (/Account|Password|Authenticate|Credential/i.test(code) || (during === 'login' && http >= 400 && http < 500)) {
    return new DexcomError('invalid_credentials',
      "Dexcom didn't accept that sign-in. Use the username and password you sign in with in the Dexcom G6/G7 app (the person wearing the sensor — not a Follow login), and pick the right region.", 401);
  }
  console.error('Dexcom: unexpected response', { http, code, during });
  return new DexcomError('upstream_error', 'Dexcom gave an unexpected answer. If this keeps happening, Dexcom may have changed something.', 502);
}

const uuidOf = (body) => (typeof body === 'string' && UUID.test(body) && body !== ZERO_UUID ? body : null);

async function login(username, password, region = 'us') {
  const base = BASE[region];
  if (!base) throw new DexcomError('bad_region', 'Choose a Dexcom region.', 400);
  const applicationId = APP_ID[region];

  const a = await post(`${base}/General/AuthenticatePublisherAccount`, { accountName: username, password, applicationId });
  const accountId = a.http === 200 ? uuidOf(a.body) : null;
  if (!accountId) throw classify(a.http === 200 ? 500 : a.http, a.body || { Code: 'AccountPasswordInvalid' }, 'login');

  const s = await post(`${base}/General/LoginPublisherAccountById`, { accountId, password, applicationId });
  const sessionId = s.http === 200 ? uuidOf(s.body) : null;
  if (!sessionId) throw classify(s.http === 200 ? 500 : s.http, s.body || { Code: 'AccountPasswordInvalid' }, 'login');

  return { sessionId, region, expires: Math.floor(Date.now() / 1000) + 50 * 60 };
}

const TREND = {
  DoubleUp: 'DoubleUp', SingleUp: 'SingleUp', FortyFiveUp: 'SingleUp', Flat: 'Flat',
  FortyFiveDown: 'SingleDown', SingleDown: 'SingleDown', DoubleDown: 'DoubleDown',
  1: 'DoubleUp', 2: 'SingleUp', 3: 'SingleUp', 4: 'Flat', 5: 'SingleDown', 6: 'SingleDown', 7: 'DoubleDown',
};
const normalizeTrend = (t) => TREND[t] || 'Stale';
// Dexcom's own direction names, kept for the watch (it draws 45-degree arrows too).
const NS_NAMES = ['DoubleUp', 'SingleUp', 'FortyFiveUp', 'Flat', 'FortyFiveDown', 'SingleDown', 'DoubleDown'];
const NS_DIRECTION = { 1: 'DoubleUp', 2: 'SingleUp', 3: 'FortyFiveUp', 4: 'Flat', 5: 'FortyFiveDown', 6: 'SingleDown', 7: 'DoubleDown' };

// "Date(1691455258000)" or "Date(1691455258000-0400)" -> epoch ms (the number is UTC).
function parseDate(v) {
  const m = /Date\((-?\d+)/.exec(String(v || ''));
  return m ? Number(m[1]) : null;
}

async function fetchReadings(session) {
  const base = BASE[session.region];
  const q = { sessionId: session.sessionId, minutes: 240, maxCount: 48 };
  const { http, body } = await post(`${base}/Publisher/ReadPublisherLatestGlucoseValues`, q, q);
  if (http !== 200 || !Array.isArray(body)) throw classify(http, body, 'read');
  return shapeSnapshot(body);
}

// entries: newest first -> { reading, history }
function shapeSnapshot(entries) {
  const pts = [];
  for (const e of entries) {
    const t = parseDate(e.ST) ?? parseDate(e.DT) ?? parseDate(e.WT);
    if (t !== null && typeof e.Value === 'number') pts.push({ t, v: e.Value, trend: e.Trend });
  }
  pts.sort((a, b) => b.t - a.t);
  if (!pts.length) {
    throw new DexcomError('no_reading',
      "Signed in, but Dexcom has no recent readings to share. Check that Share is on in the Dexcom app (add at least one follower — it can be yourself) and that your sensor is running.", 404);
  }
  const cur = pts[0];
  const reading = { value: cur.v, trend: normalizeTrend(cur.trend), timestamp: cur.t, source: 'dexcom' };
  const dir = NS_NAMES.includes(cur.trend) ? cur.trend : NS_DIRECTION[cur.trend];
  if (dir) reading.direction = dir; // the watch draws 45-degree arrows too
  const prev = pts[1];
  if (prev && cur.t - prev.t > 0 && cur.t - prev.t <= 15 * 60 * 1000) reading.delta = cur.v - prev.v;
  const cutoff = Date.now() - 4 * 3600 * 1000;
  const history = pts.filter((p) => p.t >= cutoff).reverse().map((p) => p.v);
  return { reading, history };
}

module.exports = { DexcomError, login, fetchReadings, shapeSnapshot, parseDate, normalizeTrend, NS_DIRECTION };
