const { normalizeFulfillmentRecord } = require("./normalizeFulfillmentRecord");
const { runFulfillmentIntegration } = require("./runFulfillmentIntegration");
const {
  fetchFulfillmentCandidates,
  isEligibleFulfillmentCandidate,
  normalizeFulfillmentCandidate,
} = require("./fetchFulfillmentCandidates");
const {
  resolveFulfillmentInputFromSmartsuite,
} = require("./smartsuiteFulfillmentSource");
const {
  buildStubhubEticketUploadRequests,
  buildStubhubHeaders,
  buildStubhubInvoiceAssetsUrl,
  buildStubhubInvoiceByMarketplaceSaleUrl,
  buildStubhubInvoiceSearchUrl,
  buildStubhubInvoiceUrl,
  buildStubhubSaleUpdateRequest,
} = require("./stubhubFulfillmentApi");

module.exports = {
  buildStubhubEticketUploadRequests,
  buildStubhubHeaders,
  buildStubhubInvoiceAssetsUrl,
  buildStubhubInvoiceByMarketplaceSaleUrl,
  buildStubhubInvoiceSearchUrl,
  buildStubhubInvoiceUrl,
  buildStubhubSaleUpdateRequest,
  fetchFulfillmentCandidates,
  isEligibleFulfillmentCandidate,
  normalizeFulfillmentCandidate,
  normalizeFulfillmentRecord,
  resolveFulfillmentInputFromSmartsuite,
  runFulfillmentIntegration,
};
