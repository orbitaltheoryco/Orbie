// Vercel serverless function: GET /api/history
// Returns the last ~4 hours of readings as a flat array of mg/dL values,
// oldest first — this is what the frontend's poke interaction draws.

const { fetchHistoryFromNightscout } = require('../lib/nightscout');

module.exports = async function handler(req, res) {
  const source = (process.env.DATA_SOURCE || 'nightscout').toLowerCase();

  try {
    if (source !== 'nightscout') {
      // LibreLinkUp's own graph endpoint already returns a rolling history
      // natively (see lib/librelinkup.js fetchLatestMeasurement's raw
      // response), so a from-scratch history adapter isn't wired yet —
      // add one here the same way if you need it independent of Nightscout.
      return res.status(501).json({ error: `History endpoint only supports "nightscout" right now, DATA_SOURCE is "${source}".` });
    }

    const values = await fetchHistoryFromNightscout(
      process.env.NIGHTSCOUT_URL,
      process.env.NIGHTSCOUT_TOKEN
    );

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    res.status(200).json({ values, source: 'nightscout' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
