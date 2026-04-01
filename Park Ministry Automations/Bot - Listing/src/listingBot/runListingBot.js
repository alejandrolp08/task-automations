const fs = require("fs/promises");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");

const { loadEnv } = require("../../../Workspace/loadEnv");
const { getListingBotOperativePaths } = require("../../../Workspace/operativePaths");
const { fetchListingCandidates } = require("./fetchListingCandidates");
const { resolveEventTimes } = require("../../../Shared/src/shared/stubhub/resolveEventTimes");
const { buildReachProDraftCsv } = require("./buildReachProDraftCsv");
const { updateSmartsuiteListingFields } = require("./updateSmartsuiteListingFields");

loadEnv();

const LISTING_PATHS = getListingBotOperativePaths();
const OUTPUTS_DIR = LISTING_PATHS.outputs;
const OLD_RUNS_DIR = LISTING_PATHS.oldRuns;
const LATEST_CSV_PATH = LISTING_PATHS.latestCsv;
const LATEST_JSON_PATH = LISTING_PATHS.latestJson;
const OLD_RUN_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

function buildTimestamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function archiveIfExists(sourcePath, archivePrefix) {
  if (!(await pathExists(sourcePath))) {
    return null;
  }

  await ensureDirectory(OLD_RUNS_DIR);
  const ext = path.extname(sourcePath);
  const archivedPath = path.join(OLD_RUNS_DIR, `${archivePrefix}-${buildTimestamp()}${ext}`);
  await fs.rename(sourcePath, archivedPath);
  return archivedPath;
}

async function pruneOldRuns() {
  await ensureDirectory(OLD_RUNS_DIR);
  const entries = await fs.readdir(OLD_RUNS_DIR, { withFileTypes: true }).catch(() => []);
  const now = Date.now();
  const removed = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === "README.md") {
      continue;
    }

    const entryPath = path.join(OLD_RUNS_DIR, entry.name);
    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat) {
      continue;
    }

    if (now - stat.mtimeMs < OLD_RUN_RETENTION_MS) {
      continue;
    }

    await fs.rm(entryPath, { force: true }).catch(() => {});
    removed.push(entry.name);
  }

  return removed;
}

async function askDateRange() {
  const envStartDate = String(process.env.LISTING_BOT_START_DATE || "").trim();
  const envEndDate = String(process.env.LISTING_BOT_END_DATE || "").trim();
  if (envStartDate && envEndDate) {
    return { startDate: envStartDate, endDate: envEndDate };
  }

  const rl = readline.createInterface({ input, output });

  try {
    const startDate = (await rl.question("Enter start_date (YYYY-MM-DD): ")).trim();
    const endDate = (await rl.question("Enter end_date (YYYY-MM-DD): ")).trim();
    return { startDate, endDate };
  } finally {
    rl.close();
  }
}

function summarizeBlocked(records) {
  const grouped = new Map();

  for (const record of records) {
    const key = (record.listing_block_reasons || []).join(",") || "unknown";
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }

  return Array.from(grouped.entries()).map(([reason, count]) => ({ reason, count }));
}

function compareListingRows(left, right) {
  const leftDate = String(left.event_date || "");
  const rightDate = String(right.event_date || "");
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  const leftEvent = String(left.event || "").toLowerCase();
  const rightEvent = String(right.event || "").toLowerCase();
  if (leftEvent !== rightEvent) {
    return leftEvent.localeCompare(rightEvent);
  }

  const leftLocation = String(left.parking_location || "").toLowerCase();
  const rightLocation = String(right.parking_location || "").toLowerCase();
  if (leftLocation !== rightLocation) {
    return leftLocation.localeCompare(rightLocation);
  }

  const leftVenue = String(left.venue || "").toLowerCase();
  const rightVenue = String(right.venue || "").toLowerCase();
  if (leftVenue !== rightVenue) {
    return leftVenue.localeCompare(rightVenue);
  }

  return String(left.record_id || "").localeCompare(String(right.record_id || ""));
}

