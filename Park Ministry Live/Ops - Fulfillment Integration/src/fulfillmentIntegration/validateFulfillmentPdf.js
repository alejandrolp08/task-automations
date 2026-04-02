const path = require("path");

const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const MIN_DIRECT_TEXT_LENGTH = 120;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeIdentifier(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

function isLikelyLowQualityPdfText(value) {
  const raw = String(value || "");

  if (!raw.trim()) {
    return true;
  }

  const weirdMarkerCount = (raw.match(/i255/gi) || []).length;
  const slashDigitBurstCount = (raw.match(/(?:\/[0-9]{1,3}){12,}/g) || []).length;
  const alphaChars = (raw.match(/[A-Za-z]/g) || []).length;
  const digitChars = (raw.match(/[0-9]/g) || []).length;
  const visibleChars = raw.replace(/\s+/g, "");
  const alphaRatio = visibleChars.length ? alphaChars / visibleChars.length : 0;
  const digitHeavyRatio = visibleChars.length ? digitChars / visibleChars.length : 0;

  return (
    weirdMarkerCount >= 2 ||
    slashDigitBurstCount >= 1 ||
    alphaRatio < 0.25 ||
    digitHeavyRatio > 0.45
  );
}

function expandAddressAbbreviations(value) {
  return String(value || "")
    .replace(/\bst\b/gi, "street")
    .replace(/\bave\b/gi, "avenue")
    .replace(/\bblvd\b/gi, "boulevard")
    .replace(/\brd\b/gi, "road")
    .replace(/\bdr\b/gi, "drive")
    .replace(/\bln\b/gi, "lane")
    .replace(/\bpkwy\b/gi, "parkway")
    .replace(/\bhwy\b/gi, "highway")
    .replace(/\bctr\b/gi, "center")
    .replace(/\bste\b/gi, "suite");
}

function parseFullEventInfo(fullEventInfo) {
  const parts = String(fullEventInfo || "")
    .split("|")
    .map((part) => normalizeWhitespace(part));

  return {
    performer: parts[0] || "",
    venue: parts[1] || "",
    parkingLocation: parts[2] || "",
    date: parts[3] || "",
    time: parts[4] || "",
    buyCost: parts[5] || "",
    sellPrice: parts[6] || "",
  };
}

function buildDateTokens(eventDate) {
  const normalized = String(eventDate || "").trim();

  if (!normalized) {
    return [];
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return [normalized];
  }

  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const monthIndex = parsed.getUTCMonth();
  const day = parsed.getUTCDate();
  const paddedMonth = String(month).padStart(2, "0");
  const paddedDay = String(day).padStart(2, "0");
  const monthShort = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][monthIndex];
  const monthLong = [
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
  ][monthIndex];
  const weekdayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parsed.getUTCDay()];
  const weekdayLong = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][parsed.getUTCDay()];

  return Array.from(
    new Set([
    `${year}-${paddedMonth}-${paddedDay}`,
    `${month}/${day}/${year}`,
    `${paddedMonth}/${paddedDay}/${year}`,
    `${month}-${day}-${year}`,
    `${paddedMonth}-${paddedDay}-${year}`,
    `${month}/${day}/${String(year).slice(-2)}`,
    `${paddedMonth}/${paddedDay}/${String(year).slice(-2)}`,
    `${monthShort} ${day}, ${year}`,
    `${monthLong} ${day}, ${year}`,
    `${monthShort} ${paddedDay}, ${year}`,
    `${monthLong} ${paddedDay}, ${year}`,
    `${monthShort} ${day}`,
    `${monthLong} ${day}`,
    `${monthShort} ${paddedDay}`,
    `${monthLong} ${paddedDay}`,
    `${weekdayShort}, ${monthShort} ${day}, ${year}`,
    `${weekdayShort}, ${monthLong} ${day}, ${year}`,
    `${weekdayLong}, ${monthShort} ${day}, ${year}`,
    `${weekdayLong}, ${monthLong} ${day}, ${year}`,
    `${weekdayShort}, ${monthShort} ${day}`,
    `${weekdayShort}, ${monthLong} ${day}`,
    `${weekdayLong}, ${monthShort} ${day}`,
    `${weekdayLong}, ${monthLong} ${day}`,
    `${weekdayShort} ${monthShort} ${day}, ${year}`,
    `${weekdayShort} ${monthLong} ${day}, ${year}`,
    `${weekdayLong} ${monthShort} ${day}, ${year}`,
    `${weekdayLong} ${monthLong} ${day}, ${year}`,
    `${weekdayShort} ${monthShort} ${day}`,
    `${weekdayShort} ${monthLong} ${day}`,
    `${weekdayLong} ${monthShort} ${day}`,
    `${weekdayLong} ${monthLong} ${day}`,
    `${weekdayShort}, ${monthShort} ${paddedDay}`,
    `${weekdayShort}, ${monthLong} ${paddedDay}`,
    `${weekdayLong}, ${monthShort} ${paddedDay}`,
    `${weekdayLong}, ${monthLong} ${paddedDay}`,
    `${weekdayShort} ${monthShort} ${paddedDay}`,
    `${weekdayShort} ${monthLong} ${paddedDay}`,
    `${weekdayLong} ${monthShort} ${paddedDay}`,
    `${weekdayLong} ${monthLong} ${paddedDay}`,
    `PARK AFTER ${monthShort} ${day}`,
    `PARK AFTER ${monthLong} ${day}`,
    `ENTER AFTER ${monthShort} ${day}`,
    `ENTER AFTER ${monthLong} ${day}`,
    `CHECK IN ${monthShort} ${day}, ${year}`,
    `CHECK IN ${monthLong} ${day}, ${year}`,
    ]),
  );
}

