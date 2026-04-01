const fs = require("fs");
const { getBuyingBotOperativePaths } = require("../../../../../Workspace/operativePaths");
const { getEventValidationState } = require("../../stages/eventTimeResolution/validationPolicy");

function loadResultJson() {
  const resultPath = getBuyingBotOperativePaths().resultJson;

  if (!fs.existsSync(resultPath)) {
    throw new Error(
      "BuyingBot result.json was not found. Run the main pipeline first so checkout has candidate records to use.",
    );
  }

  return JSON.parse(fs.readFileSync(resultPath, "utf8"));
}

function getWayRecords(result) {
  return (result.provider_execution_plans || []).find((plan) => plan.provider_key === "way")?.records || [];
}

function getEventTimeResolutions(result) {
  return result.shared_execution_stages?.find((stage) => stage.stage === "event_time_resolution")
    ?.event_time_resolutions || [];
}

function getResolvedEventTimeForRecord(result, recordId) {
  const resolution = getEventTimeResolutions(result).find((item) => item.record_id === recordId);

  if (!resolution) {
    return null;
  }

  const validation = getEventValidationState(resolution);

  if (!validation.eligible) {
    return null;
  }

  if (validation.event_status === "tbd" || validation.event_status === "tbh") {
    return {
      resolved_event_time: resolution.resolved_event_time || null,
      source: resolution.source_used,
      status: resolution.status,
      event_status: validation.event_status,
      window_policy: resolution.window_policy || null,
      checkout_strategies: resolution.checkout_strategies || [],
    };
  }

  if (resolution.resolved_event_time) {
    return {
      resolved_event_time: resolution.resolved_event_time,
      source: resolution.source_used,
      status: resolution.status,
      event_status: validation.event_status || "scheduled",
      window_policy: resolution.window_policy || null,
      checkout_strategies: resolution.checkout_strategies || [],
    };
  }

  if (resolution.smartsuite_event_time_hint && !resolution.manual_review_required) {
    return {
      resolved_event_time: resolution.smartsuite_event_time_hint,
      source: resolution.source_used,
      status: resolution.status,
      event_status: validation.event_status || "scheduled",
      window_policy: resolution.window_policy || null,
      checkout_strategies: resolution.checkout_strategies || [],
    };
  }

  return null;
}

function loadWayCheckoutCandidate(recordId) {
  const result = loadResultJson();
  const wayRecords = getWayRecords(result);

  if (wayRecords.length === 0) {
    throw new Error("No Way records were found in BuyingBot result.json.");
  }

  const candidate = recordId
    ? wayRecords.find((record) => record.record_id === recordId)
    : wayRecords[0];

  if (!candidate) {
    throw new Error(`Way record ${recordId} was not found in BuyingBot result.json.`);
  }

  const resolvedTime = getResolvedEventTimeForRecord(result, candidate.record_id);

  if (!resolvedTime) {
    throw new Error(
      `Record ${candidate.record_id} does not have a resolved event time yet. Validate StubHub time before attempting checkout.`,
    );
  }

  return {
    candidate,
    resolved_event_time: resolvedTime.resolved_event_time,
    resolved_event_time_source: resolvedTime.source,
    resolved_event_time_status: resolvedTime.status,
    resolved_event_status: resolvedTime.event_status,
    resolved_window_policy: resolvedTime.window_policy,
    resolved_checkout_strategies: resolvedTime.checkout_strategies,
  };
}

module.exports = { loadWayCheckoutCandidate };
