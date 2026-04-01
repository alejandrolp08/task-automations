const STUBHUB_BASE_URL = "https://www.stubhub.com";
const STUBHUB_FETCH_TIMEOUT_MS = Number(process.env.STUBHUB_FETCH_TIMEOUT_MS || 15000);
const STUBHUB_LOOKUP_RETRIES = Math.max(1, Number(process.env.STUBHUB_LOOKUP_RETRIES || 3));
const STUBHUB_AI_FALLBACK_ENABLED = ["1", "true", "yes"].includes(
  String(process.env.STUBHUB_AI_FALLBACK_ENABLED || "").trim().toLowerCase(),
);
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(process.env.STUBHUB_AI_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini").trim();
const STUBHUB_AI_MIN_CONFIDENCE = Number(process.env.STUBHUB_AI_MIN_CONFIDENCE || 0.68);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bampitheater\b/g, "amphitheater")
    .replace(/\bampitheatre\b/g, "amphitheatre")
    .replace(/\bcoca cola\b/g, "cocacola")
    .replace(/\bcredit union amphitheater\b/g, "amphitheater")
    .replace(/\bmidflorida credit union amphitheater\b/g, "midflorida amphitheater")
    .replace(/\bmma\b/g, "mixed martial arts")
    .replace(/\bronda rousey\b/g, "rousey")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STUBHUB_VENUE_ALIASES = [
  {
    match: (record) => normalizeText(record?.venue).includes("circuit gilles"),
    aliases: ["Gilles Villeneuve Circuit", "Circuit Gilles Villeneuve"],
  },
  {
    match: (record) => normalizeText(record?.venue).includes("fair grounds race course"),
    aliases: ["New Orleans Fairgrounds and Racetrack", "Fair Grounds Race Course"],
  },
  {
    match: (record) => normalizeText(record?.venue).includes("first horizon coliseum"),
    aliases: ["Greensboro Coliseum Complex", "Greensboro Coliseum"],
  },
  {
    match: (record) => normalizeText(record?.venue).includes("filene center"),
    aliases: ["Wolf Trap", "Wolf Trap Filene Center"],
  },
];

