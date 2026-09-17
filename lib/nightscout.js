// Nightscout adapter — talks to the official Nightscout REST API.
// Docs: https://YOUR-NIGHTSCOUT-SITE/api-docs/

async function fetchFromNightscout(baseUrl, token) {
  if (!baseUrl) {
    throw new Error('Missing NIGHTSCOUT_URL.');
  }

  // Token is optional — some Nightscout sites are open-access and don't
  // require one at all.
  const params = new URLSearchParams({ count: '1' });
  if (token) params.set('token', token);
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/entries.json?${params.toString()}`;
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
  if (!baseUrl) {
    throw new Error('Missing NIGHTSCOUT_URL.');
  }

  // ~48 entries covers roughly 4 hours at Nightscout's typical 5-min cadence.
  // Token is optional — some Nightscout sites are open-access.
  const params = new URLSearchParams({ count: '48' });
  if (token) params.set('token', token);
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/entries.json?${params.toString()}`;
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
