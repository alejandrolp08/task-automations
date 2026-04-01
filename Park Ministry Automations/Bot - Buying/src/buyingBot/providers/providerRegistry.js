const WAY_PROVIDER = require("./way");
const { normalizeProviderKey } = require("../../../../Shared/src/shared/providers/normalizeProviderKey");

const PROVIDERS = {
  way: WAY_PROVIDER,
};

function getProviderHandler(providerKey) {
  return PROVIDERS[providerKey] || null;
}

function getSupportedProviderKeys() {
  return Object.keys(PROVIDERS);
}

module.exports = {
  normalizeProviderKey,
  getProviderHandler,
  getSupportedProviderKeys,
};
