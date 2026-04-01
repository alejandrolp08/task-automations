const { getWayConfig, hasWayCredentials } = require("./config");

function buildWayCheckoutFlow() {
  const config = getWayConfig();

  return {
    provider: "Way",
    status: hasWayCredentials() ? "ready_for_browser_automation" : "missing_way_credentials",
    urls: {
      login: config.loginUrl,
      home: config.homeUrl,
      orders: config.ordersUrl,
    },
    steps: [
      "Check whether a Way session is already active",
      "If needed, log in with Way credentials",
      "Open the main search page",
      "Search using the parking address or venue name",
      "Trim parking location text to the portion before the distance parentheses",
      "Set event date and parking window",
      "Run search and inspect returned lots",
      "Select the correct lot using visible address/title cues",
      "Click Reserve now",
      "Review checkout page and final price after taxes",
      "If a membership upsell appears, decline it",
      "Confirm checkout",
      "Open the orders page",
      "Find the new order and capture Reservation ID",
      "Build Reservation URL from the reservation id",
    ],
    decision_rules: [
      "Normal parking window is 1 hour before event start to 5 hours after event start",
      "Use event time validated in StubHub before checkout",
      "Final checkout price should stay within about $3 above Buy Cost",
      "Final checkout price should remain materially below Sell Price",
      "Process purchases one by one for now",
    ],
    notes: [
      "The order title may vary after purchase, so Reservation ID should be treated as the primary key.",
      "The reservation link follows the format https://www.way.com/order-print/<RESERVATION_ID>.",
      "A final address check can also be performed from the printed parking pass view if needed.",
    ],
  };
}

module.exports = { buildWayCheckoutFlow };
