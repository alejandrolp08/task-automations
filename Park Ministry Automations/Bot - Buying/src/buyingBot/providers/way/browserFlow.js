const { getWayConfig, buildReservationUrl } = require("./config");
const { normalizeWaySearchLocation } = require("./normalizeLocation");
const { WAY_SELECTORS } = require("./selectors");
const { getBuyingBotOperativePaths } = require("../../../../../Workspace/operativePaths");

const WAY_DEBUG = ["1", "true", "yes"].includes(String(process.env.WAY_DEBUG || "").trim().toLowerCase());
const WAY_CAPTURE_TRACE_ARTIFACTS = WAY_DEBUG || ["1", "true", "yes"].includes(String(process.env.WAY_CAPTURE_TRACE_ARTIFACTS || "").trim().toLowerCase());

function logWayDebug(message) {
  if (WAY_DEBUG) {
    console.log(message);
  }
}

function requirePlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    throw new Error(
      'Playwright is not installed yet. Run "npm install" in the project before executing Way checkout automation.',
    );
  }
}

function to12HourTime(time24) {
  if (!time24 || !/^\d{2}:\d{2}$/.test(time24)) {
    return "";
  }

  const [rawHours, minutes] = time24.split(":").map(Number);
  const suffix = rawHours >= 12 ? "PM" : "AM";
  const hours = rawHours % 12 || 12;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function parse12HourTime(timeText) {
  const match = String(timeText).match(/^(\d{2}):(\d{2})\s(AM|PM)$/);
  if (!match) {
    return null;
  }

  const [, hhText, mmText, suffix] = match;
  let hours = Number(hhText) % 12;
  if (suffix === "PM") {
    hours += 12;
  }

  return hours * 60 + Number(mmText);
}

function getQuarterHourIndex(timeText) {
  const minutes = parse12HourTime(timeText);
  if (minutes === null) {
    return null;
  }

  return Math.round(minutes / 15);
}

function floorToQuarterHour(time24) {
  if (!time24 || !/^\d{2}:\d{2}$/.test(time24)) {
    return time24 || "";
  }

  const [hours, minutes] = time24.split(":").map(Number);
  const flooredMinutes = Math.floor((hours * 60 + minutes) / 15) * 15;
  const hh = Math.floor(flooredMinutes / 60) % 24;
  const mm = flooredMinutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function shiftIsoDate(dateString, dayOffset) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return shifted.toISOString().slice(0, 10);
}

function buildCheckoutWindow(eventDate, resolvedEventTime, options = {}) {
  if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new Error("Way checkout requires a valid event date in YYYY-MM-DD format.");
  }

  if (options.absoluteStart && options.absoluteEnd) {
    const absoluteStart = floorToQuarterHour(String(options.absoluteStart).trim());
    const absoluteEnd = floorToQuarterHour(String(options.absoluteEnd).trim());
    if (!/^\d{2}:\d{2}$/.test(absoluteStart) || !/^\d{2}:\d{2}$/.test(absoluteEnd)) {
      throw new Error("Way checkout absolute windows require HH:MM start and end times.");
    }

    const endDayOffset = Number.isFinite(Number(options.endDayOffset)) ? Number(options.endDayOffset) : 0;
    return {
      beforeMinutes: null,
      afterMinutes: null,
      startDate: eventDate,
      endDate: shiftIsoDate(eventDate, endDayOffset),
      start24: absoluteStart,
      end24: absoluteEnd,
      startDisplay: to12HourTime(absoluteStart),
      endDisplay: to12HourTime(absoluteEnd),
    };
  }

  if (!resolvedEventTime || !/^\d{2}:\d{2}$/.test(resolvedEventTime)) {
    throw new Error("Way checkout requires a resolved event time in HH:MM format.");
  }

  const beforeMinutes = Number.isFinite(Number(options.beforeMinutes)) ? Number(options.beforeMinutes) : 60;
  const afterMinutes = Number.isFinite(Number(options.afterMinutes)) ? Number(options.afterMinutes) : 300;
  const [hours, minutes] = resolvedEventTime.split(":").map(Number);
  const baseMinutes = hours * 60 + minutes;
  const startMinutes = baseMinutes - beforeMinutes;
  const endMinutes = baseMinutes + afterMinutes;

  function format(totalMinutes) {
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hh = Math.floor(normalized / 60);
    const mm = normalized % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  const roundedStart = floorToQuarterHour(format(startMinutes));
  const roundedEnd = floorToQuarterHour(format(endMinutes));

  return {
    beforeMinutes,
    afterMinutes,
    startDate: shiftIsoDate(eventDate, startMinutes < 0 ? -1 : 0),
    endDate: shiftIsoDate(eventDate, endMinutes >= 1440 ? 1 : 0),
    start24: roundedStart,
    end24: roundedEnd,
    startDisplay: to12HourTime(roundedStart),
    endDisplay: to12HourTime(roundedEnd),
  };
}

function getDayOfMonth(dateString) {
  const day = Number(String(dateString).split("-")[2]);
  return String(day);
}

function buildDayOfMonthRegex(dateString) {
  const day = Number(String(dateString).split("-")[2]);
  return new RegExp(`\\b0?${day}\\b`);
}

function getCalendarCellPosition(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  const firstDayWeekday = new Date(year, month - 1, 1).getDay();
  const zeroBasedIndex = firstDayWeekday + (day - 1);

  return {
    row: Math.floor(zeroBasedIndex / 7),
    column: zeroBasedIndex % 7,
  };
}

function getMonthYearLabel(dateString) {
  const [year, month] = String(dateString).split("-").map(Number);
  const monthNames = [
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

  return `${monthNames[month - 1]} ${year}`;
}

function getMonthShortLabel(dateString) {
  return getMonthYearLabel(dateString).slice(0, 3);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSuggestionTextPattern(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const escapedTokens = normalized
    .split(" ")
    .filter(Boolean)
    .map((token) => escapeRegExp(token));

  if (!escapedTokens.length) {
    return null;
  }

  return new RegExp(escapedTokens.join("\\s+"), "i");
}

function normalizeAddressText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\bave\b/g, " avenue ")
    .replace(/\bav\b/g, " avenue ")
    .replace(/\bst\b/g, " street ")
    .replace(/\brd\b/g, " road ")
    .replace(/\bdr\b/g, " drive ")
    .replace(/\bblvd\b/g, " boulevard ")
    .replace(/\bct\b/g, " court ")
    .replace(/\bln\b/g, " lane ")
    .replace(/\bpl\b/g, " place ")
    .replace(/\bpkwy\b/g, " parkway ")
    .replace(/\bpky\b/g, " parkway ")
    .replace(/\bhwy\b/g, " highway ")
    .replace(/\bn\b/g, " north ")
    .replace(/\bs\b/g, " south ")
    .replace(/\be\b/g, " east ")
    .replace(/\bw\b/g, " west ")
    .replace(/\bne\b/g, " northeast ")
    .replace(/\bnw\b/g, " northwest ")
    .replace(/\bse\b/g, " southeast ")
    .replace(/\bsw\b/g, " southwest ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFlexibleDayPattern(dateString) {
  const day = Number(String(dateString).split("-")[2]);
  return `0?${day}`;
}

function normalizeResultText(value) {
  return normalizeAddressText(value).replace(/\b(parking|hourly|daily|outdoor|indoor|self park|self|park|soldout|reserve now|more details)\b/g, " ").replace(/\s+/g, " ").trim();
}

function tokenOverlapCount(expected, actual, minLength = 3) {
  const expectedTokens = normalizeAddressText(expected)
    .split(" ")
    .filter((token) => token.length >= minLength);
  const actualTokenSet = new Set(
    normalizeAddressText(actual)
      .split(" ")
      .filter((token) => token.length >= minLength),
  );

  let count = 0;
  for (const token of expectedTokens) {
    if (actualTokenSet.has(token)) {
      count += 1;
    }
  }

  return count;
}

async function clearWayCartState(page) {
  const result = await page
    .evaluate(() => {
      const normalizedText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const clickableNodes = Array.from(document.querySelectorAll("button, a"))
        .filter((node) => isVisible(node))
        .map((node) => ({
          node,
          text: normalizedText(node.textContent || ""),
        }));

      let removed = 0;
      for (const entry of clickableNodes.filter((item) => /^Remove$/i.test(item.text)).slice(0, 5)) {
        entry.node.click();
        removed += 1;
      }

      const closeNode = clickableNodes.find((item) => /^Close$/i.test(item.text));
      if (closeNode) {
        closeNode.node.click();
      }

      return {
        removed,
        hadOrderSummary:
          /Order Summary/i.test(normalizedText(document.body.innerText || "")) ||
          /Proceed to Checkout/i.test(normalizedText(document.body.innerText || "")),
      };
    })
    .catch(() => ({ removed: 0, hadOrderSummary: false }));

  if (result.removed > 0) {
    await page.waitForTimeout(1200);
  }

  return result;
}

function getVisibleTimeStringsFromContainerDom(container) {
  const containerRect = container.getBoundingClientRect();
  const timePattern = /^\d{2}:\d{2}\s(?:AM|PM)$/i;

  const candidates = Array.from(container.querySelectorAll("*"))
    .map((node) => {
      if (!(node instanceof Element)) {
        return null;
      }

      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!timePattern.test(text)) {
        return null;
      }

      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0 &&
        rect.top >= containerRect.top - 2 &&
        rect.bottom <= containerRect.bottom + 2;

      if (!visible) {
        return null;
      }

      return {
        text,
        top: rect.top,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.top - right.top);

  return Array.from(new Set(candidates.map((candidate) => candidate.text)));
}

function getAddressSelectionHints(locationQuery) {
  const segments = String(locationQuery)
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const [primarySegment, ...localitySegments] = segments;
  const normalizedPrimary = normalizeAddressText(primarySegment);
  const tokens = normalizedPrimary.split(" ").filter(Boolean);
  const streetNumber = tokens.find((token) => /^\d+$/.test(token)) || "";
  const normalizedLocality = normalizeAddressText(localitySegments.join(" "));
  const localityTokens = normalizedLocality
    .split(" ")
    .filter((token) => token.length >= 2);

  return {
    normalizedPrimary,
    tokens,
    streetNumber,
    normalizedLocality,
    localityTokens,
  };
}

function hasExactPrimaryAddressMatch(normalizedSuggestion, hints) {
  if (!normalizedSuggestion || !hints?.normalizedPrimary) {
    return false;
  }

  if (!normalizedSuggestion.includes(hints.normalizedPrimary)) {
    return false;
  }

  if (hints.streetNumber && !normalizedSuggestion.includes(hints.streetNumber)) {
    return false;
  }

  return true;
}

function scoreSuggestionText(suggestionText, hints) {
  const normalizedSuggestion = normalizeAddressText(suggestionText);
  const hasExactPrimaryMatch = hasExactPrimaryAddressMatch(normalizedSuggestion, hints);
  let score = 0;
  const businessTerms = [
    "hotel",
    "suites",
    "inn",
    "comfort",
    "by ihg",
    "motel",
    "resort",
    "parking garage",
    "airport",
    "park ride",
    "phl",
  ];

  if (hints.streetNumber && normalizedSuggestion.includes(hints.streetNumber)) {
    score += 10;
  }

  if (hints.normalizedPrimary && normalizedSuggestion.startsWith(hints.normalizedPrimary)) {
    score += 25;
  }

  for (const token of hints.tokens) {
    if (token.length >= 3 && normalizedSuggestion.includes(token)) {
      score += 2;
    }
  }

  if (hasExactPrimaryMatch) {
    score += 18;
  } else if (hints.normalizedPrimary && normalizedSuggestion.includes(hints.normalizedPrimary)) {
    score += 8;
  }

  if (hints.normalizedLocality && normalizedSuggestion.includes(hints.normalizedLocality)) {
    score += 20;
  }

  for (const token of hints.localityTokens || []) {
    if (normalizedSuggestion.includes(token)) {
      score += token.length <= 2 ? 4 : 3;
    }
  }

  if (
    businessTerms.some((term) => normalizedSuggestion.includes(term)) &&
    !hasExactPrimaryMatch &&
    !(hints.normalizedPrimary && normalizedSuggestion.startsWith(hints.normalizedPrimary))
  ) {
    score -= 20;
  }

  return score;
}

function scoreLotMatch(resultText, hints) {
  const normalizedResult = normalizeResultText(resultText);
  let score = 0;

  if (hints.streetNumber && normalizedResult.includes(hints.streetNumber)) {
    score += 14;
  }

  if (hints.normalizedPrimary && normalizedResult.includes(hints.normalizedPrimary)) {
    score += 18;
  }

  for (const token of hints.tokens) {
    if (token.length >= 3 && normalizedResult.includes(token)) {
      score += 3;
    }
  }

  return score;
}

function scoreAliasMatch(resultText, aliases = []) {
  const normalizedResult = normalizeResultText(resultText);
  let bestScore = 0;

  for (const alias of aliases) {
    const normalizedAlias = normalizeResultText(alias);
    if (!normalizedAlias) {
      continue;
    }

    let score = 0;
    if (normalizedResult.includes(normalizedAlias)) {
      score += 30;
    }
    score += tokenOverlapCount(normalizedAlias, normalizedResult, 3) * 4;
    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

function hasExactAliasMatch(resultText, aliases = []) {
  const normalizedResult = normalizeResultText(resultText);
  if (!normalizedResult) {
    return false;
  }

  return aliases.some((alias) => {
    const normalizedAlias = normalizeResultText(alias);
    return Boolean(normalizedAlias) && normalizedResult.includes(normalizedAlias);
  });
}

function monthLabelToIndex(label) {
  const match = String(label).match(/^([A-Z][a-z]+)\s+(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, monthName, yearText] = match;
  const monthNames = [
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
  const monthIndex = monthNames.indexOf(monthName);
  if (monthIndex === -1) {
    return null;
  }

  return Number(yearText) * 12 + monthIndex;
}

function extractCalendarMonthLabel(value) {
  const match = String(value || "")
    .replace(/\s+/g, " ")
    .match(/([A-Z][a-z]+\s+20\d{2})/);
  return match ? match[1] : "";
}

async function logVisibleCalendarText(page) {
  const calendarText = await page
    .locator("body")
    .evaluate((body) => body.innerText || "")
    .catch(() => "");

  const snippets = String(calendarText)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line)
    .filter((line) => /^\d{1,2}$/.test(line) || /^[A-Z][a-z]+\s+20\d{2}$/.test(line))
    .slice(0, 80);

  logWayDebug(`Way search debug: visible calendar tokens -> ${snippets.join(" | ")}`);
}

async function logPickerDomSummary(page) {
  const summary = await page
    .locator("body")
    .evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"))
        .map((node) => ({
          type: node.getAttribute("type") || "",
          name: node.getAttribute("name") || "",
          placeholder: node.getAttribute("placeholder") || "",
          value: node.value || "",
          aria: node.getAttribute("aria-label") || "",
        }))
        .slice(0, 20);

      const scrollables = Array.from(document.querySelectorAll("*"))
        .map((node) => ({
          tag: node.tagName,
          text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          overflowY: window.getComputedStyle(node).overflowY,
        }))
        .filter((node) => node.scrollHeight > node.clientHeight && node.clientHeight > 100)
        .slice(0, 15);

      return { inputs, scrollables };
    })
    .catch(() => ({ inputs: [], scrollables: [] }));

  logWayDebug(`Way search debug: inputs -> ${JSON.stringify(summary.inputs)}`);
  logWayDebug(`Way search debug: scrollables -> ${JSON.stringify(summary.scrollables)}`);
}

async function clickWidgetSectionByGeometry(page, section) {
  const point = await page
    .evaluate((targetSection) => {
      const labelTextMap = {
        location: "Location",
        checkin: "Check-in",
        checkout: "Checkout",
      };

      const expectedLabel = labelTextMap[targetSection];
      if (!expectedLabel) {
        return null;
      }

      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const labels = Array.from(document.querySelectorAll("*"))
        .filter((node) => isVisible(node))
        .filter((node) => (node.textContent || "").replace(/\s+/g, " ").trim() === expectedLabel)
        .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);

      const labelNode = labels[0];
      if (!labelNode) {
        return null;
      }

      let clickableNode = labelNode;
      for (let depth = 0; depth < 4 && clickableNode?.parentElement; depth += 1) {
        const parent = clickableNode.parentElement;
        if (!isVisible(parent)) {
          break;
        }

        const rect = parent.getBoundingClientRect();
        const text = (parent.textContent || "").replace(/\s+/g, " ").trim();
        if (
          rect.width >= 120 &&
          rect.height >= 40 &&
          rect.width <= window.innerWidth &&
          text.includes(expectedLabel)
        ) {
          clickableNode = parent;
        } else {
          break;
        }
      }

      const rect = clickableNode.getBoundingClientRect();
      const x =
        targetSection === "location"
          ? rect.left + Math.min(140, rect.width * 0.4)
          : rect.left + Math.max(rect.width * 0.55, Math.min(rect.width - 24, 120));
      const y = rect.top + rect.height / 2;

      return {
        x,
        y,
        label: expectedLabel,
        width: rect.width,
        height: rect.height,
      };
    }, section)
    .catch(() => null);

  if (!point) {
    return false;
  }

  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(400);
  return true;
}

async function setWaySearchMode(page, mode) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (!normalizedMode) {
    return { changed: false, mode: "default" };
  }

  const selector =
    normalizedMode === "airport"
      ? WAY_SELECTORS.home.modeAirportButton
      : WAY_SELECTORS.home.modeHourlyDailyButton;

  const result = await page
    .evaluate((targetMode) => {
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const candidates = Array.from(document.querySelectorAll("button, [role='button'], a"))
        .filter((node) => isVisible(node))
        .map((node) => ({
          node,
          text: (node.textContent || "").replace(/\s+/g, " ").trim(),
          className: node.className || "",
          ariaPressed: node.getAttribute("aria-pressed") || "",
        }));

      const label = targetMode === "airport" ? "Airport" : "Hourly/Daily";
      const target = candidates.find((entry) => entry.text === label);
      if (!target) {
        return { found: false, active: false };
      }

      const active =
        /selected|active/i.test(String(target.className || "")) ||
        String(target.ariaPressed || "").toLowerCase() === "true";

      if (!active) {
        target.node.click();
      }

      return { found: true, active };
    }, normalizedMode)
    .catch(() => ({ found: false, active: false }));

  if (result.found) {
    if (!result.active) {
      await page.waitForTimeout(900);
    }
    return { changed: !result.active, mode: normalizedMode };
  }

  const button = page.locator(selector).first();
  const visible = await button.isVisible().catch(() => false);
  if (!visible) {
    return { changed: false, mode: "unavailable" };
  }

  await button.click({ force: true }).catch(() => {});
  await page.waitForTimeout(900);
  return { changed: true, mode: normalizedMode };
}

async function ensureWayResultsMode(page, mode) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (!normalizedMode) {
    return { changed: false, mode: "default" };
  }

  const selector =
    normalizedMode === "airport"
      ? WAY_SELECTORS.home.modeAirportButton
      : WAY_SELECTORS.home.modeHourlyDailyButton;

  const button = page.locator(selector).first();
  const visible = await button.isVisible().catch(() => false);
  if (!visible) {
    return { changed: false, mode: "unavailable" };
  }

  const alreadyOnMode = normalizedMode === "airport"
    ? /\/Airport(?:$|[/?#])/i.test(page.url())
    : /\/Hourly(?:$|[/?#])/i.test(page.url());

  if (!alreadyOnMode) {
    await button.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  return { changed: !alreadyOnMode, mode: normalizedMode };
}

async function getVisibleSearchButtonBox(page) {
  const widgetButtonBox = await page
    .evaluate(() => {
      const getVisibleRect = (node) => {
        if (!(node instanceof Element)) {
          return null;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const visible =
          rect.width > 20 &&
          rect.height > 20 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0;

        return visible ? rect : null;
      };

      const checkoutLabels = Array.from(document.querySelectorAll("*"))
        .filter((node) => (node.textContent || "").replace(/\s+/g, " ").trim() === "Checkout")
        .map((node) => ({ node, rect: getVisibleRect(node) }))
        .filter((entry) => entry.rect)
        .sort((left, right) => left.rect.top - right.rect.top);

      if (!checkoutLabels.length) {
        return null;
      }

      const checkoutRect = checkoutLabels[0].rect;
      const candidates = Array.from(document.querySelectorAll("button, [role='button'], a"))
        .map((node) => {
          const rect = getVisibleRect(node);
          return rect
            ? {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height,
                text: (node.textContent || "").replace(/\s+/g, " ").trim(),
              }
            : null;
        })
        .filter(Boolean)
        .filter(
          (candidate) =>
            candidate.x > checkoutRect.right - 10 &&
            Math.abs(candidate.y + candidate.height / 2 - (checkoutRect.top + checkoutRect.height / 2)) < 90 &&
            candidate.width >= 50 &&
            candidate.height >= 50,
        )
        .sort((left, right) => left.x - right.x);

      return candidates[0] || null;
    })
    .catch(() => null);

  if (widgetButtonBox) {
    return widgetButtonBox;
  }

  const boxes = await page
    .locator(WAY_SELECTORS.home.searchButton)
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          return {
            text,
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            visible:
              rect.width > 20 &&
              rect.height > 20 &&
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              Number(style.opacity || "1") > 0,
          };
        })
        .filter((box) => box.visible),
    )
    .catch(() => []);

  if (!boxes.length) {
    return null;
  }

  return boxes
    .sort((left, right) => {
      if (right.x !== left.x) {
        return right.x - left.x;
      }

      return right.width - left.width;
    })
    .at(0);
}

function getWidgetSectionSampleX(searchButtonBox, section) {
  const offsetMap = {
    location: 760,
    checkin: 500,
    checkout: 240,
  };

  return searchButtonBox.x - offsetMap[section];
}

async function closeOpenCalendarPicker(page) {
  const visible = await page.locator(WAY_SELECTORS.home.calendarRoot).first().isVisible().catch(() => false);
  if (!visible) {
    return false;
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  const stillVisible = await page.locator(WAY_SELECTORS.home.calendarRoot).first().isVisible().catch(() => false);
  if (stillVisible) {
    await page.mouse.click(40, 40);
    await page.waitForTimeout(300);
  }

  const stillVisibleAfterOutsideClick = await page
    .locator(WAY_SELECTORS.home.calendarRoot)
    .first()
    .isVisible()
    .catch(() => false);

  if (stillVisibleAfterOutsideClick) {
    const searchButtonBox = await page.locator(WAY_SELECTORS.home.searchButton).last().boundingBox().catch(() => null);
    if (searchButtonBox) {
      await page.mouse.click(searchButtonBox.x - 220, searchButtonBox.y - 40);
      await page.waitForTimeout(300);
    }
  }

  const finalVisible = await page.locator(WAY_SELECTORS.home.calendarRoot).first().isVisible().catch(() => false);
  return finalVisible;
}

async function waitForCalendarBackdropToClear(page, timeout = 2000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const visibleBackdrop = await page
      .locator(".calender-backdrop")
      .evaluateAll((nodes) =>
        nodes.some((node) => {
          if (!(node instanceof HTMLElement)) {
            return false;
          }

          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0
          );
        }),
      )
      .catch(() => false);

    if (!visibleBackdrop) {
      return true;
    }

    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }

  return false;
}

async function openDateTimePicker(page, sectionSelector) {
  if ([WAY_SELECTORS.home.checkInSection, WAY_SELECTORS.home.checkoutSection].includes(sectionSelector)) {
    await closeOpenCalendarPicker(page);
  }

  if (sectionSelector === WAY_SELECTORS.home.checkInSection) {
    const clickedByGeometry = await clickWidgetSectionByGeometry(page, "checkin");
    if (clickedByGeometry) {
      const geometricCalendarVisible = await page
        .locator(WAY_SELECTORS.home.calendarRoot)
        .first()
        .isVisible()
        .catch(() => false);
      if (geometricCalendarVisible) {
        return;
      }
    }
  }

  if (sectionSelector === WAY_SELECTORS.home.checkoutSection) {
    const clickedByGeometry = await clickWidgetSectionByGeometry(page, "checkout");
    if (clickedByGeometry) {
      const geometricCalendarVisible = await page
        .locator(WAY_SELECTORS.home.calendarRoot)
        .first()
        .isVisible()
        .catch(() => false);
      if (geometricCalendarVisible) {
        return;
      }
    }
  }

  const selectorCandidates =
    sectionSelector === WAY_SELECTORS.home.checkoutSection
      ? [sectionSelector, "text=Checkout", "text=Select date & time"]
      : [sectionSelector, "text=Check-in"];

  for (const candidate of selectorCandidates) {
    const locator = page.locator(candidate).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    await locator.click();
    await page.waitForTimeout(400);
    const calendarVisible = await page.locator(WAY_SELECTORS.home.calendarRoot).first().isVisible().catch(() => false);
    if (calendarVisible) {
      return;
    }
  }

  if (sectionSelector === WAY_SELECTORS.home.checkoutSection) {
    const searchButtonBox = await page.locator(WAY_SELECTORS.home.searchButton).last().boundingBox().catch(() => null);
    if (searchButtonBox) {
      const candidateOffsets = [320, 260, 220];
      for (const offset of candidateOffsets) {
        await page.mouse.click(searchButtonBox.x - offset, searchButtonBox.y + searchButtonBox.height / 2);
        await page.waitForTimeout(350);
        const calendarVisible = await page.locator(WAY_SELECTORS.home.calendarRoot).first().isVisible().catch(() => false);
        if (calendarVisible) {
          return;
        }
      }

      await page.keyboard.press("Tab").catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(400);
      const keyboardCalendarVisible = await page
        .locator(WAY_SELECTORS.home.calendarRoot)
        .first()
        .isVisible()
        .catch(() => false);
      if (keyboardCalendarVisible) {
        return;
      }
    }
  }

  throw new Error(`Way date picker did not open for selector: ${sectionSelector}`);
}

async function navigateCalendarToMonth(page, recordDate) {
  const targetLabel = getMonthYearLabel(recordDate);
  const targetIndex = monthLabelToIndex(targetLabel);
  const calendarRoot = page.locator(WAY_SELECTORS.home.calendarRoot).first();

  const readCurrentMonthLabel = async () =>
    extractCalendarMonthLabel(
      await calendarRoot.textContent().catch(() => ""),
    );

  const tryKeyboardMonthShift = async (goNext) => {
    await calendarRoot.click({ force: true }).catch(() => {});
    await page.keyboard.press(goNext ? "PageDown" : "PageUp").catch(() => {});
    await page.waitForTimeout(350);
  };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const currentLabel = await readCurrentMonthLabel();
    if (currentLabel === targetLabel) {
      return;
    }

    const currentIndex = monthLabelToIndex(currentLabel);
    if (currentIndex === null || targetIndex === null) {
      break;
    }

    const directionSelector =
      currentIndex < targetIndex ? WAY_SELECTORS.home.calendarNextButton : WAY_SELECTORS.home.calendarPrevButton;

    const directionLocator = calendarRoot.locator(directionSelector).first();
    const directionVisible = await directionLocator.isVisible().catch(() => false);
    const goNext = currentIndex < targetIndex;
    let monthChanged = false;

    if (directionVisible) {
      await directionLocator.click({ force: true }).catch(() => {});
      await page.waitForTimeout(350);
      monthChanged = (await readCurrentMonthLabel()) !== currentLabel;
    } else {
      const fallbackResult = await page
        .evaluate((direction) => {
          const root = Array.from(document.querySelectorAll(".clboxx"))
            .filter((node) => {
              if (!(node instanceof HTMLElement)) {
                return false;
              }
              const rect = node.getBoundingClientRect();
              const style = window.getComputedStyle(node);
              return (
                rect.width > 220 &&
                rect.height > 220 &&
                style.visibility !== "hidden" &&
                style.display !== "none"
              );
            })
            .sort((left, right) => {
              const leftRect = left.getBoundingClientRect();
              const rightRect = right.getBoundingClientRect();
              return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
            })[0];

          if (!(root instanceof HTMLElement)) {
            return { status: "root_not_found" };
          }

          const directArrowSelector = direction.goNext
            ? ".picker-navigate-right-arrow"
            : ".picker-navigate-left-arrow";
          const directArrow = root.querySelector(directArrowSelector);
          if (directArrow instanceof HTMLElement) {
            directArrow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
            directArrow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
            directArrow.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
            directArrow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            return {
              status: "clicked_direct_arrow",
              text: (directArrow.textContent || "").replace(/\s+/g, " ").trim(),
            };
          }

          const rootRect = root.getBoundingClientRect();
          const clickableCandidates = Array.from(root.querySelectorAll("button, [role='button'], span, div"))
            .filter((node) => node instanceof HTMLElement)
            .map((node) => {
              const text = (node.textContent || "").replace(/\s+/g, " ").trim();
              const rect = node.getBoundingClientRect();
              return { node, text, rect };
            })
            .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0)
            .filter((entry) => entry.rect.top <= rootRect.top + 70);

          const arrowCandidate = clickableCandidates
            .filter((entry) => {
              const compactText = entry.text.replace(/\s+/g, "");
              if (direction.goNext) {
                return compactText === ">" || compactText.endsWith(">") || compactText === "›";
              }

              return compactText === "<" || compactText.startsWith("<") || compactText === "‹";
            })
            .sort((left, right) => {
              if (direction.goNext) {
                return right.rect.left - left.rect.left;
              }
              return left.rect.left - right.rect.left;
            })[0];

          if (arrowCandidate?.node instanceof HTMLElement) {
            arrowCandidate.node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
            arrowCandidate.node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
            arrowCandidate.node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
            arrowCandidate.node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

            return {
              status: "clicked_arrow_candidate",
              text: arrowCandidate.text,
            };
          }

          return {
            status: "clicked_root_edge_fallback",
            x: direction.goNext ? rootRect.right - direction.xOffset : rootRect.left + direction.xOffset,
            y: rootRect.top + direction.yOffset,
          };
        }, { goNext, xOffset: 18, yOffset: 26 })
        .catch((error) => ({ status: "evaluate_failed", error: error.message || "unknown_calendar_nav_error" }));

      if (["clicked_root_edge_fallback"].includes(fallbackResult.status)) {
        await page.mouse.click(fallbackResult.x, fallbackResult.y).catch(() => {});
        await page.waitForTimeout(350);
        monthChanged = (await readCurrentMonthLabel()) !== currentLabel;
      } else if (
        ["root_not_found", "click_target_not_found", "evaluate_failed"].includes(fallbackResult.status)
      ) {
        throw new Error(`Way calendar navigation controls were not found for month: ${currentLabel || "unknown"}`);
      } else {
        await page.waitForTimeout(350);
        monthChanged = (await readCurrentMonthLabel()) !== currentLabel;
      }
    }

    if (!monthChanged) {
      const edgeClickOffsets = [30, 48, 64];
      for (const xOffset of edgeClickOffsets) {
        const edgeClickResult = await page
          .evaluate((direction) => {
            const root = document.querySelector(".clboxx");
            if (!(root instanceof HTMLElement)) {
              return null;
            }
            const rect = root.getBoundingClientRect();
            return {
              x: direction.goNext ? rect.right - direction.xOffset : rect.left + direction.xOffset,
              y: rect.top + direction.yOffset,
            };
          }, { goNext, xOffset, yOffset: 24 })
          .catch(() => null);

        if (edgeClickResult?.x && edgeClickResult?.y) {
          await page.mouse.click(edgeClickResult.x, edgeClickResult.y).catch(() => {});
          await page.waitForTimeout(350);
          monthChanged = (await readCurrentMonthLabel()) !== currentLabel;
          if (monthChanged) {
            break;
          }
        }
      }
    }

    if (!monthChanged) {
      await tryKeyboardMonthShift(goNext);
      monthChanged = (await readCurrentMonthLabel()) !== currentLabel;
    }
  }

  const finalLabel = await readCurrentMonthLabel();
  if (finalLabel !== targetLabel) {
    throw new Error(`Way calendar could not navigate to target month: ${targetLabel} (current: ${finalLabel || "unknown"})`);
  }
}

async function clickCalendarDayByPosition(page, recordDate) {
  const dayText = getDayOfMonth(recordDate);
  const monthLabelText = getMonthYearLabel(recordDate);
  const clickResult = await page
    .evaluate(({ targetDay, targetMonthLabel, recordDateValue }) => {
      const targetPosition = (() => {
        const [year, month, day] = String(recordDateValue).split("-").map(Number);
        const firstDayWeekday = new Date(year, month - 1, 1).getDay();
        const zeroBasedIndex = firstDayWeekday + (day - 1);
        return {
          row: Math.floor(zeroBasedIndex / 7),
          column: zeroBasedIndex % 7,
        };
      })();

      const calendarRoot = Array.from(document.querySelectorAll(".clboxx, *"))
        .filter((node) => {
          if (!(node instanceof HTMLElement)) {
            return false;
          }

          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          if (text.indexOf(targetMonthLabel) === -1) {
            return false;
          }

          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const className = typeof node.className === "string" ? node.className : "";
          return (
            rect.width > 220 &&
            rect.height > 220 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            (className.includes("clboxx") || text.includes(targetMonthLabel))
          );
        })
        .sort((left, right) => {
          const leftClass = typeof left.className === "string" ? left.className : "";
          const rightClass = typeof right.className === "string" ? right.className : "";
          const leftBoost = leftClass.includes("clboxx") ? 1 : 0;
          const rightBoost = rightClass.includes("clboxx") ? 1 : 0;
          if (leftBoost !== rightBoost) {
            return rightBoost - leftBoost;
          }
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
        })[0] || null;

      if (!calendarRoot) {
        return null;
      }

      const monthRect = calendarRoot.getBoundingClientRect();
      const allDayCells = Array.from(calendarRoot.querySelectorAll("button, td, span, div"))
        .map((node) => ({
          node,
          text: (node.textContent || "").replace(/\s+/g, " ").trim(),
          rect: node.getBoundingClientRect(),
        }))
        .filter((entry) => /^\d{1,2}$/.test(entry.text))
        .filter((entry) => {
          const rect = entry.rect;
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= monthRect.top &&
            rect.bottom <= monthRect.bottom &&
            rect.left >= monthRect.left &&
            rect.right <= monthRect.right
          );
        })
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);

      const candidates = allDayCells.filter((entry) => entry.text === targetDay);
      if (candidates.length > 0) {
        const uniqueRowTops = Array.from(
          new Set(allDayCells.map((candidate) => Math.round(candidate.rect.top / 4) * 4)),
        ).sort((left, right) => left - right);
        const uniqueColLefts = Array.from(
          new Set(allDayCells.map((candidate) => Math.round(candidate.rect.left / 4) * 4)),
        ).sort((left, right) => left - right);

        const scoredCandidates = candidates.map((candidate) => {
          const roundedTop = Math.round(candidate.rect.top / 4) * 4;
          const roundedLeft = Math.round(candidate.rect.left / 4) * 4;
          const rowIndex = uniqueRowTops.findIndex((value) => Math.abs(value - roundedTop) <= 4);
          const colIndex = uniqueColLefts.findIndex((value) => Math.abs(value - roundedLeft) <= 4);
          const rowDistance = rowIndex === -1 ? 99 : Math.abs(rowIndex - targetPosition.row);
          const colDistance = colIndex === -1 ? 99 : Math.abs(colIndex - targetPosition.column);

          return {
            node: candidate.node,
            text: candidate.text,
            rect: candidate.rect,
            score: rowDistance * 10 + colDistance,
          };
        }).sort((left, right) => left.score - right.score);

        const target = scoredCandidates[0];
        if (target?.node instanceof HTMLElement) {
          const rect = target.rect;
          const clickX = rect.left + rect.width / 2;
          const clickY = rect.top + rect.height / 2;
          const topNodes = document.elementsFromPoint(clickX, clickY).slice(0, 6).map((node) => ({
            tag: node.tagName,
            text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
            className: typeof node.className === "string" ? node.className : "",
          }));

          target.node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
          target.node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          target.node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          target.node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

          return {
            status: "clicked_day_cell",
            clickedText: target.text,
            topNodes,
          };
        }
      }

      const walker = document.createTreeWalker(calendarRoot, NodeFilter.SHOW_TEXT);
      const textCandidates = [];
      while (walker.nextNode()) {
        const textNode = walker.currentNode;
        const value = (textNode.textContent || "").trim();
        if (value !== targetDay) {
          continue;
        }

        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rect = range.getBoundingClientRect();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.top < monthRect.top ||
          rect.bottom > monthRect.bottom ||
          rect.left < monthRect.left ||
          rect.right > monthRect.right
        ) {
          continue;
        }

        textCandidates.push({
          rect,
          roundedTop: Math.round(rect.top / 4) * 4,
          roundedLeft: Math.round(rect.left / 4) * 4,
        });
      }

      if (textCandidates.length > 0) {
        const uniqueRowTops = Array.from(new Set(textCandidates.map((candidate) => candidate.roundedTop))).sort(
          (left, right) => left - right,
        );
        const uniqueColLefts = Array.from(new Set(textCandidates.map((candidate) => candidate.roundedLeft))).sort(
          (left, right) => left - right,
        );

        const scoredCandidates = textCandidates
          .map((candidate) => {
            const rowIndex = uniqueRowTops.findIndex((value) => Math.abs(value - candidate.roundedTop) <= 4);
            const colIndex = uniqueColLefts.findIndex((value) => Math.abs(value - candidate.roundedLeft) <= 4);
            const rowDistance = rowIndex === -1 ? 99 : Math.abs(rowIndex - targetPosition.row);
            const colDistance = colIndex === -1 ? 99 : Math.abs(colIndex - targetPosition.column);

            return {
              rect: candidate.rect,
              score: rowDistance * 10 + colDistance,
            };
          })
          .sort((left, right) => left.score - right.score);

        const rect = scoredCandidates[0].rect;
        const clickX = rect.left + rect.width / 2;
        const clickY = rect.top + rect.height / 2;
        const clickableNode = document.elementsFromPoint(clickX, clickY).find(
          (node) => node instanceof HTMLElement && calendarRoot.contains(node),
        );
        const topNodes = document.elementsFromPoint(clickX, clickY).slice(0, 6).map((node) => ({
          tag: node.tagName,
          text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
          className: typeof node.className === "string" ? node.className : "",
        }));

        if (clickableNode instanceof HTMLElement) {
          clickableNode.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
          clickableNode.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          clickableNode.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          clickableNode.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

          return {
            status: "clicked_day_text_range",
            clickedText: targetDay,
            topNodes,
          };
        }
      }

      return { status: "not_found" };
    }, { targetDay: dayText, targetMonthLabel: monthLabelText, recordDateValue: recordDate })
    .catch((error) => ({ status: "evaluate_failed", error: error.message || "unknown_calendar_click_error" }));

  if (!clickResult || clickResult.status === "not_found") {
    throw new Error(`Way calendar day text could not be located for: ${dayText}`);
  }

  if (clickResult.status === "evaluate_failed") {
    throw new Error(`Way calendar day click failed for ${dayText}: ${clickResult.error}`);
  }

  logWayDebug(`Way search debug: calendar day click -> ${JSON.stringify(clickResult)}`);
  await page.waitForTimeout(500);
}

