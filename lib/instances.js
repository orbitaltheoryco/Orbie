// Shared-tenant store on Upstash Redis. Everything for one person's Orbie
// hangs off their slug:
//
//   instance:<slug>  the instance record (30-day sliding TTL)
//        { source: 'nightscout', nightscoutUrl, nightscoutToken }
//        { source: 'librelinkup', creds: <ENCRYPTED>, patientId }
//   session:<slug>   the cached LibreLinkUp login token (ENCRYPTED, ~1 hour)
//   snap:<slug>      the latest reading + history, shared by /reading and
//                    /history so one upstream call serves both (45 s)
//   cool:<slug>      "stop trying for a while" after a lockout / bad login
//   lock:<slug>      short lock so parallel requests don't all log in at once
//
// Records written before LibreLinkUp support have no `source`; they are
// Nightscout instances.
//
// Expiry: instance keys slide forward 30 days on every read, so a link
// nobody visits quietly disappears (taking any stored login with it).

const { kv } = require('./redis');

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const k = {
  instance: (s) => `instance:${s}`,
  session: (s) => `session:${s}`,
  snap: (s) => `snap:${s}`,
  cool: (s) => `cool:${s}`,
  lock: (s) => `lock:${s}`,
};

async function slugExists(slug) {
  return Boolean(await kv.get(k.instance(slug)));
}

async function createInstance(slug, record) {
  await kv.set(k.instance(slug), { createdAt: Date.now(), ...record }, { ex: TTL_SECONDS });
}

async function getInstance(slug) {
  const data = await kv.get(k.instance(slug));
  if (!data) return null;
  await kv.expire(k.instance(slug), TTL_SECONDS); // someone's using it — push expiry back out
  return { source: 'nightscout', ...data };
}

// Removes the instance AND everything cached for it (incl. the stored login).
async function deleteInstance(slug) {
  await kv.del(k.instance(slug), k.session(slug), k.snap(slug), k.cool(slug), k.lock(slug));
}

const getSession = (slug) => kv.get(k.session(slug));
const setSession = (slug, blob, ttl) => kv.set(k.session(slug), blob, { ex: ttl });
const clearSession = (slug) => kv.del(k.session(slug));

const getSnapshot = (slug) => kv.get(k.snap(slug));
const setSnapshot = (slug, snap, ttl) => kv.set(k.snap(slug), snap, { ex: ttl });

const getCooldown = (slug) => kv.get(k.cool(slug));
const setCooldown = (slug, info, ttl) => kv.set(k.cool(slug), info, { ex: ttl });

async function acquireLoginLock(slug) {
  return (await kv.set(k.lock(slug), 1, { nx: true, ex: 15 })) !== null;
}
const releaseLoginLock = (slug) => kv.del(k.lock(slug));

module.exports = {
  TTL_SECONDS, slugExists, createInstance, getInstance, deleteInstance,
  getSession, setSession, clearSession, getSnapshot, setSnapshot,
  getCooldown, setCooldown, acquireLoginLock, releaseLoginLock,
};
