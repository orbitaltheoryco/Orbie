// Shared-tenant instance store, backed by Upstash Redis (connected via the
// Vercel Marketplace — Vercel's own native "KV" product was discontinued
// in favor of this). Each "instance" is just
// slug -> { nightscoutUrl, nightscoutToken, createdAt }.
//
// Expiry: every key is written with a 30-day TTL, and getInstance() resets
// that TTL on every read. So a demo link nobody visits quietly expires in
// 30 days; one that's actively used keeps sliding forward and never does.
// There's no cleanup job to maintain — Redis just deletes the key itself.
//
// Redis.fromEnv() auto-detects credentials under either
// UPSTASH_REDIS_REST_URL/TOKEN (Upstash's own naming) or the legacy
// KV_REST_API_URL/TOKEN names some Vercel integrations still inject —
// so this works regardless of which env var names show up.

const { Redis } = require('@upstash/redis');
const kv = Redis.fromEnv();

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const KEY_PREFIX = 'instance:';

function keyFor(slug) {
  return `${KEY_PREFIX}${slug}`;
}

async function slugExists(slug) {
  return Boolean(await kv.get(keyFor(slug)));
}

async function createInstance(slug, { nightscoutUrl, nightscoutToken }) {
  await kv.set(
    keyFor(slug),
    { nightscoutUrl, nightscoutToken: nightscoutToken || null, createdAt: Date.now() },
    { ex: TTL_SECONDS }
  );
}

async function getInstance(slug) {
  const data = await kv.get(keyFor(slug));
  if (!data) return null;
  await kv.expire(keyFor(slug), TTL_SECONDS); // touch — someone's using it, push expiry back out
  return data;
}

module.exports = { createInstance, getInstance, slugExists, TTL_SECONDS };