async function readSectionValue(page, sectionSelector) {
  if ([WAY_SELECTORS.home.checkInSection, WAY_SELECTORS.home.checkoutSection].includes(sectionSelector)) {
    const widgetProbeValue = await page
      .evaluate((targetSection) => {
        const targetLabel = targetSection === "checkin" ? "Check-in" : "Checkout";
        const targetRegex = /([A-Z][a-z]{2},?\s+\d{1,2}\s*\/\s*\d{2}:\d{2}\s(?:AM|PM)|Select date & time)/i;

        const isVisible = (node) => {
          if (!(node instanceof HTMLElement)) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0
          );
        };

        const labels = Array.from(document.querySelectorAll("*"))
          .filter((node) => isVisible(node))
          .filter((node) => (node.textContent || "").replace(/\s+/g, " ").trim() === targetLabel)
          .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);

        const labelNode = labels[0];
        if (!labelNode) {
          return "";
        }

        let container = labelNode;
        for (let depth = 0; depth < 4 && container?.parentElement; depth += 1) {
          const parent = container.parentElement;
          if (!isVisible(parent)) {
            break;
          }

          const rect = parent.getBoundingClientRect();
          const text = (parent.textContent || "").replace(/\s+/g, " ").trim();
          if (
            rect.width >= 120 &&
            rect.height >= 40 &&
            rect.width <= window.innerWidth &&
            text.includes(targetLabel)
          ) {
            container = parent;
          } else {
            break;
          }
        }

        const containerText = (container.textContent || "").replace(/\s+/g, " ").trim();
        const labelIndex = containerText.indexOf(targetLabel);
        if (labelIndex >= 0) {
          const trailingText = containerText.slice(labelIndex + targetLabel.length).trim();
          const match = trailingText.match(targetRegex);
          if (match) {
            return match[1];
          }
        }

        return "";
      }, sectionSelector === WAY_SELECTORS.home.checkInSection ? "checkin" : "checkout")
      .catch(() => "");

    if (widgetProbeValue) {
      return widgetProbeValue;
    }

    const labelBasedValue = await page
      .evaluate((targetSection) => {
        const targetLabel = targetSection === "checkin" ? "Check-in" : "Checkout";
        const targetRegex = /([A-Z][a-z]{2},?\s+\d{1,2}\s*\/\s*\d{2}:\d{2}\s(?:AM|PM)|Select date & time)/i;
        const isVisible = (node) => {
          if (!(node instanceof Element)) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0
          );
        };

        const labelNodes = Array.from(document.querySelectorAll("*"))
          .filter((node) => isVisible(node))
          .filter((node) => (node.textContent || "").replace(/\s+/g, " ").trim() === targetLabel)
          .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);

        for (const labelNode of labelNodes) {
          let current = labelNode;
          for (let depth = 0; depth < 4 && current; depth += 1) {
            const parent = current.parentElement;
            if (!parent || !isVisible(parent)) {
              break;
            }

            const parentText = (parent.textContent || "").replace(/\s+/g, " ").trim();
            const labelIndex = parentText.indexOf(targetLabel);
            if (labelIndex >= 0) {
              const trailingText = parentText.slice(labelIndex + targetLabel.length).trim();
              const match = trailingText.match(targetRegex);
              if (match) {
                return match[1];
              }
            }

            current = parent;
          }
        }

        return "";
      }, sectionSelector === WAY_SELECTORS.home.checkInSection ? "checkin" : "checkout")
      .catch(() => "");

    if (labelBasedValue) {
      return labelBasedValue;
    }

    const sectionValueFromPageText = await page
      .locator("body")
      .evaluate((body, targetSection) => {
        const text = (body.innerText || body.textContent || "").replace(/\s+/g, " ").trim();
        const checkInMatch = text.match(
          /Check-in\s*([A-Z][a-z]{2},?\s+\d{1,2}\s*\/\s*\d{2}:\d{2}\s(?:AM|PM)|Select date & time)\s*Checkout/i,
        );
        const checkoutMatch = text.match(/Checkout\s*([A-Z][a-z]{2},?\s+\d{1,2}\s*\/\s*\d{2}:\d{2}\s(?:AM|PM)|Select date & time)/i);

        return targetSection === "checkin" ? checkInMatch?.[1] || "" : checkoutMatch?.[1] || "";
      }, sectionSelector === WAY_SELECTORS.home.checkInSection ? "checkin" : "checkout")
      .catch(() => "");

    if (sectionValueFromPageText) {
      return sectionValueFromPageText;
    }
  }

  return page
    .locator(sectionSelector)
    .first()
    .evaluate((node) => {
      let current = node;
      let bestText = (node.textContent || "").replace(/\s+/g, " ").trim();

      for (let depth = 0; depth < 4 && current; depth += 1) {
        const parent = current.parentElement;
        if (!parent) {
          break;
        }

        const parentText = (parent.textContent || "").replace(/\s+/g, " ").trim();
        if (parentText.length > bestText.length) {
          bestText = parentText;
        }

        current = parent;
      }

      return bestText;
    })
    .catch(() => "");
}

