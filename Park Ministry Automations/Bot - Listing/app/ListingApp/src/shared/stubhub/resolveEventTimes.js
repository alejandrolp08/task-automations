const { getStubhubConfig } = require("./config");
const { buildCheckoutWindowPlan } = require("./windowPlan");
const { resolveEventTimesViaStubhubWeb } = require("./webLookup");

function buildStubhubEventUrl(eventId) {
  if (!eventId) {
    return "";
  }

  return `https://www.stubhub.com/event/${eventId}`;
}

function buildSearchInputs(record) {
  return {
    event_id_hint: record.event_id,
    stubhub_event_url: buildStubhubEventUrl(record.event_id),
    performer_name: record.event,
    venue_name: record.venue,
    event_date: record.event_date,
    city_state: record.city_state,
  };
}

function getForcedEventIdAllowlist() {
  return new Set(
    String(process.env.LISTING_FORCE_EVENT_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function canUseSmartsuiteEventIdOnlyFallback(record) {
  const allowFallback = ["1", "true", "yes"].includes(
    String(process.env.LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK || "").trim().toLowerCase(),
  );
  if (!allowFallback) {
    return false;
  }

  const eventId = String(record?.event_id || "").trim();
  if (!eventId) {
    return false;
  }

  const allowlist = getForcedEventIdAllowlist();
  if (allowlist.size === 0) {
    return true;
  }

  return allowlist.has(eventId);
}

function buildBaseResolution(record) {
  const hasEventId = Boolean(record.event_id);

  return {
    record_id: record.record_id,
    provider: record.provider,
    event: record.event,
    venue: record.venue,
    event_date: record.event_date,
    city_state: record.city_state,
    event_id_hint: record.event_id,
    stubhub_event_url: buildStubhubEventUrl(record.event_id),
    match_method: hasEventId ? "event_id_then_validate" : "search_then_disambiguate",
    confidence: "pending_review",
    source_used: "stubhub_live_web",
    smartsuite_event_time_hint: record.event_time || null,
    resolved_event_time: null,
    event_status: "unverified",
    resolved_stubhub_event_id: record.event_id || null,
    manual_review_required: true,
    purchase_blocked: true,
    validation_checks: [
      "Validate event date",
      "Validate performer name with flexible match, not exact string match",
      "Validate venue name with flexible match, not exact string match",
      "Use City & State when event matching is ambiguous",
    ],
    search_inputs: buildSearchInputs(record),
  };
}

function buildResolvedFromLiveWeb(record, liveResolution) {
  const eventStatus =
    typeof liveResolution.event_status === "string" && liveResolution.event_status.trim()
      ? liveResolution.event_status.trim().toLowerCase()
      : "unverified";

  const baseResolution = {
    ...buildBaseResolution(record),
    status:
      liveResolution.status === "validated"
        ? "resolved_from_stubhub_live_web"
        : "stubhub_live_web_requires_review",
    confidence: liveResolution.status === "validated" ? "high" : "pending_review",
    resolved_event_time: liveResolution.resolved_event_time || null,
    event_status: eventStatus,
    resolved_stubhub_event_id: String(
      liveResolution.resolved_stubhub_event_id || record.event_id || "",
    ).trim() || null,
    manual_review_required: liveResolution.status !== "validated",
    purchase_blocked: !["scheduled", "tbd", "tbh"].includes(eventStatus) || liveResolution.status !== "validated",
    resolution_notes: liveResolution.resolution_notes || ["StubHub live web lookup completed."],
    status_source_url: liveResolution.source_url || buildStubhubEventUrl(record.event_id),
  };

  return {
    ...baseResolution,
    ...buildCheckoutWindowPlan(record, baseResolution),
  };
}

function buildLookupFailureResolution(record, reason, notes = []) {
  const baseResolution = {
    ...buildBaseResolution(record),
    status: reason,
    event_status: reason === "missing_on_stubhub" ? "missing_on_stubhub" : "unverified",
    resolution_notes: notes.length > 0 ? notes : ["StubHub live web lookup could not validate this event."],
  };

  return {
    ...baseResolution,
    ...buildCheckoutWindowPlan(record, baseResolution),
  };
}

function buildForcedSmartsuiteEventIdFallbackResolution(record, reason, notes = []) {
  const eventStatus = String(record.event_time || "").trim() ? "scheduled" : "tbd";
  const baseResolution = {
    ...buildBaseResolution(record),
    status: "accepted_smartsuite_event_id_only_fallback",
    match_method: "smartsuite_event_id_only_fallback",
    confidence: "manual_override",
    resolved_event_time: String(record.event_time || "").trim() || null,
    event_status: eventStatus,
    resolved_stubhub_event_id: String(record.event_id || "").trim() || null,
    manual_review_required: true,
    purchase_blocked: false,
    resolution_notes: [
      `Accepted SmartSuite Event ID fallback after StubHub live validation returned ${reason || "lookup_error"}.`,
      ...notes,
      getForcedEventIdAllowlist().size > 0
        ? "This row was allowed because LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK=1 and the Event ID was explicitly allowlisted."
        : "This row was allowed because LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK=1 and a SmartSuite Event ID was already present.",
    ],
    status_source_url: buildStubhubEventUrl(record.event_id),
  };

  return {
    ...baseResolution,
    ...buildCheckoutWindowPlan(record, baseResolution),
  };
}

function buildUnsupportedLookupModeResolution(record, lookupMode) {
  return buildLookupFailureResolution(record, "unsupported_stubhub_lookup_mode", [
    `Unsupported StubHub lookup mode: ${lookupMode || "unknown"}.`,
    "This project currently expects live StubHub public web validation.",
  ]);
}

async function resolveEventTimes(records) {
  const { lookupMode } = getStubhubConfig();

  if (lookupMode !== "live_web") {
    return records.map((record) => buildUnsupportedLookupModeResolution(record, lookupMode));
  }

  const liveResults = await resolveEventTimesViaStubhubWeb(records).catch((error) => {
    return records.map(() => ({
      status: "lookup_error",
      source_url: "",
      event_status: "unverified",
      resolved_event_time: null,
      resolution_notes: [`StubHub live web lookup failed: ${error.message}`],
    }));
  });

  return records.map((record, index) => {
    const liveResolution = liveResults[index];

    if (!liveResolution) {
      return buildLookupFailureResolution(record, "lookup_error");
    }

    if (["validated", "scheduled_time_not_found"].includes(liveResolution.status)) {
      return buildResolvedFromLiveWeb(record, liveResolution);
    }

    if (canUseSmartsuiteEventIdOnlyFallback(record)) {
      return buildForcedSmartsuiteEventIdFallbackResolution(
        record,
        liveResolution.status || "lookup_error",
        liveResolution.resolution_notes || [],
      );
    }

    return buildLookupFailureResolution(
      record,
      liveResolution.status || "lookup_error",
      liveResolution.resolution_notes || [],
    );
  });
}

module.exports = { resolveEventTimes, buildStubhubEventUrl };
