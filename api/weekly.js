// Vercel serverless function: GET /api/weekly
// Returns a 7-day summary (percent time low/in-range/high, average,
// counts) for the weekly recap view. Nightscout only for now — see the
// note in api/history.js about LibreLinkUp not having an equivalent
// bulk-history call wired up yet.
//
// Pass ?u=<slug> for a visitor's own demo instance (see /api/create-instance
// and lib/instances.js); with no slug this is the site owner's own
// deployment and behaves exactly as before, reading from env vars.

const { fetchWeeklySummaryFromNightscout } = require('../lib/nightscout');
const { resolveSource } = require('../lib/resolveSource');

module.exports = async function handler(req, res) {
  try {
    const cfg = await resolveSource(req);

    if (cfg.source !== 'nightscout') {
      return res.status(501).json({ error: `Weekly recap only supports "nightscout" right now, DATA_SOURCE is "${cfg.source}".` });
    }

    const summary = await fetchWeeklySummaryFromNightscout(cfg.nightscoutUrl, cfg.nightscoutToken);

    // A week of history doesn't need to be recomputed on every request —
    // half an hour of caching is plenty fresh for a "weekly" view.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    res.status(200).json(summary);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
};
