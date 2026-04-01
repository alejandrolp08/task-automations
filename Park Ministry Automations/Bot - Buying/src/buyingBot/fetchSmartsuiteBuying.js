const { BUYING_SMARTSUITE, listSmartsuiteRecords } = require("../../../Shared/src/shared/smartsuite/api");

function buildBuyingFilter(startDate, endDate) {
  return {
    operator: "and",
    fields: [
      {
        field: BUYING_SMARTSUITE.fields.eventDate,
        comparison: "is_on_or_after",
        value: {
          date_mode: "exact_date",
          date_mode_value: startDate,
        },
      },
      {
        field: BUYING_SMARTSUITE.fields.eventDate,
        comparison: "is_on_or_before",
        value: {
          date_mode: "exact_date",
          date_mode_value: endDate,
        },
      },
      {
        field: BUYING_SMARTSUITE.fields.live,
        comparison: "is",
        value: false,
      },
      {
        field: BUYING_SMARTSUITE.fields.reservationId,
        comparison: "is_empty",
        value: "",
      },
      {
        field: BUYING_SMARTSUITE.fields.reservationUrl,
        comparison: "is_empty",
        value: "",
      },
    ],
  };
}

async function fetchSmartsuiteBuying({ startDate, endDate } = {}) {
  const buyingTableId = process.env.SMARTSUITE_BUYING_TABLE_ID || BUYING_SMARTSUITE.buyingTableId;
  const filter = startDate && endDate ? buildBuyingFilter(startDate, endDate) : {};

  return listSmartsuiteRecords(buyingTableId, {
    limit: 500,
    filter,
  });
}

module.exports = { fetchSmartsuiteBuying, listSmartsuiteRecords, buildBuyingFilter };
