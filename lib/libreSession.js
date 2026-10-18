// Per-person LibreLinkUp sessions: this is what replaces the old single
// process-global login cache (which could only ever hold ONE account).
//
//   * The login token is cached per slug in Redis, ENCRYPTED, for just under
//     its lifetime (~1 h), so we don't sign in to Abbott on every poll.
//   * The page asks for /api/reading and /api/history at the same moment; a
//     short Redis lock makes sure only one of them signs in.
//   * One upstream call (the "graph") feeds both reading and history, and
//     is cached ~45 s per person, so we stay polite to Abbott no matter how
//     often the page polls.
//   * After a lockout / rejected login we STOP trying for a while ("cool
//     down") instead of hammering Abbott and making a lockout worse.

const { encryptJson, decryptJson } = require('./crypto');
const store = require('./instances');
const llu = require('./librelinkup');

const SNAPSHOT_TTL = 45;
const COOLDOWNS = {
  rate_limited: 600,
  invalid_credentials: 1800,
  step_required: 600,
  client_outdated: 120,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credsContext = (slug) => `orbie:creds:${slug}`;
const sessionContext = (slug) => `orbie:session:${slug}`;

async function saveSession(slug, session) {
  const ttl = Math.floor(session.expires - Date.now() / 1000) - 120;
  if (ttl < 60) return; // too short-lived to be worth caching
  await store.setSession(slug, encryptJson(session, sessionContext(slug)), Math.min(ttl, 3300));
}

async function loadSession(slug) {
  const blob = await store.getSession(slug);
  if (!blob) return null;
  try {
    const s = decryptJson(blob, sessionContext(slug));
    return s.expires * 1000 - Date.now() > 90000 ? s : null;
  } catch {
    return null; // e.g. key was rotated — just sign in again
  }
}

// Remember that something is wrong so we stop retrying for a bit.
async function noteFailure(slug, err) {
  const ttl = COOLDOWNS[err.code];
  if (ttl) await store.setCooldown(slug, { code: err.code, message: err.message, status: err.status }, ttl);
  return err;
}

async function signIn(slug, creds) {
  const gotLock = await store.acquireLoginLock(slug);
  if (!gotLock) {
    // Another request is signing in right now — wait for its session.
    for (let i = 0; i < 12; i++) {
      await sleep(400);
      const s = await loadSession(slug);
      if (s) return s;
    }
  }
  try {
    const session = await llu.login(creds.email, creds.password, creds.region || 'GLOBAL');
    await saveSession(slug, session);
    return session;
  } catch (err) {
    throw await noteFailure(slug, err);
  } finally {
    if (gotLock) await store.releaseLoginLock(slug);
  }
}

// -> { reading, history }
async function getLibreSnapshot(slug, instance) {
  const cool = await store.getCooldown(slug);
  if (cool) throw new llu.LibreError(cool.code, cool.message, cool.status || 502);

  const cached = await store.getSnapshot(slug);
  if (cached) return cached;

  const creds = decryptJson(instance.creds, credsContext(slug));
  let session = (await loadSession(slug)) || (await signIn(slug, creds));

  let snap;
  try {
    snap = await llu.fetchGraph(session, instance.patientId);
  } catch (err) {
    if (err.code !== 'auth_expired') throw await noteFailure(slug, err);
    await store.clearSession(slug);
    session = await signIn(slug, creds);
    try {
      snap = await llu.fetchGraph(session, instance.patientId);
    } catch (err2) {
      throw await noteFailure(slug, err2);
    }
  }
  await store.setSnapshot(slug, snap, SNAPSHOT_TTL);
  return snap;
}

// Used right after a successful sign-up so the first page load needs no new login.
async function seedSession(slug, session, snap) {
  await saveSession(slug, session);
  await store.setSnapshot(slug, snap, SNAPSHOT_TTL);
}

module.exports = { getLibreSnapshot, seedSession, credsContext };
