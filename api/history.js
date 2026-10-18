// Vercel serverless function: GET /api/history
// Returns the last ~4 hours of readings as a flat array of mg/dL values,
// oldest first — this is what the frontend's poke interaction draws.
//
// Pass ?u=<slug> for a visitor's own Orbie. For LibreLinkUp the history
// comes from the same cached upstream call as /api/reading (one request to
// Abbott serves both).

const { fetchHistoryFromNightscout } = require('../lib/nightscout');
const { getLibreSnapshot } = require('../lib/libreSession');
const { resolveSource } = require('../lib/resolveSource');
const { sendError, exposeUpstream } = require('../lib/errors');

module.exports = async function handler(req, res) {
  try {
    const cfg = await resolveSource(req);

    if (cfg.source === 'librelinkup' && cfg.slug) {
      const snap = await getLibreSnapshot(cfg.slug, cfg.instance);
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
      return res.status(200).json({ values: snap.history, source: 'librelinkup' });
    }

    if (cfg.source !== 'nightscout') {
      return res.status(501).json({ error: `History endpoint only supports "nightscout" (or a LibreLinkUp link) right now, DATA_SOURCE is "${cfg.source}".` });
    }

    const values = await exposeUpstream(() => fetchHistoryFromNightscout(cfg.nightscoutUrl, cfg.nightscoutToken));
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    res.status(200).json({ values, source: 'nightscout' });
  } catch (err) {
    sendError(res, err);
  }
};
