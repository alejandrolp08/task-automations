const { getBuyingBotOperativePaths } = require("../../../../../Workspace/operativePaths");

function getWayConfig() {
  const buyingPaths = getBuyingBotOperativePaths();
  return {
    loginUrl: "https://www.way.com/login",
    homeUrl: "https://www.way.com/",
    checkoutUrl: "https://www.way.com/checkout",
    ordersUrl: "https://www.way.com/orders",
    orderConfirmedUrl: "https://www.way.com/checkout/order-confirmed",
    username: process.env.WAY_USERNAME || "",
    password: process.env.WAY_PASSWORD || "",
    userDataDir:
      process.env.WAY_USER_DATA_DIR ||
      buyingPaths.sessions.way,
  };
}

function buildReservationUrl(reservationId) {
  if (!reservationId) {
    return "";
  }

  return `https://www.way.com/order-print/${reservationId}`;
}

function hasWayCredentials() {
  const config = getWayConfig();
  return Boolean(config.username && config.password);
}

module.exports = { getWayConfig, buildReservationUrl, hasWayCredentials };
