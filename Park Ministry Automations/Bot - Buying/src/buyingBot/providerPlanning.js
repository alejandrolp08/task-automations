const {
  normalizeProviderKey,
  getProviderHandler,
} = require("./providers/providerRegistry");
const { buildEventTimeResolutionStage } = require("./stages/eventTimeResolution");

function buildProviderExecutionPlans(records) {
  const grouped = new Map();

  for (const record of records) {
    const providerKey = normalizeProviderKey(record.provider);
    const nextRecord = {
      ...record,
      provider_key: providerKey,
    };

    if (!grouped.has(providerKey)) {
      grouped.set(providerKey, []);
    }

    grouped.get(providerKey).push(nextRecord);
  }

  return Array.from(grouped.entries())
    .map(([providerKey, providerRecords]) => {
      const handler = getProviderHandler(providerKey);

      if (!handler) {
        return {
          provider: providerRecords[0]?.provider || providerKey,
          provider_key: providerKey,
          stage: "unsupported",
          status: "pending_definition",
          supports_checkout: false,
          requires_event_time_resolution: false,
          record_count: providerRecords.length,
          records: providerRecords,
          next_steps: [
            "Define provider-specific search flow",
            "Define provider-specific checkout flow",
          ],
          notes: [
            "This provider is not yet implemented in the automation architecture.",
          ],
        };
      }

      return handler.buildPlan(providerRecords);
    })
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

async function buildSharedExecutionStages(records) {
  return [await buildEventTimeResolutionStage(records)];
}

module.exports = { buildProviderExecutionPlans, buildSharedExecutionStages };
