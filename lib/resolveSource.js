// Shared by every /api/* route: figures out which CGM source and
// credentials apply to THIS request.
//
// - `?u=<slug>` = a visitor's own Orbie link. Look the instance up in Redis;
//   it is either a Nightscout site or a LibreLinkUp follower login (stored
//   encrypted — see lib/crypto.js, lib/libreSession.js).
// - No slug = the site owner's own deployment: read from env vars, as before.

const { getInstance } = require('./instances');

async function resolveSource(req) {
  const slug = req.query && req.query.u;

  if (slug) {
    // Slugs are random hex (or, for older links, base-36). Reject anything
    // else early, before it goes near Redis keys.
    if (!/^[a-z0-9]{6,64}$/i.test(String(slug))) {
      const err = new Error('This link has expired or does not exist.');
      err.status = 404;
      err.expose = true;
      throw err;
    }
    const instance = await getInstance(slug);
    if (!instance) {
      const err = new Error('This link has expired or does not exist.');
      err.status = 404;
      err.expose = true;
      throw err;
    }
    if (instance.source === 'librelinkup') {
      return { source: 'librelinkup', slug, instance };
    }
    return { source: 'nightscout', nightscoutUrl: instance.nightscoutUrl, nightscoutToken: instance.nightscoutToken };
  }

  const source = (process.env.DATA_SOURCE || 'nightscout').toLowerCase();
  return {
    source,
    nightscoutUrl: process.env.NIGHTSCOUT_URL,
    nightscoutToken: process.env.NIGHTSCOUT_TOKEN,
    libreEmail: process.env.LIBRE_EMAIL,
    librePassword: process.env.LIBRE_PASSWORD,
    libreRegion: process.env.LIBRE_REGION || 'GLOBAL',
  };
}

module.exports = { resolveSource };
