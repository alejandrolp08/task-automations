const { listSmartsuiteRecords } = require("../../../Shared/src/shared/smartsuite/api");
const { LOCATIONS_SMARTSUITE } = require("../../../Shared/src/shared/smartsuite/config");
const { normalizeProviderKey } = require("../../../Shared/src/shared/providers/normalizeProviderKey");

function unwrapValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "";
    }

    return unwrapValue(value[0]);
  }

  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "title")) {
      return value.title;
    }

    if (Object.prototype.hasOwnProperty.call(value, "label")) {
      return value.label;
    }

    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return value.value;
    }
  }

  return value;
}

function unwrapFirstLinkedRecord(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const linkedRecord = unwrapFirstLinkedRecord(item);
      if (linkedRecord) {
        return linkedRecord;
      }
    }

    return null;
  }

  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "id")) {
    return value;
  }

  return null;
}

function toText(value) {
  const unwrapped = unwrapValue(value);
  return unwrapped === null || unwrapped === undefined ? "" : String(unwrapped);
}

function toNumber(value) {
  const parsed = Number(unwrapValue(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDistanceToMiles(distanceValue, unitLabel) {
  const numericDistance = Number(distanceValue);
  if (!Number.isFinite(numericDistance)) {
    return null;
  }

  const normalizedUnit = String(unitLabel || "").trim().toLowerCase();
  if (normalizedUnit === "km") {
    return numericDistance * 0.621371;
  }

  return numericDistance;
}

function normalizeLocationRecord(record) {
  const fields = LOCATIONS_SMARTSUITE.fields;
  const venueValue = record[fields.venueName];
  const providerValue = record[fields.providerName];
  const statusValue = record[fields.locationStatus];
  const unitValue = record[fields.distanceUnit];
  const venueLinkedRecord = unwrapFirstLinkedRecord(venueValue);
  const providerLinkedRecord = unwrapFirstLinkedRecord(providerValue);
  const distance = toNumber(record[fields.distanceFromVenue]);
  const unitLabel = toText(unitValue);

  return {
    record_id: record.record_id || record.id || "",
    parking_location: toText(record[fields.title]),
    parking_location_id: toText(record[fields.parkingLocationId]),
    venue_record_id: toText(venueLinkedRecord?.id || ""),
    venue: toText(venueValue),
    provider: toText(providerValue),
    provider_key: normalizeProviderKey(toText(providerValue)),
    provider_record_id: toText(providerLinkedRecord?.id || ""),
    status_label: toText(statusValue),
    status_value: toText(statusValue?.value || statusValue),
    buy_cost: toNumber(record[fields.buyCost]),
    sell_price: toNumber(record[fields.sellPrice]),
    distance_from_venue: distance,
    distance_unit: unitLabel,
    distance_miles: normalizeDistanceToMiles(distance, unitLabel),
  };
}

async function fetchFallbackLocations() {
  const rawRecords = await listSmartsuiteRecords(LOCATIONS_SMARTSUITE.tableId, {
    limit: 500,
    filter: {},
  });

  return rawRecords.map(normalizeLocationRecord);
}

function buildFallbackLocationIndex(locations) {
  const index = new Map();

  for (const location of locations) {
    const venueRecordId = String(location.venue_record_id || "").trim();
    const providerKey = String(location.provider_key || "").trim();

    if (!venueRecordId || !providerKey) {
      continue;
    }

    if (!index.has(venueRecordId)) {
      index.set(venueRecordId, new Map());
    }

    const venueMap = index.get(venueRecordId);
    if (!venueMap.has(providerKey)) {
      venueMap.set(providerKey, []);
    }

    venueMap.get(providerKey).push(location);
  }

  for (const venueMap of index.values()) {
    for (const providerLocations of venueMap.values()) {
      providerLocations.sort((left, right) => {
        const leftDistance = Number.isFinite(left.distance_miles) ? left.distance_miles : Number.POSITIVE_INFINITY;
        const rightDistance = Number.isFinite(right.distance_miles) ? right.distance_miles : Number.POSITIVE_INFINITY;

        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }

        return String(left.parking_location || "").localeCompare(String(right.parking_location || ""));
      });
    }
  }

  return index;
}

function getFallbackLocationsForCandidate(
  candidate,
  fallbackLocationIndex,
  { activeProviderKeys = [], maxDistanceMiles = 3, maxBuyCostDelta = 3 } = {},
) {
  const venueRecordId = String(candidate?.venue_record_id || "").trim();
  const providerKey = normalizeProviderKey(candidate?.provider_key || candidate?.provider);
  const targetBuyCost = Number(candidate?.buy_cost);

  if (!venueRecordId || !providerKey || !fallbackLocationIndex.has(venueRecordId)) {
    return [];
  }

  if (activeProviderKeys.length > 0 && !activeProviderKeys.includes(providerKey)) {
    return [];
  }

  const providerLocations = fallbackLocationIndex.get(venueRecordId)?.get(providerKey) || [];
  const originalParkingLocationRecordId = String(candidate?.parking_location_record_id || "").trim();
  const originalParkingLocation = String(candidate?.parking_location || "").trim().toLowerCase();

  return providerLocations.filter((location) => {
    const statusValue = String(location.status_value || "").trim().toLowerCase();
    if (statusValue !== "complete") {
      return false;
    }

    if (!Number.isFinite(location.distance_miles) || location.distance_miles > maxDistanceMiles) {
      return false;
    }

    if (!Number.isFinite(location.buy_cost) || !Number.isFinite(targetBuyCost)) {
      return false;
    }

    if (Math.abs(location.buy_cost - targetBuyCost) > maxBuyCostDelta) {
      return false;
    }

    if (
      originalParkingLocationRecordId &&
      String(location.record_id || "").trim() === originalParkingLocationRecordId
    ) {
      return false;
    }

    if (
      !originalParkingLocationRecordId &&
      originalParkingLocation &&
      String(location.parking_location || "").trim().toLowerCase() === originalParkingLocation
    ) {
      return false;
    }

    return true;
  });
}

module.exports = {
  fetchFallbackLocations,
  buildFallbackLocationIndex,
  getFallbackLocationsForCandidate,
};