async function ensureSectionContains(page, sectionSelector, patterns, description) {
  const normalizedPatterns = Array.isArray(patterns) ? patterns : [patterns];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const value = await readSectionValue(page, sectionSelector);
    const matched = normalizedPatterns.every((pattern) => pattern.test(value));
    if (matched) {
      return value;
    }

    await page.waitForTimeout(250);
  }

  const lastValue = await readSectionValue(page, sectionSelector);
  throw new Error(`Way ${description} was not confirmed. Current value: ${lastValue || "unknown"}`);
}

function parseWidgetDateTimeValue(value) {
  const match = String(value)
    .replace(/\s+/g, " ")
    .match(/([A-Z][a-z]{2}),?\s+(\d{1,2})\s*\/\s*(\d{2}:\d{2}\s(?:AM|PM))/i);

  if (!match) {
    return null;
  }

  const [, monthShort, dayText, timeText] = match;
  return {
    monthShort,
    day: Number(dayText),
    timeText,
    minutes: parse12HourTime(timeText.toUpperCase()),
  };
}

async function ensureSectionMatchesTarget(page, sectionSelector, recordDate, targetTimeDisplay, toleranceMinutes = 15) {
  const expectedDay = Number(getDayOfMonth(recordDate));
  const expectedMonth = getMonthShortLabel(recordDate).toLowerCase();
  const targetMinutes = parse12HourTime(targetTimeDisplay);

  if (targetMinutes === null) {
    throw new Error(`Way target time could not be parsed for validation: ${targetTimeDisplay}`);
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const value = await readSectionValue(page, sectionSelector);
    const parsed = parseWidgetDateTimeValue(value);

    if (parsed) {
      const sameMonth = parsed.monthShort.toLowerCase() === expectedMonth;
      const sameDay = parsed.day === expectedDay;
      const delta = parsed.minutes === null ? Number.POSITIVE_INFINITY : Math.abs(parsed.minutes - targetMinutes);

      if (sameMonth && sameDay && delta <= toleranceMinutes) {
        console.log(
          `Way search: confirmed ${sectionSelector === WAY_SELECTORS.home.checkInSection ? "check-in" : "checkout"} -> ${value}`,
        );
        return {
          rawValue: value,
          deltaMinutes: delta,
        };
      }
    }

    await page.waitForTimeout(250);
  }

  const finalValue = await readSectionValue(page, sectionSelector);
  throw new Error(
    `Way selected date/time did not match target. Expected ${getMonthShortLabel(recordDate)} ${expectedDay} around ${targetTimeDisplay}. Current value: ${finalValue || "unknown"}`,
  );
}

async function readWidgetWindow(page) {
  const [checkInValue, checkoutValue] = await Promise.all([
    readSectionValue(page, WAY_SELECTORS.home.checkInSection),
    readSectionValue(page, WAY_SELECTORS.home.checkoutSection),
  ]);

  return {
    checkInValue,
    checkoutValue,
    parsedCheckIn: parseWidgetDateTimeValue(checkInValue),
    parsedCheckout: parseWidgetDateTimeValue(checkoutValue),
  };
}

function isParsedValueWithinTarget(parsedValue, recordDate, targetTimeDisplay, toleranceMinutes = 15) {
  if (!parsedValue) {
    return false;
  }

  const expectedDay = Number(getDayOfMonth(recordDate));
  const expectedMonth = getMonthShortLabel(recordDate).toLowerCase();
  const targetMinutes = parse12HourTime(targetTimeDisplay);

  if (targetMinutes === null || parsedValue.minutes === null) {
    return false;
  }

  return (
    parsedValue.monthShort.toLowerCase() === expectedMonth &&
    parsedValue.day === expectedDay &&
    Math.abs(parsedValue.minutes - targetMinutes) <= toleranceMinutes
  );
}

async function stabilizeBookingWindow(page, recordDate, startDisplay, endDisplay) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await readWidgetWindow(page);
    const checkInOk = isParsedValueWithinTarget(snapshot.parsedCheckIn, recordDate, startDisplay, 15);
    const checkoutOk = isParsedValueWithinTarget(snapshot.parsedCheckout, recordDate, endDisplay, 15);

    console.log(
      `Way search: booking window snapshot -> ${JSON.stringify({
        attempt: attempt + 1,
        checkInValue: snapshot.checkInValue,
        checkoutValue: snapshot.checkoutValue,
        checkInOk,
        checkoutOk,
      })}`,
    );

    if (checkInOk && checkoutOk) {
      return snapshot;
    }

    if (!checkInOk) {
      await selectDateAndTime(page, WAY_SELECTORS.home.checkInSection, recordDate, startDisplay);
      console.log(`Way search: re-applied check-in -> ${recordDate} ${startDisplay}`);
    }

    if (!checkoutOk) {
      await selectDateAndTime(page, WAY_SELECTORS.home.checkoutSection, recordDate, endDisplay);
      console.log(`Way search: re-applied checkout -> ${recordDate} ${endDisplay}`);
    }
  }

  const finalSnapshot = await readWidgetWindow(page);
  throw new Error(
    `Way booking window did not stabilize. Final state: check-in=${finalSnapshot.checkInValue || "unknown"}, checkout=${finalSnapshot.checkoutValue || "unknown"}`,
  );
}

async function validateResultsWindow(page, expectedStartDate, expectedStartDisplay, expectedEndDate, expectedEndDisplay) {
  const resultsWindow = await page
    .evaluate(() => {
      const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
      const fromMatch = text.match(/Park From\s+([A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}\s+\|\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|May\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|May\s+\d{1,2}\s+\d{2}:\d{2}\s(?:AM|PM))/i);
      const toMatch = text.match(/Park To\s+([A-Z][a-z]{2}\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|May\s+\d{1,2},?\s+\d{2}:\d{2}\s(?:AM|PM)|May\s+\d{1,2}\s+\d{2}:\d{2}\s(?:AM|PM))/i);
      return {
        from: fromMatch?.[1] || "",
        to: toMatch?.[1] || "",
        bodySnippet: text.slice(0, 1200),
      };
    })
    .catch(() => ({ from: "", to: "", bodySnippet: "" }));

  const expectedStartDay = getDayOfMonth(expectedStartDate);
  const expectedStartMonth = getMonthShortLabel(expectedStartDate);
  const expectedEndDay = getDayOfMonth(expectedEndDate);
  const expectedEndMonth = getMonthShortLabel(expectedEndDate);
  const startTimePattern = new RegExp(
    `${escapeRegExp(expectedStartMonth)}\\s*,?\\s*${buildFlexibleDayPattern(expectedStartDate)}.*${escapeRegExp(expectedStartDisplay)}`,
    "i",
  );
  const endTimePattern = new RegExp(
    `${escapeRegExp(expectedEndMonth)}\\s*,?\\s*${buildFlexibleDayPattern(expectedEndDate)}.*${escapeRegExp(expectedEndDisplay)}`,
    "i",
  );

  const fromOk = startTimePattern.test(resultsWindow.from);
  const toOk = endTimePattern.test(resultsWindow.to);
  const resultsPageLooksLoaded =
    /results in/i.test(resultsWindow.bodySnippet) ||
    /sort by/i.test(resultsWindow.bodySnippet) ||
    /more details/i.test(resultsWindow.bodySnippet) ||
    /soldout/i.test(resultsWindow.bodySnippet);

  logWayDebug(`Way search: results window -> ${JSON.stringify(resultsWindow)}`);

  if (!resultsWindow.from && !resultsWindow.to && resultsPageLooksLoaded) {
    console.log("Way search: results window labels were not parseable, but results page is clearly loaded. Continuing.");
    return;
  }

  if (!fromOk || !toOk) {
    throw new Error(
      `Way results window did not match expected booking window. Expected ${expectedStartMonth} ${expectedStartDay} ${expectedStartDisplay} -> ${expectedEndMonth} ${expectedEndDay} ${expectedEndDisplay}. Got ${resultsWindow.from || "unknown"} -> ${resultsWindow.to || "unknown"}`,
    );
  }
}

async function scrollTimePickerToTarget(page, targetTimeDisplay) {
  const targetQuarterIndex = getQuarterHourIndex(targetTimeDisplay);
  if (targetQuarterIndex === null) {
    throw new Error(`Way target time could not be parsed: ${targetTimeDisplay}`);
  }

  const inspectAndPositionTarget = async () =>
    page
      .evaluate((targetTime) => {
        const normalize = (value) => (value || "").replace(/\s+/g, " ").trim().toUpperCase();
        const parse12HourTimeDom = (timeText) => {
          const match = String(timeText).match(/^(\d{2}):(\d{2})\s(AM|PM)$/);
          if (!match) {
            return null;
          }

          const [, hhText, mmText, suffix] = match;
          let hours = Number(hhText) % 12;
          if (suffix === "PM") {
            hours += 12;
          }

          return hours * 60 + Number(mmText);
        };

        const findTimeContainer = () => {
          const calendarRoots = Array.from(document.querySelectorAll(".clboxx, div"))
            .filter((node) => {
              if (!(node instanceof HTMLElement)) {
                return false;
              }
              const text = (node.textContent || "").replace(/\s+/g, " ").trim();
              const className = typeof node.className === "string" ? node.className : "";
              return (
                (className.includes("clboxx") || /[A-Z][a-z]+\s+20\d{2}/.test(text)) &&
                /\d{2}:\d{2}\s(?:AM|PM)/.test(text)
              );
            })
            .map((node) => ({ node, rect: node.getBoundingClientRect() }))
            .filter((entry) => entry.rect.width > 200 && entry.rect.height > 200)
            .sort((left, right) => {
              const leftClass = typeof left.node.className === "string" ? left.node.className : "";
              const rightClass = typeof right.node.className === "string" ? right.node.className : "";
              const leftBoost = leftClass.includes("clboxx") ? 1 : 0;
              const rightBoost = rightClass.includes("clboxx") ? 1 : 0;
              if (leftBoost !== rightBoost) {
                return rightBoost - leftBoost;
              }
              return right.rect.width * right.rect.height - left.rect.width * left.rect.height;
            });

          const calendarRect = calendarRoots[0]?.rect || null;

          const allTimeContainers = Array.from(document.querySelectorAll("div"))
            .map((node) => {
              const style = window.getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              const isScrollable =
                ["auto", "scroll"].includes(style.overflowY) &&
                node.scrollHeight > node.clientHeight &&
                node.clientHeight >= 180 &&
                /\d{2}:\d{2}\s(?:AM|PM)/.test(node.innerText || node.textContent || "");

              if (!isScrollable) {
                return null;
              }

              return { node, rect };
            })
            .filter(Boolean)
            .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height);

          const strictContainer = allTimeContainers.find(({ rect }) => {
            if (!calendarRect) {
              return true;
            }

            return (
              rect.top >= calendarRect.top - 10 &&
              rect.bottom <= calendarRect.bottom + 10 &&
              rect.left >= calendarRect.left + calendarRect.width * 0.55
            );
          });

          const overlappingContainer = allTimeContainers.find(({ rect }) => {
            if (!calendarRect) {
              return true;
            }

            return (
              rect.bottom >= calendarRect.top &&
              rect.top <= calendarRect.bottom &&
              rect.right >= calendarRect.left &&
              rect.left <= calendarRect.right
            );
          });

          return (strictContainer || overlappingContainer || allTimeContainers[0])?.node || null;
        };

        const container = findTimeContainer();
        if (!container) {
          return { status: "container_not_found" };
        }

        const containerRect = container.getBoundingClientRect();
        const visibleRows = Array.from(container.querySelectorAll("*"))
          .map((node) => {
            if (!(node instanceof Element)) {
              return null;
            }

            const text = (node.textContent || "").replace(/\s+/g, " ").trim();
            if (!/^\d{2}:\d{2}\s(?:AM|PM)$/i.test(text)) {
              return null;
            }

            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            const visible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              Number(style.opacity || "1") > 0 &&
              rect.top >= containerRect.top - 2 &&
              rect.bottom <= containerRect.bottom + 2;

            if (!visible) {
              return null;
            }

            return {
              text,
              top: rect.top,
              height: rect.height,
              quarterIndex: Math.round((parse12HourTimeDom(text) || 0) / 15),
            };
          })
          .filter(Boolean)
          .sort((left, right) => left.top - right.top);

        const visibleTimes = Array.from(new Set(visibleRows.map((row) => row.text)));
        const targetVisible = visibleTimes.some((time) => normalize(time) === normalize(targetTime));

        if (targetVisible) {
          return {
            status: "target_visible",
            visibleTimes,
            scrollTop: container.scrollTop,
          };
        }

        const firstRow = visibleRows[0];
        const secondRow = visibleRows[1];
        if (!firstRow) {
          return {
            status: "no_visible_rows",
            visibleTimes,
            scrollTop: container.scrollTop,
          };
        }

        const rowHeight =
          secondRow && Number.isFinite(secondRow.top - firstRow.top) && secondRow.top !== firstRow.top
            ? Math.abs(secondRow.top - firstRow.top)
            : Math.max(18, firstRow.height);

        const targetQuarterIndex = Math.round((parse12HourTimeDom(targetTime) || 0) / 15);
        const deltaRows = targetQuarterIndex - firstRow.quarterIndex;
        const desiredScrollTop =
          container.scrollTop +
          deltaRows * rowHeight -
          Math.max(rowHeight, container.clientHeight / 3);

        container.scrollTop = Math.max(0, desiredScrollTop);

        return {
          status: "repositioned",
          visibleTimes,
          firstVisible: firstRow.text,
          rowHeight,
          fromQuarterIndex: firstRow.quarterIndex,
          toQuarterIndex: targetQuarterIndex,
          scrollTop: container.scrollTop,
        };
      }, targetTimeDisplay)
      .catch((error) => ({ status: "evaluate_failed", error: error.message || "unknown_picker_position_error" }));

  const clickExactVisibleTime = async () =>
    page
      .evaluate((targetTime) => {
        const normalize = (value) => (value || "").replace(/\s+/g, " ").trim().toUpperCase();

        const findTimeContainer = () => {
          const calendarRoots = Array.from(document.querySelectorAll(".clboxx, div"))
            .filter((node) => {
              if (!(node instanceof HTMLElement)) {
                return false;
              }
              const text = (node.textContent || "").replace(/\s+/g, " ").trim();
              const className = typeof node.className === "string" ? node.className : "";
              return (
                (className.includes("clboxx") || /[A-Z][a-z]+\s+20\d{2}/.test(text)) &&
                /\d{2}:\d{2}\s(?:AM|PM)/.test(text)
              );
            })
            .map((node) => ({ node, rect: node.getBoundingClientRect() }))
            .filter((entry) => entry.rect.width > 200 && entry.rect.height > 200)
            .sort((left, right) => {
              const leftClass = typeof left.node.className === "string" ? left.node.className : "";
              const rightClass = typeof right.node.className === "string" ? right.node.className : "";
              const leftBoost = leftClass.includes("clboxx") ? 1 : 0;
              const rightBoost = rightClass.includes("clboxx") ? 1 : 0;
              if (leftBoost !== rightBoost) {
                return rightBoost - leftBoost;
              }
              return right.rect.width * right.rect.height - left.rect.width * left.rect.height;
            });

          const calendarRect = calendarRoots[0]?.rect || null;

          const allTimeContainers = Array.from(document.querySelectorAll("div"))
            .map((node) => {
              const style = window.getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              const isScrollable =
                ["auto", "scroll"].includes(style.overflowY) &&
                node.scrollHeight > node.clientHeight &&
                node.clientHeight >= 180 &&
                /\d{2}:\d{2}\s(?:AM|PM)/.test(node.innerText || node.textContent || "");

              if (!isScrollable) {
                return null;
              }

              return { node, rect };
            })
            .filter(Boolean)
            .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height);

          const strictContainer = allTimeContainers.find(({ rect }) => {
            if (!calendarRect) {
              return true;
            }

            return (
              rect.top >= calendarRect.top - 10 &&
              rect.bottom <= calendarRect.bottom + 10 &&
              rect.left >= calendarRect.left + calendarRect.width * 0.55
            );
          });

          const overlappingContainer = allTimeContainers.find(({ rect }) => {
            if (!calendarRect) {
              return true;
            }

            return (
              rect.bottom >= calendarRect.top &&
              rect.top <= calendarRect.bottom &&
              rect.right >= calendarRect.left &&
              rect.left <= calendarRect.right
            );
          });

          return (strictContainer || overlappingContainer || allTimeContainers[0])?.node || null;
        };

        const container = findTimeContainer();

        if (!container) {
          return { status: "container_not_found_after_scroll" };
        }

        const containerRect = container.getBoundingClientRect();
        const allCandidates = Array.from(container.querySelectorAll("*"))
          .map((node) => {
            if (!(node instanceof Element)) {
              return null;
            }

            const rawText = (node.textContent || "").replace(/\s+/g, " ").trim();
            const text = normalize(rawText);
            if (!text.includes(normalize(targetTime))) {
              return null;
            }

            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            const visible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              Number(style.opacity || "1") > 0 &&
              rect.top >= containerRect.top - 4 &&
              rect.bottom <= containerRect.bottom + 4;

            if (!visible) {
              return null;
            }

            return {
              node,
              text,
              rawText,
              rect,
              tag: node.tagName,
              className: typeof node.className === "string" ? node.className : "",
              distanceFromCenter: Math.abs(rect.top + rect.height / 2 - (containerRect.top + containerRect.height / 2)),
            };
          })
          .filter(Boolean);

        const candidates = allCandidates
          .sort((left, right) => {
            const leftExact = left.text === normalize(targetTime) ? 1 : 0;
            const rightExact = right.text === normalize(targetTime) ? 1 : 0;
            if (leftExact !== rightExact) {
              return rightExact - leftExact;
            }

            return left.distanceFromCenter - right.distanceFromCenter;
          });

        const target = candidates[0];
        if (!target) {
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
          const textMatches = [];
          while (walker.nextNode()) {
            const textNode = walker.currentNode;
            const rawText = (textNode.textContent || "").replace(/\s+/g, " ").trim();
            if (normalize(rawText) !== normalize(targetTime)) {
              continue;
            }

            const range = document.createRange();
            range.selectNodeContents(textNode);
            const rect = range.getBoundingClientRect();
            if (
              rect.width <= 0 ||
              rect.height <= 0 ||
              rect.top < containerRect.top - 4 ||
              rect.bottom > containerRect.bottom + 4
            ) {
              continue;
            }

            textMatches.push({
              rect,
              rawText,
              distanceFromCenter: Math.abs(rect.top + rect.height / 2 - (containerRect.top + containerRect.height / 2)),
            });
          }

          if (textMatches.length > 0) {
            const bestTextMatch = textMatches.sort(
              (left, right) => left.distanceFromCenter - right.distanceFromCenter,
            )[0];

            const clickX = bestTextMatch.rect.left + bestTextMatch.rect.width / 2;
            const clickY = bestTextMatch.rect.top + bestTextMatch.rect.height / 2;
            const topNodes = document.elementsFromPoint(clickX, clickY).slice(0, 6).map((node) => ({
              tag: node.tagName,
              text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
              className: typeof node.className === "string" ? node.className : "",
            }));

            const clickableNode = document.elementsFromPoint(clickX, clickY).find(
              (node) => node instanceof HTMLElement && container.contains(node),
            );
            if (clickableNode instanceof HTMLElement) {
              clickableNode.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
              clickableNode.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
              clickableNode.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
              clickableNode.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

              return {
                status: "clicked_exact_time_via_text_range",
                clickedRawText: bestTextMatch.rawText,
                clickedTag: clickableNode.tagName,
                topNodes,
              };
            }
          }

          return {
            status: "target_not_visible_after_scroll",
            visibleTimes: Array.from(
              new Set(
                ((container.innerText || container.textContent || "").match(/\d{2}:\d{2}\s(?:AM|PM)/g) || []).filter(Boolean),
              ),
            ),
          };
        }

        const clickX = target.rect.left + target.rect.width / 2;
        const clickY = target.rect.top + target.rect.height / 2;
        const topNodes = document.elementsFromPoint(clickX, clickY).slice(0, 6).map((node) => ({
          tag: node.tagName,
          text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
          className: typeof node.className === "string" ? node.className : "",
        }));

        target.node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
        target.node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        target.node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        target.node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

        return {
          status: "clicked_exact_time",
          clickedText: target.text,
          clickedRawText: target.rawText,
          clickedTag: target.tag,
          clickedClassName: target.className,
          topNodes,
          visibleTimes: Array.from(new Set(allCandidates.map((candidate) => candidate.rawText).filter(Boolean))),
          candidateCount: candidates.length,
        };
      }, targetTimeDisplay)
      .catch((error) => ({ status: "exact_click_failed", error: error.message || "unknown_exact_click_error" }));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const inspectResult = await inspectAndPositionTarget();
    logWayDebug(`Way search debug: picker position -> ${JSON.stringify(inspectResult)}`);
    if (inspectResult.status === "evaluate_failed") {
      throw new Error(
        `Way time picker could not position target time for ${targetTimeDisplay} (${inspectResult.error})`,
      );
    }
    if (inspectResult.status === "container_not_found") {
      throw new Error(`Way time container was not found for target time: ${targetTimeDisplay}`);
    }

    const visibleTimes = Array.isArray(inspectResult.visibleTimes) ? inspectResult.visibleTimes : [];
    logWayDebug(`Way search debug: visible time options -> ${visibleTimes.join(" | ")}`);

    if (visibleTimes.some((time) => String(time).toUpperCase() === targetTimeDisplay.toUpperCase())) {
      const clickResult = await clickExactVisibleTime();
      logWayDebug(`Way search debug: exact time click -> ${JSON.stringify(clickResult)}`);

      if (clickResult.status === "clicked_exact_time") {
        await page.waitForTimeout(500);
        return;
      }

      throw new Error(
        `Way exact time selection failed for ${targetTimeDisplay}: ${clickResult.status}${
          clickResult.error ? ` (${clickResult.error})` : ""
        }`,
      );
    }

    await page.waitForTimeout(300);
  }

  throw new Error(`Way time picker could not bring target time into view: ${targetTimeDisplay}`);
}

