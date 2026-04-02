const fs = require("fs/promises");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");

const { loadEnv } = require("../../../Workspace/loadEnv");
const { getBuyingBotOperativePaths } = require("../../../Workspace/operativePaths");
const { fetchBuying } = require("./fetchBuying");
const { normalizeBuyingRecords } = require("../../../Shared/src/shared/records/normalizeBuying");
const { filterBuying } = require("./filterBuying");
const { buildOutput } = require("./buildOutput");
const { getEventValidationState } = require("./stages/eventTimeResolution/validationPolicy");
const { runRoutineMaintenance } = require("./maintenance");
const {
  buildProviderExecutionPlans,
  buildSharedExecutionStages,
} = require("./providerPlanning");
const { executeWayCheckout } = require("./providers/way/executeCheckout");
const {
  getActiveBuyingProviderKeys,
  getFallbackMaxDistanceMiles,
  getFallbackMaxBuyCostDelta,
} = require("./config");
const {
  fetchFallbackLocations,
  buildFallbackLocationIndex,
  getFallbackLocationsForCandidate,
} = require("./alternateLocations");

loadEnv();

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }

  return !["false", "0", "no"].includes(String(value).trim().toLowerCase());
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEquivalentLotGroupKey(candidate, resolvedTimeOrStatus = "") {
  return [
    normalizeText(candidate?.provider),
    normalizeText(candidate?.event),
    String(candidate?.event_date || "").trim(),
    String(resolvedTimeOrStatus || candidate?.event_time || "").trim(),
    normalizeText(candidate?.parking_location),
  ].join("|");
}

function cloneCheckoutStrategy(strategy) {
  if (!strategy || typeof strategy !== "object") {
    return null;
  }

  return {
    ...strategy,
    checkoutWindow:
      strategy.checkoutWindow && typeof strategy.checkoutWindow === "object"
        ? { ...strategy.checkoutWindow }
        : strategy.checkoutWindow || null,
  };
}

function serializeCheckoutStrategy(strategy) {
  if (!strategy || typeof strategy !== "object") {
    return "";
  }

  return JSON.stringify({
    label: String(strategy.label || ""),
    checkoutWindow: strategy.checkoutWindow && typeof strategy.checkoutWindow === "object"
      ? strategy.checkoutWindow
      : null,
  });
}

function prioritizeCheckoutStrategies(baseStrategies, preferredStrategy) {
  const normalizedBase = Array.isArray(baseStrategies) ? baseStrategies.filter(Boolean) : [];
  const normalizedPreferred = cloneCheckoutStrategy(preferredStrategy);

  if (!normalizedPreferred) {
    return normalizedBase.map((strategy) => cloneCheckoutStrategy(strategy)).filter(Boolean);
  }

  const preferredKey = serializeCheckoutStrategy(normalizedPreferred);
  const remaining = normalizedBase
    .filter((strategy) => serializeCheckoutStrategy(strategy) !== preferredKey)
    .map((strategy) => cloneCheckoutStrategy(strategy))
    .filter(Boolean);

  return [normalizedPreferred, ...remaining];
}

function shouldSkipEquivalentGroupAfterFailure(result) {
  const status = String(result?.status || "");
  const errorMessage = String(result?.error_message || "");

  if (status === "target_lot_sold_out" || status === "parking_lot_not_found" || status === "parking_lot_overpriced") {
    return true;
  }

  if (status !== "execution_error") {
    return false;
  }

  return [
    "Way checkout date selection was not confirmed",
    "Way selected date/time did not match target",
    "Way calendar day text could not be located",
    "Way time container was not found for target time",
    "Way time picker could not bring target time into view",
    "Way search button did not transition to results after all click strategies.",
    "Way results window did not match expected booking window.",
    "Way results did not contain a strong address match for the target parking location.",
    "locator.click: Timeout 30000ms exceeded.",
  ].some((needle) => errorMessage.includes(needle));
}

function isClearlyUnrecoverableExecutionError(result) {
  if (String(result?.status || "") !== "execution_error") {
    return false;
  }

  const errorMessage = String(result?.error_message || "");
  return [
    "Way calendar could not navigate to target month",
    "Way checkout requires a resolved event time",
    "Way checkout absolute windows require HH:MM start and end times",
    "Way checkout requires a valid event date in YYYY-MM-DD format",
    "Way results did not contain a strong address match for the target parking location.",
    "Way calendar navigation controls were not found for month",
  ].some((needle) => errorMessage.includes(needle));
}

function buildEquivalentFailureSignature(result) {
  if (!shouldSkipEquivalentGroupAfterFailure(result)) {
    return null;
  }

  if (result?.status === "target_lot_sold_out") {
    return "target_lot_sold_out";
  }

  if (result?.status === "parking_lot_not_found") {
    return "parking_lot_not_found";
  }

  if (result?.status === "parking_lot_overpriced") {
    return "parking_lot_overpriced";
  }

  const errorMessage = String(result?.error_message || "");
  const knownPatterns = [
    "Way checkout date selection was not confirmed",
    "Way selected date/time did not match target",
    "Way calendar day text could not be located",
    "Way time container was not found for target time",
    "Way time picker could not bring target time into view",
    "Way search button did not transition to results after all click strategies.",
    "Way results window did not match expected booking window.",
    "Way results did not contain a strong address match for the target parking location.",
    "locator.click: Timeout 30000ms exceeded.",
  ];

  return knownPatterns.find((needle) => errorMessage.includes(needle)) || result?.status || "execution_error";
}

