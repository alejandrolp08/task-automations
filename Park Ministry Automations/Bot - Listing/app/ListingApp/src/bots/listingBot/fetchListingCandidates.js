const { listSmartsuiteRecords } = require("../../shared/smartsuite/api");
const { normalizeBuyingRecords } = require("../../shared/records/normalizeBuying");
const { SMARTSUITE } = require("../../shared/smartsuite/config");

function unwrapLabels(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flat(Infinity)
    .map((entry) => {
      if (entry && typeof entry === "object") {
        if (entry.title) {
          return String(entry.title);
        }
        if (entry.label) {
          return String(entry.label);
        }
        if (entry.value) {
          return String(entry.value);
        }
      }
      if (entry === null || entry === undefined || entry === "") {
        return "";
      }
      return String(entry);
    })
    .filter(Boolean);
}

function buildListingFilter(startDate, endDate) {
  return {
    operator: "and",
    fields: [
      {
        field: SMARTSUITE.fields.eventDate,
        comparison: "is_on_or_after",
        value: {
          date_mode: "exact_date",
          date_mode_value: startDate,
        },
      },
      {
        field: SMARTSUITE.fields.eventDate,
        comparison: "is_on_or_before",
        value: {
          date_mode: "exact_date",
          date_mode_value: endDate,
        },
      },
      {
        field: SMARTSUITE.fields.live,
        comparison: "is",
        value: false,
      },
    ],
  };
}

function buildListingCandidates(rawRecords) {
  const normalized = normalizeBuyingRecords(rawRecords);

  return normalized.map((record, index) => {
    const raw = rawRecords[index] || {};
    return {
      ...record,
      raw_record: raw,
      platform_listed_on_labels: unwrapLabels(raw[SMARTSUITE.fields.platformListedOn]),
    };
  });
}

function filterListingCandidates(records, platformLabel = "ReachPro") {
  const targetPlatform = String(platformLabel || "").trim().toLowerCase();

  return records.map((record) => {
    const reasons = [];

    if (record.live === true) {
      reasons.push("already_live");
    }
    if (!record.reservation_id) {
      reasons.push("missing_reservation_id");
    }
    if (!record.reservation_url) {
      reasons.push("missing_reservation_url");
    }
    if (!record.provider) {
      reasons.push("missing_provider");
    }
    if (!record.event) {
      reasons.push("missing_event");
    }
    if (!record.venue) {
      reasons.push("missing_venue");
    }
    if (!record.parking_location) {
      reasons.push("missing_parking_location");
    }
    if (!record.parking_location_id) {
      reasons.push("missing_parking_location_id");
    }
    if (!Number.isFinite(Number(record.buy_cost))) {
      reasons.push("missing_buy_cost");
    }
    if (!Number.isFinite(Number(record.sell_price))) {
      reasons.push("missing_sell_price");
    }
    if ((record.platform_listed_on_labels || []).length > 0) {
      reasons.push("platform_listed_on_not_empty");
    }
    if (
      targetPlatform &&
      record.platform_listed_on_labels.some((label) => String(label).trim().toLowerCase() === targetPlatform)
    ) {
      reasons.push("already_marked_for_target_platform");
    }

    return {
      ...record,
      listing_eligible: reasons.length === 0,
      listing_block_reasons: reasons,
    };
  });
}

async function fetchListingCandidates({ startDate, endDate, platformLabel = "ReachPro" } = {}) {
  const buyingTableId = process.env.SMARTSUITE_BUYING_TABLE_ID || SMARTSUITE.buyingTableId;
  const rawRecords = await listSmartsuiteRecords(buyingTableId, {
    limit: 500,
    filter: buildListingFilter(startDate, endDate),
  });

  const candidates = buildListingCandidates(rawRecords);
  return filterListingCandidates(candidates, platformLabel);
}

module.exports = {
  fetchListingCandidates,
  buildListingFilter,
  filterListingCandidates,
};
