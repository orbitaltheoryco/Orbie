// One place to turn a thrown error into an HTTP response.
//
// Errors we created (LibreError, rate limits, validation) carry a safe,
// human-readable message + status. Anything else is logged (name only, never
// the message, which could contain internal details) and replaced by a
// generic message so internals never reach the browser.
function sendError(res, err) {
  const known = err && err.status && err.message && (err.name === 'LibreError' || err.expose || err.code);
  res.setHeader('Cache-Control', 'no-store');
  if (known) {
    return res.status(err.status).json({ error: err.message, code: err.code || undefined });
  }
  console.error('Unhandled API error:', err && (err.code || err.name));
  return res.status(502).json({ error: 'Something went wrong reaching your data. Please try again in a moment.' });
}

// The Nightscout / owner-mode adapters throw plain Errors whose messages are
// meant for people ("Nightscout request failed: 401 Unauthorized"). Mark
// ONLY errors coming out of those calls as safe to show.
async function exposeUpstream(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err && !err.status && !err.code && err.message) {
      err.expose = true;
      err.status = 502;
    }
    throw err;
  }
}

module.exports = { sendError, exposeUpstream };