function isWayDebugEnabled() {
  return ["1", "true", "yes"].includes(String(process.env.WAY_DEBUG || "").trim().toLowerCase());
}

function formatUserFacingStatus(status) {
  const normalized = String(status || "");
  if (normalized === "price_out_of_range") {
    return "parking_lot_overpriced";
  }
  return normalized;
}

function formatRecordContext(candidate, resolution, validation) {
  return [
    candidate?.event || "Unknown event",
    candidate?.venue || "Unknown venue",
    candidate?.event_date || "unknown-date",
    resolution?.resolved_event_time || candidate?.event_time || validation?.event_status || "unverified",
    candidate?.parking_location || "unknown-location",
  ].join(" | ");
}

function shouldTryAlternateLocationFallback(result) {
  return [
    "target_lot_sold_out",
    "parking_lot_not_found",
    "best_match_unavailable",
  ].includes(String(result?.status || ""));
}

function cloneCandidateWithFallbackLocation(candidate, fallbackLocation) {
  return {
    ...candidate,
    provider: fallbackLocation.provider || candidate.provider,
    provider_key: fallbackLocation.provider_key || candidate.provider_key,
    parking_location: fallbackLocation.parking_location,
    parking_location_id: fallbackLocation.parking_location_id || candidate.parking_location_id,
    parking_location_record_id: fallbackLocation.record_id || candidate.parking_location_record_id,
    fallback_distance_from_venue: fallbackLocation.distance_from_venue,
    fallback_distance_unit: fallbackLocation.distance_unit,
    fallback_distance_miles: fallbackLocation.distance_miles,
  };
}

async function executeWayCheckoutWithLocationFallback({
  candidate,
  resolvedEventTime,
  resolvedEventStatus,
  checkoutStrategies,
  dryRun,
  keepBrowserOpen,
  updateSmartsuite,
  excludeReservationIds,
  fallbackLocations = [],
} = {}) {
  const attemptedLocations = [];
  const locationCandidates = [
    { source: "primary", candidate, fallbackLocation: null },
    ...fallbackLocations.map((fallbackLocation, index) => ({
      source: "alternate",
      candidate: cloneCandidateWithFallbackLocation(candidate, fallbackLocation),
      fallbackLocation,
      fallback_rank: index + 1,
    })),
  ];

  let lastResult = null;

  for (let index = 0; index < locationCandidates.length; index += 1) {
    const locationAttempt = locationCandidates[index];

    if (locationAttempt.source === "alternate") {
      console.log(
        `Way fallback location ${locationAttempt.fallback_rank}/${fallbackLocations.length} -> ${locationAttempt.candidate.parking_location}`,
      );
    }

    const checkoutResult = await executeWayCheckout({
      candidate: locationAttempt.candidate,
      resolvedEventTime,
      resolvedEventStatus,
      checkoutStrategies,
      dryRun,
      keepBrowserOpen,
      updateSmartsuite,
      excludeReservationIds,
    });

    attemptedLocations.push({
      source: locationAttempt.source,
      fallback_rank: locationAttempt.fallback_rank || null,
      parking_location: locationAttempt.candidate.parking_location,
      parking_location_id: locationAttempt.candidate.parking_location_id || "",
      parking_location_record_id: locationAttempt.candidate.parking_location_record_id || "",
      status: checkoutResult?.status || "unknown",
      error_message: checkoutResult?.error_message || null,
      distance_miles:
        locationAttempt.fallbackLocation?.distance_miles ??
        locationAttempt.candidate?.fallback_distance_miles ??
        null,
    });

    lastResult = {
      ...checkoutResult,
      attempted_locations: attemptedLocations,
      selected_parking_location: locationAttempt.candidate.parking_location,
      selected_parking_location_id: locationAttempt.candidate.parking_location_id || "",
      selected_parking_location_record_id: locationAttempt.candidate.parking_location_record_id || "",
      used_alternate_location: locationAttempt.source === "alternate",
      alternate_location_rank: locationAttempt.fallback_rank || null,
    };

    const hasRemainingAlternates = index < locationCandidates.length - 1;
    if (!hasRemainingAlternates || !shouldTryAlternateLocationFallback(checkoutResult)) {
      if (
        !hasRemainingAlternates &&
        shouldTryAlternateLocationFallback(checkoutResult) &&
        locationCandidates.length > 1
      ) {
        lastResult.error_message = [
          checkoutResult?.error_message || null,
          "No valid alternate lots remained after fallback attempts.",
        ]
          .filter(Boolean)
          .join(" ");
      }

      if (
        !hasRemainingAlternates &&
        shouldTryAlternateLocationFallback(checkoutResult) &&
        locationCandidates.length === 1
      ) {
        lastResult.error_message = [
          checkoutResult?.error_message || null,
          "No valid alternate lots were available for this venue/provider.",
        ]
          .filter(Boolean)
          .join(" ");
      }

      return lastResult;
    }
  }

  return lastResult;
}

