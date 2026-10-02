// Vercel serverless function: GET /api/history
// Returns the last ~4 hours of readings as a flat array of mg/dL values,
// oldest first — this is what the frontend's poke interaction draws.
//
// Pass ?u=<slug> for a visitor's own demo instance (see /api/create-instance
// and lib/instances.js); with no slug this is the site owner's own
// deployment and behaves exactly as before, reading from env vars.

const { fetchHistoryFromNightscout } = require('../lib/nightscout');
const { resolveSource } = require('../lib/resolveSource');

module.exports = async function handler(req, res) {
  try {
    const cfg = await resolveSource(req);

    if (cfg.source !== 'nightscout') {
      // LibreLinkUp's own graph endpoint already returns a rolling history
      // natively (see lib/librelinkup.js fetchLatestMeasurement's raw
      // response), so a from-scratch history adapter isn't wired yet —
      // add one here the same way if you need it independent of Nightscout.
      return res.status(501).json({ error: `History endpoint only supports "nightscout" right now, DATA_SOURCE is "${cfg.source}".` });
    }

    const values = await fetchHistoryFromNightscout(cfg.nightscoutUrl, cfg.nightscoutToken);

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    res.status(200).json({ values, source: 'nightscout' });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
};
