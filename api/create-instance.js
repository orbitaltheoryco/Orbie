// Vercel serverless function: POST /api/create-instance
//
//   Nightscout:    { nightscoutUrl, nightscoutToken? }
//   LibreLinkUp:   { source: 'librelinkup', email, password, patientId? }
//
// Response: { slug, url }  — the visitor then uses Orbie at /u/<slug>.
// LibreLinkUp may instead answer { choosePatient: true, patients: [...] }
// when the account follows more than one person; the page shows a picker and
// sends the request again with patientId.
//
// A LibreLinkUp login is a PASSWORD, so this path is much stricter than the
// Nightscout one: strict per-IP and per-email limits (so the form can't be
// used to guess passwords against Abbott), encryption at rest (lib/crypto.js),
// and nothing about the request body is ever logged or echoed back.

const crypto = require('crypto');
const dns = require('dns').promises;
const { createInstance, slugExists } = require('../lib/instances');
const { hit, clientIp, emailKey } = require('../lib/ratelimit');
const { encryptJson, isConfigured } = require('../lib/crypto');
const llu = require('../lib/librelinkup');
const { seedSession, credsContext } = require('../lib/libreSession');
const { sendError } = require('../lib/errors');

// An error whose message is safe to show the visitor.
function userError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  if (code) err.code = code;
  return err;
}

// 128 bits from the OS random source. The slug IS the access key to someone's
// glucose data, so it must be unguessable (Math.random is not).
function newSlug() {
  return crypto.randomBytes(16).toString('hex');
}

async function freshSlug() {
  let slug = newSlug();
  for (let i = 0; i < 5 && (await slugExists(slug)); i++) slug = newSlug();
  return slug;
}

// ---------------- Nightscout ----------------

// Blocks SSRF targets: loopback, link-local (incl. the 169.254.169.254 cloud
// metadata address), private/CGNAT ranges, and their IPv6 equivalents.
function isPrivateIp(ip) {
  const v = String(ip).toLowerCase().replace(/^::ffff:/, '');
  if (v === '::1' || v === '::' || v === '0.0.0.0') return true;
  if (/^127\./.test(v) || /^0\./.test(v)) return true;
  if (/^10\./.test(v) || /^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^169\.254\./.test(v)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return true; // 100.64.0.0/10
  if (/^f[cd][0-9a-f]{2}:/.test(v)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(v)) return true; // fe80::/10
  return false;
}

async function assertPublicHttpsUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw userError(400, "That doesn't look like a valid URL.");
  }
  if (parsed.protocol !== 'https:') throw userError(400, 'Nightscout URL must start with https://');
  if (parsed.hostname === 'localhost') throw userError(400, "That URL isn't reachable from the internet.");
  const addresses = await dns.lookup(parsed.hostname, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    throw userError(400, "That URL isn't reachable from the internet.");
  }
  return parsed;
}

async function createNightscout(res, body, ip) {
  // Small daily cap per IP so this can't become a free SSRF probe or get
  // spammed with junk instances.
  if (!(await hit(`ratelimit:create-instance:${ip}`, 10, 60 * 60 * 24))) {
    throw userError(429, 'Too many links created from this address today — try again tomorrow.', 'too_many_attempts');
  }

  const { nightscoutUrl, nightscoutToken } = body;
  if (!nightscoutUrl || typeof nightscoutUrl !== 'string') throw userError(400, 'nightscoutUrl is required.');

  const parsed = await assertPublicHttpsUrl(nightscoutUrl);
  const cleanUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');

  // Confirm it's a live, readable Nightscout site before saving it.
  const statusUrl = new URL(`${cleanUrl}/api/v1/status.json`);
  if (nightscoutToken) statusUrl.searchParams.set('token', nightscoutToken);
  let statusRes;
  try {
    statusRes = await fetch(statusUrl.toString(), { signal: AbortSignal.timeout(8000) });
  } catch {
    throw userError(400, "Couldn't reach that URL — double check it's correct.");
  }
  if (!statusRes.ok) {
    throw userError(400, 'That looks unreachable or private — check the URL (and token, if your site needs one).');
  }

  const slug = await freshSlug();
  await createInstance(slug, { source: 'nightscout', nightscoutUrl: cleanUrl, nightscoutToken: nightscoutToken || null });
  res.status(200).json({ slug, url: `/u/${slug}`, source: 'nightscout' });
}

// ---------------- LibreLinkUp ----------------

async function createLibre(res, body, ip) {
  // Refuse outright (rather than store a password unencrypted) if the
  // server's encryption key isn't configured.
  if (!isConfigured()) {
    throw userError(503, "LibreLinkUp sign-in isn't switched on for this site yet.", 'not_configured');
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw userError(400, 'Enter the email address of your LibreLinkUp login.');
  }
  if (!password || password.length > 200) throw userError(400, 'Enter your LibreLinkUp password.');

  // Limits come BEFORE any call to Abbott. By IP (per hour and per day) and
  // by hashed email, so neither one machine nor a targeted guess at one
  // account can use this form to hammer Abbott's login.
  const okIp = await hit(`rl:libre:ip:${ip}`, 8, 3600);
  const okDay = await hit(`rl:libre:ipday:${ip}`, 20, 86400);
  const okEmail = await hit(`rl:libre:email:${emailKey(email)}`, 5, 3600);
  if (!okIp || !okDay || !okEmail) {
    throw userError(429, 'Too many sign-in attempts. Please wait a while before trying again.', 'too_many_attempts');
  }

  // LibreLinkUp* errors thrown below already carry a safe message + status.
  const session = await llu.login(email, password, 'GLOBAL');
  const connections = await llu.listConnections(session);
  if (!connections.length) {
    throw userError(
      422,
      "You're signed in, but this LibreLinkUp account isn't following anyone yet. The person wearing the sensor needs to invite this email address in the LibreLink app, and you need to accept the invitation in LibreLinkUp. Then try again.",
      'no_connections'
    );
  }

  let patientId = typeof body.patientId === 'string' ? body.patientId : null;
  if (!patientId) {
    if (connections.length > 1) return res.status(200).json({ choosePatient: true, patients: connections });
    patientId = connections[0].id;
  }
  if (!connections.some((c) => c.id === patientId)) {
    throw userError(400, "That person isn't on this LibreLinkUp account. Please start again.");
  }

  // Prove data actually flows before we keep anything.
  const snapshot = await llu.fetchGraph(session, patientId);

  const slug = await freshSlug();
  await createInstance(slug, {
    source: 'librelinkup',
    patientId,
    creds: encryptJson({ email, password, region: llu.regionOf(session.baseUrl) }, credsContext(slug)),
  });
  await seedSession(slug, session, snapshot);
  res.status(200).json({ slug, url: `/u/${slug}`, source: 'librelinkup' });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  try {
    const ip = clientIp(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.source === 'librelinkup') return await createLibre(res, body, ip);
    return await createNightscout(res, body, ip);
  } catch (err) {
    sendError(res, err);
  }
};