async function triggerSearch(page, config) {
  await suppressFloatingOverlays(page);
  const waitForResults = async (timeout = 5000) =>
    Promise.race([
      page.waitForURL((url) => !String(url).startsWith(config.homeUrl), { timeout }).then(() => "url_changed").catch(() => null),
      page
        .locator(WAY_SELECTORS.results.reserveNowButton)
        .first()
        .waitFor({ state: "visible", timeout })
        .then(() => "reserve_visible")
        .catch(() => null),
      page
        .waitForFunction(() => {
          const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
          return (
            /results in/i.test(text) ||
            /sort by/i.test(text) ||
            /more details/i.test(text) ||
            /soldout/i.test(text)
          );
        }, { timeout })
        .then(() => "results_loaded")
        .catch(() => null),
    ]);

  const searchDiagnostics = await page
    .evaluate(() => {
      const getVisibleRect = (node) => {
        if (!(node instanceof Element)) {
          return null;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const visible =
          rect.width > 10 &&
          rect.height > 10 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0;
        return visible ? rect : null;
      };

      const checkoutLabel = Array.from(document.querySelectorAll("*"))
        .filter((node) => (node.textContent || "").replace(/\s+/g, " ").trim() === "Checkout")
        .map((node) => ({ rect: getVisibleRect(node) }))
        .filter((entry) => entry.rect)
        .sort((left, right) => left.rect.top - right.rect.top)[0];

      const candidates = Array.from(document.querySelectorAll("button, [role='button'], a, input[type='submit']"))
        .map((node) => {
          const rect = getVisibleRect(node);
          if (!rect) return null;
          return {
            tag: node.tagName,
            type: node.getAttribute("type") || "",
            text: (node.textContent || "").replace(/\s+/g, " ").trim(),
            aria: node.getAttribute("aria-label") || "",
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          };
        })
        .filter(Boolean)
        .filter((candidate) => candidate.width >= 25 && candidate.height >= 25)
        .sort((left, right) => right.x - left.x)
        .slice(0, 20);

      return {
        checkoutLabel,
        candidates,
      };
    })
    .catch(() => ({ checkoutLabel: null, candidates: [] }));

  logWayDebug(`Way search debug: search candidates -> ${JSON.stringify(searchDiagnostics)}`);
  const widgetSearchCandidate =
    searchDiagnostics.candidates.find((candidate) => /search/i.test(candidate.aria || "")) ||
    searchDiagnostics.candidates.find((candidate) => /^search$/i.test(candidate.text || ""));

  if (widgetSearchCandidate) {
    const domClickResult = await page
      .evaluate(() => {
        const getVisibleRect = (node) => {
          if (!(node instanceof Element)) {
            return null;
          }

          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const visible =
            rect.width > 10 &&
            rect.height > 10 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0;

          return visible ? rect : null;
        };

        const checkoutLabel = Array.from(document.querySelectorAll("*"))
          .filter((node) => (node.textContent || "").replace(/\s+/g, " ").trim() === "Checkout")
          .map((node) => ({ node, rect: getVisibleRect(node) }))
          .filter((entry) => entry.rect)
          .sort((left, right) => left.rect.top - right.rect.top)[0];

        if (!checkoutLabel) {
          return { status: "checkout_not_found" };
        }

        const candidates = Array.from(document.querySelectorAll("button, [role='button'], a, input[type='submit']"))
          .map((node) => ({ node, rect: getVisibleRect(node) }))
          .filter((entry) => entry.rect)
          .map((entry) => ({
            node: entry.node,
            rect: entry.rect,
            text: (entry.node.textContent || "").replace(/\s+/g, " ").trim(),
            aria: entry.node.getAttribute("aria-label") || "",
          }))
          .filter(
            (candidate) =>
              candidate.rect.left > checkoutLabel.rect.right - 10 &&
              Math.abs(
                candidate.rect.top + candidate.rect.height / 2 - (checkoutLabel.rect.top + checkoutLabel.rect.height / 2),
              ) < 90 &&
              candidate.rect.width >= 40 &&
              candidate.rect.height >= 40,
          )
          .sort((left, right) => left.rect.left - right.rect.left);

        const target =
          candidates.find((candidate) => /search/i.test(candidate.aria || "")) ||
          candidates.find((candidate) => /^search$/i.test(candidate.text || "")) ||
          candidates[0];

        if (!target) {
          return { status: "candidate_not_found" };
        }

        target.node.click();

        return {
          status: "clicked",
          text: target.text,
          aria: target.aria,
        };
      })
      .catch((error) => ({ status: "evaluate_failed", error: error.message || "unknown_dom_click_error" }));

    console.log(`Way search: attempted DOM search click -> ${JSON.stringify(domClickResult)}`);
    const domResult = await waitForResults(5000);
    if (domResult) {
      return domResult;
    }

    const hitTest = await page
      .evaluate(({ x, y }) => {
        return document
          .elementsFromPoint(x, y)
          .slice(0, 8)
          .map((node) => ({
            tag: node.tagName,
            text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
            aria: node.getAttribute?.("aria-label") || "",
            cls: node.className || "",
          }));
      }, {
        x: widgetSearchCandidate.x + widgetSearchCandidate.width / 2,
        y: widgetSearchCandidate.y + widgetSearchCandidate.height / 2,
      })
      .catch(() => []);

    logWayDebug(`Way search debug: search hit-test -> ${JSON.stringify(hitTest)}`);

    await suppressFloatingOverlays(page);
    await page.mouse.click(
      widgetSearchCandidate.x + widgetSearchCandidate.width / 2,
      widgetSearchCandidate.y + widgetSearchCandidate.height / 2,
    );
    console.log(`Way search: attempted search click via exact widget candidate -> ${JSON.stringify(widgetSearchCandidate)}`);
    const coordinateResult = await waitForResults(5000);
    if (coordinateResult) {
      return coordinateResult;
    }
  }
  return null;
}

async function selectDateAndTime(page, sectionSelector, recordDate, timeDisplay, options = {}) {
  const sectionName = sectionSelector === WAY_SELECTORS.home.checkInSection ? "check-in" : "checkout";
  const sectionKey = sectionSelector === WAY_SELECTORS.home.checkInSection ? "checkin" : "checkout";
  const keepPickerOpen = Boolean(options.keepPickerOpen);
  await openDateTimePicker(page, sectionSelector);
  console.log(`Way search: opened ${sectionName} picker`);

  await logPickerDomSummary(page);
  await navigateCalendarToMonth(page, recordDate);
  console.log(`Way search: navigated ${sectionName} picker to ${getMonthYearLabel(recordDate)}`);

  // Calendar day labels like "1" and "10" can collide with unrelated visible buttons
  // on the page. Clicking by point inside the active calendar has proven safer.
  await clickCalendarDayByPosition(page, recordDate);
  await waitForCalendarBackdropToClear(page).catch(() => {});
  console.log(`Way search: selected ${sectionName} day -> ${getDayOfMonth(recordDate)}`);

  // Way keeps the same picker active after choosing the date, and reopening it can
  // reset the time list back to its default state. We stay on the active picker
  // and only retry by reopening if the direct time selection fails.
  await page.waitForTimeout(300);
  console.log(`Way search: continuing ${sectionName} time selection on active picker`);

  try {
    await scrollTimePickerToTarget(page, timeDisplay);
  } catch (error) {
    if (sectionKey === "checkout") {
      console.log(`Way search: checkout time selection retry -> ${error.message}`);
      await openDateTimePicker(page, sectionSelector);
      await page.waitForTimeout(250);
      await scrollTimePickerToTarget(page, timeDisplay);
    } else if (sectionKey === "checkin") {
      console.log(`Way search: check-in time selection retry -> ${error.message}`);
      await openDateTimePicker(page, sectionSelector);
      await page.waitForTimeout(250);
      await scrollTimePickerToTarget(page, timeDisplay);
    } else {
      throw error;
    }
  }
  console.log(`Way search: attempted ${sectionName} time selection -> ${timeDisplay}`);
  if (!keepPickerOpen) {
    const pickerStillVisible = await closeOpenCalendarPicker(page);
    console.log(`Way search: ${sectionName} picker closed -> ${pickerStillVisible ? "no" : "yes"}`);
  } else {
    // Some Way widgets only commit the chosen date/time back into the section
    // value after the picker closes. When we intentionally keep it open for the
    // overnight follow-up flow, defer section-value validation until later.
    console.log(`Way search: keeping ${sectionName} picker open for follow-up flow`);
    return;
  }
  await ensureSectionContains(
    page,
    sectionSelector,
    [new RegExp(getMonthShortLabel(recordDate), "i"), buildDayOfMonthRegex(recordDate)],
    "date selection",
  );
  await ensureSectionMatchesTarget(page, sectionSelector, recordDate, timeDisplay, 15);
  console.log(`Way search: confirmed ${sectionName} target after picker close -> ${timeDisplay}`);
}

async function readActiveTimePickerVisibleTimes(page) {
  const result = await page
    .evaluate(() => {
      const calendarRoots = Array.from(document.querySelectorAll(".clboxx, div"))
        .filter((node) => {
          if (!(node instanceof HTMLElement)) {
            return false;
          }
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          const className = typeof node.className === "string" ? node.className : "";
          return (
            (className.includes("clboxx") || /[A-Z][a-z]+\s+20\d{2}/.test(text)) &&
            /\d{2}:\d{2}\s(?:AM|PM)/.test(text)
          );
        })
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter((entry) => entry.rect.width > 200 && entry.rect.height > 200)
        .sort((left, right) => {
          const leftClass = typeof left.node.className === "string" ? left.node.className : "";
          const rightClass = typeof right.node.className === "string" ? right.node.className : "";
          const leftBoost = leftClass.includes("clboxx") ? 1 : 0;
          const rightBoost = rightClass.includes("clboxx") ? 1 : 0;
          if (leftBoost !== rightBoost) {
            return rightBoost - leftBoost;
          }
          return right.rect.width * right.rect.height - left.rect.width * left.rect.height;
        });

      const calendarRect = calendarRoots[0]?.rect || null;
      const timeRegex = /\d{2}:\d{2}\s(?:AM|PM)/g;

      const allTimeContainers = Array.from(document.querySelectorAll("div"))
        .map((node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          const isScrollable =
            ["auto", "scroll"].includes(style.overflowY) &&
            node.scrollHeight > node.clientHeight &&
            node.clientHeight >= 180 &&
            /\d{2}:\d{2}\s(?:AM|PM)/.test(node.innerText || node.textContent || "");

          if (!isScrollable) {
            return null;
          }

          return { node, rect };
        })
        .filter(Boolean)
        .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height);

      const strictContainer = allTimeContainers.find(({ rect }) => {
        if (!calendarRect) {
          return true;
        }

        return (
          rect.top >= calendarRect.top - 10 &&
          rect.bottom <= calendarRect.bottom + 10 &&
          rect.left >= calendarRect.left + calendarRect.width * 0.55
        );
      });

      const overlappingContainer = allTimeContainers.find(({ rect }) => {
        if (!calendarRect) {
          return true;
        }

        return (
          rect.bottom >= calendarRect.top &&
          rect.top <= calendarRect.bottom &&
          rect.right >= calendarRect.left &&
          rect.left <= calendarRect.right
        );
      });

      const container = (strictContainer || overlappingContainer || allTimeContainers[0])?.node || null;

      if (!container) {
        return { status: "container_not_found", visibleTimes: [] };
      }

      return {
        status: "ok",
        visibleTimes: (container.innerText.match(timeRegex) || []).slice(0, 20),
      };
    })
    .catch((error) => ({ status: "evaluate_failed", error: error.message || "unknown_visible_times_error", visibleTimes: [] }));

  return result;
}

async function ensureCheckoutTimePickerAnchored(page, checkInDisplay) {
  const checkInMinutes = parse12HourTime(checkInDisplay);
  if (checkInMinutes === null) {
    throw new Error(`Way check-in time could not be parsed for checkout anchoring: ${checkInDisplay}`);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visibleTimesResult = await readActiveTimePickerVisibleTimes(page);
    console.log(`Way search: checkout visible times snapshot -> ${JSON.stringify(visibleTimesResult)}`);

    if (visibleTimesResult.status !== "ok") {
      await closeOpenCalendarPicker(page);
      await openDateTimePicker(page, WAY_SELECTORS.home.checkoutSection);
      await page.waitForTimeout(300);
      continue;
    }

    const visibleMinutes = visibleTimesResult.visibleTimes
      .map((time) => parse12HourTime(String(time)))
      .filter((value) => value !== null);

    if (visibleMinutes.length) {
      const minVisible = Math.min(...visibleMinutes);
      if (minVisible >= checkInMinutes + 15) {
        return;
      }
    }

    await closeOpenCalendarPicker(page);
    await openDateTimePicker(page, WAY_SELECTORS.home.checkoutSection);
    await page.waitForTimeout(300);
  }

  throw new Error(`Way checkout picker did not anchor after check-in ${checkInDisplay}.`);
}

async function createWayBrowserSession() {
  const { chromium } = requirePlaywright();
  const config = getWayConfig();
  const context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: false,
  });
  const page = context.pages()[0] || (await context.newPage());
  const browser = context.browser();

  return { browser, context, page };
}

async function dismissCookieBanner(page) {
  const acceptVisible = await page
    .locator(WAY_SELECTORS.common.cookieAcceptButton)
    .isVisible()
    .catch(() => false);

  if (!acceptVisible) {
    return { status: "not_present" };
  }

  await page.locator(WAY_SELECTORS.common.cookieAcceptButton).click();
  await page.waitForTimeout(500);

  return { status: "accepted" };
}

async function suppressFloatingOverlays(page) {
  await page
    .evaluate(() => {
      const isFloatingOverlay = (rect) =>
        rect.right > window.innerWidth * 0.62 && rect.bottom > window.innerHeight * 0.4;

      const nodes = Array.from(document.querySelectorAll("div, button, a, iframe, aside, section"));
      for (const node of nodes) {
        if (!(node instanceof Element)) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const text = (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        const positionMatch = ["fixed", "sticky"].includes(style.position);
        const likelyPromo =
          text.includes("save 5%") ||
          text.includes("scan the qr") ||
          text.includes("support") ||
          text.includes("chat") ||
          text.includes("cancel the chat") ||
          text.includes("return to chat") ||
          text.includes("cancel chat") ||
          text.includes("chatbot") ||
          text.includes("kindly") ||
          text.includes("powered by");
        const likelyFloatingButton =
          rect.width >= 44 &&
          rect.height >= 44 &&
          isFloatingOverlay(rect) &&
          Number(style.zIndex || "0") >= 1;

        if ((positionMatch && isFloatingOverlay(rect) && (likelyPromo || likelyFloatingButton)) || node.tagName === "IFRAME") {
          node.setAttribute("data-codex-hidden-overlay", "true");
          node.style.setProperty("display", "none", "important");
          node.style.setProperty("visibility", "hidden", "important");
          node.style.setProperty("pointer-events", "none", "important");
        }
      }

      for (const node of Array.from(document.querySelectorAll("*"))) {
        if (!(node instanceof Element)) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const inLowerRight = rect.right > window.innerWidth * 0.78 && rect.bottom > window.innerHeight * 0.72;
        const isFloating =
          ["fixed", "sticky"].includes(style.position) &&
          rect.width >= 36 &&
          rect.height >= 36 &&
          Number(style.opacity || "1") > 0;

        if (inLowerRight && isFloating) {
          node.setAttribute("data-codex-hidden-overlay", "true");
          node.style.setProperty("display", "none", "important");
          node.style.setProperty("visibility", "hidden", "important");
          node.style.setProperty("pointer-events", "none", "important");
        }
      }
    })
    .catch(() => {});

  const modalButtons = [
    'button:has-text("Cancel chat")',
    'button:has-text("Close")',
  ];

  for (const selector of modalButtons) {
    const button = page.locator(selector).first();
    const visible = await button.isVisible().catch(() => false);
    if (visible) {
      await button.click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
}

async function ensureLoggedIn(page) {
  const config = getWayConfig();
  console.log("Way login: opening login page...");
  const isCloudflareGate = async () =>
    page
      .evaluate(() => {
        const title = document.title || "";
        const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
        return /just a moment/i.test(title) || /performing security verification/i.test(text);
      })
      .catch(() => false);
  const confirmAuthenticatedSession = async () => {
    console.log("Way login: validating session via /orders ...");
    await page.goto(config.ordersUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await dismissCookieBanner(page);
    await suppressFloatingOverlays(page);

    const loginFormVisible = await page.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);
    const loginUrl = /\/login\b/i.test(page.url());
    const ordersIndicatorVisible = await page
      .locator(WAY_SELECTORS.orders.orderRow)
      .first()
      .isVisible()
      .catch(() => false);

    return {
      authenticated: !loginFormVisible && !loginUrl,
      loginFormVisible,
      loginUrl,
      ordersIndicatorVisible,
      currentUrl: page.url(),
    };
  };

  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });
  console.log(`Way login: landed on -> ${page.url()}`);
  await page.waitForTimeout(1200);
  await dismissCookieBanner(page);
  await suppressFloatingOverlays(page);

  if (await isCloudflareGate()) {
    throw new Error(
      "Way login is blocked by Cloudflare verification. Complete it once in the persistent browser session, then rerun the batch.",
    );
  }

  let loggedOut = await page.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);
  console.log(`Way login: login form visible -> ${loggedOut ? "yes" : "no"}`);
  if (!loggedOut) {
    const sessionState = await confirmAuthenticatedSession();
    console.log(`Way login: session validation result -> ${JSON.stringify(sessionState)}`);
    if (!sessionState.authenticated) {
      throw new Error(
        `Way session looked logged in from /login, but authentication was not confirmed at /orders (${sessionState.currentUrl}).`,
      );
    }
    return { status: "already_logged_in" };
  }

  if (!config.username || !config.password) {
    throw new Error("Way credentials are missing. Set WAY_USERNAME and WAY_PASSWORD before running checkout.");
  }

  await page.fill(WAY_SELECTORS.login.emailInput, config.username);
  await page.fill(WAY_SELECTORS.login.passwordInput, config.password);
  console.log("Way login: filled credentials, submitting...");
  await page.click(WAY_SELECTORS.login.submitButton);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await dismissCookieBanner(page);
  await suppressFloatingOverlays(page);

  const loginStillVisible = await page.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);
  console.log(`Way login: login form still visible after submit -> ${loginStillVisible ? "yes" : "no"}`);
  if (loginStillVisible) {
    throw new Error("Way login did not complete successfully.");
  }

  const sessionState = await confirmAuthenticatedSession();
  console.log(`Way login: post-submit session validation -> ${JSON.stringify(sessionState)}`);
  if (!sessionState.authenticated) {
    throw new Error(
      `Way login did not create an authenticated session (${sessionState.currentUrl}).`,
    );
  }

  return { status: "logged_in" };
}

async function submitWayLoginFormIfVisible(page) {
  const config = getWayConfig();
  const loginVisible = await page.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);
  if (!loginVisible) {
    return { status: "not_visible" };
  }

  if (!config.username || !config.password) {
    throw new Error("Way credentials are missing. Set WAY_USERNAME and WAY_PASSWORD before running checkout.");
  }

  await page.fill(WAY_SELECTORS.login.emailInput, config.username);
  await page.fill(WAY_SELECTORS.login.passwordInput, config.password);
  await page.click(WAY_SELECTORS.login.submitButton);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(1500);
  await dismissCookieBanner(page);
  await suppressFloatingOverlays(page);

  const loginStillVisible = await page.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);
  if (loginStillVisible || /\/login\b/i.test(page.url())) {
    throw new Error(`Way inline login did not complete successfully (${page.url()}).`);
  }

  return { status: "logged_in_from_visible_form", currentUrl: page.url() };
}

