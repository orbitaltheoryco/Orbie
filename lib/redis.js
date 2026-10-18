// One shared Upstash Redis client (credentials auto-detected from the
// UPSTASH_REDIS_REST_* or legacy KV_REST_API_* env vars Vercel injects).
const { Redis } = require('@upstash/redis');
module.exports = { kv: Redis.fromEnv() };
