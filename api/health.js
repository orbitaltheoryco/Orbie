// TEMPORARY diagnostic: GET /api/health
// Tests each dependency separately and reports pass/fail. No logins, tokens or keys are shown
// (only yes/no for settings, and short error names/messages). DELETE THIS FILE once things work.

const attempt = async (fn) => {
  const t = Date.now();
  try { return { ok: true, ms: Date.now() - t, ...((await fn()) || {}) }; }
  catch (e) { return { ok: false, ms: Date.now() - t, error: { name: e && e.name, code: e && e.code, message: String((e && e.message) || '').slice(0, 160) } }; }
};
const loads = (thunk) => { try { thunk(); return { ok: true }; } catch (e) { return { ok: false, error: String((e && (e.code || e.name)) || 'error'), message: String((e && e.message) || '').slice(0, 160) }; } };

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = { time: new Date().toISOString(), node: process.version };

  out.settings = {
    redisUrlSet: Boolean(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL),
    redisTokenSet: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
    encryptionKey: 'unknown',
    LLU_VERSION: process.env.LLU_VERSION || '(default)',
  };

  out.files = {
    redis: loads(() => require('../lib/redis')),
    crypto: loads(() => require('../lib/crypto')),
    ratelimit: loads(() => require('../lib/ratelimit')),
    instances: loads(() => require('../lib/instances')),
    errors: loads(() => require('../lib/errors')),
    resolveSource: loads(() => require('../lib/resolveSource')),
    librelinkup: loads(() => require('../lib/librelinkup')),
    libreSession: loads(() => require('../lib/libreSession')),
    dexcom: loads(() => require('../lib/dexcom')),
    dexcomSession: loads(() => require('../lib/dexcomSession')),
    createInstance: loads(() => require('./create-instance')),
  };

  const checks = {};
  checks.encryption = await attempt(async () => {
    const c = require('../lib/crypto');
    out.settings.encryptionKey = c.isConfigured() ? 'ok' : 'missing or invalid';
    if (!c.isConfigured()) throw new Error('CREDENTIAL_ENCRYPTION_KEY is missing or not 32 bytes');
    const back = c.decryptJson(c.encryptJson({ a: 1 }, 'health'), 'health');
    if (back.a !== 1) throw new Error('encryption round-trip failed');
  });
  checks.database = await attempt(async () => {
    const { kv } = require('../lib/redis');
    await kv.set('health:probe', 'ok', { ex: 30 });
    const v = await kv.get('health:probe');
    await kv.del('health:probe');
    if (v !== 'ok') throw new Error('database read-back mismatch');
  });
  // These two use a made-up login, so a "wrong login" answer is the HEALTHY result.
  checks.dexcomReachable = await attempt(async () => {
    try { await require('../lib/dexcom').login('orbie-health-check', 'x', 'us'); throw new Error('unexpectedly signed in'); }
    catch (e) { if (e.code === 'invalid_credentials' || e.code === 'rate_limited') return { answer: e.code }; throw e; }
  });
  checks.libreReachable = await attempt(async () => {
    try { await require('../lib/librelinkup').login('orbie-health-check@example.invalid', 'x', 'GLOBAL'); throw new Error('unexpectedly signed in'); }
    catch (e) { if (['invalid_credentials', 'step_required', 'rate_limited'].includes(e.code)) return { answer: e.code }; throw e; }
  });

  out.checks = checks;
  const problems = [
    ...Object.entries(out.files).filter(([, v]) => !v.ok).map(([k]) => 'file:' + k),
    ...Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k),
    ...(!out.settings.redisUrlSet || !out.settings.redisTokenSet ? ['redis-settings'] : []),
  ];
  out.summary = { allOk: problems.length === 0, problems };
  res.status(200).json(out);
};