function formatSummaryRecordLine(item) {
  return [
    item.event || "Unknown event",
    item.venue || "Unknown venue",
    item.event_date || "unknown-date",
    item.event_time || "unverified",
    item.parking_location || "unknown-location",
  ].join(" | ");
}

function hasAirportPassMarker(item) {
  return Boolean(item?.result?.airport_fallback_used);
}

function getEffectiveSummaryStatus(item) {
  const status = formatUserFacingStatus(item?.result?.status || item?.final_status || "");
  const errorMessage = String(item?.result?.error_message || item?.error_message || "");

  if (status === "equivalent_group_failure_skipped") {
    if (/Parking lot not found/i.test(errorMessage)) {
      return "parking_lot_not_found";
    }
    if (/Parking lot overpriced/i.test(errorMessage)) {
      return "parking_lot_overpriced";
    }
    if (/License plate/i.test(errorMessage)) {
      return "license_plate_required";
    }
    if (/sold out/i.test(errorMessage)) {
      return "sold_out";
    }
    return "other";
  }

  return status;
}

function mapSummaryBucket(status) {
  switch (String(status || "")) {
    case "purchase_completed":
      return "completed";
    case "target_lot_sold_out":
    case "sold_out_group_skipped":
    case "sold_out":
      return "sold_out";
    case "parking_lot_not_found":
      return "parking_lot_not_found";
    case "parking_lot_overpriced":
      return "parking_lot_overpriced";
    case "checkout_price_unavailable":
      return "other";
    case "license_plate_required":
      return "license_plate_required";
    case "unexpected_reservation_detected":
      return "other";
    default:
      return "other";
  }
}

function formatSummaryBucketLabel(bucket) {
  return String(bucket || "").toUpperCase();
}

function shouldPrintWayLog(message) {
  const text = String(message || "");
  const allowedPatterns = [
    /^Way checkout strategy:/,
    /^Way checkout price check:/,
    /^Way search: cleared stale cart state ->/,
    /^Way checkout: pressing final Checkout/,
    /^Way checkout: final click result ->/,
    /^Way checkout: post-submit URL ->/,
    /^Way checkout retry:/,
    /^Way checkout: license plate requirement detected ->/,
    /^Way checkout review: landed on home/,
    /^Way checkout review: recovery result ->/,
    /^Way checkout review: login form detected/,
    /^Way search: search outcome ->/,
    /^Way results: clicking best-match Reserve Now/,
    /^Way results: clicking fallback Reserve Now/,
  ];

  return allowedPatterns.some((pattern) => pattern.test(text));
}

async function withFilteredWayLogs(fn) {
  if (isWayDebugEnabled()) {
    return fn();
  }

  const originalLog = console.log;
  console.log = (...args) => {
    const message = args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" ");
    if (!message.startsWith("Way ")) {
      originalLog(...args);
      return;
    }

    if (shouldPrintWayLog(message)) {
      originalLog(...args);
    }
  };

  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

function formatBlockedSummary(blockedWayRecords) {
  const grouped = new Map();

  for (const item of blockedWayRecords) {
    const resolutionStatus = String(item.resolution?.status || "missing_resolution");
    const eventStatus = String(item.validation.event_status || item.resolution?.event_status || "unverified");
    let label = resolutionStatus;

    if (eventStatus === "missing_on_stubhub") {
      label = "missing_on_stubhub";
    } else if (eventStatus === "tbd" || eventStatus === "tbh") {
      label = "event_time_tbd";
    } else if (item.validation.reason === "missing_resolved_event_time") {
      label = "missing_resolved_event_time";
    }

    grouped.set(label, (grouped.get(label) || 0) + 1);
  }

  return Array.from(grouped.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count);
}

function buildBlockedDetails(blockedWayRecords) {
  const grouped = new Map();

  for (const item of blockedWayRecords) {
    const resolutionStatus = String(item.resolution?.status || "missing_resolution");
    const eventStatus = String(item.validation.event_status || item.resolution?.event_status || "unverified");
    let label = resolutionStatus;

    if (eventStatus === "missing_on_stubhub") {
      label = "missing_on_stubhub";
    } else if (eventStatus === "tbd" || eventStatus === "tbh") {
      label = "event_time_tbd";
    } else if (item.validation.reason === "missing_resolved_event_time") {
      label = "missing_resolved_event_time";
    }

    if (!grouped.has(label)) {
      grouped.set(label, []);
    }

    grouped.get(label).push({
      event: item.candidate?.event || "Unknown event",
      venue: item.candidate?.venue || "Unknown venue",
      event_date: item.candidate?.event_date || "unknown-date",
      event_time:
        item.resolution?.resolved_event_time ||
        item.candidate?.event_time ||
        item.validation?.event_status ||
        "unverified",
      parking_location: item.candidate?.parking_location || "unknown-location",
      validation_reason: item.validation?.reason || null,
      resolution_status: item.resolution?.status || "missing_resolution",
    });
  }

  return grouped;
}

