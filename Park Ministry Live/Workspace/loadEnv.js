const fs = require("fs");
const path = require("path");

function loadEnv(envPath) {
  const candidatePaths = [
    envPath,
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "..", "Park Ministry Automations", ".env"),
  ].filter(Boolean);

  const resolvedEnvPath = candidatePaths.find((candidate) => fs.existsSync(candidate));

  if (!resolvedEnvPath) {
    return;
  }

  const raw = fs.readFileSync(resolvedEnvPath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadEnv };
