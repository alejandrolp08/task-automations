function getEventValidationState(resolution) {
  const eventStatus = String(resolution?.event_status || "unverified").trim().toLowerCase();
  const hasResolvedTime = Boolean(resolution?.resolved_event_time);
  const manualReviewRequired = resolution?.manual_review_required !== false;
  const purchaseBlocked = resolution?.purchase_blocked === true;

  if (manualReviewRequired) {
    return {
      eligible: false,
      reason: "manual_review_required",
      event_status: eventStatus,
    };
  }

  if (purchaseBlocked) {
    return {
      eligible: false,
      reason: "purchase_blocked",
      event_status: eventStatus,
    };
  }

  if (eventStatus === "scheduled") {
    if (!hasResolvedTime) {
      return {
        eligible: false,
        reason: "missing_resolved_event_time",
        event_status: eventStatus,
      };
    }

    return {
      eligible: true,
      reason: null,
      event_status: eventStatus,
    };
  }

  if (eventStatus === "tbd" || eventStatus === "tbh") {
    return {
      eligible: true,
      reason: null,
      event_status: eventStatus,
    };
  }

  return {
    eligible: false,
    reason: "event_not_purchaseable",
    event_status: eventStatus,
  };
}

module.exports = { getEventValidationState };
