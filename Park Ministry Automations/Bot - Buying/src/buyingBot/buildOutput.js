function buildOutput(
  startDate,
  endDate,
  recordsToBuy,
  source = "local_sample",
  sharedExecutionStages = [],
  providerExecutionPlans = [],
) {
  return {
    run_type: "buy_candidates",
    source,
    date_range: {
      start: startDate,
      end: endDate,
    },
    records_to_buy: recordsToBuy,
    shared_execution_stages: sharedExecutionStages,
    provider_execution_plans: providerExecutionPlans,
  };
}

module.exports = { buildOutput };
