// Vercel serverless function: GET /api/reading
// Returns the normalized reading shape, regardless of which CGM source
// is configured. Point Glimmer's frontend at this endpoint.
//
// Pass ?u=<slug> for a visitor's own demo instance (see /api/create-instance
// and lib/instances.js); with no slug this is the site owner's own
// deployment and behaves exactly as before, reading from env vars.

const { fetchFromNightscout } = require('../lib/nightscout');
const { fetchFromLibreLinkUp } = require('../lib/librelinkup');
const { resolveSource } = require('../lib/resolveSource');

module.exports = async function handler(req, res) {
  try {
    const cfg = await resolveSource(req);
    let reading;

    if (cfg.source === 'nightscout') {
      reading = await fetchFromNightscout(cfg.nightscoutUrl, cfg.nightscoutToken);
    } else if (cfg.source === 'librelinkup') {
      reading = await fetchFromLibreLinkUp(cfg.libreEmail, cfg.librePassword, cfg.libreRegion);
    } else {
      return res.status(400).json({ error: `Unknown DATA_SOURCE "${cfg.source}". Use "nightscout" or "librelinkup".` });
    }

    // Cache briefly at the edge/CDN layer if you put one in front of this —
    // CGM data doesn't change faster than every ~1 minute anyway.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.status(200).json(reading);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
};
