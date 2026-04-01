function getStubhubConfig() {
  const environment = process.env.STUBHUB_ENV || "production";
  const lookupMode = process.env.STUBHUB_LOOKUP_MODE || "live_web";
  const isSandbox = environment === "sandbox";

  return {
    environment,
    lookupMode,
    apiBaseUrl: isSandbox
      ? "https://sandbox.api.stubhub.net"
      : "https://api.stubhub.net",
    authBaseUrl: isSandbox
      ? "https://sandbox.account.stubhub.com"
      : "https://account.stubhub.com",
    clientId: process.env.STUBHUB_CLIENT_ID || "",
    clientSecret: process.env.STUBHUB_CLIENT_SECRET || "",
  };
}

function hasStubhubCredentials() {
  const config = getStubhubConfig();
  return Boolean(config.clientId && config.clientSecret);
}

module.exports = { getStubhubConfig, hasStubhubCredentials };