function buildLocationSignals(location) {
  const raw = normalizeWhitespace(location);
  const normalized = normalizeText(expandAddressAbbreviations(raw));
  const segments = raw
    .split(/\(|\)|,/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  const signals = new Set();

  if (normalized) {
    signals.add(normalized);
  }

  for (const segment of segments) {
    const cleaned = normalizeText(segment);
    if (cleaned && cleaned.length >= 8) {
      signals.add(cleaned);
    }
  }

  const numericStreet = raw.match(/\d{2,5}[^|,()]*/);
  if (numericStreet) {
    const cleaned = normalizeText(expandAddressAbbreviations(numericStreet[0]));
    if (cleaned) {
      signals.add(cleaned);
    }
  }

  return Array.from(signals);
}

function tokenizeLocationSignal(value) {
  const stopWords = new Set([
    "from",
    "miles",
    "mile",
    "stadium",
    "the",
    "and",
  ]);

  return normalizeText(expandAddressAbbreviations(value))
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token.length >= 3 && !stopWords.has(token));
}

function tokensLooselyMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  if (left.length >= 5 && right.length >= 5) {
    const minLength = Math.min(left.length, right.length);
    const prefixLength = Math.max(4, minLength - 1);

    if (left.slice(0, prefixLength) === right.slice(0, prefixLength)) {
      return true;
    }
  }

  return false;
}

function matchesLocationSignal(signal, normalizedPdfText) {
  if (!signal) {
    return false;
  }

  if (normalizedPdfText.includes(signal)) {
    return true;
  }

  const signalTokens = tokenizeLocationSignal(signal);
  const pdfTokens = normalizedPdfText.split(/\s+/).filter(Boolean);

  if (signalTokens.length < 2) {
    return false;
  }

  const matchedTokens = signalTokens.filter(
    (token) =>
      normalizedPdfText.includes(token) ||
      pdfTokens.some((pdfToken) => tokensLooselyMatch(token, pdfToken)),
  );
  const minimumTokensRequired = Math.min(2, signalTokens.length);

  return matchedTokens.length >= minimumTokensRequired;
}

