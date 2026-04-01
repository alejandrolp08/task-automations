const fs = require("fs/promises");
const path = require("path");

const { getWayConfig } = require("./providers/way/config");
const { getBuyingBotOperativePaths } = require("../../../Workspace/operativePaths");

const OUTPUTS_DIR = getBuyingBotOperativePaths().outputs;
const MAINTENANCE_STATE_PATH = path.join(OUTPUTS_DIR, "maintenance-state.json");

function parsePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function readMaintenanceState() {
  try {
    const raw = await fs.readFile(MAINTENANCE_STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeMaintenanceState(payload) {
  await ensureDirectory(path.dirname(MAINTENANCE_STATE_PATH));
  await fs.writeFile(MAINTENANCE_STATE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function clearDirectoryContents(targetPath) {
  if (!(await pathExists(targetPath))) {
    return false;
  }

  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(targetPath, { recursive: true });
  return true;
}

async function listFiles(targetPath) {
  try {
    return await fs.readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function pruneFilesByAge(targetPath, options = {}) {
  const {
    olderThanMs = 0,
    include = () => true,
    exclude = () => false,
  } = options;

  const removed = [];
  const entries = await listFiles(targetPath);
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const entryPath = path.join(targetPath, entry.name);
    if (!include(entry.name, entryPath) || exclude(entry.name, entryPath)) {
      continue;
    }

    const stat = await fs.stat(entryPath).catch(() => null);
    if (!stat) {
      continue;
    }

    if (olderThanMs > 0 && now - stat.mtimeMs < olderThanMs) {
      continue;
    }

    await fs.rm(entryPath, { force: true }).catch(() => {});
    removed.push(entry.name);
  }

  return removed;
}

async function runRoutineMaintenance() {
  const maintenanceIntervalHours = parsePositiveNumber(
    process.env.BUYING_BOT_MAINTENANCE_INTERVAL_HOURS,
    12,
  );
  const screenshotRetentionDays = parsePositiveNumber(
    process.env.BUYING_BOT_SCREENSHOT_RETENTION_DAYS,
    3,
  );
  const outputRetentionDays = parsePositiveNumber(
    process.env.BUYING_BOT_OUTPUT_RETENTION_DAYS,
    7,
  );

  const previousState = await readMaintenanceState();
  const now = Date.now();
  const minimumIntervalMs = maintenanceIntervalHours * 60 * 60 * 1000;
  if (previousState?.last_run_at && now - previousState.last_run_at < minimumIntervalMs) {
    return {
      skipped: true,
      reason: "interval_not_reached",
      last_run_at: previousState.last_run_at,
    };
  }

  const wayConfig = getWayConfig();
  const buyingPaths = getBuyingBotOperativePaths();
  const waySessionDir = wayConfig.userDataDir;
  const cacheDirectories = [
    path.join(waySessionDir, "Default", "Cache"),
    path.join(waySessionDir, "Default", "Code Cache"),
    path.join(waySessionDir, "Default", "GPUCache"),
    path.join(waySessionDir, "Default", "DawnCache"),
    path.join(waySessionDir, "GrShaderCache"),
  ];

  const clearedCaches = [];
  for (const cachePath of cacheDirectories) {
    if (await clearDirectoryContents(cachePath)) {
      clearedCaches.push(path.relative(process.cwd(), cachePath));
    }
  }

  const removedScreenshots = await pruneFilesByAge(buyingPaths.screenshots.root, {
    olderThanMs: screenshotRetentionDays * 24 * 60 * 60 * 1000,
    include: (name) => /\.(png|jpg|jpeg)$/i.test(name),
  });

  const protectedJsonFiles = new Set([
    "result.json",
    "buying-bot-live-last-run.json",
    "buy-pass-last-run.json",
    "maintenance-state.json",
  ]);
  const removedOutputs = await pruneFilesByAge(OUTPUTS_DIR, {
    olderThanMs: outputRetentionDays * 24 * 60 * 60 * 1000,
    include: (name) => /\.json$/i.test(name),
    exclude: (name) => protectedJsonFiles.has(name),
  });

  const nextState = {
    last_run_at: now,
    cleared_caches: clearedCaches,
    removed_screenshots: removedScreenshots,
    removed_outputs: removedOutputs,
  };
  await writeMaintenanceState(nextState);

  return {
    skipped: false,
    ...nextState,
  };
}

module.exports = {
  runRoutineMaintenance,
};
