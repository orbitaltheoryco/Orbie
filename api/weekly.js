// Vercel serverless function: GET /api/weekly
// Returns a 7-day summary (percent time low/in-range/high, average,
// counts) for the weekly recap view. Nightscout only: LibreLinkUp only
// exposes roughly the last 12 hours, so a real weekly recap isn't possible.
//
// Pass ?u=<slug> for a visitor's own Orbie.

const { fetchWeeklySummaryFromNightscout } = require('../lib/nightscout');
const { resolveSource } = require('../lib/resolveSource');
const { sendError, exposeUpstream } = require('../lib/errors');

module.exports = async function handler(req, res) {
  try {
    const cfg = await resolveSource(req);

    if (cfg.source === 'librelinkup') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(501).json({ error: "The weekly recap isn't available with LibreLinkUp — it only shares about the last 12 hours.", code: 'weekly_unavailable' });
    }
    if (cfg.source !== 'nightscout') {
      return res.status(501).json({ error: `Weekly recap only supports "nightscout" right now, DATA_SOURCE is "${cfg.source}".` });
    }

    const summary = await exposeUpstream(() => fetchWeeklySummaryFromNightscout(cfg.nightscoutUrl, cfg.nightscoutToken));
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    res.status(200).json(summary);
  } catch (err) {
    sendError(res, err);
  }
};