const STUBHUB_EVENT_ALIASES = [
  {
    match: (record) =>
      normalizeText(record?.event) === "formula 1" &&
      normalizeText(record?.venue).includes("circuit gilles"),
    aliases: ["Canadian Grand Prix", "Grand Prix du Canada", "Canada F1 GP"],
  },
  {
    match: (record) => normalizeText(record?.event).includes("new orleans jazz festival"),
    aliases: ["New Orleans Jazz & Heritage Festival", "Jazz Fest", "New Orleans Jazz and Heritage Festival"],
  },
];

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function isStubhubWafChallenge(html) {
  const text = String(html || "");
  if (text.trim().length < 500) {
    return true;
  }

  return /awsWafCookieDomainList|gokuProps|<title><\/title>/i.test(text);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAiFallbackExcerpt(label, html) {
  const text = stripHtml(html).slice(0, 12000);
  return text ? `Source: ${label}\n${text}` : "";
}

function buildAiSearchItemsExcerpt(label, candidates) {
  const lines = (candidates || [])
    .filter(Boolean)
    .map((candidate, index) => {
      const item = candidate.item || candidate;
      return [
        `${index + 1}. name: ${item?.name || ""}`,
        `venue: ${item?.venueName || ""}`,
        `city: ${item?.venueCity || ""}`,
        `date: ${item?.formattedDate || ""}`,
        `time: ${item?.formattedTime || item?.time || ""}`,
      ].join(" | ");
    })
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  return `Source: ${label}\n${lines.join("\n")}`;
}

function normalizeAiEventStatus(value) {
  const normalized = normalizeText(value);
  if (["scheduled", "tbd", "tbh", "canceled", "rescheduled", "missing"].includes(normalized)) {
    return normalized === "missing" ? "missing_on_stubhub" : normalized;
  }

  if (normalized.includes("cancel")) {
    return "canceled";
  }
  if (normalized.includes("resched") || normalized.includes("postpon")) {
    return "rescheduled";
  }
  if (normalized === "tbd" || normalized === "tbh" || normalized.includes("determined")) {
    return "tbd";
  }
  return "unverified";
}

async function resolveViaOpenAiFallback(record, contextExcerpts) {
  if (!STUBHUB_AI_FALLBACK_ENABLED || !OPENAI_API_KEY || contextExcerpts.length === 0) {
    const reasons = [];
    if (!STUBHUB_AI_FALLBACK_ENABLED) {
      reasons.push("disabled");
    }
    if (!OPENAI_API_KEY) {
      reasons.push("missing_key");
    }
    if (contextExcerpts.length === 0) {
      reasons.push("no_context");
    }
    console.log(
      `StubHub AI fallback skipped -> ${record.event} | ${record.venue} | ${record.event_date} | ${reasons.join(",") || "unknown"}`,
    );
    return null;
  }

  console.log(
    `StubHub AI fallback attempt -> ${record.event} | ${record.venue} | ${record.event_date} | excerpts ${contextExcerpts.length}`,
  );

  const prompt = [
    "You are validating whether StubHub web content matches a target live event.",
    "Return strict JSON only.",
    "",
    "Schema:",
    '{"matched":boolean,"event_status":"scheduled|tbd|tbh|canceled|rescheduled|missing","resolved_event_time":"HH:MM|null","matched_title":"string","confidence":0.0,"reasoning_summary":"string"}',
    "",
    `Target event: ${record.event}`,
    `Target venue: ${record.venue}`,
    `Target date: ${record.event_date}`,
    `Target city/state: ${record.city_state}`,
    "",
    "Rules:",
    "- matched=true only if the content strongly suggests the same event date and venue, with a reasonable performer/title overlap.",
    "- If the event is time-to-be-determined or time-not-confirmed, use tbd.",
    "- If no convincing match exists, set matched=false and event_status=missing.",
    "- resolved_event_time must be in 24-hour HH:MM format or null.",
    "",
    contextExcerpts.join("\n\n---\n\n"),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "stubhub_event_resolution",
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "matched",
              "event_status",
              "resolved_event_time",
              "matched_title",
              "confidence",
              "reasoning_summary",
            ],
            properties: {
              matched: { type: "boolean" },
              event_status: { type: "string" },
              resolved_event_time: {
                anyOf: [{ type: "string", pattern: "^\\d{2}:\\d{2}$" }, { type: "null" }],
              },
              matched_title: { type: "string" },
              confidence: { type: "number" },
              reasoning_summary: { type: "string" },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI fallback failed (${response.status})`);
  }

  const payload = await response.json();
  const outputText = payload.output_text || "";
  if (!outputText) {
    return null;
  }

  const parsed = JSON.parse(outputText);
  const eventStatus = normalizeAiEventStatus(parsed.event_status);
  if (!parsed.matched || eventStatus === "missing_on_stubhub") {
    console.log(
      `StubHub AI fallback result -> ${record.event} | ${record.venue} | ${record.event_date} | no_match`,
    );
    return null;
  }

  if (typeof parsed.confidence !== "number" || parsed.confidence < STUBHUB_AI_MIN_CONFIDENCE) {
    console.log(
      `StubHub AI fallback result -> ${record.event} | ${record.venue} | ${record.event_date} | low_confidence ${typeof parsed.confidence === "number" ? parsed.confidence.toFixed(2) : "n/a"}`,
    );
    return null;
  }

  console.log(
    `StubHub AI fallback result -> ${record.event} | ${record.venue} | ${record.event_date} | matched ${eventStatus}${parsed.resolved_event_time ? ` @ ${parsed.resolved_event_time}` : ""} | confidence ${parsed.confidence.toFixed(2)}`,
  );

  return {
    status: eventStatus === "scheduled" && !parsed.resolved_event_time ? "scheduled_time_not_found" : "validated",
    source_url: "",
    match_score: Math.round(parsed.confidence * 100),
    event_status: eventStatus,
    resolved_event_time: parsed.resolved_event_time || null,
    resolution_notes: [
      `OpenAI fallback matched ambiguous StubHub content with confidence ${parsed.confidence.toFixed(2)}.`,
      parsed.reasoning_summary || "OpenAI fallback resolved an ambiguous StubHub page.",
    ],
  };
}

function parseCity(value) {
  return String(value || "")
    .split(",")[0]
    .trim();
}

function parseState(value) {
  return String(value || "")
    .split(",")
    .slice(1)
    .join(",")
    .trim();
}

function getVenueAliases(record) {
  return STUBHUB_VENUE_ALIASES.filter((entry) => entry.match(record)).flatMap((entry) => entry.aliases || []);
}

function getEventAliases(record) {
  return STUBHUB_EVENT_ALIASES.filter((entry) => entry.match(record)).flatMap((entry) => entry.aliases || []);
}

function buildRecordValidationKey(record) {
  const normalizedEventId = String(record?.event_id || "").trim();
  if (normalizedEventId) {
    return `event_id:${normalizedEventId}`;
  }

  return [
    normalizeText(record?.event),
    normalizeText(record?.venue),
    String(record?.event_date || "").trim(),
    normalizeText(record?.city_state),
  ].join("|");
}

function buildStubhubEventUrl(eventId) {
  if (!eventId) {
    return "";
  }

  return `${STUBHUB_BASE_URL}/event/${encodeURIComponent(eventId)}`;
}

function slugifyStubhubSegment(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildStubhubSlugCandidateUrls(record) {
  const eventId = String(record?.event_id || "").trim();
  const city = parseCity(record?.city_state);
  const parts = getDateParts(record?.event_date);
  if (!eventId || !city || !parts) {
    return [];
  }

  const eventCandidates = [record?.event, ...getEventAliases(record)];
  const slugs = eventCandidates
    .map((eventName) => slugifyStubhubSegment(eventName))
    .filter(Boolean)
    .map((eventSlug) => `${STUBHUB_BASE_URL}/parking-passes-only-${eventSlug}-${slugifyStubhubSegment(city)}-tickets-${parts.month}-${parts.day}-${parts.year}/event/${encodeURIComponent(eventId)}/`);

  return Array.from(new Set(slugs));
}

function extractEventIdFromUrl(url) {
  const match = String(url || "").match(/\/event\/(\d+)/i);
  return match ? String(match[1]).trim() : "";
}

function extractResolvedStubhubEventId(item, sourceUrl) {
  const directId = String(item?.eventId || item?.id || "").trim();
  if (directId) {
    return directId;
  }

  return extractEventIdFromUrl(sourceUrl);
}

function buildSearchQueries(record) {
  const city = parseCity(record.city_state);
  const state = parseState(record.city_state);
  const normalizedVenue = normalizeText(record.venue);
  const normalizedEvent = normalizeText(record.event);
  const date = record.event_date;
  const monthDay = formatMonthDayFromEventDate(record.event_date);
  const weekday = formatWeekdayFromEventDate(record.event_date);
  const venueAliases = getVenueAliases(record);
  const eventAliases = getEventAliases(record);
  const usePassOnlySearch = shouldUsePassOnlySearch(record);

  const queries = [
    usePassOnlySearch && weekday ? `${record.event} ${weekday} Pass Only parking ${city} ${date}` : "",
    usePassOnlySearch && weekday ? `${record.event} ${weekday} Pass Only parking ${record.venue} ${city} ${date}` : "",
    weekday ? `${record.event} ${weekday} parking lots ${city} ${date}` : "",
    `${record.event} parking passes only ${record.venue} ${city} ${date}`,
    `${record.event} parking passes only ${city} ${date}`,
    `${record.event} parking ${record.venue} ${city} ${date}`,
    `${record.event} parking lots ${record.venue} ${city} ${date}`,
    `${record.event} parking lot ${record.venue} ${city} ${date}`,
    `${record.event} garage ${record.venue} ${city} ${date}`,
    `${record.event} lot ${record.venue} ${city} ${date}`,
    `${record.event} parking ${city} ${date}`,
    `${record.event} parking lots ${city} ${date}`,
    `${record.event} garage ${city} ${date}`,
    `${record.event} lot ${city} ${date}`,
    `${record.event} parking ${state} ${date}`,
    `${record.venue} parking ${city} ${date}`,
    `${record.venue} parking lots ${city} ${date}`,
    `${record.venue} garage ${city} ${date}`,
    `${record.venue} lot ${city} ${date}`,
    `${record.venue} parking ${state} ${date}`,
    `${record.event} ${record.venue} ${city} ${date}`,
    `${record.event} ${city} ${date}`,
    `${record.event} ${state} ${date}`,
    `${record.venue} ${city} ${date}`,
    `${record.venue} ${state} ${date}`,
    `${normalizedEvent} ${normalizedVenue} ${date}`,
    `${normalizedEvent} ${date}`,
    `${normalizedVenue} ${date}`,
    monthDay?.full ? `${record.event} ${record.venue} ${monthDay.full}` : "",
    monthDay?.full ? `${record.event} parking lots ${city} ${monthDay.full}` : "",
    monthDay?.full ? `${record.event} ${city} ${monthDay.full}` : "",
    monthDay?.short ? `${record.event} ${record.venue} ${monthDay.short}` : "",
    monthDay?.short ? `${record.event} parking lots ${city} ${monthDay.short}` : "",
    monthDay?.short ? `${record.venue} ${city} ${monthDay.short}` : "",
    ...venueAliases.flatMap((venueAlias) => [
      usePassOnlySearch && weekday ? `${record.event} ${weekday} Pass Only parking ${venueAlias} ${city} ${date}` : "",
      `${record.event} parking ${venueAlias} ${city} ${date}`,
      `${record.event} parking ${venueAlias} ${state} ${date}`,
      monthDay?.full ? `${record.event} parking ${venueAlias} ${monthDay.full}` : "",
    ]),
    ...venueAliases.flatMap((venueAlias) => [
      `${record.event} ${venueAlias} ${city} ${date}`,
      monthDay?.full ? `${record.event} ${venueAlias} ${monthDay.full}` : "",
      `${venueAlias} ${city} ${date}`,
    ]),
    ...eventAliases.flatMap((eventAlias) => [
      usePassOnlySearch && weekday ? `${eventAlias} ${weekday} Pass Only parking ${city} ${date}` : "",
      usePassOnlySearch && weekday ? `${eventAlias} ${weekday} Pass Only parking ${record.venue} ${city} ${date}` : "",
      weekday ? `${eventAlias} ${weekday} parking lots ${city} ${date}` : "",
      `${eventAlias} parking passes only ${record.venue} ${city} ${date}`,
      `${eventAlias} parking passes only ${city} ${date}`,
      `${eventAlias} parking ${record.venue} ${city} ${date}`,
      `${eventAlias} parking lots ${record.venue} ${city} ${date}`,
      `${eventAlias} garage ${record.venue} ${city} ${date}`,
      `${eventAlias} lot ${record.venue} ${city} ${date}`,
      `${eventAlias} parking ${record.venue} ${state} ${date}`,
      ...venueAliases.map((venueAlias) => (usePassOnlySearch && weekday ? `${eventAlias} ${weekday} Pass Only parking ${venueAlias} ${city} ${date}` : "")),
      ...venueAliases.map((venueAlias) => `${eventAlias} parking ${venueAlias} ${city} ${date}`),
      ...venueAliases.map((venueAlias) => `${eventAlias} parking lots ${venueAlias} ${city} ${date}`),
      monthDay?.full ? `${eventAlias} parking ${city} ${monthDay.full}` : "",
      monthDay?.full ? `${eventAlias} parking lots ${city} ${monthDay.full}` : "",
      monthDay?.short ? `${eventAlias} parking ${city} ${monthDay.short}` : "",
      monthDay?.short ? `${eventAlias} parking lots ${city} ${monthDay.short}` : "",
      `${eventAlias} ${record.venue} ${city} ${date}`,
      ...venueAliases.map((venueAlias) => `${eventAlias} ${venueAlias} ${city} ${date}`),
      monthDay?.full ? `${eventAlias} ${city} ${monthDay.full}` : "",
      monthDay?.short ? `${eventAlias} ${city} ${monthDay.short}` : "",
    ]),
  ];

  return Array.from(new Set(queries.map((query) => query.replace(/\s+/g, " ").trim()).filter(Boolean)));
}

function formatWeekdayFromEventDate(eventDate) {
  const parts = getDateParts(eventDate);
  if (!parts) {
    return "";
  }

  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return weekdays[utcDate.getUTCDay()] || "";
}

function shouldUsePassOnlySearch(record) {
  const normalizedEvent = normalizeText(record?.event);
  return (
    normalizedEvent.includes("festival") ||
    normalizedEvent.includes("stakes") ||
    normalizedEvent.includes("grand prix") ||
    normalizedEvent.includes("formula 1") ||
    normalizedEvent.includes("f1") ||
    normalizedEvent.includes("weekend")
  );
}

function hasStrongParkingSignal(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("parking passes only") ||
    normalized.includes("parking lots") ||
    normalized.includes("parking lot") ||
    normalized.includes("garage") ||
    /\bparking\b/.test(normalized) ||
    /\blots\b/.test(normalized) ||
    /\blot\b/.test(normalized)
  );
}

function isParkingSearchItem(item) {
  if (item?.isParkingEvent) {
    return true;
  }

  const text = `${item?.name || ""} ${item?.venueName || ""} ${item?.formattedVenueLocation || ""} ${item?.url || ""}`;
  return hasStrongParkingSignal(text);
}

function isParkingDocument(document, sourceUrl) {
  const text = [
    sourceUrl || "",
    document?.url || "",
    extractDocumentTitle(document?.html || ""),
    extractMetaDescription(document?.html || ""),
    stripHtml(document?.html || ""),
  ]
    .filter(Boolean)
    .join(" ");
  return hasStrongParkingSignal(text);
}

function extractDocumentTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match ? match[1] : "");
}

function extractMetaDescription(html) {
  const match = String(html || "").match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  return stripHtml(match ? match[1] : "");
}

function hasMultiDayIndicator(text) {
  const normalized = normalizeText(text);
  const hasSingleDayPassMarker =
    normalized.includes("pass only") ||
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(pass only|admission)\b/.test(normalized);

  return (
    /\b\d+\s+day\b/.test(normalized) ||
    /\b\d+\s+days\b/.test(normalized) ||
    normalized.includes("multi day") ||
    normalized.includes("multiday") ||
    (normalized.includes("weekend") && !hasSingleDayPassMarker) ||
    (normalized.includes("admission") && !hasSingleDayPassMarker) ||
    /[a-z]{3,9}\s+\d{1,2}\s+[a-z]{0,3}\s+[a-z]{3,9}\s+\d{1,2}/.test(normalized)
  );
}

function isSingleDayParkingSearchItem(item, record) {
  const itemText = `${item?.name || ""} ${item?.venueName || ""} ${item?.formattedDate || ""} ${item?.url || ""}`;
  if (hasMultiDayIndicator(itemText)) {
    return false;
  }

  const formattedDate = normalizeText(item?.formattedDate || "");
  const targetMonthDay = formatMonthDayFromEventDate(record?.event_date);
  if (!targetMonthDay || !formattedDate) {
    return true;
  }

  const acceptedDates = [
    targetMonthDay.full,
    targetMonthDay.short,
    targetMonthDay.fullPadded,
    targetMonthDay.shortPadded,
    targetMonthDay.iso,
    targetMonthDay.numericDashed,
    targetMonthDay.numericDashedPadded,
    targetMonthDay.numericSlashed,
    targetMonthDay.numericSlashedPadded,
  ].map((value) => normalizeText(value));

  return acceptedDates.some((value) => formattedDate === value || formattedDate.includes(value));
}

function isSingleDayParkingDocument(document, sourceUrl, record) {
  const pageSummary = [
    sourceUrl || "",
    document?.url || "",
    extractDocumentTitle(document?.html || ""),
    extractMetaDescription(document?.html || ""),
    stripHtml(document?.html || ""),
  ]
    .filter(Boolean)
    .join(" ");

  const combined = pageSummary;
  if (hasMultiDayIndicator(combined)) {
    return false;
  }

  const targetMonthDay = formatMonthDayFromEventDate(record?.event_date);
  if (!targetMonthDay) {
    return true;
  }

  const normalized = normalizeText(combined);
  const acceptedDates = [
    targetMonthDay.full,
    targetMonthDay.short,
    targetMonthDay.fullPadded,
    targetMonthDay.shortPadded,
    targetMonthDay.iso,
    targetMonthDay.numericDashed,
    targetMonthDay.numericDashedPadded,
    targetMonthDay.numericSlashed,
    targetMonthDay.numericSlashedPadded,
  ].map((value) => normalizeText(value));

  return acceptedDates.some((value) => normalized.includes(value));
}

function to24HourTime(timeText) {
  const match = String(timeText || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    return null;
  }

  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2]);
  const suffix = match[3].toUpperCase();

  if (suffix === "PM") {
    hours += 12;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function extractResolvedEventTimeFromDocument(html, summaryText) {
  const jsonDatePatterns = [
    /"formattedLocalEventDateTime"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)"/i,
    /"startDate"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)"/i,
    /"doorTime"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)"/i,
  ];

  for (const pattern of jsonDatePatterns) {
    const match = String(html || "").match(pattern);
    if (!match) {
      continue;
    }

    const isoTime = String(match[1] || "").match(/T(\d{2}):(\d{2})/);
    if (isoTime) {
      return `${isoTime[1]}:${isoTime[2]}`;
    }
  }

  return to24HourTime((String(summaryText || "").match(/\b(\d{1,2}:\d{2}\s?(?:AM|PM))\b/i) || [])[1]);
}

function getDateParts(eventDate) {
  const [year, month, day] = String(eventDate || "").split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return { year, month, day };
}

function formatMonthDayFromEventDate(eventDate) {
  const parts = getDateParts(eventDate);
  if (!parts) {
    return null;
  }

  const fullMonths = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const shortMonths = fullMonths.map((monthName) => monthName.slice(0, 3));

  return {
    full: `${fullMonths[parts.month - 1]} ${parts.day}`,
    short: `${shortMonths[parts.month - 1]} ${parts.day}`,
    fullPadded: `${fullMonths[parts.month - 1]} ${String(parts.day).padStart(2, "0")}`,
    shortPadded: `${shortMonths[parts.month - 1]} ${String(parts.day).padStart(2, "0")}`,
    iso: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    numericDashed: `${parts.month}-${parts.day}-${parts.year}`,
    numericDashedPadded: `${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}-${parts.year}`,
    numericSlashed: `${parts.month}/${parts.day}/${parts.year}`,
    numericSlashedPadded: `${String(parts.month).padStart(2, "0")}/${String(parts.day).padStart(2, "0")}/${parts.year}`,
  };
}

function extractJsonArrayByKey(html, key) {
  const marker = `"${key}":[`;
  const start = String(html || "").indexOf(marker);
  if (start === -1) {
    return null;
  }

  let index = start + marker.length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; index < html.length; index += 1) {
    const char = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start + marker.length - 1, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function extractJsonArrayAfterMarker(html, sectionMarker, arrayKey) {
  const sectionIndex = String(html || "").indexOf(sectionMarker);
  if (sectionIndex === -1) {
    return null;
  }

  const subHtml = html.slice(sectionIndex);
  return extractJsonArrayByKey(subHtml, arrayKey);
}

function extractAllJsonArraysByKey(html, key) {
  const marker = `"${key}":[`;
  const arrays = [];
  let searchIndex = 0;

  while (searchIndex < String(html || "").length) {
    const start = String(html || "").indexOf(marker, searchIndex);
    if (start === -1) {
      break;
    }

    const slice = String(html || "").slice(start);
    const parsed = extractJsonArrayByKey(slice, key);
    if (Array.isArray(parsed)) {
      arrays.push(parsed);
    }

    searchIndex = start + marker.length;
  }

  return arrays;
}

function extractTopSearchResults(html) {
  const parsed = extractJsonArrayAfterMarker(html, '"topSearchResults"', "searchResults");
  return Array.isArray(parsed) ? parsed : [];
}

function extractVenueTopResultsViaRegex(html) {
  const matches = [
    ...String(html || "").matchAll(
      /"subtitle":"Venue".{0,400}?"title":"([^"]+)".{0,1200}?"url":"([^"]+)"/g,
    ),
  ];

  return matches.map((match) => ({
    subtitle: "Venue",
    title: match[1],
    url: match[2],
    objectId: "3:regex",
  }));
}

function extractPerformerTopResultsViaRegex(html) {
  const matches = [
    ...String(html || "").matchAll(
      /"subtitle":"([^"]+)".{0,400}?"title":"([^"]+)".{0,1200}?"url":"([^"]+)"/g,
    ),
  ];

  return matches
    .map((match) => ({
      subtitle: match[1],
      title: match[2],
      url: match[3],
    }))
    .filter((candidate) => normalizeText(candidate.subtitle).includes("tickets"));
}

function extractVenueLinksFromHtml(html) {
  const matches = [...String(html || "").matchAll(/\/_V-\d+/g)];
  return Array.from(new Set(matches.map((match) => match[0])));
}

function extractPerformerCityLinks(html) {
  const parsed = extractJsonArrayByKey(html, "cityLinks");
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => ({
      name: item?.name || "",
      stateProvince: item?.stateProvince || "",
      url: item?.url || "",
      eventCount: Number(item?.eventCount || 0),
    }))
    .filter((item) => item.url);
}

function extractCandidateUrlsByEventId(html, eventId) {
  const normalizedEventId = String(eventId || "").trim();
  if (!normalizedEventId) {
    return [];
  }

  const normalizedHtml = decodeHtmlEntities(String(html || "")).replace(/\\\//g, "/");
  const directPattern = new RegExp(`https?:\\/\\/www\\.stubhub\\.com\\/[^"'\\s]*\\/event\\/${escapeRegExp(normalizedEventId)}[^"'\\s]*`, "gi");
  const relativePattern = new RegExp(`\\/[^\\"'\\s]*\\/event\\/${escapeRegExp(normalizedEventId)}[^"'\\s]*`, "gi");

  const urls = [
    ...Array.from(normalizedHtml.matchAll(directPattern)).map((match) => match[0]),
    ...Array.from(normalizedHtml.matchAll(relativePattern)).map((match) => match[0]),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.startsWith("http") ? value : `${STUBHUB_BASE_URL}${value}`));

  return Array.from(new Set(urls));
}

function extractBestVenueUrlByTitle(html, venueName) {
  const candidates = extractVenueTopResultsViaRegex(html)
    .map((candidate) => ({
      ...candidate,
      match_score: tokenOverlapScore(venueName, candidate.title, {
        minLength: 4,
        ignored: ["venue", "arena", "stadium", "center", "theater", "theatre", "park", "lot"],
      }) * 8,
    }))
    .filter((candidate) => candidate.url && candidate.match_score >= 8)
    .sort((left, right) => right.match_score - left.match_score);

  return candidates[0]?.url || "";
}

function tokenOverlapScore(expected, actual, { minLength = 3, ignored = [] } = {}) {
  const ignoredSet = new Set(ignored);
  const expectedTokens = normalizeText(expected)
    .split(" ")
    .filter((token) => token.length >= minLength && !ignoredSet.has(token));
  const actualTokens = new Set(
    normalizeText(actual)
      .split(" ")
      .filter((token) => token.length >= minLength && !ignoredSet.has(token)),
  );

  if (expectedTokens.length === 0) {
    return 0;
  }

  let score = 0;
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function dateMatchesSearchItem(item, eventDate) {
  const target = String(eventDate || "");
  if (!target) {
    return false;
  }

  const eventStart = item?.eventMetadata?.common?.eventStartDateTime;
  const offset = item?.eventMetadata?.common?.venueTimeZoneOffset;

  if (Number.isFinite(eventStart) && Number.isFinite(offset)) {
    const localIsoDate = new Date(Number(eventStart) + Number(offset)).toISOString().slice(0, 10);
    if (localIsoDate === target) {
      return true;
    }
  }

  const monthDay = formatMonthDayFromEventDate(eventDate);
  const normalizedFormattedDate = normalizeText(item?.formattedDate);

  if (monthDay && normalizedFormattedDate) {
    const targetCandidates = [
      monthDay.full,
      monthDay.short,
      monthDay.fullPadded,
      monthDay.shortPadded,
    ].map((candidate) => normalizeText(candidate));

    if (targetCandidates.some((candidate) => normalizedFormattedDate === candidate)) {
      return true;
    }

    if (targetCandidates.some((candidate) => normalizedFormattedDate.includes(candidate))) {
      return true;
    }
  }

  return false;
}

function inferEventStatusFromSearchItem(item) {
  const normalizedName = normalizeText(item?.name);
  const normalizedVenue = normalizeText(item?.venueName);
  const normalizedRescheduled = normalizeText(item?.formattedRescheduledFromDate);

  if (
    /\bcancel+ed\b|\bcancelled\b/.test(normalizedName) ||
    /\bcancel+ed\b|\bcancelled\b/.test(normalizedVenue)
  ) {
    return "canceled";
  }

  if (normalizedRescheduled || /\brescheduled\b|\bpostponed\b/.test(normalizedName)) {
    return "rescheduled";
  }

  if (item?.isTbd || item?.isTimeConfirmed === false || item?.isDateConfirmed === false) {
    return "tbd";
  }

  return "scheduled";
}

function scoreSearchItemCore(item, record) {
  const venueIgnored = ["venue", "arena", "stadium", "center", "theater", "theatre", "park", "lot"];
  const performerText = `${item?.name || ""}`;
  const venueText = `${item?.venueName || ""}`;
  const locationText = `${item?.venueCity || ""} ${item?.venueStateProvince || ""} ${item?.formattedVenueLocation || ""}`;

  const performerPhraseExpected = normalizeText(record.event);
  const performerPhraseActual = normalizeText(performerText);
  const venuePhraseExpected = normalizeText(record.venue);
  const venuePhraseActual = normalizeText(venueText);
  const cityExpected = normalizeText(parseCity(record.city_state));
  const stateExpected = normalizeText(parseState(record.city_state));
  const cityActual = normalizeText(item?.venueCity || item?.formattedVenueLocation);
  const stateActual = normalizeText(item?.venueStateProvince || item?.formattedVenueLocation);
  const itemEventId = String(item?.eventId || item?.id || "").trim();
  const targetEventId = String(record?.event_id || "").trim();

  let score = 0;
  const venueOverlap = tokenOverlapScore(record.venue, venueText, { minLength: 4, ignored: venueIgnored });
  const performerOverlap = tokenOverlapScore(record.event, performerText, { minLength: 4 });

  if (
    isGenericFestivalRecord(record) &&
    venuePhraseExpected &&
    !venuePhraseActual.includes(venuePhraseExpected) &&
      venueOverlap < 2
  ) {
    return -100;
  }

  if (
    !(
      (performerPhraseExpected && performerPhraseActual.includes(performerPhraseExpected)) ||
      performerOverlap > 0 ||
      (venuePhraseExpected && venuePhraseActual.includes(venuePhraseExpected)) ||
      venueOverlap > 0
    )
  ) {
    return -100;
  }

  if (performerPhraseExpected && performerPhraseActual.includes(performerPhraseExpected)) {
    score += 24;
  } else {
    score += performerOverlap * 5;
  }

  if (venuePhraseExpected && venuePhraseActual.includes(venuePhraseExpected)) {
    score += 26;
  } else {
    score += venueOverlap * 6;
  }

  if (cityExpected && cityActual.includes(cityExpected)) {
    score += 10;
  }

  if (stateExpected && stateActual.includes(stateExpected)) {
    score += 4;
  }

  if (normalizeText(locationText).includes(cityExpected) && cityExpected) {
    score += 4;
  }

  score += 25;

  if (targetEventId && itemEventId && targetEventId === itemEventId) {
    score += 80;
  }

  return score;
}

function extractResolvedEventTimeFromSearchItem(item) {
  if (item?.isTbd || item?.isTimeConfirmed === false) {
    return null;
  }

  const formattedTime = to24HourTime(item?.formattedTime);
  if (formattedTime) {
    return formattedTime;
  }

  const eventStart = item?.eventMetadata?.common?.eventStartDateTime;
  const offset = item?.eventMetadata?.common?.venueTimeZoneOffset;
  if (Number.isFinite(eventStart) && Number.isFinite(offset)) {
    const local = new Date(Number(eventStart) + Number(offset));
    return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  }

  return null;
}

function isExactEventIdSearchMatch(item, record) {
  const targetEventId = String(record?.event_id || "").trim();
  const itemEventId = String(item?.eventId || item?.id || "").trim();
  if (!targetEventId || !itemEventId || targetEventId !== itemEventId) {
    return false;
  }

  if (!(isParkingSearchItem(item) && isSingleDayParkingSearchItem(item, record) && dateMatchesSearchItem(item, record.event_date))) {
    return false;
  }

  const performerText = normalizeText(item?.name || "");
  const venueText = normalizeText(item?.venueName || "");
  const locationText = normalizeText(`${item?.venueCity || ""} ${item?.venueStateProvince || ""} ${item?.formattedVenueLocation || ""}`);
  const eventCandidates = [record?.event, ...getEventAliases(record)].map((value) => normalizeText(value)).filter(Boolean);
  const venueCandidates = [record?.venue, ...getVenueAliases(record)].map((value) => normalizeText(value)).filter(Boolean);
  const targetCity = normalizeText(parseCity(record?.city_state));
  const targetState = normalizeText(parseState(record?.city_state));

  const performerMatches = eventCandidates.some((candidate) => candidate && (performerText.includes(candidate) || tokenOverlapScore(candidate, performerText, { minLength: 4 }) > 0));
  const venueMatches = venueCandidates.some((candidate) => candidate && (venueText.includes(candidate) || tokenOverlapScore(candidate, venueText, {
    minLength: 4,
    ignored: ["venue", "arena", "stadium", "center", "theater", "theatre", "park", "lot"],
  }) > 0));
  const cityMatches = Boolean(targetCity) && (locationText.includes(targetCity) || venueText.includes(targetCity));
  const stateMatches = Boolean(targetState) && locationText.includes(targetState);

  return performerMatches && (venueMatches || cityMatches || stateMatches);
}

function scoreSearchItem(item, record) {
  if (!isParkingSearchItem(item)) {
    return -100;
  }

  if (!isSingleDayParkingSearchItem(item, record)) {
    return -100;
  }

  const dateMatch = dateMatchesSearchItem(item, record.event_date);
  if (!dateMatch) {
    return -100;
  }

  return scoreSearchItemCore(item, record);
}

function scoreGeneralEventSearchItem(item, record) {
  if (!isSingleDayParkingSearchItem(item, record)) {
    return -100;
  }

  if (!dateMatchesSearchItem(item, record.event_date)) {
    return -100;
  }

  return scoreSearchItemCore(item, record);
}

function isGenericFestivalRecord(record) {
  const normalizedEvent = normalizeText(record?.event);
  return (
    normalizedEvent.includes("festival") ||
    normalizedEvent.includes("fest") ||
    normalizedEvent.includes("joke") ||
    normalizedEvent.includes("presents")
  );
}

function scoreVenuePageItem(item, record) {
  if (!isParkingSearchItem(item)) {
    return -100;
  }

  if (!isSingleDayParkingSearchItem(item, record)) {
    return -100;
  }

  if (!dateMatchesSearchItem(item, record.event_date)) {
    return -100;
  }

  const performerOverlap = tokenOverlapScore(record.event, item?.name, { minLength: 4 });
  if (performerOverlap === 0) {
    return -100;
  }

  const venueScore =
    tokenOverlapScore(record.venue, item?.venueName, {
      minLength: 4,
      ignored: ["venue", "arena", "stadium", "center", "theater", "theatre", "park", "lot"],
    }) * 8;
  const cityScore = normalizeText(item?.venueCity).includes(normalizeText(parseCity(record.city_state))) ? 12 : 0;
  const performerScore = performerOverlap * (isGenericFestivalRecord(record) ? 2 : 5);

  return 70 + venueScore + cityScore + performerScore;
}

function extractSearchItemsFromHtml(html) {
  const arrays = [
    ...extractAllJsonArraysByKey(html, "searchResultItems"),
    ...extractAllJsonArraysByKey(html, "events"),
    ...extractAllJsonArraysByKey(html, "items"),
  ];
  const items = [];
  const seenEventIds = new Set();

  for (const parsed of arrays) {
    if (!Array.isArray(parsed)) {
      continue;
    }

    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const eventId = String(item.eventId || item.id || "");
      if (eventId && seenEventIds.has(eventId)) {
        continue;
      }

      if (eventId) {
        seenEventIds.add(eventId);
      }

      items.push(item);
    }
  }

  return items;
}

async function fetchStubhubPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STUBHUB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: STUBHUB_BASE_URL,
      },
    });

    if (!response.ok) {
      throw new Error(`StubHub web request failed (${response.status}) for ${url}`);
    }

    return {
      url: response.url,
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseEventDocument(document, record, sourceUrl) {
  const parkingDocument = isParkingDocument(document, sourceUrl);

  if (!parkingDocument) {
    return {
      status: "not_parking_event",
      source_url: sourceUrl,
      match_score: 0,
      event_status: "unverified",
      resolved_event_time: null,
      resolved_stubhub_event_id: null,
      resolution_notes: ["StubHub page matched an event, but it does not appear to be the parking event."],
    };
  }

  if (!isSingleDayParkingDocument(document, sourceUrl, record)) {
    return {
      status: "multi_day_parking_event",
      source_url: sourceUrl,
      match_score: 0,
      event_status: "unverified",
      resolved_event_time: null,
      resolved_stubhub_event_id: null,
      resolution_notes: ["StubHub page appears to be a parking pass for multiple days, not the single target event date."],
    };
  }

  const bodyText = stripHtml(document.html);
  const summaryText = [
    sourceUrl || "",
    document?.url || "",
    extractDocumentTitle(document?.html || ""),
    extractMetaDescription(document?.html || ""),
    bodyText,
  ]
    .filter(Boolean)
    .join(" ");

  const performerOverlap = tokenOverlapScore(record.event, summaryText, { minLength: 4 });
  const venueIgnored = ["venue", "arena", "stadium", "center", "theater", "theatre", "park", "lot"];
  const venueCandidates = [record.venue, ...getVenueAliases(record)].filter(Boolean);
  const venueOverlap = venueCandidates.reduce(
    (bestScore, candidate) =>
      Math.max(
        bestScore,
        tokenOverlapScore(candidate, summaryText, {
          minLength: 4,
          ignored: venueIgnored,
        }),
      ),
    0,
  );
  const normalizedSummary = normalizeText(summaryText);
  const cityMatch = normalizedSummary.includes(normalizeText(parseCity(record.city_state))) ? 1 : 0;
  const targetMonthDay = formatMonthDayFromEventDate(record.event_date);
  const acceptedDates = [
    targetMonthDay?.full,
    targetMonthDay?.short,
    targetMonthDay?.fullPadded,
    targetMonthDay?.shortPadded,
    targetMonthDay?.iso,
    targetMonthDay?.numericDashed,
    targetMonthDay?.numericDashedPadded,
    targetMonthDay?.numericSlashed,
    targetMonthDay?.numericSlashedPadded,
  ]
    .filter(Boolean)
    .map((value) => normalizeText(value));
  const dateMatch = acceptedDates.some((value) => normalizedSummary.includes(value)) ? 1 : 0;
  const matchScore = performerOverlap * 6 + venueOverlap * 7 + cityMatch * 5 + dateMatch * 20;

  if (matchScore < 28) {
    return {
      status: "page_mismatch",
      source_url: sourceUrl,
      match_score: matchScore,
      event_status: "unverified",
      resolved_event_time: null,
      resolution_notes: ["StubHub page did not match the expected performer, venue, city, and date strongly enough."],
    };
  }

  const normalized = normalizeText(summaryText);
  let eventStatus = "scheduled";
  if (/\bcancel+ed\b|\bcancelled\b/.test(normalized)) {
    eventStatus = "canceled";
  } else if (/\brescheduled\b|\bpostponed\b/.test(normalized)) {
    eventStatus = "rescheduled";
  } else if (/\btbd\b|\btbh\b|\btba\b|\bto be announced\b|\bto be determined\b|\bnot determined yet\b/.test(normalized)) {
    eventStatus = "tbd";
  }

  const resolvedTime = eventStatus === "scheduled" ? extractResolvedEventTimeFromDocument(document?.html || "", summaryText) : null;

  return {
    status: eventStatus === "scheduled" && !resolvedTime ? "scheduled_time_not_found" : "validated",
    source_url: sourceUrl,
    match_score: matchScore,
    event_status: eventStatus,
    resolved_event_time: resolvedTime,
    resolved_stubhub_event_id: extractEventIdFromUrl(sourceUrl),
    resolution_notes: ["StubHub parking event page matched the expected event details."],
  };
}

function buildValidatedResultFromSearchItem(item, record, sourceUrl, options = {}) {
  const matchKind = String(options.matchKind || "parking_search");
  if (matchKind === "general_event_search" || (!isParkingSearchItem(item) && !hasStrongParkingSignal(sourceUrl))) {
    return {
      status: "not_parking_event",
      source_url: sourceUrl,
      match_score: -100,
      event_status: "unverified",
      resolved_event_time: null,
      resolved_stubhub_event_id: null,
      resolution_notes: ["StubHub search result matched the event, but it does not appear to be a parking listing."],
    };
  }

  const eventStatus = inferEventStatusFromSearchItem(item);
  const resolvedEventTime = extractResolvedEventTimeFromSearchItem(item);
  const score = scoreSearchItem(item, record);

  return {
    status: eventStatus === "scheduled" && !resolvedEventTime ? "scheduled_time_not_found" : "validated",
    source_url: sourceUrl,
    match_score: score,
    event_status: eventStatus,
    resolved_event_time: resolvedEventTime,
    resolved_stubhub_event_id: extractResolvedStubhubEventId(item, sourceUrl),
    resolution_notes: [`StubHub parking search matched performer, venue, and exact date (${item.formattedDate || record.event_date}).`],
  };
}

function buildValidatedResultFromVenuePageItem(item, record, sourceUrl, options = {}) {
  const matchKind = String(options.matchKind || "parking_venue_page");
  if (matchKind === "general_event_venue_page" || (!isParkingSearchItem(item) && !hasStrongParkingSignal(sourceUrl))) {
    return {
      status: "not_parking_event",
      source_url: sourceUrl,
      match_score: -100,
      event_status: "unverified",
      resolved_event_time: null,
      resolved_stubhub_event_id: null,
      resolution_notes: ["StubHub venue page item matched the event, but it does not appear to be a parking listing."],
    };
  }

  const eventStatus = inferEventStatusFromSearchItem(item);
  const resolvedEventTime = extractResolvedEventTimeFromSearchItem(item);
  const score = scoreVenuePageItem(item, record);

  return {
    status: eventStatus === "scheduled" && !resolvedEventTime ? "scheduled_time_not_found" : "validated",
    source_url: sourceUrl,
    match_score: score,
    event_status: eventStatus,
    resolved_event_time: resolvedEventTime,
    resolved_stubhub_event_id: extractResolvedStubhubEventId(item, sourceUrl),
    resolution_notes: [`StubHub parking venue page matched the exact venue and date (${item.formattedDate || record.event_date}).`],
  };
}

function isTerminalValidatedResult(result) {
  return Boolean(result && ["validated", "scheduled_time_not_found"].includes(result.status));
}

async function resolveViaVenueFallback(searchDocument, record) {
  const venueCandidates = [...extractTopSearchResults(searchDocument.html), ...extractVenueTopResultsViaRegex(searchDocument.html)]
    .filter((result) => {
      const subtitle = normalizeText(result?.subtitle);
      return subtitle === "venue" || String(result?.objectId || "").startsWith("3:");
    })
    .map((result) => ({
      title: result?.title || "",
      url: result?.url || "",
      match_score:
        tokenOverlapScore(record.venue, result?.title, {
          minLength: 4,
          ignored: ["venue", "arena", "stadium", "center", "theater", "theatre", "park", "lot"],
        }) * 8,
    }))
    .filter((candidate) => candidate.url && candidate.match_score >= 8)
    .sort((left, right) => right.match_score - left.match_score)
    .slice(0, 3);

  for (const candidate of venueCandidates) {
    const candidateUrl = candidate.url.startsWith("http")
      ? candidate.url
      : `${STUBHUB_BASE_URL}${candidate.url.startsWith("/") ? candidate.url : `/${candidate.url}`}`;
    const venueDocument = await fetchStubhubPage(candidateUrl).catch(() => null);
    if (!venueDocument) {
      continue;
    }

    const venueItems = extractSearchItemsFromHtml(venueDocument.html)
      .map((item) => ({
        item,
        match_score: scoreVenuePageItem(item, record),
      }))
      .filter((candidateItem) => candidateItem.match_score >= 65)
      .sort((left, right) => right.match_score - left.match_score);

    if (venueItems.length > 0) {
      const best = venueItems[0];
      const sourceUrl = String(best.item?.url || venueDocument.url || candidateUrl);
      const result = buildValidatedResultFromVenuePageItem(
        best.item,
        record,
        sourceUrl.startsWith("http") ? sourceUrl : `${STUBHUB_BASE_URL}${sourceUrl}`,
      );
      if (isTerminalValidatedResult(result)) {
        return result;
      }
    }
  }

  return null;
}

async function resolveViaDirectVenueSearch(record) {
  const city = parseCity(record.city_state);
  const venueAliases = getVenueAliases(record);
  const venueQueries = Array.from(
    new Set(
      [
        `${record.venue} parking lots ${city} ${record.event_date}`.trim(),
        `${record.venue} parking ${city} ${record.event_date}`.trim(),
        `${record.venue} lots ${city} ${record.event_date}`.trim(),
        `${record.venue} garage ${city} ${record.event_date}`.trim(),
        `${record.venue} ${city}`.trim(),
        String(record.venue || "").trim(),
        ...venueAliases.flatMap((venueAlias) => [
          `${venueAlias} parking lots ${city} ${record.event_date}`.trim(),
          `${venueAlias} parking ${city} ${record.event_date}`.trim(),
          `${venueAlias} ${city}`.trim(),
          venueAlias,
        ]),
      ].filter(Boolean),
    ),
  );

  for (const venueQuery of venueQueries) {
    const searchUrl = `${STUBHUB_BASE_URL}/search?q=${encodeURIComponent(venueQuery)}`;
    const searchDocument = await fetchStubhubPage(searchUrl).catch(() => null);
    if (!searchDocument) {
      continue;
    }

    const structuredVenueResult = await resolveViaVenueFallback(searchDocument, record);
    if (structuredVenueResult) {
      return structuredVenueResult;
    }

    const exactVenueUrl = extractBestVenueUrlByTitle(searchDocument.html, record.venue);
    if (exactVenueUrl) {
      const candidateUrl = exactVenueUrl.startsWith("http")
        ? exactVenueUrl
        : `${STUBHUB_BASE_URL}${exactVenueUrl.startsWith("/") ? exactVenueUrl : `/${exactVenueUrl}`}`;
      const venueDocument = await fetchStubhubPage(candidateUrl).catch(() => null);
      if (venueDocument) {
        const venueItems = extractSearchItemsFromHtml(venueDocument.html)
          .map((item) => ({
            item,
            match_score: scoreVenuePageItem(item, record),
          }))
          .filter((candidateItem) => candidateItem.match_score >= 65)
          .sort((left, right) => right.match_score - left.match_score);

        if (venueItems.length > 0) {
          const best = venueItems[0];
          const sourceUrl = String(best.item?.url || venueDocument.url || candidateUrl);
          const result = buildValidatedResultFromVenuePageItem(
            best.item,
            record,
            sourceUrl.startsWith("http") ? sourceUrl : `${STUBHUB_BASE_URL}${sourceUrl}`,
          );
          if (isTerminalValidatedResult(result)) {
            return result;
          }
        }
      }
    }

    const rawVenueLinks = extractVenueLinksFromHtml(searchDocument.html).slice(0, 5);
    for (const rawLink of rawVenueLinks) {
      const candidateUrl = `${STUBHUB_BASE_URL}${rawLink}`;
      const venueDocument = await fetchStubhubPage(candidateUrl).catch(() => null);
      if (!venueDocument) {
        continue;
      }

      const venueItems = extractSearchItemsFromHtml(venueDocument.html)
        .map((item) => ({
          item,
          match_score: scoreVenuePageItem(item, record),
        }))
        .filter((candidateItem) => candidateItem.match_score >= 65)
        .sort((left, right) => right.match_score - left.match_score);

      if (venueItems.length > 0) {
        const best = venueItems[0];
        const sourceUrl = String(best.item?.url || venueDocument.url || candidateUrl);
        const result = buildValidatedResultFromVenuePageItem(
          best.item,
          record,
          sourceUrl.startsWith("http") ? sourceUrl : `${STUBHUB_BASE_URL}${sourceUrl}`,
        );
        if (isTerminalValidatedResult(result)) {
          return result;
        }
      }
    }
  }

  return null;
}

async function resolveViaPerformerCitySearch(record) {
  const performerQueries = Array.from(
    new Set(
      [
        `${record.event} parking lots ${parseCity(record.city_state)} ${record.event_date}`.trim(),
        `${record.event} parking ${parseCity(record.city_state)} ${record.event_date}`.trim(),
        `${record.event} ${parseCity(record.city_state)} ${record.event_date}`.trim(),
        String(record.event || "").trim(),
        ...getEventAliases(record).flatMap((eventAlias) => [
          `${eventAlias} parking lots ${parseCity(record.city_state)} ${record.event_date}`.trim(),
          `${eventAlias} parking ${parseCity(record.city_state)} ${record.event_date}`.trim(),
          `${eventAlias} ${parseCity(record.city_state)} ${record.event_date}`.trim(),
          eventAlias,
        ]),
      ].filter(Boolean),
    ),
  );
  if (performerQueries.length === 0) {
    return null;
  }

  for (const performerQuery of performerQueries) {
    const performerSearchUrl = `${STUBHUB_BASE_URL}/search?q=${encodeURIComponent(performerQuery)}`;
    const performerSearchDocument = await fetchStubhubPage(performerSearchUrl).catch(() => null);
    if (!performerSearchDocument) {
      continue;
    }

    const performerCandidates = [...extractTopSearchResults(performerSearchDocument.html), ...extractPerformerTopResultsViaRegex(performerSearchDocument.html)]
      .map((candidate) => ({
        title: candidate?.title || "",
        subtitle: candidate?.subtitle || "",
        url: candidate?.url || "",
        match_score: tokenOverlapScore(record.event, candidate?.title, { minLength: 4 }) * 8,
      }))
      .filter((candidate) => candidate.url && candidate.match_score >= 8)
      .sort((left, right) => right.match_score - left.match_score)
      .slice(0, 3);

    const targetCity = normalizeText(parseCity(record.city_state));
    const targetState = normalizeText(parseState(record.city_state));

    for (const performerCandidate of performerCandidates) {
      const performerUrl = performerCandidate.url.startsWith("http")
        ? performerCandidate.url
        : `${STUBHUB_BASE_URL}${performerCandidate.url.startsWith("/") ? performerCandidate.url : `/${performerCandidate.url}`}`;
      const performerDocument = await fetchStubhubPage(performerUrl).catch(() => null);
      if (!performerDocument) {
        continue;
      }

      const directItems = extractSearchItemsFromHtml(performerDocument.html)
        .map((item) => ({
          item,
          match_score: scoreSearchItem(item, record),
        }))
        .filter((candidateItem) => candidateItem.match_score >= 55)
        .sort((left, right) => right.match_score - left.match_score);

      if (directItems.length > 0) {
        const best = directItems[0];
        const sourceUrl = String(best.item?.url || performerDocument.url || performerUrl);
        const result = buildValidatedResultFromSearchItem(
          best.item,
          record,
          sourceUrl.startsWith("http") ? sourceUrl : `${STUBHUB_BASE_URL}${sourceUrl}`,
        );
        if (isTerminalValidatedResult(result)) {
          return result;
        }
      }

      const cityLinks = extractPerformerCityLinks(performerDocument.html)
        .map((cityLink) => {
          const cityName = normalizeText(cityLink.name);
          const stateName = normalizeText(cityLink.stateProvince);
          let matchScore = 0;
          if (targetCity && cityName.includes(targetCity)) {
            matchScore += 12;
          }
          if (targetState && stateName.includes(targetState)) {
            matchScore += 6;
          }
          return {
            ...cityLink,
            match_score: matchScore,
          };
        })
        .filter((cityLink) => cityLink.match_score >= 12)
        .sort((left, right) => right.match_score - left.match_score)
        .slice(0, 3);

      for (const cityLink of cityLinks) {
        const cityUrl = cityLink.url.startsWith("http")
          ? cityLink.url
          : `${STUBHUB_BASE_URL}${cityLink.url.startsWith("/") ? cityLink.url : `/${cityLink.url}`}`;
        const cityDocument = await fetchStubhubPage(cityUrl).catch(() => null);
        if (!cityDocument) {
          continue;
        }

        const cityItems = extractSearchItemsFromHtml(cityDocument.html)
          .map((item) => ({
            item,
            match_score: scoreSearchItem(item, record),
          }))
          .filter((candidateItem) => {
            const targetEventId = String(record.event_id || "").trim();
            const itemEventId = String(candidateItem.item?.eventId || candidateItem.item?.id || "").trim();
            if (targetEventId && itemEventId && targetEventId === itemEventId) {
              return true;
            }
            return candidateItem.match_score >= 55;
          })
          .sort((left, right) => right.match_score - left.match_score);

        if (cityItems.length > 0) {
          const exactIdMatch = cityItems.find((candidateItem) => {
            const targetEventId = String(record.event_id || "").trim();
            const itemEventId = String(candidateItem.item?.eventId || candidateItem.item?.id || "").trim();
            return Boolean(targetEventId && itemEventId && targetEventId === itemEventId);
          });
          const best = exactIdMatch || cityItems[0];
          const sourceUrl = String(best.item?.url || cityDocument.url || cityUrl);
          const result = buildValidatedResultFromSearchItem(
            best.item,
            record,
            sourceUrl.startsWith("http") ? sourceUrl : `${STUBHUB_BASE_URL}${sourceUrl}`,
          );
          if (isTerminalValidatedResult(result)) {
            return result;
          }
        }
      }
    }
  }

  return null;
}

async function resolveRecordViaStubhubWeb(record) {
  const directUrl = buildStubhubEventUrl(record.event_id);
  const aiFallbackExcerpts = [];

  if (directUrl) {
    const directDocument = await fetchStubhubPage(directUrl).catch(() => null);
    if (directDocument) {
      aiFallbackExcerpts.push(buildAiFallbackExcerpt(`direct event page ${directDocument.url || directUrl}`, directDocument.html));
      const directResult = parseEventDocument(directDocument, record, directDocument.url || directUrl);
      if (["validated", "scheduled_time_not_found"].includes(directResult.status)) {
        return directResult;
      }

      if (isStubhubWafChallenge(directDocument.html)) {
        const candidateUrls = buildStubhubSlugCandidateUrls(record);
        for (const candidateUrl of candidateUrls) {
          const candidateDocument = await fetchStubhubPage(candidateUrl).catch(() => null);
          if (!candidateDocument?.html || isStubhubWafChallenge(candidateDocument.html)) {
            continue;
          }

          aiFallbackExcerpts.push(
            buildAiFallbackExcerpt(`slug candidate ${candidateDocument.url || candidateUrl}`, candidateDocument.html),
          );
          const candidateResult = parseEventDocument(candidateDocument, record, candidateDocument.url || candidateUrl);
          if (["validated", "scheduled_time_not_found"].includes(candidateResult.status)) {
            return candidateResult;
          }
        }
      }
    }
  }

  const searchQueries = buildSearchQueries(record);
  const seenCandidateUrls = new Set();

  for (const query of searchQueries) {
    const searchUrl = `${STUBHUB_BASE_URL}/secure/search/?q=${encodeURIComponent(query)}`;
    const searchDocument = await fetchStubhubPage(searchUrl).catch((error) => ({
      url: searchUrl,
      html: "",
      error,
    }));

    if (searchDocument.error) {
      continue;
    }

    aiFallbackExcerpts.push(buildAiFallbackExcerpt(`search results for "${query}"`, searchDocument.html));

    if (record.event_id) {
      const eventIdUrls = extractCandidateUrlsByEventId(searchDocument.html, record.event_id);
      for (const candidateUrl of eventIdUrls.slice(0, 3)) {
        if (seenCandidateUrls.has(candidateUrl)) {
          continue;
        }

        seenCandidateUrls.add(candidateUrl);
        const candidateDocument = await fetchStubhubPage(candidateUrl).catch(() => null);
        if (!candidateDocument || !candidateDocument.html) {
          continue;
        }

        aiFallbackExcerpts.push(
          buildAiFallbackExcerpt(`event-id candidate ${candidateDocument.url || candidateUrl}`, candidateDocument.html),
        );

        const parsed = parseEventDocument(candidateDocument, record, candidateDocument.url || candidateUrl);
        if (["validated", "scheduled_time_not_found"].includes(parsed.status)) {
          return parsed;
        }
      }
    }

    const rawSearchItems = extractSearchItemsFromHtml(searchDocument.html);

    if (record.event_id) {
      const exactIdSearchItem = rawSearchItems.find((item) => isExactEventIdSearchMatch(item, record));
      if (exactIdSearchItem) {
        const sourceUrl = String(exactIdSearchItem?.url || searchDocument.url || searchUrl);
        const result = buildValidatedResultFromSearchItem(
          exactIdSearchItem,
          record,
          sourceUrl.startsWith("http") ? sourceUrl : `${STUBHUB_BASE_URL}${sourceUrl}`,
        );
        if (isTerminalValidatedResult(result)) {
          return result;
        }
      }
    }

    const searchItems = rawSearchItems
      .map((item) => ({
        item,
        match_score: scoreSearchItem(item, record),
      }))
      .filter((candidate) => candidate.match_score >= 38)
      .sort((left, right) => right.match_score - left.match_score);

    const aiCandidateExcerpt = buildAiSearchItemsExcerpt(
      `structured search candidates for "${query}"`,
      searchItems.slice(0, 8),
    );
    if (aiCandidateExcerpt) {
      aiFallbackExcerpts.push(aiCandidateExcerpt);
    }

    if (searchItems.length > 0) {
      const best = searchItems[0];
      if (best.match_score >= 55) {
        const sourceUrl = String(best.item?.url || searchDocument.url || searchUrl);
        const result = buildValidatedResultFromSearchItem(
          best.item,
          record,
          sourceUrl.startsWith("http") ? sourceUrl : `${STUBHUB_BASE_URL}${sourceUrl}`,
        );
        if (isTerminalValidatedResult(result)) {
          return result;
        }
      }
    }


    const venueFallback = await resolveViaVenueFallback(searchDocument, record);
    if (venueFallback) {
      return venueFallback;
    }

    const topLinks = [...String(searchDocument.html).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({
        href: decodeHtmlEntities(match[1] || ""),
        text: stripHtml(match[2] || ""),
      }))
      .map((candidate) => {
        const href = candidate.href.startsWith("http")
          ? candidate.href
          : `${STUBHUB_BASE_URL}${candidate.href.startsWith("/") ? candidate.href : `/${candidate.href}`}`;
        const combined = `${candidate.text} ${href}`;
        return {
          href,
          text: candidate.text,
          match_score:
            (hasStrongParkingSignal(combined) ? 18 : 0) +
            tokenOverlapScore(record.event, combined, { minLength: 4 }) * 5 +
            tokenOverlapScore(record.venue, combined, {
              minLength: 4,
              ignored: ["venue", "arena", "stadium", "center", "theater", "theatre", "park", "lot"],
            }) * 6 +
            (normalizeText(combined).includes(normalizeText(parseCity(record.city_state))) ? 8 : 0),
        };
      })
      .filter((candidate) => candidate.match_score >= 24 && hasStrongParkingSignal(`${candidate.text} ${candidate.href}`))
      .sort((left, right) => right.match_score - left.match_score)
      .slice(0, 8);

    for (const candidate of topLinks) {
      if (seenCandidateUrls.has(candidate.href)) {
        continue;
      }

      seenCandidateUrls.add(candidate.href);
      const candidateDocument = await fetchStubhubPage(candidate.href).catch(() => null);
      if (!candidateDocument) {
        continue;
      }

      aiFallbackExcerpts.push(buildAiFallbackExcerpt(`candidate link ${candidateDocument.url || candidate.href}`, candidateDocument.html));

      const parsed = parseEventDocument(candidateDocument, record, candidateDocument.url || candidate.href);
      if (["validated", "scheduled_time_not_found"].includes(parsed.status)) {
        return parsed;
      }
    }
  }

  const directVenueResult = await resolveViaDirectVenueSearch(record);
  if (directVenueResult) {
    return directVenueResult;
  }

  const performerCityResult = await resolveViaPerformerCitySearch(record);
  if (performerCityResult) {
    return performerCityResult;
  }

  const aiFallbackResult = await resolveViaOpenAiFallback(
    record,
    aiFallbackExcerpts.filter(Boolean).slice(0, 8),
  ).catch(() => null);
  if (aiFallbackResult) {
    return aiFallbackResult;
  }

  return {
    status: "missing_on_stubhub",
    source_url: `${STUBHUB_BASE_URL}/secure/search/?q=${encodeURIComponent(searchQueries[0] || record.event || "")}`,
    match_score: 0,
    event_status: "missing_on_stubhub",
    resolved_event_time: null,
    resolution_notes: ["StubHub live web lookup could not find a matching event page for this record."],
  };
}

async function resolveEventTimesViaStubhubWeb(records) {
  const groupedRecords = new Map();
  records.forEach((record, index) => {
    const key = buildRecordValidationKey(record);
    if (!groupedRecords.has(key)) {
      groupedRecords.set(key, []);
    }

    groupedRecords.get(key).push({ record, index });
  });

  const groupedEntries = Array.from(groupedRecords.values());
  const groupedResults = new Map();

  for (const [groupIndex, groupedEntry] of groupedEntries.entries()) {
    const { record } = groupedEntry[0];
    const duplicateCount = groupedEntry.length;
    console.log(
      `StubHub validation ${groupIndex + 1}/${groupedEntries.length} -> ${record.event} | ${record.venue} | ${record.event_date}${duplicateCount > 1 ? ` | group ${duplicateCount}` : ""}`,
    );
    let result = null;
    for (let attempt = 1; attempt <= STUBHUB_LOOKUP_RETRIES; attempt += 1) {
      result = await resolveRecordViaStubhubWeb(record).catch((error) => ({
        status: "lookup_error",
        source_url: buildStubhubEventUrl(record.event_id),
        match_score: 0,
        event_status: "unverified",
        resolved_event_time: null,
        resolution_notes: [`StubHub live web lookup failed: ${error.message}`],
      }));

      if (result.status === "validated") {
        break;
      }

      if (result.status != "lookup_error" || attempt >= STUBHUB_LOOKUP_RETRIES) {
        break;
      }

      console.log(
        `StubHub retry ${attempt + 1}/${STUBHUB_LOOKUP_RETRIES} -> ${record.event} | ${record.venue} | ${record.event_date}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    const resolvedEventIdLabel = String(result.resolved_stubhub_event_id || "").trim();
    const resolutionLabel =
      result.status === "validated"
        ? `Event ID ${resolvedEventIdLabel || "missing"} | ${result.event_status}${result.resolved_event_time ? ` @ ${result.resolved_event_time}` : ""}`
        : `${result.status}${resolvedEventIdLabel ? ` | Event ID ${resolvedEventIdLabel}` : ""}`;
    console.log(`StubHub result ${groupIndex + 1}/${groupedEntries.length} -> ${resolutionLabel}`);
    groupedResults.set(buildRecordValidationKey(record), result);
  }

  return records.map((record) => groupedResults.get(buildRecordValidationKey(record)) || ({
    status: "lookup_error",
    source_url: buildStubhubEventUrl(record.event_id),
    match_score: 0,
    event_status: "unverified",
    resolved_event_time: null,
    resolution_notes: ["StubHub live web lookup grouping returned no result for this record."],
  }));
}

module.exports = { resolveEventTimesViaStubhubWeb, buildStubhubEventUrl };