function collapseBlockedItems(items) {
  const collapsed = new Map();

  for (const item of items || []) {
    const line = formatSummaryRecordLine(item);
    const key = `${item.resolution_status || "unknown"}|${item.validation_reason || "unknown"}|${line}`;

    if (!collapsed.has(key)) {
      collapsed.set(key, {
        qty: 0,
        line,
        resolution_status: item.resolution_status || "missing_resolution",
        validation_reason: item.validation_reason || null,
      });
    }

    collapsed.get(key).qty += 1;
  }

  return Array.from(collapsed.values());
}

function arraysEqualAsSets(left, right) {
  const leftSet = new Set((left || []).filter(Boolean));
  const rightSet = new Set((right || []).filter(Boolean));
  if (leftSet.size !== rightSet.size) {
    return false;
  }

  for (const value of leftSet) {
    if (!rightSet.has(value)) {
      return false;
    }
  }

  return true;
}

function hasNewReservationIds(beforeIds, afterIds) {
  const beforeSet = new Set((beforeIds || []).filter(Boolean));
  return (afterIds || []).filter(Boolean).some((reservationId) => !beforeSet.has(reservationId));
}

async function askDateRange() {
  const rl = readline.createInterface({ input, output });

  try {
    const startDate = (await rl.question("Enter start_date (YYYY-MM-DD): ")).trim();
    const endDate = (await rl.question("Enter end_date (YYYY-MM-DD): ")).trim();

    return { startDate, endDate };
  } finally {
    rl.close();
  }
}

function buildResolutionMap(result) {
  const resolutions =
    result.shared_execution_stages?.find((stage) => stage.stage === "event_time_resolution")
      ?.event_time_resolutions || [];
  return new Map(resolutions.map((item) => [item.record_id, item]));
}

function getWayRecords(result) {
  return (
    result.provider_execution_plans?.find((plan) => plan.provider_key === "way")?.records || []
  );
}

async function buildFreshBuyingResult(startDate, endDate, { activeProviderKeys = [] } = {}) {
  const dataPath = getBuyingBotOperativePaths().data.sampleBuyingJson;
  const outputPath = getBuyingBotOperativePaths().resultJson;

  const { records: rawRecords, source } = await fetchBuying(dataPath, { startDate, endDate });
  const normalizedRecords = normalizeBuyingRecords(rawRecords);
  const recordsToBuy = filterBuying(normalizedRecords, startDate, endDate, { activeProviderKeys });
  const sharedExecutionStages = await buildSharedExecutionStages(recordsToBuy);
  const providerExecutionPlans = buildProviderExecutionPlans(recordsToBuy);
  const result = buildOutput(
    startDate,
    endDate,
    recordsToBuy,
    source,
    sharedExecutionStages,
    providerExecutionPlans,
  );

  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  return {
    result,
    normalizedRecords,
    source,
    activeProviderKeys,
  };
}

