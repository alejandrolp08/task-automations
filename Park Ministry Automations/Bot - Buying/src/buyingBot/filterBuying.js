function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function isPendingBuyingRecord(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "boolean") {
    return value === false;
  }

  const normalized = String(value).trim().toLowerCase();

  if (normalized === "" || normalized === "no" || normalized === "false" || normalized === "0") {
    return true;
  }

  if (normalized === "yes" || normalized === "true" || normalized === "1") {
    return false;
  }

  return true;
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

function normalizeDate(value) {
  return new Date(`${value}T00:00:00`);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function buildParkingWindow(eventDate, eventTime) {
  if (!eventTime || !/^\d{2}:\d{2}$/.test(eventTime)) {
    return {
      start: null,
      end: null,
    };
  }

  const base = new Date(`${eventDate}T${eventTime}:00`);

  if (Number.isNaN(base.getTime())) {
    return {
      start: null,
      end: null,
    };
  }

  const start = new Date(base.getTime() - 60 * 60 * 1000);
  const end = new Date(base.getTime() + 5 * 60 * 60 * 1000);

  return {
    start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}`,
    end: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())} ${pad(end.getHours())}:${pad(end.getMinutes())}`,
  };
}

function hasRequiredBuyingFields(record) {
  return [
    record.event_date,
    record.provider,
    record.event,
    record.venue,
    record.parking_location,
    record.buy_cost,
    record.sell_price,
  ].every((value) => !isEmpty(value));
}

function filterBuying(records, startDate, endDate) {
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    throw new Error("Dates must use YYYY-MM-DD format.");
  }

  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);

  if (start > end) {
    throw new Error("start_date cannot be later than end_date.");
  }

  return records
    .filter((record) => {
      if (!isValidDateString(record.event_date)) {
        return false;
      }

      const eventDate = normalizeDate(record.event_date);
      const isPending = isPendingBuyingRecord(record.live);
      const hasNoReservation = isEmpty(record.reservation_id) && isEmpty(record.reservation_url);
      const hasRequiredFields = hasRequiredBuyingFields(record);
      const isInRange = eventDate >= start && eventDate <= end;
      const buyCost = Number(record.buy_cost);
      const sellPrice = Number(record.sell_price);
      const isProfitable = Number.isFinite(buyCost) && Number.isFinite(sellPrice) && buyCost < sellPrice;

      return isPending && hasNoReservation && hasRequiredFields && isInRange && isProfitable;
    })
    .map((record) => ({
      record_id: record.record_id,
      event_id: record.event_id,
      event: record.event,
      venue: record.venue,
      event_date: record.event_date,
      event_time: record.event_time,
      provider: record.provider,
      provider_key: record.provider_key,
      parking_location: record.parking_location,
      parking_location_id: record.parking_location_id,
      city_state: record.city_state,
      buy_cost: Number(record.buy_cost),
      sell_price: Number(record.sell_price),
      parking_window: buildParkingWindow(record.event_date, record.event_time),
      recommended_action: "buy",
    }));
}

module.exports = { filterBuying, buildParkingWindow, isPendingBuyingRecord, hasRequiredBuyingFields };