async function searchLots(page, record, resolvedEventTime, options = {}) {
  const config = getWayConfig();
  const checkoutWindow = buildCheckoutWindow(record.event_date, resolvedEventTime, options.checkoutWindow || {});
  const locationQuery = String(options.locationQueryOverride || "").trim()
    || normalizeWaySearchLocation(record.parking_location, record.city_state);
  const searchMode = String(options.searchMode || "hourly").trim().toLowerCase();
  const airportMetadata = options.airportMetadata || null;
  const addressHints = getAddressSelectionHints(locationQuery);

  await page.goto(config.homeUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await dismissCookieBanner(page);
  await suppressFloatingOverlays(page);
  const clearedCartState = await clearWayCartState(page);
  if (clearedCartState.removed > 0 || clearedCartState.hadOrderSummary) {
    console.log(`Way search: cleared stale cart state -> ${JSON.stringify(clearedCartState)}`);
  }
  console.log("Way search: home loaded");

  const widgetVisible = await page.locator(WAY_SELECTORS.home.widgetRoot).first().isVisible().catch(() => false);
  if (!widgetVisible) {
    throw new Error("Way home search widget was not detected.");
  }
  console.log("Way search: widget detected");
  const modeResult = await setWaySearchMode(page, searchMode === "airport" ? "airport" : "hourly");
  console.log(`Way search: mode -> ${modeResult.mode}`);

  await page.locator(WAY_SELECTORS.home.locationSection).first().click();
  await page.waitForTimeout(500);
  console.log("Way search: clicked location section");

  const locationInput = page.locator(WAY_SELECTORS.home.locationInput).first();
  await locationInput.waitFor({ state: "visible", timeout: 5000 });
  await locationInput.click();
  await locationInput.fill("");
  await page.waitForTimeout(200);
  await page.keyboard.type(locationQuery, { delay: 65 });
  await page.waitForTimeout(1200);
  console.log(`Way search: typed location query -> ${locationQuery}`);

  const suggestionItems = page.locator(WAY_SELECTORS.home.locationSuggestion).filter({ hasText: /.+/ });
  const collectVisibleSuggestions = async () =>
    page
      .locator(WAY_SELECTORS.home.locationSuggestion)
      .evaluateAll((nodes) =>
        nodes
          .map((node, index) => {
            const element = node instanceof HTMLElement ? node : null;
            if (!element) {
              return null;
            }

            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const visible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              Number(style.opacity || "1") > 0;

            if (!visible) {
              return null;
            }

            return {
              index,
              text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
            };
          })
          .filter(Boolean),
      )
      .catch(() => []);

  let visibleSuggestions = await collectVisibleSuggestions();
  let suggestionCount = visibleSuggestions.length;

  if (!suggestionCount) {
    await page.keyboard.press("ArrowDown").catch(() => {});
    await page.waitForTimeout(300);
    visibleSuggestions = await collectVisibleSuggestions();
    suggestionCount = visibleSuggestions.length;
  }

  let selectedSuggestion = null;

  if (suggestionCount > 0) {
    const rankedSuggestions = [];
    visibleSuggestions.forEach((entry, index) => {
      const text = entry.text;
      const weightedScore = scoreSuggestionText(text, {
        normalizedPrimary: addressHints.normalizedPrimary,
        tokens: addressHints.tokens,
        streetNumber: addressHints.streetNumber,
      });
      rankedSuggestions.push({
        ...entry,
        rankIndex: index,
        weightedScore,
      });
    });
    rankedSuggestions.sort((left, right) => right.weightedScore - left.weightedScore || left.rankIndex - right.rankIndex);

    logWayDebug(
      `Way search debug: ranked suggestions -> ${JSON.stringify(
        rankedSuggestions.map((entry) => ({
          index: entry.index,
          text: entry.text,
          score: entry.weightedScore,
        })),
      )}`,
    );

    for (const candidate of rankedSuggestions) {
      const candidateLocator = page.locator(WAY_SELECTORS.home.locationSuggestion).nth(candidate.index);
      const clicked = await candidateLocator.click({ force: true }).then(() => true).catch(() => false);
      if (!clicked) {
        await page.keyboard.press("ArrowDown").catch(() => {});
        await page.keyboard.press("Enter").catch(() => {});
      }
      await page.waitForTimeout(500);

      const candidateLocationValue = await locationInput.inputValue().catch(() => "");
      const candidateLocationScore = scoreSuggestionText(candidateLocationValue, addressHints);
      const candidateTextScore = scoreSuggestionText(candidate.text, addressHints);
      if (candidateLocationScore >= 10 || candidateTextScore >= 10) {
        selectedSuggestion = candidate;
        console.log(`Way search: selected suggestion -> ${candidate.text}`);
        break;
      }

      await locationInput.click().catch(() => {});
      await page.waitForTimeout(250);
    }

    if (!selectedSuggestion) {
      throw new Error("Way location suggestions were visible, but no acceptable suggestion could be confirmed.");
    }
  } else {
    await page.keyboard.press("ArrowDown").catch(() => {});
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter").catch(() => {});
    console.log("Way search: attempted suggestion selection via keyboard fallback");
  }

  await page.waitForTimeout(900);

  const selectedLocationValue = await locationInput.inputValue().catch(() => "");
  if (!selectedLocationValue || selectedLocationValue.trim().length < 8) {
    throw new Error("Way location selection was not confirmed after typing and suggestion handling.");
  }
  const selectedLocationScore = scoreSuggestionText(selectedLocationValue, addressHints);
  const selectedSuggestionScore = selectedSuggestion ? scoreSuggestionText(selectedSuggestion.text, addressHints) : 0;
  const airportLocationAliases = airportMetadata
    ? [airportMetadata.airport_query || "", ...(airportMetadata.lot_aliases || [])]
    : [];
  const selectedAirportAliasScore = scoreAliasMatch(selectedLocationValue, airportLocationAliases);
  const locationSelectionAccepted = searchMode === "airport"
    ? selectedLocationScore >= 10 || selectedSuggestionScore >= 10 || selectedAirportAliasScore >= 12
    : selectedLocationScore >= 10 || selectedSuggestionScore >= 10;
  if (!locationSelectionAccepted) {
    throw new Error(`Way selected location does not sufficiently match target address: ${selectedLocationValue}`);
  }
  console.log(`Way search: confirmed location value -> ${selectedLocationValue}`);

  const locationDebugState = await page
    .evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"))
        .map((node) => ({
          type: node.getAttribute("type") || "",
          name: node.getAttribute("name") || "",
          value: node.value || "",
          placeholder: node.getAttribute("placeholder") || "",
        }))
        .filter((entry) => entry.value || entry.name)
        .slice(0, 20);

      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((node) => ({
          text: (node.textContent || "").replace(/\s+/g, " ").trim(),
          href: node.getAttribute("href") || "",
        }))
        .filter((entry) => /parking|alpharetta|old milton|hourly/i.test(`${entry.text} ${entry.href}`))
        .slice(0, 20);

      const bodyText = (document.body.innerText || "").replace(/\s+/g, " ").trim();
      const coordinates = bodyText.match(/-?\d+\.\d{4,}/g) || [];

      return {
        inputs,
        links,
        coordinates: coordinates.slice(0, 10),
        currentUrl: window.location.href,
      };
    })
    .catch(() => ({ inputs: [], links: [], coordinates: [], currentUrl: "" }));

  logWayDebug(`Way search debug: location state -> ${JSON.stringify(locationDebugState)}`);

  // Way's auto-advance behavior has proven too fragile across venues. We now
  // select each field independently: complete check-in first, then open a fresh
  // checkout picker and apply the end date/time explicitly.
  await selectDateAndTime(page, WAY_SELECTORS.home.checkInSection, checkoutWindow.startDate, checkoutWindow.startDisplay);
  console.log(`Way search: selected check-in -> ${checkoutWindow.startDate} ${checkoutWindow.startDisplay}`);
  await selectDateAndTime(page, WAY_SELECTORS.home.checkoutSection, checkoutWindow.endDate, checkoutWindow.endDisplay);
  console.log(`Way search: selected checkout -> ${checkoutWindow.endDate} ${checkoutWindow.endDisplay}`);
  if (WAY_CAPTURE_TRACE_ARTIFACTS) {
    const buyingPaths = getBuyingBotOperativePaths();
    await page
      .screenshot({
        path: buyingPaths.screenshots.wayAfterCheckin,
        fullPage: true,
      })
      .catch(() => {});
  }

  const preSearchWindowSnapshot = await readWidgetWindow(page);
  logWayDebug(
    `Way search: pre-search widget window -> ${JSON.stringify({
      checkInValue: preSearchWindowSnapshot.checkInValue,
      checkoutValue: preSearchWindowSnapshot.checkoutValue,
    })}`,
  );

  const searchPickerStillVisible = await closeOpenCalendarPicker(page);
  await waitForCalendarBackdropToClear(page);
  console.log(`Way search: picker closed before search -> ${searchPickerStillVisible ? "no" : "yes"}`);
  await page.waitForTimeout(500);
  await suppressFloatingOverlays(page);
  const searchOutcome = await triggerSearch(page, config);
  if (!searchOutcome) {
    throw new Error("Way search button did not transition to results after all click strategies.");
  }
  console.log(`Way search: search outcome -> ${searchOutcome}`);

  if (searchMode === "airport") {
    const resultsMode = await ensureWayResultsMode(page, "airport");
    console.log(`Way search: results mode -> ${resultsMode.mode}`);
  }

  console.log(`Way search: post-search page -> ${page.url()}`);
  const clearedResultsCartState = await clearWayCartState(page);
  if (clearedResultsCartState.removed > 0 || clearedResultsCartState.hadOrderSummary) {
    console.log(`Way search: cleared stale results cart state -> ${JSON.stringify(clearedResultsCartState)}`);
  }
  await validateResultsWindow(
    page,
    checkoutWindow.startDate,
    checkoutWindow.startDisplay,
    checkoutWindow.endDate,
    checkoutWindow.endDisplay,
  );

  return {
    status: "search_completed",
    locationQuery,
    checkoutWindow,
    searchMode,
  };
}

async function selectLot(page, record, options = {}) {
  const context = page.context();
  const existingPages = new Set(context.pages());

  await page
    .evaluate(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
      window.scrollTo({ top: 500, behavior: "auto" });
      window.scrollTo({ top: 1200, behavior: "auto" });
    })
    .catch(() => {});
  await page.waitForTimeout(400);

  const waitForCheckoutSurface = async () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const pages = context.pages();
      const candidatePages = [
        ...pages.filter((candidate) => !existingPages.has(candidate)),
        ...pages,
      ];

      for (const candidatePage of candidatePages) {
        if (!candidatePage || candidatePage.isClosed()) {
          continue;
        }

        await candidatePage.waitForLoadState("domcontentloaded").catch(() => {});
        const url = candidatePage.url();
        const loginVisible = await candidatePage.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);
        const proceedVisible = await candidatePage
          .locator(WAY_SELECTORS.checkout.proceedToCheckoutButton)
          .first()
          .isVisible()
          .catch(() => false);
        const finalCheckoutVisible = await candidatePage
          .locator(WAY_SELECTORS.checkout.finalCheckoutButton)
          .first()
          .isVisible()
          .catch(() => false);

        if (
          loginVisible ||
          /\/login\b/i.test(url) ||
          proceedVisible ||
          finalCheckoutVisible ||
          /\/checkout\b/i.test(url)
        ) {
          return candidatePage;
        }
      }

      await page.waitForTimeout(400);
    }

    return page;
  };

  const waitForCheckoutReady = async (candidatePage) => {
    await candidatePage.waitForLoadState("domcontentloaded").catch(() => {});

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const loginVisible = await candidatePage.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);
      const proceedVisible = await candidatePage
        .locator(WAY_SELECTORS.checkout.proceedToCheckoutButton)
        .first()
        .isVisible()
        .catch(() => false);
      const finalCheckoutVisible = await candidatePage
        .locator(WAY_SELECTORS.checkout.finalCheckoutButton)
        .first()
        .isVisible()
        .catch(() => false);

      if (
        loginVisible ||
        proceedVisible ||
        finalCheckoutVisible ||
        /\/checkout\b/i.test(candidatePage.url())
      ) {
        return;
      }

      await candidatePage.waitForTimeout(250);
    }
  };

  const collectResultCards = async () =>
    page.evaluate(() => {
      const getVisibleRect = (node) => {
        if (!(node instanceof Element)) {
          return null;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0;
        return visible ? rect : null;
      };

      const actionNodes = Array.from(document.querySelectorAll("button, a, div, span"))
        .map((node) => ({
          node,
          rect: getVisibleRect(node),
          text: (node.textContent || "").replace(/\s+/g, " ").trim(),
        }))
        .filter((entry) => entry.rect && /^(reserve now|soldout)$/i.test(entry.text));

      return actionNodes.map((entry, index) => {
        const normalizeText = (value) => (value || "").replace(/\s+/g, " ").trim();
        const stripLeadLabels = (value) =>
          normalizeText(value)
            .replace(/^(just dropped|top rated|nearest|selling out fast|8 free benefits)\s*/gi, "")
            .trim();
        const deriveTitleFromContainer = (containerText, addressLine) => {
          const cleaned = stripLeadLabels(containerText);
          const addressMatches = [
            ...cleaned.matchAll(/\b\d{2,6}\s+[A-Za-z0-9.()'-]+(?:\s+[A-Za-z0-9.()'&/-]+){0,8}/g),
          ];

          if (addressMatches.length >= 2) {
            const first = addressMatches[0];
            const second = addressMatches[1];
            const title = cleaned.slice(first.index, second.index).trim();
            if (title) {
              return title;
            }
          }

          if (addressLine) {
            const addressIndex = cleaned.indexOf(addressLine);
            if (addressIndex > 0) {
              const title = cleaned.slice(0, addressIndex).trim();
              if (title) {
                return stripLeadLabels(title);
              }
            }
          }

          return "";
        };
        let current = entry.node;
        let container = entry.node;
        for (let depth = 0; depth < 6 && current; depth += 1) {
          const parent = current.parentElement;
          if (!parent) {
            break;
          }
          const parentText = (parent.textContent || "").replace(/\s+/g, " ").trim();
          if (parentText.length > 30 && parentText.length < 600) {
            container = parent;
          }
          current = parent;
        }

        const containerText = normalizeText(container.textContent || "");
        const textLines = containerText
          .split(/(?<=\S)\s{2,}|\n+/)
          .map((line) => normalizeText(line))
          .filter(Boolean);
        const addressLine =
          textLines.find((line) => /\d{2,}\s+[A-Za-z]/.test(line)) ||
          textLines.find((line) => /parkway|street|st\b|avenue|ave\b|road|rd\b|boulevard|blvd\b|drive|dr\b/i.test(line)) ||
          "";
        const titleLine =
          textLines.find((line) => !/^\$?\d+(\.\d{2})?$/.test(line) && !/reserve now|soldout|more details/i.test(line)) ||
          deriveTitleFromContainer(containerText, addressLine) ||
          "";

        return {
          index,
          actionText: entry.text,
          containerText,
          titleText: titleLine,
          addressText: addressLine,
        };
      });
    }).catch(() => []);

  const onAirportResultsPage = /\/Airport\b/i.test(page.url());
  const lotAliases = Array.isArray(options.lotAliases) ? options.lotAliases.filter(Boolean) : [];
  const clickAirportShowAll = async () =>
    page.evaluate(() => {
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };

      const candidate = Array.from(document.querySelectorAll("button, a, div, span"))
        .find((node) => {
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          return isVisible(node) && /^show all\s*\(\d+\)$/i.test(text);
        });

      if (!candidate) {
        return { clicked: false };
      }

      candidate.click();
      return {
        clicked: true,
        text: (candidate.textContent || "").replace(/\s+/g, " ").trim(),
      };
    }).catch(() => ({ clicked: false }));

  const sortAirportResultsByCheapest = async () =>
    page.evaluate(() => {
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };

      const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
      const nodes = Array.from(document.querySelectorAll("button, [role=\"button\"], div, span, li"));
      const sortTrigger = nodes.find((node) => isVisible(node) && /^recommended$/i.test(normalize(node.textContent || "")));
      if (sortTrigger) {
        sortTrigger.click();
      }

      const cheapestOption = Array.from(document.querySelectorAll("button, [role=\"button\"], div, span, li"))
        .find((node) => isVisible(node) && /^cheapest$/i.test(normalize(node.textContent || "")));

      if (!cheapestOption) {
        return { changed: false };
      }

      cheapestOption.click();
      return { changed: true };
    }).catch(() => ({ changed: false }));

  const dedupeCards = (cards = []) => {
    const seen = new Set();
    const merged = [];
    for (const card of cards) {
      const key = normalizeResultText(`${card.containerText}|||${card.titleText}|||${card.addressText}|||${card.actionText}`);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(card);
    }
    return merged;
  };

  let resultCards = [];
  if (onAirportResultsPage) {
    const showAllResult = await clickAirportShowAll();
    if (showAllResult?.clicked) {
      logWayDebug(`Way results: clicked show all -> ${JSON.stringify(showAllResult)}`);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
    }
  }

  for (let attempt = 0; attempt < (onAirportResultsPage ? 10 : 5); attempt += 1) {
    const batchCards = await collectResultCards();
    resultCards = dedupeCards([...resultCards, ...batchCards]);

    const hasExactAliasInCurrentBatch = lotAliases.length > 0 && batchCards.some((card) =>
      hasExactAliasMatch(`${card.titleText} ${card.addressText} ${card.containerText}`, lotAliases),
    );

    if (resultCards.length > 0 && (!lotAliases.length || hasExactAliasInCurrentBatch)) {
      break;
    }

    if (onAirportResultsPage) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
    }

    await page
      .evaluate((position) => {
        window.scrollTo({ top: position, behavior: "auto" });
      }, 1200 + attempt * 500)
      .catch(() => {});
    await page.waitForTimeout((onAirportResultsPage ? 1200 : 600) + attempt * 300);
  }

  if (resultCards.length === 0 && onAirportResultsPage) {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    resultCards = dedupeCards(await collectResultCards());
  }

  const hasAnyExactAlias = lotAliases.length > 0 && resultCards.some((card) =>
    hasExactAliasMatch(`${card.titleText} ${card.addressText} ${card.containerText}`, lotAliases),
  );

  if (onAirportResultsPage && lotAliases.length > 0 && !hasAnyExactAlias) {
    const sortResult = await sortAirportResultsByCheapest();
    if (sortResult?.changed) {
      logWayDebug(`Way results: changed airport sort -> ${JSON.stringify(sortResult)}`);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);

      let cheapestCards = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const batchCards = await collectResultCards();
        cheapestCards = dedupeCards([...cheapestCards, ...batchCards]);
        const foundExactAlias = cheapestCards.some((card) =>
          hasExactAliasMatch(`${card.titleText} ${card.addressText} ${card.containerText}`, lotAliases),
        );
        if (foundExactAlias) {
          break;
        }
        await page
          .evaluate((position) => {
            window.scrollTo({ top: position, behavior: "auto" });
          }, 1200 + attempt * 500)
          .catch(() => {});
        await page.waitForTimeout(1200 + attempt * 250);
      }

      resultCards = dedupeCards([...resultCards, ...cheapestCards]);
    }
  }

  const targetLocation = normalizeWaySearchLocation(record.parking_location || "", record.city_state || "");
  const addressHints = getAddressSelectionHints(targetLocation);
  const normalizedTargetLocation = normalizeAddressText(targetLocation);
  const scoredCards = resultCards.map((card) => ({
    ...card,
    aliasScore: scoreAliasMatch(`${card.titleText} ${card.addressText} ${card.containerText}`, lotAliases),
    exactAliasMatched: hasExactAliasMatch(`${card.titleText} ${card.addressText} ${card.containerText}`, lotAliases),
    score:
      scoreLotMatch(card.containerText, addressHints) +
      scoreAliasMatch(`${card.titleText} ${card.addressText} ${card.containerText}`, lotAliases) +
      (card.addressText && normalizeAddressText(card.addressText).includes(normalizedTargetLocation) ? 25 : 0) +
      (card.titleText && normalizeAddressText(card.titleText).includes(addressHints.normalizedPrimary) ? 8 : 0) +
      tokenOverlapCount(targetLocation, `${card.addressText} ${card.titleText} ${card.containerText}`, 3) * 2,
    streetNumberMatched:
      Boolean(addressHints.streetNumber) &&
      normalizeAddressText(`${card.addressText} ${card.titleText} ${card.containerText}`).includes(addressHints.streetNumber),
    tokenOverlap: tokenOverlapCount(targetLocation, `${card.addressText} ${card.titleText} ${card.containerText}`, 3),
    available: /reserve now/i.test(card.actionText),
  }));

  scoredCards.sort((left, right) => right.score - left.score);
  logWayDebug(`Way results: candidate lots -> ${JSON.stringify(scoredCards.slice(0, 8))}`);

  const strongAliasCandidate = lotAliases.length > 0
    ? (
      scoredCards.find((card) => card.available && card.exactAliasMatched)
      || scoredCards.find((card) => card.exactAliasMatched)
      || null
    )
    : null;

  if (lotAliases.length > 0 && !strongAliasCandidate) {
    return {
      status: "parking_lot_not_found",
      error_message: "Parking lot not found.",
      alias_match_required: true,
    };
  }

  const bestCard = lotAliases.length > 0
    ? strongAliasCandidate
    : scoredCards[0];

  const bestSoldOutCandidate = scoredCards.find(
    (card) =>
      !card.available &&
      /soldout/i.test(card.actionText) &&
      (
        card.score >= 6 ||
        card.aliasScore >= 12 ||
        card.streetNumberMatched ||
        card.tokenOverlap >= 2
      ),
  );
  if (!bestCard || bestCard.score < 8) {
    if (bestSoldOutCandidate) {
      console.log("Way results: target lot is sold out.");
      return {
        status: "target_lot_sold_out",
        matched_text: bestSoldOutCandidate.containerText,
        matched_title: bestSoldOutCandidate.titleText,
        matched_address: bestSoldOutCandidate.addressText,
        sold_out_group_key: `${normalizeAddressText(record.event)}|${record.event_date}|${normalizeAddressText(targetLocation)}`,
      };
    }
    throw new Error("Way results did not contain a strong address match for the target parking location.");
  }

  if (!bestCard.available) {
    if (/soldout/i.test(bestCard.actionText)) {
      console.log("Way results: target lot is sold out.");
      return {
        status: "target_lot_sold_out",
        matched_text: bestCard.containerText,
        matched_title: bestCard.titleText,
        matched_address: bestCard.addressText,
        sold_out_group_key: `${normalizeAddressText(record.event)}|${record.event_date}|${normalizeAddressText(targetLocation)}`,
      };
    }

    const bestAvailableAlternative = scoredCards.find((card) => card.available);
    const fallbackIsStrongMatch =
      bestAvailableAlternative &&
      bestAvailableAlternative.score >= 12 &&
      bestAvailableAlternative.score >= Math.max(12, bestCard.score - 10);

    if (fallbackIsStrongMatch) {
      console.log("Way results: clicking fallback Reserve Now...");
      await page
        .evaluate((targetIndex) => {
          const getVisibleRect = (node) => {
            if (!(node instanceof Element)) {
              return null;
            }
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            const visible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              Number(style.opacity || "1") > 0;
            return visible ? rect : null;
          };

          const actionNodes = Array.from(document.querySelectorAll("button, a"))
            .map((node) => ({
              node,
              rect: getVisibleRect(node),
              text: (node.textContent || "").replace(/\s+/g, " ").trim(),
            }))
            .filter((entry) => entry.rect && /reserve now|soldout/i.test(entry.text));

          const target = actionNodes[targetIndex];
          if (target) {
            target.node.click();
          }
        }, bestAvailableAlternative.index)
        .catch(() => {});
      const activePage = await waitForCheckoutSurface();
      await waitForCheckoutReady(activePage);
      console.log(`Way results: fallback lot click completed, current URL -> ${activePage.url()}`);

      return {
        status: "fallback_lot_selected",
        active_page_url: activePage.url(),
        matched_text: bestAvailableAlternative.containerText,
        matched_title: bestAvailableAlternative.titleText,
        matched_address: bestAvailableAlternative.addressText,
        match_score: bestAvailableAlternative.score,
        street_number_matched: bestAvailableAlternative.streetNumberMatched,
        token_overlap: bestAvailableAlternative.tokenOverlap,
        replaced_unavailable_best_match: {
          title: bestCard.titleText,
          address: bestCard.addressText,
          score: bestCard.score,
          matched_text: bestCard.containerText,
        },
      };
    }

    return {
      status: "best_match_unavailable",
      matched_text: bestCard.containerText,
      matched_title: bestCard.titleText,
      matched_address: bestCard.addressText,
      best_available_alternative: bestAvailableAlternative
        ? {
            title: bestAvailableAlternative.titleText,
            address: bestAvailableAlternative.addressText,
            score: bestAvailableAlternative.score,
            matched_text: bestAvailableAlternative.containerText,
          }
        : null,
    };
  }

  console.log("Way results: clicking best-match Reserve Now...");
  await page
    .evaluate((targetIndex) => {
      const getVisibleRect = (node) => {
        if (!(node instanceof Element)) {
          return null;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0;
        return visible ? rect : null;
      };

      const actionNodes = Array.from(document.querySelectorAll("button, a"))
        .map((node) => ({
          node,
          rect: getVisibleRect(node),
          text: (node.textContent || "").replace(/\s+/g, " ").trim(),
        }))
        .filter((entry) => entry.rect && /reserve now|soldout/i.test(entry.text));

      const target = actionNodes[targetIndex];
      if (target) {
        target.node.click();
      }
    }, bestCard.index)
    .catch(() => {});
  const activePage = await waitForCheckoutSurface();
  await waitForCheckoutReady(activePage);
  console.log(`Way results: best-match lot click completed, current URL -> ${activePage.url()}`);

  return {
    status: "lot_selected",
    active_page_url: activePage.url(),
    matched_text: bestCard.containerText,
    matched_title: bestCard.titleText,
    matched_address: bestCard.addressText,
    match_score: bestCard.score,
    street_number_matched: bestCard.streetNumberMatched,
    token_overlap: bestCard.tokenOverlap,
  };
}

