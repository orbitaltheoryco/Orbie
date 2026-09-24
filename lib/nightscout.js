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

async function fetchWeeklySummaryFromNightscout(baseUrl, token) {
  if (!baseUrl || !token) {
    throw new Error('Missing NIGHTSCOUT_URL or NIGHTSCOUT_TOKEN.');
  }

  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  // Enough headroom for a week at typical 5-min cadence (~2016 entries),
  // filtered server-side by Nightscout itself via the date query.
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/entries.json?count=3000&find[date][$gte]=${sevenDaysAgoMs}&token=${token}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Nightscout weekly request failed: ${res.status} ${res.statusText}`);
  }

  const entries = await res.json();
  const values = entries.map((e) => e.sgv).filter((v) => typeof v === 'number');
  if (!values.length) {
    throw new Error('No entries returned for the last 7 days.');
  }

  const total = values.length;
  const lowCount = values.filter((v) => v < 70).length;
  const highCount = values.filter((v) => v > 180).length;
  const inRangeCount = total - lowCount - highCount;
  const average = values.reduce((a, b) => a + b, 0) / total;

  return {
    percentLow: Math.round((lowCount / total) * 100),
    percentInRange: Math.round((inRangeCount / total) * 100),
    percentHigh: Math.round((highCount / total) * 100),
    average,
    lowCount,
    highCount,
    totalReadings: total,
    days: 7,
  };
}

module.exports = { fetchFromNightscout, fetchHistoryFromNightscout, fetchWeeklySummaryFromNightscout, normalizeDirection };
