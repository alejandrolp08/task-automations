const { getStubhubConfig } = require("../../../../../Shared/src/shared/stubhub/config");
const { resolveEventTimes } = require("../../../../../Shared/src/shared/stubhub/resolveEventTimes");

async function buildEventTimeResolutionStage(records) {
  const resolutions = await resolveEventTimes(records, {
    allowGeneralEventTimeFallback: true,
  });
  const { lookupMode } = getStubhubConfig();
  const status = lookupMode === "live_web" ? "ready_for_live_web_lookup" : "unsupported_lookup_mode";

  return {
    stage: "event_time_resolution",
    status,
    record_count: records.length,
    records,
    event_time_resolutions: resolutions,
    source_priority: [
      "Event ID / event info",
      "Performer Name + Venue Name + Event Date",
      "City & State for disambiguation",
    ],
    next_steps: [
      "Try Event ID / event info first when available",
      "If Event ID exists, open the direct StubHub event URL first",
      "Validate event date and confirm performer/venue with flexible matching",
      "Search StubHub using performer, venue, and date",
      "Use City & State to disambiguate duplicate venue names when needed",
      "Extract exact event time before provider-specific checkout",
    ],
    notes: [
      "This stage applies to all providers, not just Way.",
      "Event time resolution is a shared prerequisite before provider-specific checkout automation.",
      "StubHub is the primary operational source for event-time verification.",
      lookupMode === "live_web"
        ? "The current implementation is operating in live StubHub web lookup mode."
        : `Unsupported StubHub lookup mode detected: ${lookupMode}.`,
    ],
  };
}

module.exports = { buildEventTimeResolutionStage };
