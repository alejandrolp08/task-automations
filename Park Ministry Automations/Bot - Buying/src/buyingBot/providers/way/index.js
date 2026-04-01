const { buildWayCheckoutFlow } = require("./checkoutFlow");
const { hasWayCredentials } = require("./config");

const provider = {
  key: "way",
  name: "Way",
  stage: "provider_checkout_preparation",
  status: hasWayCredentials() ? "ready_for_browser_automation" : "missing_way_credentials",
  supportsCheckout: false,
  requiresEventTimeResolution: true,
  notes: [
    "Way checkout should start only after the shared event-time resolution stage is complete.",
    "Way keeps its own provider-specific search and checkout flow.",
    "Checkout automation for Way will be built in a provider-specific module.",
  ],
};

function buildPlan(records) {
  return {
    provider: provider.name,
    provider_key: provider.key,
    stage: provider.stage,
    status: provider.status,
    supports_checkout: provider.supportsCheckout,
    requires_event_time_resolution: provider.requiresEventTimeResolution,
    record_count: records.length,
    records,
    checkout_flow: buildWayCheckoutFlow(),
    next_steps: [
      "Receive records after shared event-time resolution",
      "Use resolved event time to build the parking window",
      "Prepare Way search and checkout flow",
    ],
    notes: provider.notes,
  };
}

module.exports = {
  ...provider,
  buildPlan,
};
