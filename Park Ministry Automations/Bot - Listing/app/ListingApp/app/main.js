const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');

let mainWindow = null;

const APP_RESOURCE_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.resolve(__dirname, '..');

function getPackagedListingAppRoot() {
  if (!app.isPackaged) {
    return path.resolve(__dirname, '..');
  }

  if (process.platform === 'darwin') {
    return path.resolve(process.resourcesPath, '..', '..', '..', '..', '..');
  }

  if (process.platform === 'win32') {
    return path.resolve(process.resourcesPath, '..', '..', '..');
  }

  return path.resolve(process.resourcesPath, '..', '..');
}

const LISTING_APP_ROOT = getPackagedListingAppRoot();
const RUNTIME_ROOT = LISTING_APP_ROOT;
const LISTING_SCRIPT_PATH = app.isPackaged
  ? path.join(APP_RESOURCE_ROOT, 'src', 'bots', 'listingBot', 'runListingBot.js')
  : path.join(LISTING_APP_ROOT, 'src', 'bots', 'listingBot', 'runListingBot.js');
const LICENSE_PATH = path.join(LISTING_APP_ROOT, 'license.json');
const SETTINGS_PATH = path.join(LISTING_APP_ROOT, 'settings.json');
const OUTPUTS_ROOT = path.join(RUNTIME_ROOT, 'outputs');
const RUN_JSON_PATH = path.join(OUTPUTS_ROOT, 'listing-bot-last-run.json');
const CSV_PATH = path.join(OUTPUTS_ROOT, 'reachpro-bulk-draft-latest.csv');
const WINDOW_ICON_PATH = app.isPackaged
  ? path.join(APP_RESOURCE_ROOT, 'assets', process.platform === 'win32' ? 'ParkMinistry.ico' : 'ParkMinistry.icns')
  : path.join(RUNTIME_ROOT, 'templates', 'ParkMinistry_LightBackground_LogoSolo.png');
