function normalizeWaySearchLocation(parkingLocation, cityState = "") {
  const baseLocation = String(parkingLocation || "").split("(")[0].trim();

  if (!baseLocation) {
    return cityState || "";
  }

  return cityState ? `${baseLocation}, ${cityState}` : baseLocation;
}

module.exports = { normalizeWaySearchLocation };