async function getActiveWayPage(page) {
  const context = page.context();
  const pages = context.pages().filter((candidate) => candidate && !candidate.isClosed());

  for (const candidatePage of [...pages].reverse()) {
    const url = candidatePage.url();
    const proceedVisible = await candidatePage
      .locator(WAY_SELECTORS.checkout.proceedToCheckoutButton)
      .first()
      .isVisible()
      .catch(() => false);
    const finalCheckoutVisible = await candidatePage
      .locator(WAY_SELECTORS.checkout.finalCheckoutButton)
      .first()
      .isVisible()
      .catch(() => false);
    const loginVisible = await candidatePage.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);

    if (
      proceedVisible ||
      finalCheckoutVisible ||
      loginVisible ||
      /\/checkout\b/i.test(url) ||
      /\/login\b/i.test(url)
    ) {
      return candidatePage;
    }
  }

  return page;
}

async function completeCheckout(page) {
  const config = getWayConfig();
  const membershipPreflight = await ensureMembershipUpsellDeclined(page, 2);
  if (membershipPreflight.present) {
    console.log(`Way checkout: membership preflight -> ${JSON.stringify(membershipPreflight)}`);
  }
  if (membershipPreflight.present && !membershipPreflight.declineSelected) {
    return {
      status: "membership_selection_required",
      current_url: page.url(),
      membership_decline_result: membershipPreflight,
    };
  }

  const priceSnapshot = await page.locator(WAY_SELECTORS.checkout.priceSummary).first().textContent().catch(() => "");
  let vehicleRecoveryAttempted = false;
  let preClickLicensePlateRequirement = await detectLicensePlateRequirement(page);
  if (preClickLicensePlateRequirement) {
    // Try to recover inside the same checkout page before escalating to a full
    // record-level retry. This is safer and faster than restarting immediately.
    console.log("Way checkout retry: dismissing license plate modal before checkout.");
    const dismissed = await dismissLicensePlateRequirementModal(page);
    console.log(`Way checkout retry: dismiss modal result -> ${dismissed ? "dismissed" : "not_dismissed"}`);
    console.log("Way checkout retry: attempting saved vehicle recovery before checkout.");
    const vehicleRecovery = await tryResolveLicensePlateRequirement(page);
    console.log(`Way checkout retry: saved vehicle recovery result -> ${JSON.stringify(vehicleRecovery)}`);
    vehicleRecoveryAttempted = vehicleRecoveryAttempted || vehicleRecovery.recovered;
    preClickLicensePlateRequirement = await detectLicensePlateRequirement(page);
  }
  if (preClickLicensePlateRequirement && !vehicleRecoveryAttempted) {
    return {
      status: "license_plate_required",
      priceSnapshot: priceSnapshot || "",
      current_url: page.url(),
      vehicle_recovery_attempted: vehicleRecoveryAttempted,
      license_plate_requirement: preClickLicensePlateRequirement,
    };
  }

  console.log(`Way checkout: pressing final Checkout at ${page.url()} ...`);
  const finalCheckoutLocator = getFinalCheckoutLocator(page);
  const clickResult = await clickCheckoutAction(page, finalCheckoutLocator, {
    actionName: "final Checkout",
    confirmNavigation: true,
  });
  console.log(`Way checkout: final click result -> ${JSON.stringify(clickResult)}`);

  const membershipStateAfterClick = await detectMembershipUpsell(page);
  if (/\/checkout\b/i.test(page.url()) && membershipStateAfterClick.present && !membershipStateAfterClick.declineSelected) {
    console.log(`Way checkout retry: membership state after click -> ${JSON.stringify(membershipStateAfterClick)}`);
    console.log("Way checkout retry: membership upsell still visible after checkout click.");
    const membershipDeclineResult = await ensureMembershipUpsellDeclined(page, 3);
    console.log(`Way checkout retry: membership dismiss result -> ${JSON.stringify(membershipDeclineResult)}`);
    const membershipStateAfterDismiss = await detectMembershipUpsell(page);
    console.log(`Way checkout retry: membership state after dismiss -> ${JSON.stringify(membershipStateAfterDismiss)}`);

    if (membershipStateAfterDismiss.present && !membershipStateAfterDismiss.declineSelected) {
      return {
        status: "membership_selection_required",
        priceSnapshot: priceSnapshot || "",
        current_url: page.url(),
        click_result: clickResult,
        membership_decline_result: membershipDeclineResult,
      };
    }

    const retryCheckoutLocator = getFinalCheckoutLocator(page);
    const membershipRetryClickResult = await clickCheckoutAction(page, retryCheckoutLocator, {
      actionName: "final Checkout retry after membership",
      confirmNavigation: true,
    });
    console.log(`Way checkout retry: final click after membership result -> ${JSON.stringify(membershipRetryClickResult)}`);

    const membershipStateAfterRetryClick = await detectMembershipUpsell(page);
    if (/\/checkout\b/i.test(page.url()) && membershipStateAfterRetryClick.present && !membershipStateAfterRetryClick.declineSelected) {
      console.log(`Way checkout retry: membership state after retry click -> ${JSON.stringify(membershipStateAfterRetryClick)}`);
      const retryDeclineResult = await ensureMembershipUpsellDeclined(page, 2);
      console.log(`Way checkout retry: membership second dismiss result -> ${JSON.stringify(retryDeclineResult)}`);
      const membershipStateAfterSecondDismiss = await detectMembershipUpsell(page);
      console.log(`Way checkout retry: membership state after second dismiss -> ${JSON.stringify(membershipStateAfterSecondDismiss)}`);
      if (membershipStateAfterSecondDismiss.present && !membershipStateAfterSecondDismiss.declineSelected) {
        return {
          status: "membership_selection_required",
          priceSnapshot: priceSnapshot || "",
          current_url: page.url(),
          click_result: membershipRetryClickResult,
          membership_decline_result: retryDeclineResult,
        };
      }

      const secondRetryCheckoutLocator = getFinalCheckoutLocator(page);
      const secondMembershipRetryClickResult = await clickCheckoutAction(page, secondRetryCheckoutLocator, {
        actionName: "final Checkout retry after membership verification",
        confirmNavigation: true,
      });
      console.log(`Way checkout retry: final click after second membership check -> ${JSON.stringify(secondMembershipRetryClickResult)}`);
    }
  }

  const licensePlateRequirement = await waitForLicensePlateRequirement(page, 5000);
  if (licensePlateRequirement) {
    console.log("Way checkout retry: dismissing license plate modal after checkout attempt.");
    const dismissed = await dismissLicensePlateRequirementModal(page);
    console.log(`Way checkout retry: dismiss modal result -> ${dismissed ? "dismissed" : "not_dismissed"}`);
    console.log("Way checkout retry: attempting saved vehicle recovery after license plate requirement.");
    const vehicleRecovery = await tryResolveLicensePlateRequirement(page);
    console.log(`Way checkout retry: saved vehicle recovery result -> ${JSON.stringify(vehicleRecovery)}`);
    vehicleRecoveryAttempted = vehicleRecoveryAttempted || vehicleRecovery.recovered;
    if (vehicleRecovery.recovered) {
      console.log("Way checkout retry: reselected saved vehicle after license plate requirement.");
      const secondCheckoutLocator = getFinalCheckoutLocator(page);
      const retryClickResult = await clickCheckoutAction(page, secondCheckoutLocator, {
        actionName: "final Checkout retry",
        confirmNavigation: true,
      });
      console.log(`Way checkout retry: final click result -> ${JSON.stringify(retryClickResult)}`);

      const remainingLicensePlateRequirement = await waitForLicensePlateRequirement(page, 3500);
      if (!remainingLicensePlateRequirement) {
        const retryPostCheckoutState = await waitForPostCheckoutState(page, config);
        const retryReachedOrderConfirmed = retryPostCheckoutState.confirmed;

        if (!retryReachedOrderConfirmed) {
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          await page.waitForTimeout(1200);
        }

        console.log(`Way checkout: post-submit URL -> ${page.url()}`);
        return {
          status: retryReachedOrderConfirmed ? "checkout_confirmed" : "checkout_not_confirmed",
          priceSnapshot: priceSnapshot || "",
          current_url: page.url(),
          click_result: retryClickResult,
          vehicle_recovery_attempted: vehicleRecoveryAttempted,
          order_confirmed_state: retryPostCheckoutState,
        };
      }

      console.log(`Way checkout: license plate requirement detected -> ${remainingLicensePlateRequirement.message}`);
      return {
        status: "license_plate_required",
        priceSnapshot: priceSnapshot || "",
        current_url: page.url(),
        click_result: retryClickResult,
        vehicle_recovery_attempted: vehicleRecoveryAttempted,
        license_plate_requirement: remainingLicensePlateRequirement,
      };
    }

    console.log(`Way checkout: license plate requirement detected -> ${licensePlateRequirement.message}`);
    return {
      status: "license_plate_required",
      priceSnapshot: priceSnapshot || "",
      current_url: page.url(),
      click_result: clickResult,
      vehicle_recovery_attempted: vehicleRecoveryAttempted,
      license_plate_requirement: licensePlateRequirement,
    };
  }

  const postCheckoutState = await waitForPostCheckoutState(page, config);
  const reachedOrderConfirmed = postCheckoutState.confirmed;

  if (!reachedOrderConfirmed) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1200);
  }

  console.log(`Way checkout: post-submit URL -> ${page.url()}`);

  return {
    status: reachedOrderConfirmed ? "checkout_confirmed" : "checkout_not_confirmed",
    priceSnapshot: priceSnapshot || "",
    current_url: page.url(),
    click_result: clickResult,
    vehicle_recovery_attempted: vehicleRecoveryAttempted,
    order_confirmed_state: postCheckoutState,
  };
}

async function handleOrderConfirmedFollowUp(page) {
  const skipLocator = page.locator(WAY_SELECTORS.checkout.orderConfirmedSkipButton).first();
  const continueLocator = page.locator(WAY_SELECTORS.checkout.orderConfirmedContinueButton).first();

  const skipVisible = await skipLocator.isVisible().catch(() => false);
  if (skipVisible) {
    const clickResult = await clickCheckoutAction(page, skipLocator, {
      actionName: "order confirmed Skip",
      confirmNavigation: false,
    }).catch(() => ({ status: "skip_click_failed" }));
    await page.waitForTimeout(1200);
    return {
      action: "skip",
      click_result: clickResult,
      current_url: page.url(),
    };
  }

  const continueVisible = await continueLocator.isVisible().catch(() => false);
  if (continueVisible) {
    const clickResult = await clickCheckoutAction(page, continueLocator, {
      actionName: "order confirmed Continue",
      confirmNavigation: false,
    }).catch(() => ({ status: "continue_click_failed" }));
    await page.waitForTimeout(1200);
    return {
      action: "continue",
      click_result: clickResult,
      current_url: page.url(),
    };
  }

  return {
    action: "none",
    current_url: page.url(),
  };
}

async function waitForPostCheckoutState(page, config) {
  const deadline = Date.now() + 18000;
  let retriedCheckoutClick = false;

  while (Date.now() < deadline) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const url = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const normalizedBody = String(bodyText).replace(/\s+/g, " ").trim();
    const confirmedUrl = String(url).startsWith(config.orderConfirmedUrl);
    const confirmedText =
      /your order is confirmed|order confirmation|booking confirmed/i.test(normalizedBody);

    if (confirmedUrl || confirmedText) {
      const followUp = await handleOrderConfirmedFollowUp(page);
      return {
        confirmed: true,
        current_url: page.url(),
        confirmation_url_detected: confirmedUrl,
        confirmation_text_detected: confirmedText,
        follow_up: followUp,
      };
    }

    const stillOnCheckout = /\/checkout\b/i.test(String(url));
    const finalCheckoutVisible = await getFinalCheckoutLocator(page).isVisible().catch(() => false);
    const membershipState = await detectMembershipUpsell(page).catch(() => ({ present: false, declineSelected: false }));
    const licensePlateRequirement = await detectLicensePlateRequirement(page).catch(() => null);
    const membershipBlocking = Boolean(membershipState?.present && !membershipState?.declineSelected);

    if (
      stillOnCheckout &&
      finalCheckoutVisible &&
      !membershipBlocking &&
      !licensePlateRequirement &&
      !retriedCheckoutClick
    ) {
      retriedCheckoutClick = true;
      const retryLocator = getFinalCheckoutLocator(page);
      const retryClickResult = await clickCheckoutAction(page, retryLocator, {
        actionName: "final Checkout verification retry",
        confirmNavigation: true,
      }).catch(() => ({ status: "retry_failed" }));
      console.log(`Way checkout retry: second final click result -> ${JSON.stringify(retryClickResult)}`);
      await page.waitForTimeout(1800);
      continue;
    }

    if (stillOnCheckout && finalCheckoutVisible) {
      return {
        confirmed: false,
        current_url: url,
        still_on_checkout: true,
        final_checkout_visible: true,
        membership_present: Boolean(membershipState?.present),
        membership_decline_selected: Boolean(membershipState?.declineSelected),
        license_plate_requirement: licensePlateRequirement?.message || null,
      };
    }

    await page.waitForTimeout(1200);
  }

  return {
    confirmed: false,
    current_url: page.url(),
    timeout_waiting_for_confirmation: true,
  };
}

function getProceedToCheckoutLocator(page) {
  return page
    .locator("button, a")
    .filter({ hasText: /^\s*Proceed to Checkout\s*$/ })
    .first();
}

function getFinalCheckoutLocator(page) {
  return page
    .locator("button")
    .filter({ hasText: /^\s*Checkout\s*$/ })
    .first();
}

async function dismissMembershipUpsell(page) {
  const result = await page
    .evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const declinePattern = /No,\s*I don[’']t want discounts?\s*&\s*benefits?/i;
      const genericPattern = /No thanks|Skip|Continue without/i;
      const nodes = Array.from(document.querySelectorAll("label, button, [role='button'], div, span, p"))
        .filter((node) => isVisible(node))
        .map((node) => ({
          node,
          text: normalize(node.textContent || ""),
        }));

      const directMatch = nodes
        .filter((entry) => declinePattern.test(entry.text))
        .sort((left, right) => left.text.length - right.text.length)[0];
      const fallbackMatch = nodes
        .filter((entry) => genericPattern.test(entry.text))
        .sort((left, right) => left.text.length - right.text.length)[0];
      const chosen = directMatch || fallbackMatch;

      if (!chosen) {
        return { dismissed: false, reason: "not_present" };
      }

      const target =
        chosen.node.closest('label, button, [role="button"], .cursor-pointer, [class*="radio"], [class*="option"]') ||
        chosen.node;

      if (!(target instanceof HTMLElement)) {
        return { dismissed: false, reason: "no_click_target" };
      }

      target.scrollIntoView({ block: "center", behavior: "instant" });
      const radioInput =
        target.querySelector?.('input[type="radio"], input[type="checkbox"]') ||
        chosen.node.querySelector?.('input[type="radio"], input[type="checkbox"]') ||
        target.closest("label")?.querySelector?.('input[type="radio"], input[type="checkbox"]') ||
        chosen.node.closest("label")?.querySelector?.('input[type="radio"], input[type="checkbox"]');

      if (radioInput instanceof HTMLElement) {
        radioInput.click();
        radioInput.dispatchEvent(new Event("change", { bubbles: true }));
      }

      target.click();

      return {
        dismissed: true,
        text: chosen.text,
      };
    })
    .catch(() => ({ dismissed: false, reason: "evaluate_failed" }));

  if (result.dismissed) {
    console.log(`Way checkout: declined membership upsell -> ${result.text || "matched option"}`);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(900);
  }

  return result;
}

async function detectMembershipUpsell(page) {
  return page
    .evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const visibleTexts = Array.from(document.querySelectorAll("label, div, span, p, h1, h2, h3"))
        .filter((node) => isVisible(node))
        .map((node) => normalize(node.textContent || ""))
        .filter(Boolean)
        .sort((left, right) => left.length - right.length);

      const yesPattern = /Yes,\s*I want to save up to/i;
      const noPattern = /No,\s*I don[’']t want discounts?\s*&\s*benefits?/i;
      const checkedNoPattern = /^✓\s*No,\s*I don[’']t want discounts?\s*&\s*benefits?/i;
      const checkedYesPattern = /^✓\s*Yes,\s*I want to save up to/i;
      const present = visibleTexts.some((text) =>
        /Exclusive savings & benefits with Way\+\s*Sapphire|Way\+\s*Sapphire|No,\s*I don[’']t want discounts?\s*&\s*benefits?|Yes,\s*I want to save up to/i.test(text),
      );

      const declineRadio = document.querySelector('input[name="way-plus-radio"][value="false"]');
      const acceptRadio = document.querySelector('input[name="way-plus-radio"][value="true"]');
      const inputs = Array.from(document.querySelectorAll("input[type='radio'], input[type='checkbox']")).filter((input) => isVisible(input) || isVisible(input.closest("label")));
      const declineRadioChecked = Boolean(declineRadio instanceof HTMLInputElement && declineRadio.checked);
      const acceptRadioChecked = Boolean(acceptRadio instanceof HTMLInputElement && acceptRadio.checked);
      const checkedDeclineTextPresent = visibleTexts.some((text) => checkedNoPattern.test(text));
      const checkedAcceptTextPresent = visibleTexts.some((text) => checkedYesPattern.test(text));
      const declineOptionVisible = visibleTexts.some((text) => noPattern.test(text));
      const acceptOptionVisible = visibleTexts.some((text) => yesPattern.test(text));
      const fullPriceCopyPresent = visibleTexts.some((text) =>
        /continue without way\+\s*sapphire and pay full price on this booking/i.test(text) ||
        /i would like to continue paying full price on my car expenses/i.test(text),
      );
      const declineSelected = inputs.some((input) => {
        const text = normalize(input.closest("label")?.innerText || input.parentElement?.innerText || "");
        return noPattern.test(text) && input.checked;
      }) || declineRadioChecked || checkedDeclineTextPresent;
      const acceptSelected = inputs.some((input) => {
        const text = normalize(input.closest("label")?.innerText || input.parentElement?.innerText || "");
        return yesPattern.test(text) && input.checked;
      }) || acceptRadioChecked || checkedAcceptTextPresent;

      return {
        present,
        declineSelected,
        acceptSelected,
        declineRadioVisible: Boolean(declineRadio instanceof HTMLElement && (isVisible(declineRadio) || isVisible(declineRadio.closest("label")))),
        declineRadioChecked,
        acceptRadioVisible: Boolean(acceptRadio instanceof HTMLElement && (isVisible(acceptRadio) || isVisible(acceptRadio.closest("label")))),
        acceptRadioChecked,
        declineOptionVisible,
        acceptOptionVisible,
        checkedDeclineTextPresent,
        checkedAcceptTextPresent,
        fullPriceCopyPresent,
      };
    })
    .catch(() => ({
      present: false,
      declineSelected: false,
      acceptSelected: false,
      declineRadioVisible: false,
      declineRadioChecked: false,
      acceptRadioVisible: false,
      acceptRadioChecked: false,
      declineOptionVisible: false,
      acceptOptionVisible: false,
      checkedDeclineTextPresent: false,
      checkedAcceptTextPresent: false,
      fullPriceCopyPresent: false,
    }));
}

async function forceSelectMembershipDeclineOption(page) {
  const declineRadio = page.locator('input[name="way-plus-radio"][value="false"]').first();
  const declineRadioVisible = await declineRadio.isVisible().catch(() => false);
  if (declineRadioVisible) {
    const preChecked = await declineRadio.isChecked().catch(() => false);
    if (!preChecked) {
      await declineRadio.check({ force: true }).catch(() => {});
      await page.waitForTimeout(250);
    }

    const checkedAfterCheck = await declineRadio.isChecked().catch(() => false);
    if (!checkedAfterCheck) {
      await declineRadio.click({ force: true }).catch(() => {});
      await page.waitForTimeout(250);
    }

    const finalChecked = await declineRadio.isChecked().catch(() => false);
    if (finalChecked) {
      return {
        selected: true,
        text: "membership_decline_radio_checked",
      };
    }
  }

  return page
    .evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const declinePattern = /No,\s*I don[’']t want discounts?\s*&\s*benefits?/i;
      const candidates = Array.from(document.querySelectorAll("label, button, [role='button'], div, span, p"))
        .filter((node) => isVisible(node))
        .map((node) => ({
          node,
          text: normalize(node.textContent || ""),
        }))
        .filter((entry) => declinePattern.test(entry.text))
        .sort((left, right) => left.text.length - right.text.length);

      const chosen = candidates[0];
      if (!chosen) {
        return { selected: false, reason: "decline_option_not_found" };
      }

      const clickable =
        chosen.node.closest('label, button, [role="button"], .cursor-pointer, [class*="radio"], [class*="option"]') ||
        chosen.node;

      const radioInput =
        clickable.querySelector?.('input[type="radio"], input[type="checkbox"]') ||
        chosen.node.querySelector?.('input[type="radio"], input[type="checkbox"]') ||
        clickable.closest("label")?.querySelector?.('input[type="radio"], input[type="checkbox"]') ||
        chosen.node.closest("label")?.querySelector?.('input[type="radio"], input[type="checkbox"]');

      if (radioInput instanceof HTMLInputElement) {
        radioInput.checked = true;
        radioInput.dispatchEvent(new Event("input", { bubbles: true }));
        radioInput.dispatchEvent(new Event("change", { bubbles: true }));
        radioInput.click();
      }

      if (clickable instanceof HTMLElement) {
        clickable.scrollIntoView({ block: "center", behavior: "instant" });
        clickable.click();
      }

      return {
        selected: Boolean(radioInput instanceof HTMLInputElement ? radioInput.checked : true),
        text: chosen.text,
      };
    })
    .catch(() => ({ selected: false, reason: "evaluate_failed" }));
}

