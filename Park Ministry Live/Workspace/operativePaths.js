const path = require("path");

function getOperativeRoot() {
  return process.cwd();
}

function getFulfillmentIntegrationOperativePaths() {
  const root = path.join(process.cwd(), "Ops - Fulfillment Integration", "runtime");
  const outputs = path.join(root, "outputs");

  return {
    root,
    outputs,
    latestJson: path.join(outputs, "fulfillment-integration-last-run.json"),
    latestCsv: path.join(outputs, "fulfillment-integration-last-run.csv"),
    oldRuns: path.join(outputs, "old_runs"),
  };
}

module.exports = {
  getOperativeRoot,
  getFulfillmentIntegrationOperativePaths,
};
