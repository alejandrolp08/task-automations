const PROVIDER_ALIASES = {
  way: 'way',
  'way.com': 'way',
  spothero: 'spothero',
  'spot hero': 'spothero',
  laz: 'laz',
  'laz parking': 'laz',
  parkmobile: 'parkmobile',
  'park mobile': 'parkmobile',
  parkingcom: 'parkingcom',
  'parking.com': 'parkingcom',
  bestparking: 'bestparking',
  'best parking': 'bestparking',
  premiumparking: 'premiumparking',
  'premium parking': 'premiumparking',
  parking305: 'parking305',
  'click n park': 'clicknpark',
  clicknpark: 'clicknpark',
};

function normalizeProviderKey(providerName) {
  const normalized = String(providerName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (!normalized) {
    return 'unknown';
  }

  return PROVIDER_ALIASES[normalized] || normalized.replace(/[^a-z0-9]+/g, '');
}

module.exports = { normalizeProviderKey, PROVIDER_ALIASES };
