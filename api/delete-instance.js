// Vercel serverless function: POST /api/delete-instance?u=<slug>
//
// Lets a person remove their Orbie — and, for LibreLinkUp, the login we hold
// for them — immediately, instead of waiting for the 30-day expiry. The slug
// itself is the proof of ownership (it is an unguessable 128-bit value).
// Always answers "deleted" so it can't be used to probe which slugs exist.

const { deleteInstance } = require('../lib/instances');
const { hit, clientIp } = require('../lib/ratelimit');
const { sendError } = require('../lib/errors');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Use POST.' });
  }
  try {
    const slug = req.query && req.query.u;
    if (!slug || !/^[a-z0-9]{6,64}$/i.test(String(slug))) {
      return res.status(400).json({ error: 'Missing or invalid link.' });
    }
    if (!(await hit(`rl:delete:ip:${clientIp(req)}`, 30, 3600))) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    await deleteInstance(slug);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ deleted: true });
  } catch (err) {
    sendError(res, err);
  }
};
