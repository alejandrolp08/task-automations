const path = require("path");

function getOperativeRoot() {
  return process.cwd();
}

function getBuyingBotOperativePaths() {
  const root = path.join(getOperativeRoot(), "BuyingBot");
  const outputs = path.join(root, "outputs");
  const screenshots = path.join(outputs, "screenshots");

  return {
    root,
    outputs,
    data: {
      root: path.join(root, "data"),
      sampleBuyingJson: path.join(root, "data", "sampleBuying.json"),
      manualEventTimeResolutionsJson: path.join(root, "data", "manualEventTimeResolutions.json"),
    },
    resultJson: path.join(outputs, "result.json"),
    liveRunJson: path.join(outputs, "buying-bot-live-last-run.json"),
    buyPassJson: path.join(outputs, "buy-pass-last-run.json"),
    maintenanceStateJson: path.join(outputs, "maintenance-state.json"),
    screenshots: {
      root: screenshots,
      buyPassFailure: path.join(screenshots, "buy-pass-failure.png"),
      wayDryRunFailure: path.join(screenshots, "way-dry-run-failure.png"),
      wayLiveRunFailure: path.join(screenshots, "way-live-run-failure.png"),
      wayAfterCheckin: path.join(screenshots, "way-after-checkin.png"),
      wayPassCapture: path.join(screenshots, "way-pass-capture.png"),
      wayOrdersCapture: path.join(screenshots, "way-orders-capture.png"),
    },
    sessions: {
      root: path.join(outputs, "sessions"),
      way: path.join(outputs, "sessions", "way"),
    },
  };
}

function getListingBotOperativePaths() {
  const overrideRoot = String(process.env.LISTING_BOT_OPERATIVE_ROOT || "").trim();
  const root = overrideRoot || getOperativeRoot();
  const outputs = path.join(root, "outputs");

  return {
    root,
    outputs,
    templates: {
      root: path.join(root, "templates"),
      reachpro: path.join(root, "templates", "reachpro"),
    },
    latestCsv: path.join(outputs, "reachpro-bulk-draft-latest.csv"),
    latestJson: path.join(outputs, "listing-bot-last-run.json"),
    oldRuns: path.join(outputs, "old_runs"),
  };
}

function getSalesTrackingOperativePaths() {
  const root = path.join(getOperativeRoot(), "SalesTracking");
  const outputs = path.join(root, "outputs");

  return {
    root,
    outputs,
    latestJson: path.join(outputs, "sales-tracking-last-run.json"),
    latestCsv: path.join(outputs, "sales-tracking-last-run.csv"),
    oldRuns: path.join(outputs, "old_runs"),
  };
}

module.exports = {
  getOperativeRoot,
  getBuyingBotOperativePaths,
  getListingBotOperativePaths,
  getSalesTrackingOperativePaths,
};
