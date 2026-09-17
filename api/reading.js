// Vercel serverless function: GET /api/reading
// Returns the normalized reading shape, regardless of which CGM source
// is configured. Point Glimmer's frontend at this endpoint.

const { fetchFromNightscout } = require('../lib/nightscout');
const { fetchFromLibreLinkUp } = require('../lib/librelinkup');

module.exports = async function handler(req, res) {
  const source = (process.env.DATA_SOURCE || 'nightscout').toLowerCase();

  try {
    let reading;

    if (source === 'nightscout') {
      reading = await fetchFromNightscout(
        process.env.NIGHTSCOUT_URL,
        process.env.NIGHTSCOUT_TOKEN
      );
    } else if (source === 'librelinkup') {
      reading = await fetchFromLibreLinkUp(
        process.env.LIBRE_EMAIL,
        process.env.LIBRE_PASSWORD,
        process.env.LIBRE_REGION || 'GLOBAL'
      );
    } else {
      return res.status(400).json({ error: `Unknown DATA_SOURCE "${source}". Use "nightscout" or "librelinkup".` });
    }

    // Cache briefly at the edge/CDN layer if you put one in front of this —
    // CGM data doesn't change faster than every ~1 minute anyway.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.status(200).json(reading);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
