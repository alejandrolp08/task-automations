function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AIRPORT_PARKING_LOCATIONS = [
  {
    address_prefix: "78100 Varner Rd",
    airport_query: "Palm Springs International Airport PSP",
    lot_aliases: ["Motel 6 Palm Desert PSP Airport Parking", "PSP Airport Parking"],
  },
  {
    address_prefix: "2617 McGavock Pk",
    airport_query: "Nashville International Airport BNA",
    lot_aliases: ["Quality Inn BNA Airport Parking", "BNA Airport Parking"],
  },
  {
    address_prefix: "580 W Shaw Ave",
    airport_query: "Fresno Air Terminal FAT",
    lot_aliases: [
      "TownePlace Suites by Marriott Fresno Clovis Airport Parking",
      "Fresno Air Terminal FAT",
      "FAT Airport Parking",
    ],
  },
  {
    address_prefix: "1520 N 84th Dr",
    airport_query: "Phoenix Sky Harbor International Airport PHX",
    lot_aliases: ["Victory Inn PHX Airport Parking", "1520 N 84th Dr", "1520 North 84th Drive"],
  },
  {
    address_prefix: "5045 N Arco Ln",
    airport_query: "Charleston International Airport CHS",
    lot_aliases: [
      "Extended Stay America CHS Airport Parking",
      "5045 N Arco Ln",
    ],
  },
  {
    address_prefix: "1211 N W Ave",
    airport_query: "Sioux Falls Regional Airport",
    lot_aliases: [
      "Sheraton Sioux Falls & Convention Center Airport Parking",
      "1211 Northwest Avenue",
      "Fargo airport parking",
    ],
  },
  {
    address_prefix: "3300 Preston Hwy",
    airport_query: "Louisville International Airport SDF",
    lot_aliases: [
      "Extended Stay America Select Suites SDF Airport Parking",
      "SDF Airport Parking",
      "3300 Preston Hwy",
    ],
  },
  {
    address_prefix: "320 W Broadway",
    airport_query: "Louisville International Airport SDF",
    lot_aliases: [
      "Heyburn Lot SDF Airport Parking",
      "M HEYBURN LOT SDF Airport Parking",
      "320 W Broadway Heyburn Lot",
      "320 West Broadway",
      "SDF Airport Parking",
    ],
  },
];

const NORMALIZED_AIRPORT_PARKING_LOCATIONS = AIRPORT_PARKING_LOCATIONS.map((entry) => ({
  ...entry,
  normalized_prefix: normalizeText(entry.address_prefix),
  normalized_aliases: Array.from(
    new Set(
      [entry.address_prefix, ...(entry.lot_aliases || []), entry.airport_query]
        .filter(Boolean)
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  ),
}));

function getAirportParkingMetadata(recordOrLocation) {
  const parkingLocation =
    typeof recordOrLocation === "string"
      ? recordOrLocation
      : recordOrLocation?.parking_location || "";
  const normalizedLocation = normalizeText(parkingLocation);
  if (!normalizedLocation) {
    return null;
  }

  return (
    NORMALIZED_AIRPORT_PARKING_LOCATIONS.find((entry) =>
      normalizedLocation.startsWith(entry.normalized_prefix),
    ) || null
  );
}

module.exports = {
  AIRPORT_PARKING_LOCATIONS,
  getAirportParkingMetadata,
};
