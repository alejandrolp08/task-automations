const { getSupportedProviderKeys } = require("./providers/providerRegistry");
const { normalizeProviderKey } = require("../../../Shared/src/shared/providers/normalizeProviderKey");

function parseCommaSeparatedValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getActiveBuyingProviderKeys() {
  const configuredValues = parseCommaSeparatedValues(process.env.BUYING_BOT_ACTIVE_PROVIDERS);
  const normalizedConfigured = configuredValues
    .map((provider) => normalizeProviderKey(provider))
    .filter(Boolean);

  if (normalizedConfigured.length > 0) {
    return Array.from(new Set(normalizedConfigured));
  }

  return getSupportedProviderKeys();
}

function getFallbackMaxDistanceMiles() {
  const configuredValue = Number(process.env.BUYING_BOT_FALLBACK_MAX_DISTANCE_MILES || 3.5);
  return Number.isFinite(configuredValue) && configuredValue > 0 ? configuredValue : 3.5;
}

function getFallbackMaxBuyCostDelta() {
  const configuredValue = Number(process.env.BUYING_BOT_FALLBACK_MAX_BUY_COST_DELTA || 3);
  return Number.isFinite(configuredValue) && configuredValue >= 0 ? configuredValue : 3;
}

module.exports = {
  getActiveBuyingProviderKeys,
  getFallbackMaxDistanceMiles,
  getFallbackMaxBuyCostDelta,
};
