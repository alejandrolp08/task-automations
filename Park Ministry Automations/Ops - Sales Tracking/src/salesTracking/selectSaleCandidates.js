const {
  normalizeInventoryRecord,
  normalizeSaleRecord,
} = require("./normalizeSalesTracking");

function includesComparableValue(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.includes(right) || right.includes(left);
}

function calculateSellPriceDelta(saleValue, sellPrice) {
  if (!Number.isFinite(saleValue) || !Number.isFinite(sellPrice)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(saleValue - sellPrice);
}

function comparePurchaseOrder(left, right) {
  const leftValue = String(left.purchase_sort_value || "");
  const rightValue = String(right.purchase_sort_value || "");

  if (leftValue && rightValue && leftValue !== rightValue) {
    return leftValue.localeCompare(rightValue);
  }

  return String(left.record_id || "").localeCompare(String(right.record_id || ""));
}

function isRequiredFieldMatch(sale, record) {
  if (sale.event_date && record.event_date && sale.event_date !== record.event_date) {
    return false;
  }

  if (!includesComparableValue(sale.event_name_normalized, record.event_name_normalized)) {
    return false;
  }

  if (!includesComparableValue(sale.venue_normalized, record.venue_normalized)) {
    return false;
  }

  if (!includesComparableValue(sale.parking_location_normalized, record.parking_location_normalized)) {
    return false;
  }

  if (record.event_time && sale.event_time && sale.event_time !== record.event_time) {
    return false;
  }

  return true;
}

function rankCandidate(sale, record) {
  return {
    ...record,
    sell_price_delta: calculateSellPriceDelta(sale.sale_value, record.sell_price),
  };
}

function selectSaleCandidates(saleRecord, inventoryRecords) {
  const sale = normalizeSaleRecord(saleRecord);
  const normalizedInventory = inventoryRecords.map(normalizeInventoryRecord);

  const matchedCandidates = normalizedInventory
    .filter((record) => isRequiredFieldMatch(sale, record))
    .map((record) => rankCandidate(sale, record))
    .sort((left, right) => {
      if (left.sell_price_delta !== right.sell_price_delta) {
        return left.sell_price_delta - right.sell_price_delta;
      }

      return comparePurchaseOrder(left, right);
    });

  const qty = Math.max(1, Number(sale.qty) || 1);
  const selected = matchedCandidates.slice(0, qty);

  return {
    sale,
    matched: selected.length === qty,
    qty_requested: qty,
    qty_selected: selected.length,
    selected_candidates: selected,
    candidate_pool: matchedCandidates,
    review_reason:
      selected.length === qty
        ? ""
        : `Not enough valid candidates to cover qty ${qty}. Found ${matchedCandidates.length}.`,
  };
}

module.exports = {
  calculateSellPriceDelta,
  comparePurchaseOrder,
  includesComparableValue,
  isRequiredFieldMatch,
  rankCandidate,
  selectSaleCandidates,
};