async function ensureMembershipUpsellDeclined(page, maxAttempts = 3) {
  let latestState = await detectMembershipUpsell(page).catch(() => ({ present: false, declineSelected: false }));
  let latestDismissResult = { dismissed: false, reason: "not_attempted" };
  let latestForceResult = { selected: false, reason: "not_attempted" };

  if (!latestState.present) {
    return {
      success: true,
      present: false,
      declineSelected: false,
      attempts: 0,
      dismissResult: latestDismissResult,
      forceResult: latestForceResult,
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latestDismissResult = await dismissMembershipUpsell(page);
    await page.waitForTimeout(500);
    latestState = await detectMembershipUpsell(page).catch(() => ({ present: false, declineSelected: false }));
    console.log(`Way checkout retry: membership state after dismiss attempt ${attempt} -> ${JSON.stringify(latestState)}`);
    if (latestState.declineSelected) {
      return {
        success: true,
        present: latestState.present,
        declineSelected: true,
        attempts: attempt,
        dismissResult: latestDismissResult,
        forceResult: latestForceResult,
      };
    }

    latestForceResult = await forceSelectMembershipDeclineOption(page);
    await page.waitForTimeout(700);
    latestState = await detectMembershipUpsell(page).catch(() => ({ present: false, declineSelected: false }));
    console.log(`Way checkout retry: membership state after force attempt ${attempt} -> ${JSON.stringify(latestState)}`);
    if (latestState.declineSelected) {
      return {
        success: true,
        present: latestState.present,
        declineSelected: true,
        attempts: attempt,
        dismissResult: latestDismissResult,
        forceResult: latestForceResult,
      };
    }
  }

  return {
    success: !latestState.present,
    present: latestState.present,
    declineSelected: latestState.declineSelected,
    attempts: maxAttempts,
    dismissResult: latestDismissResult,
    forceResult: latestForceResult,
  };
}

async function detectLicensePlateRequirement(page) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const normalized = String(bodyText).replace(/\s+/g, " ").trim();
  const explicitModalMatch =
    normalized.match(/License plate is mandatory to book[^.]*\./i) ||
    normalized.match(/License plate[^.]*mandatory[^.]*book[^.]*\./i) ||
    normalized.match(/license plate[^.]{0,120}required[^.]{0,120}book/i);
  if (explicitModalMatch) {
    return {
      status: "license_plate_required",
      message: explicitModalMatch[0],
    };
  }

  return null;
}

async function waitForLicensePlateRequirement(page, timeoutMs = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const requirement = await detectLicensePlateRequirement(page);
    if (requirement) {
      return requirement;
    }

    await page.waitForTimeout(250);
  }

  return null;
}

async function dismissLicensePlateRequirementModal(page) {
  const dismissViaDom = await page
    .evaluate(() => {
      const normalizedText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const closeCandidate = Array.from(document.querySelectorAll("button, div, span"))
        .filter((node) => isVisible(node))
        .find((node) => {
          const text = normalizedText(node.textContent || "");
          const aria = normalizedText(node.getAttribute("aria-label") || "");
          return text === "x" || aria.includes("close");
        });

      if (closeCandidate instanceof HTMLElement) {
        closeCandidate.click();
        return true;
      }

      return false;
    })
    .catch(() => false);

  if (!dismissViaDom) {
    await page.keyboard.press("Escape").catch(() => {});
  }

  await page.waitForTimeout(500);
  const stillVisible = await detectLicensePlateRequirement(page);
  return !stillVisible;
}

async function tryResolveLicensePlateRequirement(page) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const normalized = String(bodyText).replace(/\s+/g, " ").trim();
  const onCheckoutPage = /\/checkout\b/i.test(String(page.url()));
  const hasVehicleDetailsSection = /Vehicle Details/i.test(normalized) && /Saved Vehicles/i.test(normalized);

  if (!onCheckoutPage || !hasVehicleDetailsSection) {
    return { recovered: false, reason: "vehicle_section_not_visible" };
  }

  const currentVehicleValue = await page
    .evaluate(() => {
      const normalizedText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const textNodes = Array.from(document.querySelectorAll("div, button, li, span"))
        .filter((node) => isVisible(node))
        .map((node) => normalizedText(node.textContent || ""));

      const savedVehiclesIndex = textNodes.findIndex((text) => /^Saved Vehicles$/i.test(text));
      if (savedVehiclesIndex === -1) {
        return "";
      }

      return (
        textNodes
          .slice(savedVehiclesIndex + 1, savedVehiclesIndex + 20)
          .find((text) => /^[A-Z0-9]{4,}$/.test(text)) || ""
      );
    })
    .catch(() => "");

  if (!currentVehicleValue) {
    return { recovered: false, reason: "no_visible_saved_vehicle" };
  }

  const vehicleFieldClick = await page
    .evaluate((vehicleValue) => {
      const normalizedText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const matchingNode = Array.from(document.querySelectorAll("*"))
        .filter((node) => isVisible(node))
        .find((node) => normalizedText(node.textContent || "") === vehicleValue);

      if (!matchingNode) {
        return { clicked: false, reason: "matching_vehicle_text_not_found" };
      }

      const clickable =
        matchingNode.closest("button,[role='button'],li,div") || matchingNode;

      if (clickable instanceof HTMLElement) {
        clickable.scrollIntoView({ block: "center" });
        clickable.click();
        return { clicked: true, reason: "clicked_matching_vehicle_container" };
      }

      return { clicked: false, reason: "matching_vehicle_container_not_clickable" };
    }, currentVehicleValue)
    .catch(() => ({ clicked: false, reason: "matching_vehicle_click_failed" }));

  if (!vehicleFieldClick.clicked) {
    return {
      recovered: false,
      reason: "saved_vehicle_field_not_clickable",
      vehicle_value: currentVehicleValue,
      click_detail: vehicleFieldClick.reason,
    };
  }

  await page.waitForTimeout(500);
  const availableVehicleOptions = await page
    .evaluate((currentValue) => {
      const normalizedText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      };

      const texts = Array.from(document.querySelectorAll("[role='option'], li, button, div, span"))
        .filter((node) => isVisible(node))
        .map((node) => normalizedText(node.textContent || ""))
        .filter(Boolean);

      const uniqueOptions = Array.from(
        new Set(
          texts.filter((text) =>
            text !== currentValue &&
            (
              text === "RENTAL" ||
              /^[A-Z0-9]{4,}$/.test(text)
            ),
          ),
        ),
      );

      const preferred = [
        ...uniqueOptions.filter((text) => text === "RENTAL"),
        ...uniqueOptions.filter((text) => /^GDS/i.test(text)),
        ...uniqueOptions.filter((text) => text !== "RENTAL" && !/^GDS/i.test(text)),
      ];

      return preferred;
    }, currentVehicleValue)
    .catch(() => []);

  let selectedVehicleValue = currentVehicleValue;
  let selectedAlternative = false;
  if (Array.isArray(availableVehicleOptions) && availableVehicleOptions.length > 0) {
    for (const optionText of availableVehicleOptions) {
      const escapedOptionText = optionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const vehicleOption = page
        .locator("[role='option'], li, button, div, span")
        .filter({ hasText: new RegExp(`^\\s*${escapedOptionText}\\s*$`, "i") })
        .last();
      const vehicleOptionVisible = await vehicleOption.isVisible().catch(() => false);
      if (!vehicleOptionVisible) {
        continue;
      }

      await vehicleOption.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      selectedVehicleValue = optionText;
      selectedAlternative = true;
      break;
    }
  }

  if (!selectedAlternative) {
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(400);
  }

  const checkoutButton = getFinalCheckoutLocator(page);
  await checkoutButton.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);

  return {
    recovered: true,
    reason: selectedAlternative ? "vehicle_alternative_selected" : "vehicle_field_reconfirmed",
    vehicle_value: selectedVehicleValue,
    click_detail: vehicleFieldClick.reason,
    attempted_options: availableVehicleOptions,
  };
}

async function detectFinalCheckoutSubmitState(page) {
  return page
    .evaluate(() => {
      const primary = document.querySelector("#checkoutBtn");
      const hiddenSubmit = document.querySelector("#prcd-to-chkt");
      const disabled = [primary, hiddenSubmit].some(
        (node) => node instanceof HTMLButtonElement && node.disabled,
      );
      return {
        primaryDisabled: Boolean(primary instanceof HTMLButtonElement && primary.disabled),
        hiddenSubmitDisabled: Boolean(hiddenSubmit instanceof HTMLButtonElement && hiddenSubmit.disabled),
        disabled,
      };
    })
    .catch(() => ({ primaryDisabled: false, hiddenSubmitDisabled: false, disabled: false }));
}

async function triggerFinalCheckoutDomSubmit(page) {
  return page
    .evaluate(() => {
      const hiddenSubmit = document.querySelector("#prcd-to-chkt");
      const primary = document.querySelector("#checkoutBtn");

      if (hiddenSubmit instanceof HTMLElement) {
        hiddenSubmit.click();
        return {
          clicked: true,
          target: "#prcd-to-chkt",
        };
      }

      if (primary instanceof HTMLElement) {
        primary.click();
        return {
          clicked: true,
          target: "#checkoutBtn",
        };
      }

      return {
        clicked: false,
        target: "",
      };
    })
    .catch(() => ({ clicked: false, target: "", error: "evaluate_failed" }));
}

async function waitForCheckoutActionOutcome(page, locator, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  const startingUrl = page.url();
  let submitStarted = false;

  while (Date.now() < deadline) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    const currentUrl = page.url();
    if (!/\/checkout\b/i.test(String(currentUrl))) {
      return {
        status: "navigated",
        currentUrl,
      };
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/your order is confirmed|order confirmation|booking confirmed/i.test(String(bodyText))) {
      return {
        status: "confirmation_text_detected",
        currentUrl,
      };
    }

    const submitState = await detectFinalCheckoutSubmitState(page);
    if (submitState.disabled) {
      submitStarted = true;
      await page.waitForTimeout(700);
      continue;
    }

    const membershipState = await detectMembershipUpsell(page).catch(() => ({ present: false, declineSelected: false }));
    if (membershipState?.present && !membershipState?.declineSelected) {
      return {
        status: "blocked_by_membership",
        currentUrl,
        membershipState,
      };
    }

    const licensePlateRequirement = await detectLicensePlateRequirement(page).catch(() => null);
    if (licensePlateRequirement) {
      return {
        status: "blocked_by_license_plate",
        currentUrl,
        licensePlateRequirement: licensePlateRequirement.message || null,
      };
    }

    const stillVisible = await locator.isVisible().catch(() => false);
    if (!stillVisible && currentUrl !== startingUrl) {
      return {
        status: "state_changed",
        currentUrl,
      };
    }

    await page.waitForTimeout(600);
  }

  return {
    status: submitStarted ? "submission_started" : "wait_timeout",
    currentUrl: page.url(),
  };
}

async function clickCheckoutAction(page, locator, options = {}) {
  const { actionName = "checkout action", confirmNavigation = false } = options;
  const shouldTryFinalCheckoutDomSubmit = /final Checkout/i.test(actionName);

  try {
    await locator.scrollIntoViewIfNeeded().catch(() => {});

    await locator.click({ timeout: 8000, force: true });
    if (confirmNavigation && shouldTryFinalCheckoutDomSubmit) {
      const directSubmitResult = await triggerFinalCheckoutDomSubmit(page);
      if (directSubmitResult.clicked) {
        console.log(`Way checkout retry: direct submit trigger -> ${JSON.stringify(directSubmitResult)}`);
      }
    }
    if (!confirmNavigation) {
      return { status: "clicked" };
    }

    return await waitForCheckoutActionOutcome(page, locator, 12000);
  } catch (error) {
    const beforeDomClickUrl = page.url();
    await locator
      .evaluate((node) => {
        if (node instanceof HTMLElement) {
          node.click();
        }
      })
      .catch(() => {});
    await page.waitForTimeout(1200);

    const afterDomClickUrl = page.url();
    const navigated =
      beforeDomClickUrl !== afterDomClickUrl ||
      (confirmNavigation && !/\/checkout\b/i.test(String(afterDomClickUrl)));

    if (navigated) {
      return { status: "dom_click_navigated", currentUrl: afterDomClickUrl };
    }

    if (confirmNavigation) {
      if (shouldTryFinalCheckoutDomSubmit) {
        const directSubmitResult = await triggerFinalCheckoutDomSubmit(page);
        if (directSubmitResult.clicked) {
          console.log(`Way checkout retry: direct submit trigger -> ${JSON.stringify(directSubmitResult)}`);
        }
      }
      const outcome = await waitForCheckoutActionOutcome(page, locator, 10000);
      if (outcome.status !== "wait_timeout") {
        return {
          status: `dom_click_${outcome.status}`,
          currentUrl: outcome.currentUrl || page.url(),
          licensePlateRequirement: outcome.licensePlateRequirement || null,
        };
      }
    }

    throw new Error(`Way ${actionName} click failed: ${error.message}`);
  }
}

function parseDollarAmount(value) {
  const text = String(value || "");
  const dollarMatches = [...text.matchAll(/\$\s*(\d+(?:\.\d{2})?)/g)];
  if (dollarMatches.length > 0) {
    const lastDollarMatch = dollarMatches[dollarMatches.length - 1];
    return Number(lastDollarMatch[1]);
  }

  const match = text.match(/\b(\d+(?:\.\d{2})?)\b/);
  return match ? Number(match[1]) : null;
}

function isContextualCheckoutPriceText(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  if (/saved up to|per year|a year|cashback|way\+/i.test(normalized)) {
    return false;
  }

  return /grand total|subtotal|total/i.test(normalized);
}

async function extractCheckoutPrice(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const normalized = String(bodyText).replace(/\s+/g, " ").trim();

    const priorityPatterns = [
      /Grand Total\s*\$?\s*(\d+(?:\.\d{2})?)/i,
      /Total\s*\(.*?\)\s*\$?\s*(\d+(?:\.\d{2})?)/i,
      /Subtotal\s*\$?\s*(\d+(?:\.\d{2})?).*?Grand Total\s*\$?\s*(\d+(?:\.\d{2})?)/i,
    ];

    for (const pattern of priorityPatterns) {
      const match = normalized.match(pattern);
      if (match) {
        const captured = match[2] || match[1];
        const amount = parseDollarAmount(captured);
        if (Number.isFinite(amount)) {
          return {
            text: `$${amount.toFixed(2)}`,
            amount,
            source: "checkout_body_text",
          };
        }
      }
    }

    const contextualPriceText = await page
      .evaluate(() => {
        const isVisible = (node) => {
          if (!(node instanceof HTMLElement)) {
            return false;
          }

          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0
          );
        };

        const candidates = Array.from(document.querySelectorAll("div, span, p, h1, h2, h3, h4, h5, h6"))
          .filter((node) => isVisible(node))
          .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
          .filter((text) => /\$\d+(?:\.\d{2})?/.test(text))
          .filter((text) => /grand total|subtotal|total/i.test(text))
          .filter((text) => !/saved up to|per year|a year|cashback|way\+/i.test(text))
          .sort((left, right) => left.length - right.length);

        return candidates[0] || "";
      })
      .catch(() => "");

    if (isContextualCheckoutPriceText(contextualPriceText)) {
      const contextualAmount = parseDollarAmount(contextualPriceText);
      if (Number.isFinite(contextualAmount)) {
        return {
          text: contextualPriceText,
          amount: contextualAmount,
          source: "checkout_contextual_text",
        };
      }
    }

    const fallbackText = await page.locator(WAY_SELECTORS.checkout.priceSummary).first().textContent().catch(() => "");
    const fallbackAmount = isContextualCheckoutPriceText(fallbackText) ? parseDollarAmount(fallbackText) : null;
    if (Number.isFinite(fallbackAmount)) {
      return {
        text: fallbackText || contextualPriceText || "",
        amount: fallbackAmount,
        source: "selector_fallback",
      };
    }

    if (attempt < 4) {
      await page.waitForTimeout(900);
    }
  }

  const fallbackText = await page.locator(WAY_SELECTORS.checkout.priceSummary).first().textContent().catch(() => "");
  return {
    text: fallbackText || "",
    amount: null,
    source: "selector_fallback",
  };
}

async function recoverCheckoutPage(page) {
  const config = getWayConfig();
  const currentUrl = page.url();
  const onCheckoutPage = /\/checkout\b/i.test(currentUrl);
  const atHomePage = /^https:\/\/www\.way\.com\/?(?:[#?].*)?$/i.test(currentUrl);

  if (onCheckoutPage) {
    return { status: "already_on_checkout", currentUrl };
  }

  if (atHomePage) {
    console.log("Way checkout review: landed on home after Proceed, attempting direct checkout recovery...");
    await page.goto(config.checkoutUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1200);

    const recoveredUrl = page.url();
    const finalCheckoutVisible = await getFinalCheckoutLocator(page).isVisible().catch(() => false);
    if (/\/checkout\b/i.test(recoveredUrl) || finalCheckoutVisible) {
      return { status: "recovered_via_direct_checkout", currentUrl: recoveredUrl };
    }

    await page.goBack().catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(800);
    return { status: "recovery_failed", currentUrl: page.url() };
  }

  return { status: "no_recovery_needed", currentUrl };
}

async function validateCheckoutTarget(page, record, selectionResult = null) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const pageHtml = await page.content().catch(() => "");
  const normalizedBody = normalizeAddressText(bodyText);
  const normalizedHtml = normalizeAddressText(pageHtml);
  const normalizedCombinedText = `${normalizedBody} ${normalizedHtml}`.trim();
  const expectedLocation = record?.parking_location || "";
  const selectedAddress = selectionResult?.matched_address || "";
  const selectedTitle = selectionResult?.matched_title || "";
  const selectedText = selectionResult?.matched_text || "";
  const expectedCityState = record?.city_state || "";
  const checkoutWindow = selectionResult?.checkout_window || null;
  const extractAddressLikeVariants = (...values) => {
    const variants = new Set();

    for (const rawValue of values) {
      const value = String(rawValue || "").trim();
      if (!value) {
        continue;
      }

      variants.add(value);

      for (const match of value.matchAll(/\(([^)]+)\)/g)) {
        const inner = String(match[1] || "").trim();
        if (inner) {
          variants.add(inner);
        }
      }

      const lines = value
        .split(/\n+|(?<=\S)\s{2,}/)
        .map((line) => String(line || "").trim())
        .filter(Boolean);

      for (const line of lines) {
        if (/\d{2,}\s+[A-Za-z]/.test(line) || /street|st\b|avenue|ave\b|road|rd\b|drive|dr\b|boulevard|blvd\b|highway|hwy\b|court|ct\b|broad/i.test(line)) {
          variants.add(line);
        }
      }
    }

    return Array.from(variants);
  };

  const expectedSignals = [
    ...extractAddressLikeVariants(expectedLocation, selectedAddress, selectedTitle, selectedText),
    expectedCityState,
  ].filter(Boolean);

  const strongestOverlap = expectedSignals.reduce((best, candidate) => {
    const overlap = tokenOverlapCount(candidate, normalizedCombinedText, 4);
    return Math.max(best, overlap);
  }, 0);

  const hasStreetNumberMatch = expectedSignals.some((candidate) => {
    const streetNumber = String(candidate).match(/\b\d{2,6}\b/)?.[0];
    return streetNumber ? normalizedCombinedText.includes(streetNumber.toLowerCase()) : false;
  });

  const selectionLooksStrong =
    Number(selectionResult?.match_score || 0) >= 18 &&
    (Boolean(selectionResult?.street_number_matched) || Number(selectionResult?.token_overlap || 0) >= 2);

  const selectedSignals = extractAddressLikeVariants(selectedAddress, selectedTitle, selectedText)
    .map((candidate) => normalizeAddressText(candidate))
    .filter(Boolean);
  const selectedSignalOverlap = selectedSignals.reduce((best, candidate) => {
    const overlap = tokenOverlapCount(candidate, normalizedCombinedText, 3);
    return Math.max(best, overlap);
  }, 0);

  const hasStructuredWindowSignals =
    /start:\s|end:\s|check in|check-out|check out/i.test(bodyText) ||
    /start:\s|end:\s|check in|check-out|check out/i.test(pageHtml);
  const normalizedWindowSignals =
    hasStructuredWindowSignals && checkoutWindow
      ? normalizeReservationMatchText(
          [
            getMonthShortLabel(checkoutWindow.startDate || ""),
            checkoutWindow.startDate ? String(Number(String(checkoutWindow.startDate).split("-")[2] || "")) : "",
            checkoutWindow.startDisplay || "",
            getMonthShortLabel(checkoutWindow.endDate || ""),
            checkoutWindow.endDate ? String(Number(String(checkoutWindow.endDate).split("-")[2] || "")) : "",
            checkoutWindow.endDisplay || "",
          ].join(" "),
        )
      : "";
  const normalizedCheckoutText = normalizeReservationMatchText(`${bodyText} ${pageHtml}`);
  const hasExpectedWindowMatch =
    !normalizedWindowSignals ||
    normalizedWindowSignals
      .split(" ")
      .filter((token) => token.length >= 2)
      .every((token) => normalizedCheckoutText.includes(token));

  const sparseReviewSurface =
    /review booking/i.test(bodyText) &&
    /subtotal/i.test(bodyText) &&
    !/\b\d{2,6}\s+[a-z]/i.test(bodyText);

  const strongSelectionFallback =
    sparseReviewSurface &&
    selectionLooksStrong &&
    hasStreetNumberMatch &&
    strongestOverlap >= 8 &&
    selectedSignalOverlap >= 8;

  const matchedAddress =
    strongestOverlap >= 2 ||
    (strongestOverlap >= 1 && hasStreetNumberMatch) ||
    (selectionLooksStrong && selectedSignalOverlap >= 2) ||
    strongSelectionFallback;
  const matched = strongSelectionFallback || (matchedAddress && hasExpectedWindowMatch);
  if (matched) {
    return {
      status: "checkout_target_validated",
      strongest_overlap: strongestOverlap,
      street_number_match: hasStreetNumberMatch,
      selected_signal_overlap: selectedSignalOverlap,
      selection_match_score: Number(selectionResult?.match_score || 0),
      selection_looks_strong: selectionLooksStrong,
      sparse_review_surface: sparseReviewSurface,
      strong_selection_fallback: strongSelectionFallback,
      expected_window_match: hasExpectedWindowMatch,
      expected_signals: expectedSignals.slice(0, 6),
    };
  }

  return {
    status: "checkout_target_mismatch",
    strongest_overlap: strongestOverlap,
    street_number_match: hasStreetNumberMatch,
    selected_signal_overlap: selectedSignalOverlap,
    sparse_review_surface: sparseReviewSurface,
    strong_selection_fallback: strongSelectionFallback,
    expected_window_match: hasExpectedWindowMatch,
    expected_location: expectedLocation,
    selected_address: selectedAddress,
    selected_title: selectedTitle,
    page_excerpt: String(bodyText).replace(/\s+/g, " ").trim().slice(0, 800),
  };
}

