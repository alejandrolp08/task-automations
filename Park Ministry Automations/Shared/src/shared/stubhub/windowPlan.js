function shiftIsoDate(dateString, dayOffset) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return shifted.toISOString().slice(0, 10);
}

function buildGenericCheckoutWindow(eventDate, resolvedEventTime, options = {}) {
  if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new Error("Event window planning requires a valid event date in YYYY-MM-DD format.");
  }

  if (options.absoluteStart && options.absoluteEnd) {
    const absoluteStart = String(options.absoluteStart).trim();
    const absoluteEnd = String(options.absoluteEnd).trim();
    if (!/^\d{2}:\d{2}$/.test(absoluteStart) || !/^\d{2}:\d{2}$/.test(absoluteEnd)) {
      throw new Error("Absolute checkout windows require HH:MM start and end times.");
    }

    const endDayOffset = Number.isFinite(Number(options.endDayOffset)) ? Number(options.endDayOffset) : 0;
    return {
      startDate: eventDate,
      endDate: shiftIsoDate(eventDate, endDayOffset),
      start24: absoluteStart,
      end24: absoluteEnd,
    };
  }

  if (!resolvedEventTime || !/^\d{2}:\d{2}$/.test(resolvedEventTime)) {
    throw new Error("Relative checkout windows require a resolved event time in HH:MM format.");
  }

  const beforeMinutes = Number.isFinite(Number(options.beforeMinutes)) ? Number(options.beforeMinutes) : 60;
  const afterMinutes = Number.isFinite(Number(options.afterMinutes)) ? Number(options.afterMinutes) : 300;
  const [hours, minutes] = resolvedEventTime.split(":").map(Number);
  const baseMinutes = hours * 60 + minutes;
  const startMinutes = baseMinutes - beforeMinutes;
  const endMinutes = baseMinutes + afterMinutes;

  function format(totalMinutes) {
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hh = Math.floor(normalized / 60);
    const mm = normalized % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  return {
    startDate: shiftIsoDate(eventDate, startMinutes < 0 ? -1 : 0),
    endDate: shiftIsoDate(eventDate, endMinutes >= 1440 ? 1 : 0),
    start24: format(startMinutes),
    end24: format(endMinutes),
  };
}

function isFestivalStyleEvent(record) {
  const normalizedEvent = String(record?.event || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    normalizedEvent.includes("festival") ||
    normalizedEvent.includes("fest ") ||
    normalizedEvent.endsWith(" fest") ||
    normalizedEvent.includes("all day") ||
    normalizedEvent.includes("all-day")
  );
}

function buildCheckoutWindowPlan(record, resolution) {
  const eventStatus = String(resolution?.event_status || "unverified").trim().toLowerCase();
  const resolvedEventTime = resolution?.resolved_event_time || null;
  const eventDate = record?.event_date;

  if (!eventDate) {
    return {
      window_policy: "missing_event_date",
      checkout_strategies: [],
    };
  }

  if (eventStatus === "tbd" || eventStatus === "tbh" || isFestivalStyleEvent(record)) {
    return {
      window_policy:
        eventStatus === "tbd" || eventStatus === "tbh" ? "tbd_full_day" : "festival_full_day",
      checkout_strategies: [
        {
          label: eventStatus === "tbd" || eventStatus === "tbh" ? "tbd_full_day" : "festival_full_day",
          checkoutWindow: { absoluteStart: "10:00", absoluteEnd: "01:00", endDayOffset: 1 },
        },
        {
          label:
            eventStatus === "tbd" || eventStatus === "tbh"
              ? "tbd_emergency_12h"
              : "festival_emergency_12h",
          checkoutWindow: { absoluteStart: "11:00", absoluteEnd: "23:00", endDayOffset: 0 },
        },
      ],
    };
  }

  if (!resolvedEventTime) {
    return {
      window_policy: "missing_resolved_event_time",
      checkout_strategies: [],
    };
  }

  const baselineWindow = buildGenericCheckoutWindow(eventDate, resolvedEventTime, {
    beforeMinutes: 60,
    afterMinutes: 300,
  });

  const checkoutStrategies = [
    {
      label: "standard_window",
      checkoutWindow: { beforeMinutes: 60, afterMinutes: 300 },
    },
    {
      label: "reduced_window_4h30",
      checkoutWindow: { beforeMinutes: 60, afterMinutes: 270 },
    },
    {
      label: "reduced_window_4h",
      checkoutWindow: { beforeMinutes: 60, afterMinutes: 240 },
    },
  ];

  if (baselineWindow.endDate !== baselineWindow.startDate) {
    checkoutStrategies.push({
      label: "overnight_reduced_3h30",
      checkoutWindow: { beforeMinutes: 60, afterMinutes: 210 },
    });
  }

  return {
    window_policy: "standard_event",
    checkout_strategies: checkoutStrategies,
  };
}

module.exports = { buildCheckoutWindowPlan, buildGenericCheckoutWindow, isFestivalStyleEvent };