const NODE_CANDIDATES = [process.execPath, process.env.NODE_BINARY, '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  .filter(Boolean);

function resolveNodeCommand() {
  for (const candidate of NODE_CANDIDATES) {
    if (fsSync.existsSync(candidate)) {
      return { command: candidate, argsPrefix: [], extraEnv: {} };
    }
  }

  return {
    command: '/usr/bin/env',
    argsPrefix: ['node'],
    extraEnv: {
      PATH: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', process.env.PATH || '']
        .filter(Boolean)
        .join(':'),
    },
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 780,
    height: 660,
    minWidth: 640,
    minHeight: 560,
    title: 'ListingApp',
    icon: WINDOW_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function normalizeIsoDate(value) {
  return String(value || '').trim().slice(0, 10);
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function readJsonIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function getAppSettings() {
  const raw = await readJsonIfExists(SETTINGS_PATH);
  const fee = String(raw?.marketplace_fee_percent || '').trim();
  return {
    marketplaceFeePercent: fee || '9',
  };
}

async function saveAppSettings(payload = {}) {
  const next = {
    marketplace_fee_percent: String(payload.marketplaceFeePercent || '9').trim() || '9',
  };
  await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    marketplaceFeePercent: next.marketplace_fee_percent,
  };
}

async function getLicenseStatus() {
  const license = await readJsonIfExists(LICENSE_PATH);

  if (!license) {
    return {
      ok: false,
      active: false,
      reason: 'missing_license',
      customer: '',
      issuedAt: '',
      expiresAt: '',
      message: 'License file missing. Add license.json to activate ListingApp.',
    };
  }

  const expiresAt = normalizeIsoDate(license.expires_at);
  const issuedAt = normalizeIsoDate(license.issued_at);
  const today = getTodayIsoDate();

  if (!isValidDate(expiresAt)) {
    return {
      ok: false,
      active: false,
      reason: 'invalid_license',
      customer: String(license.customer || '').trim(),
      issuedAt,
      expiresAt,
      message: 'License file is invalid. Update license.json before using ListingApp.',
    };
  }

  const active = today <= expiresAt;
  return {
    ok: active,
    active,
    reason: active ? 'active' : 'expired',
    customer: String(license.customer || '').trim(),
    issuedAt,
    expiresAt,
    message: active
      ? `License active through ${expiresAt}.`
      : `License expired on ${expiresAt}. Contact Park Ministry to renew access.`,
  };
}

async function ensureRuntimePaths() {
  await fs.mkdir(OUTPUTS_ROOT, { recursive: true });
}

function runListingBot({ startDate, endDate, useForceEventIdFallback = false, marketplaceFeePercent = '9' }) {
  return new Promise((resolve) => {
    const nodeRuntime = resolveNodeCommand();

    ensureRuntimePaths()
      .then(() => {
        const child = spawn(nodeRuntime.command, [...nodeRuntime.argsPrefix, LISTING_SCRIPT_PATH], {
          cwd: LISTING_APP_ROOT,
          env: {
            ...process.env,
            ...nodeRuntime.extraEnv,
            ELECTRON_RUN_AS_NODE: '1',
            LISTING_BOT_OPERATIVE_ROOT: RUNTIME_ROOT,
            LISTING_BOT_START_DATE: startDate,
            LISTING_BOT_END_DATE: endDate,
            LISTING_ALLOW_SMARTSUITE_EVENT_ID_ONLY_FALLBACK: useForceEventIdFallback ? '1' : '',
            LISTING_MARKETPLACE_FEE_PERCENT: String(marketplaceFeePercent || '9').trim(),
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          stdout += text;
          mainWindow?.webContents.send('listing:run-log', { stream: 'stdout', text });
        });

        child.stderr.on('data', (chunk) => {
          const text = chunk.toString();
          stderr += text;
          mainWindow?.webContents.send('listing:run-log', { stream: 'stderr', text });
        });

        child.on('error', (error) => {
          resolve({ ok: false, code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
        });

        child.on('close', async (code) => {
          const runJson = await readJsonIfExists(RUN_JSON_PATH);
          resolve({
            ok: code === 0,
            code,
            stdout,
            stderr,
            runJson,
            runJsonPath: RUN_JSON_PATH,
            csvPath: CSV_PATH,
            outputsRoot: OUTPUTS_ROOT,
          });
        });

        child.stdin.end();
      })
      .catch((error) => {
        resolve({
          ok: false,
          code: 1,
          stdout: '',
          stderr: error.message,
          runJson: null,
          runJsonPath: RUN_JSON_PATH,
          csvPath: CSV_PATH,
          outputsRoot: OUTPUTS_ROOT,
        });
      });
  });
}

ipcMain.handle('listing:getLicenseStatus', async () => getLicenseStatus());
ipcMain.handle('listing:getSettings', async () => getAppSettings());
ipcMain.handle('listing:saveSettings', async (_event, payload) => saveAppSettings(payload));

ipcMain.handle('listing:run', async (_event, payload) => {
  const startDate = String(payload?.startDate || '').trim();
  const endDate = String(payload?.endDate || '').trim();
  const useForceEventIdFallback = Boolean(payload?.useForceEventIdFallback);
  const marketplaceFeePercent = String(payload?.marketplaceFeePercent || '9').trim();
  const licenseStatus = await getLicenseStatus();

  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'Both dates must use YYYY-MM-DD.',
      runJson: null,
      runJsonPath: RUN_JSON_PATH,
      csvPath: CSV_PATH,
      outputsRoot: OUTPUTS_ROOT,
      licenseStatus,
    };
  }

  if (!licenseStatus.active) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: licenseStatus.message,
      runJson: null,
      runJsonPath: RUN_JSON_PATH,
      csvPath: CSV_PATH,
      outputsRoot: OUTPUTS_ROOT,
      licenseStatus,
    };
  }

  return runListingBot({ startDate, endDate, useForceEventIdFallback, marketplaceFeePercent });
});

ipcMain.handle('listing:openOutputs', async () => {
  await ensureRuntimePaths();
  return shell.openPath(OUTPUTS_ROOT);
});
ipcMain.handle('listing:openCsv', async () => {
  await ensureRuntimePaths();
  return shell.openPath(CSV_PATH);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