async function reviewCheckout(page, record = null, selectionResult = null, checkoutWindow = null) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loginVisible = await page.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);
    if (loginVisible || /\/login\b/i.test(page.url())) {
      console.log(`Way checkout review: login form detected at ${page.url()}, attempting inline login...`);
      await submitWayLoginFormIfVisible(page);
    }

    const onCheckoutPage = /\/checkout\b/i.test(page.url());
    const proceedLocator = getProceedToCheckoutLocator(page);
    const proceedToCheckoutVisible = await proceedLocator.isVisible().catch(() => false);

    if (!onCheckoutPage && proceedToCheckoutVisible) {
      console.log("Way checkout review: clicking Proceed to Checkout from results/cart summary...");
      const proceedAttempt = await Promise.race([
        page
          .waitForURL(/\/checkout\b/i, { timeout: 10000 })
          .then(() => ({ status: "navigated" }))
          .catch(() => ({ status: "wait_timeout" })),
        (async () => {
          try {
            return await clickCheckoutAction(page, proceedLocator, { actionName: "Proceed to Checkout" });
          } catch (error) {
            const currentUrl = page.url();
            const finalCheckoutVisible = await getFinalCheckoutLocator(page).isVisible().catch(() => false);

            if (/\/checkout\b/i.test(currentUrl) || finalCheckoutVisible) {
              return { status: "navigated_during_click_error", currentUrl };
            }

            const recoveredFinalCheckoutVisible = await getFinalCheckoutLocator(page).isVisible().catch(() => false);
            const recoveredUrl = page.url();

            if (/\/checkout\b/i.test(recoveredUrl) || recoveredFinalCheckoutVisible) {
              return { status: "recovered_after_dom_click", currentUrl: recoveredUrl };
            }

            throw error;
          }
        })(),
      ]);

      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(1200);
      console.log(`Way checkout review: proceed result -> ${JSON.stringify(proceedAttempt)}`);
      console.log(`Way checkout review: current URL after Proceed -> ${page.url()}`);

      const recoveryResult = await recoverCheckoutPage(page);
      if (recoveryResult.status !== "no_recovery_needed" && recoveryResult.status !== "already_on_checkout") {
        console.log(`Way checkout review: recovery result -> ${JSON.stringify(recoveryResult)}`);
      }
      continue;
    }

    const finalCheckoutVisibleBeforeProceed = await page
      .locator(WAY_SELECTORS.checkout.finalCheckoutButton)
      .first()
      .isVisible()
      .catch(() => false);

    if (onCheckoutPage && finalCheckoutVisibleBeforeProceed) {
      console.log("Way checkout review: final Checkout button already visible, skipping Proceed to Checkout.");
      break;
    }

    break;
  }

  const loginAfterProceed = await page.locator(WAY_SELECTORS.login.emailInput).isVisible().catch(() => false);
  if (loginAfterProceed || /\/login\b/i.test(page.url())) {
    throw new Error(`Way redirected to login before final checkout review (${page.url()}).`);
  }

  await dismissMembershipUpsell(page);

  const finalCheckoutVisible = await page
    .locator(WAY_SELECTORS.checkout.finalCheckoutButton)
    .first()
    .isVisible()
    .catch(() => false);

  if (!/\/checkout\b/i.test(page.url())) {
    throw new Error(`Way review did not reach the dedicated checkout page (${page.url()}).`);
  }

  if (!finalCheckoutVisible) {
    throw new Error(`Way final Checkout button was not visible on review screen (${page.url()}).`);
  }

  if (record) {
    const checkoutTargetValidation = await validateCheckoutTarget(page, record, {
      ...(selectionResult || {}),
      checkout_window: checkoutWindow || null,
    });
    if (checkoutTargetValidation.status !== "checkout_target_validated") {
      return {
        status: "checkout_target_mismatch",
        current_url: page.url(),
        final_checkout_visible: finalCheckoutVisible,
        checkout_target_validation: checkoutTargetValidation,
      };
    }
  }

  const price = await extractCheckoutPrice(page);

  return {
    status: "checkout_reviewed",
    priceSnapshot: price.text || "",
    priceAmount: price.amount,
    priceSource: price.source,
    current_url: page.url(),
    final_checkout_visible: finalCheckoutVisible,
    checkout_target_validation: {
      status: "checkout_target_validated",
    },
  };
}

function normalizeReservationMatchText(value) {
  return String(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReservationMatchSignals(record, options = {}) {
  const airportMetadata = options.airportMetadata || null;
  const selectionResult = options.selectionResult || null;
  const signals = new Set();

  const pushValue = (value) => {
    const normalized = normalizeReservationMatchText(value);
    if (normalized) {
      signals.add(normalized);
    }
  };

  pushValue(record?.parking_location || "");
  pushValue(record?.venue || "");
  pushValue(selectionResult?.matched_title || "");
  pushValue(selectionResult?.matched_address || "");
  pushValue(selectionResult?.matched_text || "");

  if (airportMetadata) {
    pushValue(airportMetadata.address_prefix || "");
    pushValue(airportMetadata.airport_query || "");
    for (const alias of airportMetadata.lot_aliases || []) {
      pushValue(alias);
    }
    for (const alias of airportMetadata.normalized_aliases || []) {
      pushValue(alias);
    }
  }

  return Array.from(signals);
}

function scoreReservationOrderMatch(orderCandidate, record, options = {}) {
  const titleText = normalizeReservationMatchText(orderCandidate.title || "");
  const addressText = normalizeReservationMatchText(orderCandidate.address || "");
  const recordLocation = normalizeReservationMatchText(record.parking_location || "");
  const recordVenue = normalizeReservationMatchText(record.venue || "");
  const signalTexts = buildReservationMatchSignals(record, options);
  const combinedCandidateText = `${titleText} ${addressText}`.trim();

  let score = 0;

  const primarySegments = recordLocation
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of primarySegments) {
    if (segment.length >= 5 && (titleText.includes(segment) || addressText.includes(segment))) {
      score += 18;
    }
  }

  const locationTokens = recordLocation.split(" ").filter((token) => token.length >= 3);
  for (const token of locationTokens) {
    if (titleText.includes(token) || addressText.includes(token)) {
      score += 3;
    }
  }

  const venueTokens = recordVenue.split(" ").filter((token) => token.length >= 4);
  for (const token of venueTokens) {
    if (titleText.includes(token) || addressText.includes(token)) {
      score += 2;
    }
  }

  const streetNumber = locationTokens.find((token) => /^\d+$/.test(token));
  if (streetNumber && (titleText.includes(streetNumber) || addressText.includes(streetNumber))) {
    score += 12;
  }

  for (const signal of signalTexts) {
    if (signal.length >= 8 && combinedCandidateText.includes(signal)) {
      score += 14;
    }
    const overlap = tokenOverlapCount(signal, combinedCandidateText, 3);
    if (overlap >= 2) {
      score += overlap * 2;
    }
  }

  return score;
}

function getMinimumReservationMatchScore(record, options = {}) {
  const normalizedLocation = normalizeReservationMatchText(record.parking_location || "");
  if (options.airportFallbackUsed || options.airportMetadata) {
    return 18;
  }
  if (!normalizedLocation) {
    return 18;
  }

  return 24;
}

function extractSelectedReservationDetails(bodyText) {
  const detailMatch = String(bodyText).match(
    /Order Details\s+([\s\S]*?)\s+Reservation Confirmed\s+Confirmation #:\s+([A-Z]{3}\d{8})[\s\S]*?Entrance Address:\s+([^\n]+)/i,
  );

  if (!detailMatch) {
    return null;
  }

  const [, titleBlock, reservationId, entranceAddress] = detailMatch;
  const title = String(titleBlock)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(0);

  return {
    reservation_id: reservationId.trim(),
    title: title || "",
    address: String(entranceAddress || "").trim(),
    source: "selected_order_panel",
  };
}

function extractVisibleReservationEntries(bodyText) {
  const entries = [];
  const pattern =
    /Order placed on[^\n]*\n(?:[^\n]*\n){0,4}?([A-Z]{3}\d{8})\n([^\n]+)/g;

  let match = pattern.exec(bodyText);
  while (match) {
    entries.push({
      reservation_id: match[1].trim(),
      title: match[2].trim(),
      address: "",
      source: "orders_history_list",
    });
    match = pattern.exec(bodyText);
  }

  return entries;
}

function extractReservationIdsFromBodyText(bodyText) {
  return Array.from(
    new Set(
      String(bodyText || "").match(/\b[A-Z]{3}\d{8}\b/g) || [],
    ),
  );
}

function buildReservationValidationTargets(record, resolvedEventTime, checkoutWindowOverride = null) {
  if (!record?.event_date) {
    return null;
  }

  try {
    const checkoutWindow =
      checkoutWindowOverride && checkoutWindowOverride.startDate && checkoutWindowOverride.endDate
        ? checkoutWindowOverride
        : buildCheckoutWindow(record.event_date, resolvedEventTime);
    return {
      start24: checkoutWindow.start24,
      end24: checkoutWindow.end24,
      startDisplay: checkoutWindow.startDisplay,
      endDisplay: checkoutWindow.endDisplay,
      startDate: checkoutWindow.startDate,
      endDate: checkoutWindow.endDate,
    };
  } catch (_error) {
    return null;
  }
}

function scoreReservationPrintMatch(printPageText, record, validationTargets, options = {}) {
  const normalizedPrint = normalizeReservationMatchText(printPageText);
  const normalizedLocation = normalizeReservationMatchText(record.parking_location || "");
  const normalizedVenue = normalizeReservationMatchText(record.venue || "");
  const signalTexts = buildReservationMatchSignals(record, options);

  let score = 0;

  const primarySegments = normalizedLocation
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of primarySegments) {
    if (segment.length >= 5 && normalizedPrint.includes(segment)) {
      score += 14;
    }
  }

  const locationTokens = normalizedLocation.split(" ").filter((token) => token.length >= 3);
  for (const token of locationTokens) {
    if (normalizedPrint.includes(token)) {
      score += 2;
    }
  }

  const venueTokens = normalizedVenue.split(" ").filter((token) => token.length >= 4);
  for (const token of venueTokens) {
    if (normalizedPrint.includes(token)) {
      score += 1;
    }
  }

  const eventDate = String(record.event_date || "");
  const eventDateParts = eventDate.split("-");
  if (eventDateParts.length === 3) {
    const month = Number(eventDateParts[1]);
    const day = Number(eventDateParts[2]);
    const monthNames = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const monthName = monthNames[month - 1];
    if (monthName && normalizedPrint.includes(monthName) && normalizedPrint.includes(String(day))) {
      score += 8;
    }
  }

  if (validationTargets) {
    const expectedTimes = [validationTargets.startDisplay, validationTargets.endDisplay].filter(Boolean);
    for (const timeText of expectedTimes) {
      if (normalizedPrint.includes(normalizeReservationMatchText(timeText))) {
        score += 8;
      }
    }
  }

  for (const signal of signalTexts) {
    if (signal.length >= 8 && normalizedPrint.includes(signal)) {
      score += 10;
    }
    const overlap = tokenOverlapCount(signal, normalizedPrint, 3);
    if (overlap >= 2) {
      score += overlap * 2;
    }
  }

  return score;
}

function hasExactReservationWindowMatch(printPageText, validationTargets) {
  if (!validationTargets) {
    return false;
  }

  const normalizedPrint = normalizeReservationMatchText(printPageText);
  const startMonth = normalizeReservationMatchText(getMonthShortLabel(validationTargets.startDate));
  const endMonth = normalizeReservationMatchText(getMonthShortLabel(validationTargets.endDate));
  const startDay = String(Number(String(validationTargets.startDate).split("-")[2]));
  const endDay = String(Number(String(validationTargets.endDate).split("-")[2]));
  const startTime = normalizeReservationMatchText(validationTargets.startDisplay);
  const endTime = normalizeReservationMatchText(validationTargets.endDisplay);

  return (
    normalizedPrint.includes(startMonth) &&
    normalizedPrint.includes(endMonth) &&
    normalizedPrint.includes(startDay) &&
    normalizedPrint.includes(endDay) &&
    normalizedPrint.includes(startTime) &&
    normalizedPrint.includes(endTime)
  );
}

async function validateReservationPassPage(
  context,
  reservationId,
  record,
  resolvedEventTime,
  checkoutWindowOverride = null,
  options = {},
) {
  const reservationUrl = buildReservationUrl(reservationId);
  if (!reservationUrl) {
    return {
      status: "reservation_url_not_available",
      reservation_url: "",
      pass_match_score: 0,
      pass_text_excerpt: "",
    };
  }

  const validationTargets = buildReservationValidationTargets(record, resolvedEventTime, checkoutWindowOverride);
  const passPage = await context.newPage();

  try {
    await passPage.goto(reservationUrl, { waitUntil: "domcontentloaded" });
    await passPage.waitForLoadState("networkidle").catch(() => {});
    let passText = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await passPage.waitForTimeout(1200);
      passText = await passPage.locator("body").innerText().catch(() => "");
      if (String(passText).trim().length > 400) {
        break;
      }
    }

    const passMatchScore = scoreReservationPrintMatch(passText, record, validationTargets, options);
    const exactWindowMatch = hasExactReservationWindowMatch(passText, validationTargets);

    if (WAY_CAPTURE_TRACE_ARTIFACTS) {
      const buyingPaths = getBuyingBotOperativePaths();
      await passPage
        .screenshot({
          path: buyingPaths.screenshots.wayPassCapture,
          fullPage: true,
        })
        .catch(() => {});
    }

    const strongStructuredMatch = passMatchScore >= 26;
    const validated = passMatchScore >= 18 && (exactWindowMatch || strongStructuredMatch);

    return {
      status: validated
        ? exactWindowMatch
          ? "reservation_pass_validated"
          : "reservation_pass_validated_relaxed"
        : "reservation_pass_mismatch",
      reservation_url: reservationUrl,
      pass_match_score: passMatchScore,
      exact_window_match: exactWindowMatch,
      pass_text_excerpt: String(passText).slice(0, 1200),
    };
  } finally {
    await passPage.close().catch(() => {});
  }
}

async function getVisibleReservationIdsSnapshot(page) {
  const config = getWayConfig();
  await page.goto(config.ordersUrl, { waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  return Array.from(
    new Set(
      [
        extractSelectedReservationDetails(bodyText),
        ...extractVisibleReservationEntries(bodyText).slice(0, 50),
      ]
        .filter(Boolean)
        .map((entry) => entry.reservation_id)
        .concat(extractReservationIdsFromBodyText(bodyText))
        .filter(Boolean),
    ),
  );
}

function buildReservationCandidates(bodyText, record, excludedReservationIds = [], options = {}) {
  const excluded = new Set((excludedReservationIds || []).filter(Boolean));

  return [extractSelectedReservationDetails(bodyText), ...extractVisibleReservationEntries(bodyText).slice(0, 50)]
    .filter(Boolean)
    .filter((candidate) => candidate.reservation_id && !excluded.has(candidate.reservation_id))
    .map((candidate, index) => ({
      ...candidate,
      match_score: scoreReservationOrderMatch(candidate, record, options),
      source_index: index,
    }));
}

function getReservationValidationQueue(candidates, minimumMatchScore, attempt) {
  const unique = [];
  const seenReservationIds = new Set();

  for (const candidate of candidates) {
    if (!candidate?.reservation_id || seenReservationIds.has(candidate.reservation_id)) {
      continue;
    }

    seenReservationIds.add(candidate.reservation_id);
    unique.push(candidate);
  }

  const strongMatches = unique
    .filter((candidate) => candidate.match_score >= minimumMatchScore)
    .sort((left, right) => right.match_score - left.match_score);

  if (attempt <= 2) {
    return strongMatches.slice(0, 5);
  }

  const fallbackVisible = unique
    .filter((candidate) => !strongMatches.some((strongMatch) => strongMatch.reservation_id === candidate.reservation_id))
    .sort((left, right) => left.source_index - right.source_index);

  return [...strongMatches, ...fallbackVisible].slice(0, 6);
}

async function captureReservationDetails(page, record, resolvedEventTime = "", options = {}) {
  const config = getWayConfig();
  const airportMetadata = options.airportMetadata || null;
  const airportFallbackUsed = Boolean(options.airportFallbackUsed);
  const selectionResult = options.selectionResult || null;
  const minimumMatchScore = getMinimumReservationMatchScore(record, {
    airportMetadata,
    airportFallbackUsed,
  });
  const excludedReservationIds = Array.isArray(options.excludeReservationIds) ? options.excludeReservationIds : [];
  const preCheckoutReservationIds = Array.isArray(options.preCheckoutReservationIds)
    ? options.preCheckoutReservationIds
    : [];
  const checkoutWindowOverride = options.checkoutWindow || null;
  const excludedIds = new Set([...excludedReservationIds, ...preCheckoutReservationIds].filter(Boolean));
  let bestCandidate = null;
  let finalReservationId = "";
  let finalReservationUrl = "";
  let finalPassValidation = {
    status: "reservation_pass_not_checked",
    reservation_url: "",
    pass_match_score: 0,
    pass_text_excerpt: "",
  };
  let visibleReservationIds = [];

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await page.goto(config.ordersUrl, { waitUntil: "domcontentloaded" });
    await page.locator("body").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(attempt <= 2 ? 5000 : 3500);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const candidates = buildReservationCandidates(bodyText, record, Array.from(excludedIds), {
      airportMetadata,
      airportFallbackUsed,
      selectionResult,
    });
    visibleReservationIds = Array.from(new Set(candidates.map((candidate) => candidate.reservation_id).filter(Boolean)));
    const candidatesByScore = [...candidates].sort((left, right) => right.match_score - left.match_score);
    const queue = getReservationValidationQueue(candidates, minimumMatchScore, attempt);
    const discoveredReservationIds = extractReservationIdsFromBodyText(bodyText);
    visibleReservationIds = Array.from(
      new Set([...visibleReservationIds, ...discoveredReservationIds].filter(Boolean)),
    );

    if (!bestCandidate && candidatesByScore[0]) {
      bestCandidate = candidatesByScore[0];
    }

    logWayDebug(
      `Way reservation capture: attempt ${attempt} -> ${JSON.stringify({
        visibleReservationIds,
        topMatchScore: candidatesByScore[0]?.match_score || 0,
        queue: queue.map((candidate) => ({
          reservation_id: candidate.reservation_id,
          match_score: candidate.match_score,
          title: candidate.title || "",
        })),
      })}`,
    );

    for (const candidate of queue) {
      const passValidation = await validateReservationPassPage(
        page.context(),
        candidate.reservation_id,
        record,
        resolvedEventTime,
        checkoutWindowOverride,
        {
          airportMetadata,
          airportFallbackUsed,
          selectionResult,
        },
      );

      if (!bestCandidate || passValidation.status === "reservation_pass_validated") {
        bestCandidate = candidate;
      }
      finalPassValidation = passValidation;

      if (
        passValidation.status === "reservation_pass_validated" ||
        passValidation.status === "reservation_pass_validated_relaxed"
      ) {
        finalReservationId = candidate.reservation_id;
        finalReservationUrl = buildReservationUrl(candidate.reservation_id);
        break;
      }
    }

    if (finalReservationId) {
      break;
    }
  }

  if (WAY_CAPTURE_TRACE_ARTIFACTS) {
    const buyingPaths = getBuyingBotOperativePaths();
    await page
      .screenshot({
        path: buyingPaths.screenshots.wayOrdersCapture,
        fullPage: true,
      })
      .catch(() => {});
  }

  return {
    status: finalReservationId ? "reservation_captured" : "reservation_match_not_found",
    reservation_id: finalReservationId,
    reservation_url: finalReservationUrl,
    matched_title: bestCandidate?.title || "",
    matched_address: bestCandidate?.address || "",
    match_score: bestCandidate?.match_score || 0,
    minimum_match_score: minimumMatchScore,
    visible_reservation_ids: visibleReservationIds,
    pass_validation_status: finalPassValidation.status,
    pass_match_score: finalPassValidation.pass_match_score || 0,
  };
}

module.exports = {
  createWayBrowserSession,
  ensureLoggedIn,
  searchLots,
  selectLot,
  getActiveWayPage,
  reviewCheckout,
  completeCheckout,
  captureReservationDetails,
  getVisibleReservationIdsSnapshot,
  buildCheckoutWindow,
};
