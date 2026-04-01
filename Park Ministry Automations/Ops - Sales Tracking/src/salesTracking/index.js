const { buildSaleUpdateItems } = require("./applySaleToSmartSuite");
const { fetchSalesTrackingCandidates } = require("./fetchSalesTrackingCandidates");
const { selectSaleCandidates } = require("./selectSaleCandidates");
const {
  isEligibleUnsoldInventory,
  normalizeSmartsuiteSaleInventoryRecord,
} = require("./normalizeSmartsuiteSaleInventory");
const { parseViagogoSaleEmail } = require("./parseViagogoSaleEmail");

module.exports = {
  buildSaleUpdateItems,
  fetchSalesTrackingCandidates,
  isEligibleUnsoldInventory,
  normalizeSmartsuiteSaleInventoryRecord,
  parseViagogoSaleEmail,
  selectSaleCandidates,
};
