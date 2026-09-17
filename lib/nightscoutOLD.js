// Nightscout adapter — talks to the official Nightscout REST API.
// Docs: https://YOUR-NIGHTSCOUT-SITE/api-docs/

async function fetchFromNightscout(baseUrl, token) {
  if (!baseUrl || !token) {
    throw new Error('Missing NIGHTSCOUT_URL or NIGHTSCOUT_TOKEN.');
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/entries.json?count=1&token=${token}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Nightscout request failed: ${res.status} ${res.statusText}`);
  }

  const [entry] = await res.json();
  if (!entry) {
    throw new Error('Nightscout returned no entries.');
  }

  return {
    value: entry.sgv,
    trend: normalizeDirection(entry.direction),
    timestamp: entry.date, // epoch ms
    source: 'nightscout',
  };
}

// Nightscout's `direction` field -> our normalized trend enum
function normalizeDirection(direction) {
  const map = {
    DoubleUp: 'DoubleUp',
    SingleUp: 'SingleUp',
    FortyFiveUp: 'SingleUp',
    Flat: 'Flat',
    FortyFiveDown: 'SingleDown',
    SingleDown: 'SingleDown',
    DoubleDown: 'DoubleDown',
    'NOT COMPUTABLE': 'Stale',
    NONE: 'Stale',
    RATE_OUT_OF_RANGE: 'Stale',
  };
  return map[direction] || 'Stale';
}

async function fetchHistoryFromNightscout(baseUrl, token) {
  if (!baseUrl || !token) {
    throw new Error('Missing NIGHTSCOUT_URL or NIGHTSCOUT_TOKEN.');
  }

  // ~48 entries covers roughly 4 hours at Nightscout's typical 5-min cadence
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/entries.json?count=48&token=${token}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Nightscout history request failed: ${res.status} ${res.statusText}`);
  }

  const entries = await res.json(); // Nightscout returns newest-first
  if (!entries.length) {
    throw new Error('Nightscout returned no history entries.');
  }

  return entries.map((e) => e.sgv).reverse(); // oldest -> newest
}

module.exports = { fetchFromNightscout, fetchHistoryFromNightscout, normalizeDirection };
