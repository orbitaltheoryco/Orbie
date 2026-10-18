// Small fixed-window rate limiter on Redis.
//
// Why this matters here: the LibreLinkUp form logs in to Abbott on a
// stranger's behalf. Without strict limits it could be abused to guess
// passwords for someone else's account (credential stuffing) from our
// server. So we limit by IP *and* by (hashed) email address.

const crypto = require('crypto');
const { kv } = require('./redis');

// Returns true if this hit is allowed, false once the limit is exceeded.
async function hit(key, limit, windowSeconds) {
  // Create the counter WITH its expiry in one atomic step (NX = only if it
  // doesn't exist yet), then increment. incr keeps the TTL, so a crash
  // between the two calls can never leave a counter that never expires.
  await kv.set(key, 0, { nx: true, ex: windowSeconds });
  const count = await kv.incr(key);
  return count <= limit;
}

function clientIp(req) {
  const h = req.headers || {};
  const raw = h['x-real-ip'] || h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || '';
  return String(raw).split(',')[0].trim() || 'unknown';
}

// Never put the raw email in a Redis key.
function emailKey(email) {
  return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
}

module.exports = { hit, clientIp, emailKey };
