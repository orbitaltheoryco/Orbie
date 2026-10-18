// Vercel serverless function: GET /api/reading
// Returns the normalized reading shape, regardless of which CGM source
// is configured: { value, trend, timestamp (epoch ms), source }.
//
// Pass ?u=<slug> for a visitor's own Orbie (Nightscout or LibreLinkUp, see
// lib/resolveSource.js); with no slug this is the site owner's deployment
// and reads from env vars.

const { fetchFromNightscout } = require('../lib/nightscout');
const { fetchFromLibreLinkUp } = require('../lib/librelinkup');
const { getLibreSnapshot } = require('../lib/libreSession');
const { resolveSource } = require('../lib/resolveSource');
const { sendError, exposeUpstream } = require('../lib/errors');

module.exports = async function handler(req, res) {
  try {
    const cfg = await resolveSource(req);
    let reading;

    if (cfg.source === 'nightscout') {
      reading = await exposeUpstream(() => fetchFromNightscout(cfg.nightscoutUrl, cfg.nightscoutToken));
    } else if (cfg.source === 'librelinkup') {
      if (cfg.slug) {
        reading = (await getLibreSnapshot(cfg.slug, cfg.instance)).reading;
      } else {
        reading = await exposeUpstream(() => fetchFromLibreLinkUp(cfg.libreEmail, cfg.librePassword, cfg.libreRegion));
      }
    } else {
      return res.status(400).json({ error: `Unknown DATA_SOURCE "${cfg.source}". Use "nightscout" or "librelinkup".` });
    }

    // CGM data doesn't change faster than every ~1 minute anyway.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.status(200).json(reading);
  } catch (err) {
    sendError(res, err);
  }
};
