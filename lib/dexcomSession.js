// Per-person Dexcom sessions — same design as lib/libreSession.js:
// the session id is cached per link (encrypted, ~50 min), only one request
// signs in at a time, one upstream call serves /reading and /history (45 s),
// and after a lockout / rejected login we stop retrying for a while.

const { encryptJson, decryptJson } = require('./crypto');
const store = require('./instances');
const dex = require('./dexcom');

const SNAPSHOT_TTL = 45;
const COOLDOWNS = { rate_limited: 1800, invalid_credentials: 1800, client_outdated: 120 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credsContext = (slug) => `orbie:creds:${slug}`;
const sessionContext = (slug) => `orbie:dsession:${slug}`;

async function saveSession(slug, s) {
  const ttl = Math.floor(s.expires - Date.now() / 1000) - 120;
  if (ttl < 60) return;
  await store.setSession(slug, encryptJson(s, sessionContext(slug)), Math.min(ttl, 3000));
}
async function loadSession(slug) {
  const blob = await store.getSession(slug);
  if (!blob) return null;
  try {
    const s = decryptJson(blob, sessionContext(slug));
    return s.expires * 1000 - Date.now() > 90000 ? s : null;
  } catch { return null; }
}
async function noteFailure(slug, err) {
  const ttl = COOLDOWNS[err.code];
  if (ttl) await store.setCooldown(slug, { code: err.code, message: err.message, status: err.status }, ttl);
  return err;
}
async function signIn(slug, creds) {
  const gotLock = await store.acquireLoginLock(slug);
  if (!gotLock) {
    for (let i = 0; i < 12; i++) {
      await sleep(400);
      const s = await loadSession(slug);
      if (s) return s;
    }
  }
  try {
    const s = await dex.login(creds.username, creds.password, creds.region || 'us');
    await saveSession(slug, s);
    return s;
  } catch (err) {
    throw await noteFailure(slug, err);
  } finally {
    if (gotLock) await store.releaseLoginLock(slug);
  }
}

async function getDexcomSnapshot(slug, instance) {
  const cool = await store.getCooldown(slug);
  if (cool) throw new dex.DexcomError(cool.code, cool.message, cool.status || 502);
  const cached = await store.getSnapshot(slug);
  if (cached) return cached;

  const creds = decryptJson(instance.creds, credsContext(slug));
  let session = (await loadSession(slug)) || (await signIn(slug, creds));
  let snap;
  try {
    snap = await dex.fetchReadings(session);
  } catch (err) {
    if (err.code !== 'auth_expired') throw await noteFailure(slug, err);
    await store.clearSession(slug);
    session = await signIn(slug, creds);
    try { snap = await dex.fetchReadings(session); } catch (e2) { throw await noteFailure(slug, e2); }
  }
  await store.setSnapshot(slug, snap, SNAPSHOT_TTL);
  return snap;
}

async function seedDexcomSession(slug, session, snap) {
  await saveSession(slug, session);
  await store.setSnapshot(slug, snap, SNAPSHOT_TTL);
}

module.exports = { getDexcomSnapshot, seedDexcomSession, credsContext };