async function runBuyingBotLive() {
  const { startDate, endDate } = await askDateRange();
  const activeProviderKeys = getActiveBuyingProviderKeys();
  const fallbackMaxDistanceMiles = getFallbackMaxDistanceMiles();
  const fallbackMaxBuyCostDelta = getFallbackMaxBuyCostDelta();
  const rawMaxPurchases = String(process.env.BUYING_BOT_MAX_PURCHASES || "").trim();
  const maxPurchases = rawMaxPurchases ? Number(rawMaxPurchases) : Number.POSITIVE_INFINITY;
  const keepBrowserOpen = parseBoolean(process.env.WAY_KEEP_BROWSER_OPEN, false);
  const maintenanceResult = await runRoutineMaintenance().catch(() => null);

  if (maintenanceResult && !maintenanceResult.skipped) {
    const maintenanceParts = [];
    if ((maintenanceResult.cleared_caches || []).length > 0) {
      maintenanceParts.push(`cleared Way cache: ${maintenanceResult.cleared_caches.length}`);
    }
    if ((maintenanceResult.removed_screenshots || []).length > 0) {
      maintenanceParts.push(`removed screenshots: ${maintenanceResult.removed_screenshots.length}`);
    }
    if ((maintenanceResult.removed_outputs || []).length > 0) {
      maintenanceParts.push(`removed old outputs: ${maintenanceResult.removed_outputs.length}`);
    }
    if (maintenanceParts.length > 0) {
      console.log(`Maintenance -> ${maintenanceParts.join(" | ")}`);
    }
  }

  const { result, source } = await buildFreshBuyingResult(startDate, endDate, { activeProviderKeys });
  const resolutionMap = buildResolutionMap(result);
  const wayRecords = getWayRecords(result);
  const fallbackLocationIndex = buildFallbackLocationIndex(await fetchFallbackLocations());
  const knownReservationIds = new Set();

  console.log(`Buying source: ${source}`);
  console.log(`Active buying providers: ${activeProviderKeys.join(", ") || "none"}`);

  const eligibleWayRecords = wayRecords
    .map((record) => ({
      candidate: record,
      resolution: resolutionMap.get(record.record_id) || null,
      validation: getEventValidationState(resolutionMap.get(record.record_id) || null),
    }))
    .filter(({ validation }) => validation.eligible);

  const blockedWayRecords = wayRecords
    .map((record) => ({
      candidate: record,
      resolution: resolutionMap.get(record.record_id) || null,
      validation: getEventValidationState(resolutionMap.get(record.record_id) || null),
    }))
    .filter(({ validation }) => !validation.eligible);

  console.log(`Way candidates found: ${wayRecords.length}`);
  console.log(`Way candidates eligible for live execution: ${eligibleWayRecords.length}`);
  if (blockedWayRecords.length > 0) {
    console.log(`Way candidates blocked by event validation: ${blockedWayRecords.length}`);
    console.log(`Blocked breakdown: ${JSON.stringify(formatBlockedSummary(blockedWayRecords))}`);
  }
  console.log(`Way targets selected for this batch: ${Math.min(eligibleWayRecords.length, maxPurchases)}`);

  const purchaseResults = [];
  const soldOutGroupKeys = new Set();
  const failedEquivalentGroupKeys = new Map();
  const successfulStrategyByEquivalentGroup = new Map();
  const equivalentFailureConfirmationThreshold = Math.max(
    1,
    Number(process.env.BUYING_BOT_EQUIVALENT_FAILURE_THRESHOLD || 1),
  );
  const skippedStatuses = new Set([
    "best_match_unavailable",
    "target_lot_sold_out",
    "parking_lot_not_found",
    "parking_lot_overpriced",
    "checkout_not_found",
    "candidate_not_found",
    "reservation_match_not_found",
    "checkout_completed_but_reservation_not_captured",
    "license_plate_required",
  ]);
  const retriableStatuses = new Set([
    "execution_error",
    "checkout_completed_but_reservation_not_captured",
    "reservation_match_not_found",
    "license_plate_required",
    "checkout_target_mismatch",
  ]);
  const maxAttemptsPerRecord = Math.max(1, Number(process.env.BUYING_BOT_MAX_ATTEMPTS_PER_RECORD || 2));

  for (const item of eligibleWayRecords.slice(0, maxPurchases)) {
    const equivalentLotGroupKey = buildEquivalentLotGroupKey(
      item.candidate,
      item.resolution?.resolved_event_time || item.validation?.event_status || "",
    );
    if (soldOutGroupKeys.has(equivalentLotGroupKey)) {
      purchaseResults.push({
        record_id: item.candidate.record_id,
        event: item.candidate.event,
        venue: item.candidate.venue || "",
        event_date: item.candidate.event_date || "",
        event_time: item.resolution?.resolved_event_time || item.candidate.event_time || item.validation?.event_status || "",
        parking_location: item.candidate.parking_location || "",
        attempt_count: 0,
        attempts: [],
        result: {
          status: "sold_out_group_skipped",
          error_message: "Equivalent event parking target was already confirmed sold out earlier in this batch.",
        },
      });
      console.log(
        `Completed ${item.candidate.record_id} -> sold_out_group_skipped -> no reservation`,
      );
      console.log(`Skipping ${item.candidate.record_id} because the same event parking target was already sold out in this batch.`);
      continue;
    }

    if (failedEquivalentGroupKeys.has(equivalentLotGroupKey)) {
      const priorFailure = failedEquivalentGroupKeys.get(equivalentLotGroupKey);
      if ((priorFailure?.count || 0) < equivalentFailureConfirmationThreshold) {
        // Allow one more live validation for the same group before we skip the rest.
      } else {
      purchaseResults.push({
        record_id: item.candidate.record_id,
        event: item.candidate.event,
        venue: item.candidate.venue || "",
        event_date: item.candidate.event_date || "",
        event_time: item.resolution?.resolved_event_time || item.candidate.event_time || item.validation?.event_status || "",
        parking_location: item.candidate.parking_location || "",
        attempt_count: 0,
        attempts: [],
        result: {
          status: "equivalent_group_failure_skipped",
          error_message: `Equivalent event parking target already failed earlier in this batch: ${priorFailure.message}`,
        },
      });
      console.log(
        `Completed ${item.candidate.record_id} -> equivalent_group_failure_skipped -> no reservation`,
      );
      console.log(`Skipping ${item.candidate.record_id} because the same event parking target already failed earlier in this batch.`);
      continue;
      }
    }

    console.log(`Starting ${item.candidate.record_id} | ${formatRecordContext(item.candidate, item.resolution, item.validation)}`);
    let purchaseResult = null;
    const attemptResults = [];
    let baselineReservationIds = null;
    const fallbackLocations = getFallbackLocationsForCandidate(item.candidate, fallbackLocationIndex, {
      activeProviderKeys,
      maxDistanceMiles: fallbackMaxDistanceMiles,
      maxBuyCostDelta: fallbackMaxBuyCostDelta,
    });

    for (let attempt = 1; attempt <= maxAttemptsPerRecord; attempt += 1) {
      try {
        const checkoutStrategies = prioritizeCheckoutStrategies(
          item.resolution?.checkout_strategies || [],
          successfulStrategyByEquivalentGroup.get(equivalentLotGroupKey) || null,
        );
        purchaseResult = await withFilteredWayLogs(() =>
          executeWayCheckoutWithLocationFallback({
            candidate: item.candidate,
            resolvedEventTime: item.resolution.resolved_event_time,
            resolvedEventStatus: item.validation.event_status,
            checkoutStrategies,
            dryRun: false,
            keepBrowserOpen,
            updateSmartsuite: true,
            excludeReservationIds: Array.from(knownReservationIds),
            fallbackLocations,
          }),
        );
      } catch (error) {
        purchaseResult = {
          status: "execution_error",
          error_message: error.message,
        };
      }

      if (!purchaseResult || typeof purchaseResult !== "object") {
        purchaseResult = {
          status: "execution_error",
          error_message: "Way execution returned no structured result.",
        };
      }

      if (!baselineReservationIds && Array.isArray(purchaseResult.pre_checkout_reservation_ids)) {
        baselineReservationIds = purchaseResult.pre_checkout_reservation_ids;
      }

      const postAttemptReservationIds = Array.isArray(purchaseResult.post_attempt_reservation_ids)
        ? purchaseResult.post_attempt_reservation_ids
        : baselineReservationIds || [];
      const effectiveBaselineReservationIds = baselineReservationIds || purchaseResult.pre_checkout_reservation_ids || [];
      const reservationStateChanged = !arraysEqualAsSets(
        effectiveBaselineReservationIds,
        postAttemptReservationIds,
      );
      const newReservationDetected = hasNewReservationIds(
        effectiveBaselineReservationIds,
        postAttemptReservationIds,
      );

      attemptResults.push({
        attempt,
        status: purchaseResult.status,
        error_message: purchaseResult.error_message || null,
        pre_checkout_reservation_ids: purchaseResult.pre_checkout_reservation_ids || effectiveBaselineReservationIds,
        post_attempt_reservation_ids: postAttemptReservationIds,
        reservation_state_changed: reservationStateChanged,
        new_reservation_detected: newReservationDetected,
      });

      if (purchaseResult.status === "purchase_completed") {
        if (purchaseResult.selected_checkout_strategy) {
          successfulStrategyByEquivalentGroup.set(
            equivalentLotGroupKey,
            cloneCheckoutStrategy(purchaseResult.selected_checkout_strategy),
          );
        }
        break;
      }

      if (purchaseResult.status === "target_lot_sold_out") {
        soldOutGroupKeys.add(equivalentLotGroupKey);
      }

      const canRetry =
        attempt < maxAttemptsPerRecord &&
        retriableStatuses.has(purchaseResult.status) &&
        !isClearlyUnrecoverableExecutionError(purchaseResult) &&
        !newReservationDetected &&
        !reservationStateChanged;

      if (!canRetry) {
        break;
      }

      // Only restart a full record when Orders still looks unchanged; this protects
      // us from turning a capture failure into a double purchase.
      console.log(
        `Way batch retry: restarting ${item.candidate.record_id} after ${purchaseResult.status} (attempt ${attempt + 1}/${maxAttemptsPerRecord}) because no new reservation appeared in orders.`,
      );
    }

    purchaseResults.push({
      record_id: item.candidate.record_id,
      event: item.candidate.event,
      venue: item.candidate.venue || "",
      event_date: item.candidate.event_date || "",
      event_time: item.resolution?.resolved_event_time || item.candidate.event_time || item.validation?.event_status || "",
      parking_location: purchaseResult?.selected_parking_location || item.candidate.parking_location || "",
      primary_parking_location: item.candidate.parking_location || "",
      attempt_count: attemptResults.length,
      attempts: attemptResults,
      result: purchaseResult,
    });

    const displayStatus = formatUserFacingStatus(purchaseResult.status);
    console.log(
      `Completed ${item.candidate.record_id} -> ${displayStatus} -> ${purchaseResult.reservation?.reservation_id || "no reservation"}`,
    );
    if (purchaseResult.error_message) {
      console.log(`Error detail: ${purchaseResult.error_message}`);
    }

    if (purchaseResult.reservation?.reservation_id) {
      knownReservationIds.add(String(purchaseResult.reservation.reservation_id).trim());
    }

    if (purchaseResult.status === "purchase_completed") {
      continue;
    }

    const equivalentFailureSignature = buildEquivalentFailureSignature(purchaseResult);
    if (equivalentFailureSignature) {
      const priorFailure = failedEquivalentGroupKeys.get(equivalentLotGroupKey);
      if (priorFailure?.signature === equivalentFailureSignature) {
        failedEquivalentGroupKeys.set(equivalentLotGroupKey, {
          signature: equivalentFailureSignature,
          message: purchaseResult.error_message || purchaseResult.status,
          count: priorFailure.count + 1,
        });
      } else {
        failedEquivalentGroupKeys.set(equivalentLotGroupKey, {
          signature: equivalentFailureSignature,
          message: purchaseResult.error_message || purchaseResult.status,
          count: 1,
        });
      }
    }

    if (skippedStatuses.has(purchaseResult.status) || purchaseResult.status === "execution_error") {
      console.log(`Skipping ${item.candidate.record_id} and continuing batch.`);
      continue;
    }
  }

  const summary = {
    total_eligible: eligibleWayRecords.length,
    attempted: purchaseResults.length,
    completed: purchaseResults.filter((item) => item.result.status === "purchase_completed").length,
    skipped: purchaseResults.filter((item) => item.result.status !== "purchase_completed").length,
    alternate_location_used: purchaseResults.filter((item) => item.result.used_alternate_location).length,
    sold_out_group_skipped: purchaseResults.filter((item) => item.result.status === "sold_out_group_skipped").length,
    equivalent_group_failure_skipped: purchaseResults.filter((item) => item.result.status === "equivalent_group_failure_skipped").length,
    target_lot_sold_out: purchaseResults.filter((item) => item.result.status === "target_lot_sold_out").length,
  };
  const blockedSummary = formatBlockedSummary(blockedWayRecords);
  const blockedDetails = buildBlockedDetails(blockedWayRecords);
  const tbdEligibleCount = eligibleWayRecords.filter(({ validation }) => {
    const status = String(validation.event_status || "").toLowerCase();
    return status === "tbd" || status === "tbh";
  }).length;
  const problematicPurchases = purchaseResults
    .filter((item) => !["purchase_completed", "sold_out_group_skipped", "equivalent_group_failure_skipped"].includes(item.result.status))
    .map((item) => {
      const lastAttempt = item.attempts[item.attempts.length - 1] || {};
      return {
        record_id: item.record_id,
        event: item.event,
        venue: item.venue || "",
        event_date: item.event_date || "",
        event_time: item.event_time || "",
        parking_location: item.parking_location || "",
        final_status: formatUserFacingStatus(item.result.status),
        attempt_count: item.attempt_count,
        error_message: item.result.error_message || null,
        reservation_state_changed: Boolean(lastAttempt.reservation_state_changed),
        new_reservation_detected: Boolean(lastAttempt.new_reservation_detected),
        manual_review_recommended: Boolean(lastAttempt.reservation_state_changed || lastAttempt.new_reservation_detected),
      };
    });
  const unassignedReservations = purchaseResults
    .flatMap((item) => {
      const result = item.result || {};
      const reservationIds = Array.isArray(result.unexpected_reservation_ids)
        ? result.unexpected_reservation_ids
        : [];
      if (reservationIds.length === 0) {
        return [];
      }

      const eventTime = item.event_time || result?.resolved_event_time || "unverified";
      return reservationIds.map((reservationId) => ({
        reservation_id: reservationId,
        event: item.event,
        venue: item.venue || "",
        event_date: item.event_date || "",
        event_time: eventTime,
        parking_location: item.parking_location || "",
        status: formatUserFacingStatus(result.status),
        error_message: result.error_message || "Unexpected reservation detected.",
      }));
    });

  const liveOutputPath = getBuyingBotOperativePaths().liveRunJson;

  await fs.writeFile(
    liveOutputPath,
    `${JSON.stringify(
      {
        run_type: "buying_bot_live",
        date_range: { start: startDate, end: endDate },
        max_purchases: maxPurchases,
        summary,
        blocked_summary: blockedSummary,
        eligible_tbd_events: tbdEligibleCount,
        problematic_purchases: problematicPurchases,
        eligible_way_records: eligibleWayRecords.map((item) => ({
          record_id: item.candidate.record_id,
          event: item.candidate.event,
          event_date: item.candidate.event_date,
          parking_location: item.candidate.parking_location,
          resolved_event_time: item.resolution.resolved_event_time,
          event_status: item.validation.event_status || "scheduled",
          window_policy: item.resolution.window_policy || null,
        })),
        blocked_way_records: blockedWayRecords.map((item) => ({
          record_id: item.candidate.record_id,
          event: item.candidate.event,
          event_date: item.candidate.event_date,
          parking_location: item.candidate.parking_location,
          resolved_event_time: item.resolution?.resolved_event_time || null,
          event_status: item.validation.event_status || "unverified",
          window_policy: item.resolution?.window_policy || null,
          resolution_status: item.resolution?.status || "missing_resolution",
          validation_reason: item.validation.reason,
        })),
        unassigned_reservations: unassignedReservations,
        purchase_results: purchaseResults,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Summary -> attempted: ${summary.attempted}, completed: ${summary.completed}, skipped: ${summary.skipped}`);
  if (summary.alternate_location_used > 0) {
    console.log(`Alternate location fallback used -> ${summary.alternate_location_used}`);
  }

  if (summary.target_lot_sold_out > 0 || summary.sold_out_group_skipped > 0) {
    console.log("");
    console.log(
      `Sold out handling -> target_lot_sold_out: ${summary.target_lot_sold_out}, sold_out_group_skipped: ${summary.sold_out_group_skipped}`,
    );
  }

  if (blockedSummary.length > 0) {
    console.log("");
    console.log(`Blocked events -> ${blockedSummary.map((item) => `${item.status}: ${item.count}`).join(", ")}`);

    const manualEventIdReviewItems = [
      ...(blockedDetails.get("missing_on_stubhub") || []),
      ...(blockedDetails.get("stubhub_live_web_requires_review") || []),
    ];
    if (manualEventIdReviewItems.length > 0) {
      console.log(
        "NO EVENT TIME VALIDATED. PLEASE PROVIDE EVENT ID MANUALLY AND RUN AGAIN USING THE EVENT ID OVERRIDE COMMAND. ->",
      );
      for (const item of collapseBlockedItems(manualEventIdReviewItems)) {
        console.log(`- qty ${item.qty} | ${item.line}`);
      }
    }
  }

  if (tbdEligibleCount > 0) {
    console.log("");
    console.log(`Eligible TBD/TBH events -> ${tbdEligibleCount}`);
  }

  if (purchaseResults.length > 0) {
    const grouped = new Map();
    for (const item of purchaseResults) {
      const bucket = mapSummaryBucket(getEffectiveSummaryStatus(item));
      if (!grouped.has(bucket)) {
        grouped.set(bucket, []);
      }
      grouped.get(bucket).push(item);
    }

    const orderedBuckets = [
      "completed",
      "sold_out",
      "parking_lot_not_found",
      "parking_lot_overpriced",
      "license_plate_required",
      "other",
    ];

    console.log("");
    console.log("OUTCOME GROUPS ->");
    for (const bucket of orderedBuckets) {
      const items = grouped.get(bucket) || [];
      if (items.length === 0) {
        continue;
      }

      console.log("");
      console.log(`${formatSummaryBucketLabel(bucket)}: ${items.length}`);
      const collapsed = new Map();
      for (const item of items) {
        const eventTime = item.event_time || item.result?.resolved_event_time || "unverified";
        const line = formatSummaryRecordLine({
          event: item.event,
          venue: item.venue,
          event_date: item.event_date,
          event_time: eventTime,
          parking_location: item.parking_location,
        });
        const key = `${bucket}|${line}`;
        const displayStatus = getEffectiveSummaryStatus(item);
        if (!collapsed.has(key)) {
          collapsed.set(key, {
            line,
            qty: 0,
            displayStatus,
            errorMessage: item.result?.error_message || null,
            reservationIds: [],
            priceAmount: item.result?.price_evaluation?.priceAmount ?? null,
            maxAllowed: item.result?.price_evaluation?.maxAllowed ?? null,
            airportPass: false,
          });
        }
        const entry = collapsed.get(key);
        entry.qty += 1;
        entry.airportPass = entry.airportPass || hasAirportPassMarker(item);
        const reservationId = item.result?.reservation?.reservation_id || null;
        if (reservationId && !entry.reservationIds.includes(reservationId)) {
          entry.reservationIds.push(reservationId);
        }
      }

      for (const entry of collapsed.values()) {
        const reservationIds = entry.reservationIds.length > 0
          ? ` -> ${entry.reservationIds.join(", ")}`
          : "";
        const airportSuffix = entry.airportPass ? " | AIRPORT PASS" : "";
        console.log(`- qty ${entry.qty} | ${entry.line}${airportSuffix}${reservationIds}`);
        if ((bucket === "other" || bucket === "parking_lot_not_found" || bucket === "license_plate_required") && entry.errorMessage) {
          console.log(`  ${String(entry.displayStatus || "").toUpperCase()}: ${entry.errorMessage}`);
        }
        if (bucket === "parking_lot_overpriced" && entry.priceAmount != null) {
          console.log(`  PRICE: ${entry.priceAmount} | MAX: ${entry.maxAllowed}`);
        }
      }
    }
  }

  if (unassignedReservations.length > 0) {
    console.log("");
    console.log("RESERVATION ID NO ASIGNADO ->");
    for (const item of unassignedReservations) {
      console.log(
        `- ${item.reservation_id} | ${formatSummaryRecordLine(item)}`,
      );
      if (item.error_message) {
        console.log(`  ${String(item.status || "").toUpperCase()}: ${item.error_message}`);
      }
    }
  }

  console.log("");
  console.log(`Wrote ${liveOutputPath}`);
}

module.exports = { runBuyingBotLive };

if (require.main === module) {
  runBuyingBotLive().catch((error) => {
    console.error("Bot - Buying live run failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
}
