// Shared by every /api/* route: figures out which CGM source and
// credentials apply to THIS request.
//
// - A `?u=<slug>` query param means a visitor on a /u/<slug> demo link —
//   look their Nightscout URL up in KV (see lib/instances.js). Demo
//   instances are always Nightscout; LibreLinkUp needs a username/password
//   login, not something you'd want strangers pasting into a public form.
// - No slug means the site owner's own deployment — behave exactly as
//   before, reading from env vars.

const { getInstance } = require('./instances');

async function resolveSource(req) {
  const slug = req.query?.u;

  if (slug) {
    const instance = await getInstance(slug);
    if (!instance) {
      const err = new Error('This demo link has expired or does not exist.');
      err.status = 404;
      throw err;
    }
    return {
      source: 'nightscout',
      nightscoutUrl: instance.nightscoutUrl,
      nightscoutToken: instance.nightscoutToken,
    };
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
