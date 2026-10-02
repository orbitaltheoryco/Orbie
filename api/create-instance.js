// Vercel serverless function: POST /api/create-instance
// Body: { nightscoutUrl: string, nightscoutToken?: string }
// Response: { slug, url }
//
// Validates the URL, confirms it's actually a live, readable Nightscout
// site, then stores it under a fresh random slug so the visitor can use
// Orbie at /u/<slug> without ever touching env vars or redeploying.

const dns = require('dns').promises;
const { kv } = require('@vercel/kv');
const { createInstance, slugExists } = require('../lib/instances');

const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomSlug(length = 8) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return out;
}

// Blocks the obvious SSRF targets: loopback, link-local (this also covers
// the 169.254.169.254 cloud metadata endpoint), and the private RFC1918
// ranges. The goal is just to stop this form being used to make Vercel's
// servers poke at internal/private network addresses.
function isPrivateIp(ip) {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // fc00::/7 unique local
  if (/^fe80:/i.test(ip)) return true; // link-local
  return false;
}

async function assertPublicHttpsUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error("That doesn't look like a valid URL."), { status: 400 });
  }
  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Nightscout URL must start with https://'), { status: 400 });
  }
  if (parsed.hostname === 'localhost') {
    throw Object.assign(new Error("That URL isn't reachable from the internet."), { status: 400 });
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(new Error("That URL isn't reachable from the internet."), { status: 400 });
  }
  return parsed;
}

// Very small daily cap per IP so this can't become a free SSRF probe or
// get spammed with junk instances. 10/day is generous for real visitors.
async function checkRateLimit(ip) {
  const key = `ratelimit:create-instance:${ip}`;
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, 60 * 60 * 24);
  if (count > 10) {
    throw Object.assign(
      new Error('Too many demo links created from this address today — try again tomorrow.'),
      { status: 429 }
    );
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    await checkRateLimit(ip);

    const { nightscoutUrl, nightscoutToken } = req.body || {};
    if (!nightscoutUrl || typeof nightscoutUrl !== 'string') {
      return res.status(400).json({ error: 'nightscoutUrl is required.' });
    }

    const parsed = await assertPublicHttpsUrl(nightscoutUrl);
    const cleanUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');

    // Confirm it's actually a live, readable Nightscout site before saving
    // it — same endpoint Nightscout's own status page uses.
    const statusUrl = new URL(`${cleanUrl}/api/v1/status.json`);
    if (nightscoutToken) statusUrl.searchParams.set('token', nightscoutToken);
    let statusRes;
    try {
      statusRes = await fetch(statusUrl.toString(), { signal: AbortSignal.timeout(8000) });
    } catch {
      return res.status(400).json({ error: "Couldn't reach that URL — double check it's correct." });
    }
    if (!statusRes.ok) {
      return res.status(400).json({
        error: 'That looks unreachable or private — check the URL (and token, if your site needs one).',
      });
    }

    let slug = randomSlug();
    for (let i = 0; i < 5 && (await slugExists(slug)); i++) {
      slug = randomSlug(); // vanishingly unlikely, but avoid clobbering a live one
    }

    await createInstance(slug, { nightscoutUrl: cleanUrl, nightscoutToken });
    res.status(200).json({ slug, url: `/u/${slug}` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
