// LibreLinkUp adapter — unofficial API (no public docs from Abbott).
// This follows the shape documented by the community reverse-engineering
// effort at https://libreview-unofficial.stoplight.io/ and used by
// projects like libre-link-up-api-client, pylibrelinkup, and Nightscout's
// own Libre uploader. IT CAN BREAK if Abbott changes their backend —
// treat this file as the single place you'd need to patch if it does.

const BASE_HOSTS = {
  GLOBAL: 'https://api.libreview.io',
  US: 'https://api-us.libreview.io',
  EU: 'https://api-eu.libreview.io',
  EU2: 'https://api-eu2.libreview.io',
  DE: 'https://api-de.libreview.io',
  FR: 'https://api-fr.libreview.io',
  JP: 'https://api-jp.libreview.io',
  AU: 'https://api-au.libreview.io',
  AE: 'https://api-ae.libreview.io',
  AP: 'https://api-ap.libreview.io',
  CA: 'https://api-ca.libreview.io',
  LA: 'https://api-la.libreview.io',
};

// Abbott's backend checks these and will reject requests without a
// recognizable client — values borrowed from the community docs above.
const LLU_HEADERS = {
  'Content-Type': 'application/json',
  product: 'llu.android',
  version: '4.12.0',
};

// In-memory cache so we don't log in on every poll. Resets on cold start,
// which is fine for a low-frequency polling use case like this.
let cachedAuth = null;

async function loginToLibreView(email, password, region = 'GLOBAL') {
  const baseUrl = BASE_HOSTS[region] || BASE_HOSTS.GLOBAL;

  const res = await fetch(`${baseUrl}/llu/auth/login`, {
    method: 'POST',
    headers: LLU_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();

  // LibreView sometimes responds with a redirect to your account's actual
  // region instead of a token on first login — follow it once.
  if (data?.data?.redirect && data?.data?.region) {
    return loginToLibreView(email, password, data.data.region.toUpperCase());
  }

  const token = data?.data?.authTicket?.token;
  if (!token) {
    throw new Error('LibreLinkUp login failed — check credentials, or your region may need setting explicitly.');
  }
  return { token, baseUrl };
}

async function getFirstConnectionId(baseUrl, token) {
  const res = await fetch(`${baseUrl}/llu/connections`, {
    headers: { ...LLU_HEADERS, Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const connection = data?.data?.[0];
  if (!connection) {
    throw new Error('No LibreLinkUp connections found for this account — make sure someone has shared readings with it.');
  }
  return connection.patientId;
}

async function fetchFromLibreLinkUp(email, password, region = 'GLOBAL') {
  if (!email || !password) {
    throw new Error('Missing LIBRE_EMAIL or LIBRE_PASSWORD.');
  }

  if (!cachedAuth) {
    cachedAuth = await loginToLibreView(email, password, region);
  }

  let latest;
  try {
    latest = await fetchLatestMeasurement(cachedAuth);
  } catch (err) {
    // Token may have expired — retry once with a fresh login.
    cachedAuth = await loginToLibreView(email, password, region);
    latest = await fetchLatestMeasurement(cachedAuth);
  }

  return {
    value: latest.ValueInMgPerDl,
    trend: normalizeTrend(latest.TrendArrow),
    timestamp: latest.Timestamp,
    source: 'librelinkup',
  };
}

async function fetchLatestMeasurement({ baseUrl, token }) {
  const patientId = await getFirstConnectionId(baseUrl, token);
  const res = await fetch(`${baseUrl}/llu/connections/${patientId}/graph`, {
    headers: { ...LLU_HEADERS, Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const measurement = data?.data?.connection?.glucoseMeasurement;
  if (!measurement) {
    throw new Error('No glucose measurement in LibreLinkUp response.');
  }
  return measurement;
}

// LibreLinkUp's numeric TrendArrow -> our normalized trend enum
function normalizeTrend(trendArrow) {
  const map = {
    1: 'DoubleDown',
    2: 'SingleDown',
    3: 'Flat',
    4: 'SingleUp',
    5: 'DoubleUp',
  };
  return map[trendArrow] || 'Stale';
}

module.exports = { fetchFromLibreLinkUp, normalizeTrend };