function collapseBlockedListingRows(rows) {
  const collapsed = new Map();

  for (const row of rows || []) {
    const line = `${row.event} | ${row.venue} | ${row.event_date} | ${row.parking_location} | status=${row.event_status} | resolved_event_id=${row.resolved_event_id || "missing"}`;
    if (!collapsed.has(line)) {
      collapsed.set(line, { line, qty: 0 });
    }
    collapsed.get(line).qty += 1;
  }

  return Array.from(collapsed.values());
}

function countEventGroups(rows) {
  const groups = new Set();
  for (const row of rows || []) {
    groups.add(
      [
        String(row.event || "").trim().toLowerCase(),
        String(row.venue || "").trim().toLowerCase(),
        String(row.event_date || "").trim(),
      ].join("||"),
    );
  }
  return groups.size;
}

async function runListingBot() {
  const { startDate, endDate } = await askDateRange();
  const platformLabel = process.env.LISTING_PLATFORM_LABEL || "ReachPro";
  const allowEventIdFallback = ["1", "true", "yes"].includes(
    String(process.env.LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK || "").trim().toLowerCase(),
  );
  await ensureDirectory(OUTPUTS_DIR);
  await ensureDirectory(OLD_RUNS_DIR);
  const allCandidates = await fetchListingCandidates({ startDate, endDate, platformLabel });
  const eligibleCandidates = allCandidates.filter((record) => record.listing_eligible);
  const blockedCandidates = allCandidates.filter((record) => !record.listing_eligible);

  console.log(`Listing candidates found: ${allCandidates.length}`);
  console.log(`Listing candidates eligible: ${eligibleCandidates.length}`);
  if (blockedCandidates.length > 0) {
    console.log(`Listing candidates blocked: ${blockedCandidates.length}`);
    console.log(`Blocked breakdown: ${JSON.stringify(summarizeBlocked(blockedCandidates))}`);
  }

  const resolutions = await resolveEventTimes(eligibleCandidates);
  const preparedRows = eligibleCandidates.map((record, index) => {
    const resolution = resolutions[index] || {};
    const resolvedEventId = String(resolution.resolved_stubhub_event_id || record.event_id || "").trim();
    const eventStatus = String(resolution.event_status || "unverified").trim().toLowerCase();
    let canList = Boolean(resolvedEventId) && ["scheduled", "tbd", "tbh"].includes(eventStatus);
    let forcedListing = false;

    if (!canList && allowEventIdFallback && String(record.event_id || "").trim()) {
      canList = true;
      forcedListing = true;
    }

    return {
      ...record,
      resolution,
      resolved_event_id: resolvedEventId,
      resolved_event_time: resolution.resolved_event_time || record.event_time || "",
      event_status: eventStatus,
      listing_ready: canList,
      listing_forced: forcedListing,
    };
  });

  const readyRows = preparedRows.filter((row) => row.listing_ready).sort(compareListingRows);
  const forcedRows = readyRows.filter((row) => row.listing_forced);
  const blockedByEventId = preparedRows.filter((row) => !row.listing_ready);
  const newlyResolvedEventIdRows = preparedRows.filter(
    (row) => !String(row.event_id || "").trim() && String(row.resolved_event_id || "").trim(),
  );

  const csvOutput = buildReachProDraftCsv(readyRows);
  const archivedCsvPath = await archiveIfExists(LATEST_CSV_PATH, "reachpro-bulk-draft");
  const archivedJsonPath = await archiveIfExists(LATEST_JSON_PATH, "listing-bot-last-run");
  const prunedOldRuns = await pruneOldRuns();
  await fs.writeFile(LATEST_CSV_PATH, csvOutput, "utf8");

  const smartsuiteUpdate = await updateSmartsuiteListingFields(readyRows, { platformLabel });
  await fs.writeFile(
    LATEST_JSON_PATH,
    `${JSON.stringify(
      {
        run_type: "listing_bot_v1",
        date_range: { start: startDate, end: endDate },
        platform_label: platformLabel,
        summary: {
          total_candidates: allCandidates.length,
          event_groups: countEventGroups(eligibleCandidates),
          eligible_candidates: eligibleCandidates.length,
          listing_ready: readyRows.length,
          blocked_candidates: blockedCandidates.length,
          blocked_by_event_resolution: blockedByEventId.length,
          event_ids_resolved_this_run: newlyResolvedEventIdRows.length,
          forced_event_id_fallbacks: forcedRows.length,
        },
        blocked_candidates: blockedCandidates,
        blocked_by_event_resolution: blockedByEventId.map((row) => ({
          record_id: row.record_id,
          event: row.event,
          venue: row.venue,
          event_date: row.event_date,
          event_id_hint: row.resolution?.event_id_hint || row.event_id || "",
          event_id: row.event_id,
          resolved_event_id: row.resolved_event_id,
          stubhub_event_url: row.resolution?.stubhub_event_url || "",
          status_source_url: row.resolution?.status_source_url || "",
          event_status: row.event_status,
          match_method: row.resolution?.match_method || "unknown",
          resolution_status: row.resolution?.status || "unknown",
          resolution_notes: row.resolution?.resolution_notes || [],
        })),
        blocked_by_event_resolution_grouped: collapseBlockedListingRows(blockedByEventId),
        listing_rows: readyRows.map((row) => ({
          record_id: row.record_id,
          event: row.event,
          venue: row.venue,
          event_date: row.event_date,
          resolved_event_time: row.resolved_event_time,
          event_status: row.event_status,
          listing_forced: row.listing_forced,
          event_id_hint: row.resolution?.event_id_hint || row.event_id || "",
          event_id: row.event_id,
          resolved_event_id: row.resolved_event_id,
          stubhub_event_url: row.resolution?.stubhub_event_url || "",
          status_source_url: row.resolution?.status_source_url || "",
          match_method: row.resolution?.match_method || "unknown",
          resolution_status: row.resolution?.status || "unknown",
          resolution_notes: row.resolution?.resolution_notes || [],
          reservation_id: row.reservation_id,
          reservation_url: row.reservation_url,
          parking_location: row.parking_location,
          parking_location_id: row.parking_location_id,
          buy_cost: row.buy_cost,
          sell_price: row.sell_price,
        })),
        smartsuite_update: smartsuiteUpdate,
        csv_output_path: LATEST_CSV_PATH,
        archived_previous_csv_path: archivedCsvPath,
        archived_previous_json_path: archivedJsonPath,
        pruned_old_runs: prunedOldRuns,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Listing ready: ${readyRows.length}`);
  console.log(`Blocked by event resolution: ${blockedByEventId.length}`);
  console.log(`Event IDs resolved this run: ${newlyResolvedEventIdRows.length}`);
  if (forcedRows.length > 0) {
    console.log(`Forced Event ID listings: ${forcedRows.length}`);
  }
  if (blockedByEventId.length > 0) {
    console.log("NO EVENT ID READY FOR LISTING. UPDATE SMARTSUITE OR REVIEW STUBHUB MATCH. ->");
    for (const item of collapseBlockedListingRows(blockedByEventId)) {
      console.log(`- qty ${item.qty} | ${item.line}`);
    }
  }
  if (!smartsuiteUpdate.platform_choice_available) {
    console.log(`Platform update skipped: create the "${platformLabel}" option in SmartSuite first.`);
  }
  if (archivedCsvPath || archivedJsonPath) {
    console.log("Archived previous Bot - Listing outputs to Bot - Listing/runtime/outputs/old_runs");
  }
  if (prunedOldRuns.length > 0) {
    console.log(`Removed archived Bot - Listing outputs older than 14 days: ${prunedOldRuns.length}`);
  }
  console.log(`Wrote ${LATEST_CSV_PATH}`);
  console.log(`Wrote ${LATEST_JSON_PATH}`);
}

module.exports = { runListingBot };

if (require.main === module) {
  runListingBot().catch((error) => {
    console.error("Bot - Listing failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
}
