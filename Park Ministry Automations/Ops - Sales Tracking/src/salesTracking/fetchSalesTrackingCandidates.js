const { listSmartsuiteRecords } = require("../../../Shared/src/shared/smartsuite/api");
const { INVENTORY_SMARTSUITE } = require("../../../Shared/src/shared/smartsuite/config");
const {
  isEligibleUnsoldInventory,
  normalizeSmartsuiteSaleInventoryRecord,
} = require("./normalizeSmartsuiteSaleInventory");

function buildSalesTrackingFilter(eventDate) {
  return {
    operator: "and",
    fields: [
      {
        field: INVENTORY_SMARTSUITE.fields.eventDate,
        comparison: "is_on_or_after",
        value: {
          date_mode: "exact_date",
          date_mode_value: eventDate,
        },
      },
      {
        field: INVENTORY_SMARTSUITE.fields.eventDate,
        comparison: "is_on_or_before",
        value: {
          date_mode: "exact_date",
          date_mode_value: eventDate,
        },
      },
    ],
  };
}

async function fetchSalesTrackingCandidates({ eventDate } = {}) {
  const tableId =
    process.env.SMARTSUITE_INVENTORY_TABLE_ID || INVENTORY_SMARTSUITE.applicationId;
  const rawRecords = await listSmartsuiteRecords(tableId, {
    limit: 500,
    filter: buildSalesTrackingFilter(eventDate),
  });

  const normalized = rawRecords.map(normalizeSmartsuiteSaleInventoryRecord);

  return {
    raw_records: rawRecords,
    normalized_records: normalized,
    eligible_records: normalized.filter(isEligibleUnsoldInventory),
  };
}

module.exports = {
  buildSalesTrackingFilter,
  fetchSalesTrackingCandidates,
};
