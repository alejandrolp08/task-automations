const {
  BUYING_SMARTSUITE,
  SMARTSUITE_API_BASE_URL,
  getSmartsuiteHeaders,
  listSmartsuiteRecords,
} = require("../../../Shared/src/shared/smartsuite/api");

async function findExistingReservationUsage(reservationId) {
  if (!reservationId) {
    return [];
  }

  const buyingTableId = process.env.SMARTSUITE_BUYING_TABLE_ID || BUYING_SMARTSUITE.buyingTableId;
  const matches = await listSmartsuiteRecords(buyingTableId, {
    limit: 100,
    filter: {
      operator: "and",
      fields: [
        {
          field: BUYING_SMARTSUITE.fields.reservationId,
          comparison: "is",
          value: reservationId,
        },
      ],
    },
  });

  return matches;
}

async function updateSmartsuiteReservation(
  recordId,
  { reservationId, reservationUrl, actualBuyCost, parkingLocationRecordId, parkingLocationId } = {},
) {
  if (!recordId) {
    throw new Error("updateSmartsuiteReservation requires a recordId.");
  }
  if (!reservationId || !reservationUrl) {
    throw new Error("updateSmartsuiteReservation requires both reservationId and reservationUrl.");
  }

  const existingMatches = await findExistingReservationUsage(reservationId);
  const conflictingMatch = existingMatches.find((record) => record.id !== recordId);

  if (conflictingMatch) {
    throw new Error(
      `Reservation ID ${reservationId} is already assigned to SmartSuite record ${conflictingMatch.id}.`,
    );
  }

  const buyingTableId = process.env.SMARTSUITE_BUYING_TABLE_ID || BUYING_SMARTSUITE.buyingTableId;
  const headers = getSmartsuiteHeaders();
  const url = `${SMARTSUITE_API_BASE_URL}/applications/${buyingTableId}/records/${recordId}/`;

  const response = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      [BUYING_SMARTSUITE.fields.reservationId]: reservationId,
      [BUYING_SMARTSUITE.fields.reservationUrl]: reservationUrl,
      ...(parkingLocationRecordId
        ? {
            [BUYING_SMARTSUITE.fields.parkingLocation]: [parkingLocationRecordId],
          }
        : {}),
      ...(Number.isFinite(Number(actualBuyCost))
        ? {
            [BUYING_SMARTSUITE.fields.buyCost]: Number(actualBuyCost),
          }
        : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SmartSuite reservation update failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();

  return {
    status: "updated",
    record_id: recordId,
    reservation_id: reservationId,
    reservation_url: reservationUrl,
    actual_buy_cost: Number.isFinite(Number(actualBuyCost)) ? Number(actualBuyCost) : null,
    parking_location_record_id: parkingLocationRecordId || null,
    parking_location_id: parkingLocationId || null,
    smartsuite_record: payload,
  };
}

module.exports = { updateSmartsuiteReservation, findExistingReservationUsage };