function extractReservationIdsFromPdf(pdfText) {
  const text = normalizeWhitespace(stripDiacritics(pdfText));
  const ids = new Set();
  const patterns = [
    /confirmation\s*#\s*([A-Z0-9-]{5,})/gi,
    /reservation\s*#\s*([A-Z0-9-]{5,})/gi,
    /reservation\s*id\s*[:#]?\s*([A-Z0-9-]{5,})/gi,
    /order\s*#\s*([A-Z0-9-]{5,})/gi,
  ];

  for (const pattern of patterns) {
    let match = null;
    while ((match = pattern.exec(text))) {
      ids.add(String(match[1] || "").trim());
    }
  }

  return Array.from(ids);
}

function detectPdfProviderProfile(pdfText) {
  const normalized = normalizeText(pdfText);

  if (
    normalized.includes("premium parking") ||
    (
      normalized.includes("receipt at p") &&
      normalized.includes("parking details") &&
      normalized.includes("parking number") &&
      normalized.includes("property name")
    )
  ) {
    return {
      key: "premium_parking",
      allowMissingLocation: true,
      requiresReservationIdForAutoPass: true,
    };
  }

  const providerProfiles = [
    {
      key: "rightway_parking",
      patterns: [
        "rightway parking",
        "rightwayparking com",
        "holiday inn philadelphia airport parking",
      ],
    },
    {
      key: "fargo_airport",
      patterns: ["fargo airport", "fargo airport parking"],
    },
    {
      key: "fly_louisville",
      patterns: ["fly louisville", "your qr code for parking reservation"],
    },
    {
      key: "hersheypark",
      patterns: ["hersheypark", "hershey park"],
    },
    {
      key: "premium_parking",
      patterns: ["premium parking"],
    },
    {
      key: "sfa_airport",
      patterns: ["sfa airport"],
    },
  ];

  for (const profile of providerProfiles) {
    if (profile.patterns.some((pattern) => normalized.includes(pattern))) {
      return {
        key: profile.key,
        allowMissingLocation: true,
        requiresReservationIdForAutoPass: true,
      };
    }
  }

  return {
    key: "default",
    allowMissingLocation: false,
    requiresReservationIdForAutoPass: false,
  };
}

function scoreValidation(checks, issues) {
  let score = 0;

  if (checks.event_date.matched_tokens.length > 0) {
    score += 45;
  }

  if (checks.parking_location.matched_signals.length > 0) {
    score += 45;
  }

  if (checks.reservation_id.expected && checks.reservation_id.matched) {
    score += 25;
  }

  if (issues.includes("pdf_text_empty")) {
    score -= 40;
  }

  if (issues.includes("event_date_not_found_in_pdf")) {
    score -= 20;
  }

  if (issues.includes("parking_location_not_found_in_pdf")) {
    score -= 20;
  }

  if (issues.includes("reservation_id_not_found_in_pdf")) {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

async function extractPdfText(pdfPath) {
  const scriptPath = path.join(__dirname, "extractPdfText.py");
  const { stdout } = await execFileAsync("python3", [scriptPath, pdfPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);

  if (!parsed.ok) {
    throw new Error(parsed.message || parsed.error || "PDF text extraction failed.");
  }

  return parsed;
}

async function extractPdfTextWithOcr(pdfPath) {
  const scriptPath = path.join(__dirname, "extractPdfTextOcr.swift");
  const { stdout } = await execFileAsync("swift", [scriptPath, pdfPath], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);

  if (!parsed.ok) {
    throw new Error(parsed.message || parsed.error || "PDF OCR extraction failed.");
  }

  return parsed;
}

async function extractPdfTextWithFallback(pdfPath) {
  const direct = await extractPdfText(pdfPath);
  const directText = normalizeWhitespace(direct?.text || "");
  const directIsLowQuality = isLikelyLowQualityPdfText(directText);

  if (directText.length >= MIN_DIRECT_TEXT_LENGTH && !directIsLowQuality) {
    return {
      ...direct,
      source: "direct_text",
    };
  }

  const ocr = await extractPdfTextWithOcr(pdfPath);
  const ocrText = normalizeWhitespace(ocr?.text || "");

  if (ocrText.length > directText.length || directIsLowQuality) {
    return {
      ...ocr,
      source: "ocr_vision",
    };
  }

  return {
    ...direct,
    source: "direct_text",
  };
}

function validatePdfAgainstRecord(record, pdfTextPayload) {
  const pdfText = normalizeWhitespace(pdfTextPayload?.text || "");
  const normalizedPdfText = normalizeText(pdfText);
  const parsedFullInfo = parseFullEventInfo(record.full_event_info || "");
  const eventDate = String(record.event_date || "").trim();
  const parkingLocation = parsedFullInfo.parkingLocation || record.parking_location || "";
  const reservationId = normalizeWhitespace(record.reservation_id || "");
  const dateTokens = buildDateTokens(eventDate);
  const locationSignals = buildLocationSignals(parkingLocation);
  const pdfReservationIds = extractReservationIdsFromPdf(pdfText);
  const providerProfile = detectPdfProviderProfile(pdfText);

  const matchedDateTokens = dateTokens.filter((token) =>
    normalizedPdfText.includes(normalizeText(token)),
  );
  const matchedLocationSignals = locationSignals.filter((signal) =>
    matchesLocationSignal(signal, normalizedPdfText),
  );
  const normalizedExpectedReservationId = normalizeIdentifier(reservationId);
  const normalizedPdfTextForId = normalizeIdentifier(pdfText);
  const reservationIdMatched =
    Boolean(reservationId) &&
    (
      (normalizedExpectedReservationId &&
        normalizedPdfTextForId.includes(normalizedExpectedReservationId)) ||
      pdfReservationIds.some(
        (candidate) => normalizeIdentifier(candidate) === normalizedExpectedReservationId,
      )
    );

  const issues = [];

  if (!pdfText) {
    issues.push("pdf_text_empty");
  }

  if (dateTokens.length && matchedDateTokens.length === 0) {
    issues.push("event_date_not_found_in_pdf");
  }

  if (locationSignals.length && matchedLocationSignals.length === 0) {
    issues.push("parking_location_not_found_in_pdf");
  }

  if (reservationId && !reservationIdMatched) {
    issues.push("reservation_id_not_found_in_pdf");
  }

  const dateMatched = matchedDateTokens.length > 0;
  const locationMatched = matchedLocationSignals.length > 0;
  const hasExtractedReservationId = pdfReservationIds.length > 0;
  const hasReservationConfidence = reservationIdMatched || hasExtractedReservationId;
  const providerLocationException =
    providerProfile.allowMissingLocation &&
    dateMatched &&
    !locationMatched &&
    hasReservationConfidence;

  const normalizedIssues = providerLocationException
    ? issues.filter((issue) => issue !== "parking_location_not_found_in_pdf")
    : issues;

  const checks = {
    event_date: {
      expected: eventDate,
      matched_tokens: matchedDateTokens,
    },
    parking_location: {
      expected: parkingLocation,
      matched_signals: matchedLocationSignals,
    },
    reservation_id: {
      expected: reservationId,
      matched: reservationIdMatched,
      extracted_candidates: pdfReservationIds,
    },
    provider_profile: {
      key: providerProfile.key,
      allow_missing_location: providerProfile.allowMissingLocation,
    },
  };
  const score = scoreValidation(checks, normalizedIssues);
  const hasCriticalMismatch =
    normalizedIssues.includes("event_date_not_found_in_pdf") ||
    normalizedIssues.includes("parking_location_not_found_in_pdf");

  if (providerLocationException) {
    const hasExpectedReservationId = Boolean(reservationId);
    const canAutoPass =
      providerProfile.key === "rightway_parking"
        ? true
        : hasExpectedReservationId && reservationIdMatched;

    return {
      ok: canAutoPass,
      status: canAutoPass ? "pass_provider_exception" : "review_provider_exception",
      classification: canAutoPass ? "pass_provider_exception" : "review_provider_exception",
      score: canAutoPass ? Math.max(score, 85) : Math.max(score, 70),
      issues: normalizedIssues,
      checks,
      provider_exception: {
        key: `${providerProfile.key}_missing_location`,
        reason: "provider_pdf_does_not_reliably_include_parking_address",
      },
      pdf_text_preview: pdfText.slice(0, 1500),
    };
  }

  if (normalizedIssues.includes("event_date_not_found_in_pdf")) {
    return {
      ok: false,
      status: "fail_date_mismatch",
      classification: "fail_date_mismatch",
      score,
      issues: normalizedIssues,
      checks,
      pdf_text_preview: pdfText.slice(0, 1500),
    };
  }

  if (normalizedIssues.includes("parking_location_not_found_in_pdf")) {
    return {
      ok: false,
      status: "review_location_mismatch",
      classification: "review_location_mismatch",
      score: Math.max(score, 45),
      issues: normalizedIssues,
      checks,
      pdf_text_preview: pdfText.slice(0, 1500),
    };
  }

  return {
    ok: score >= 70 && !hasCriticalMismatch,
    status: score >= 70 && !hasCriticalMismatch ? "pass_auto" : score >= 40 ? "review" : "fail",
    classification:
      score >= 70 && !hasCriticalMismatch ? "pass_auto" : score >= 40 ? "review" : "fail",
    score,
    issues: normalizedIssues,
    checks,
    pdf_text_preview: pdfText.slice(0, 1500),
  };
}

module.exports = {
  extractPdfText,
  extractPdfTextWithFallback,
  parseFullEventInfo,
  validatePdfAgainstRecord,
};
