// Vercel serverless function: GET /api/weekly
// Returns a 7-day summary (percent time low/in-range/high, average,
// counts) for the weekly recap view. Nightscout only for now — see the
// note in api/history.js about LibreLinkUp not having an equivalent
// bulk-history call wired up yet.

const { fetchWeeklySummaryFromNightscout } = require('../lib/nightscout');

module.exports = async function handler(req, res) {
  const source = (process.env.DATA_SOURCE || 'nightscout').toLowerCase();

  try {
    if (source !== 'nightscout') {
      return res.status(501).json({ error: `Weekly recap only supports "nightscout" right now, DATA_SOURCE is "${source}".` });
    }

    const summary = await fetchWeeklySummaryFromNightscout(
      process.env.NIGHTSCOUT_URL,
      process.env.NIGHTSCOUT_TOKEN
    );

    // A week of history doesn't need to be recomputed on every request —
    // half an hour of caching is plenty fresh for a "weekly" view.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    res.status(200).json(summary);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
