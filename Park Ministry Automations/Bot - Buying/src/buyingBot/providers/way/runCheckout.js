const { loadEnv } = require("../../../../../Workspace/loadEnv");
const { getBuyingBotOperativePaths } = require("../../../../../Workspace/operativePaths");
const {
  createWayBrowserSession,
  ensureLoggedIn,
  searchLots,
  selectLot,
  reviewCheckout,
  completeCheckout,
  captureReservationDetails,
} = require("./browserFlow");
const { loadWayCheckoutCandidate } = require("./loadCheckoutCandidate");

loadEnv();

function parseBoolean(value, defaultValue = true) {
  if (value === undefined) {
    return defaultValue;
  }

  return !["false", "0", "no"].includes(String(value).trim().toLowerCase());
}

async function main() {
  const recordId = process.env.WAY_RECORD_ID || "";
  const dryRun = parseBoolean(process.env.WAY_DRY_RUN, true);
  const keepBrowserOpen = parseBoolean(process.env.WAY_KEEP_BROWSER_OPEN, dryRun);
  const { candidate, resolved_event_time, resolved_event_time_source } = loadWayCheckoutCandidate(recordId);
  const { browser, context, page } = await createWayBrowserSession();
  let currentStep = "starting";

  try {
    console.log(`Way checkout candidate: ${candidate.record_id}`);
    console.log(`Event: ${candidate.event} | ${candidate.venue} | ${candidate.event_date}`);
    console.log(`Resolved event time: ${resolved_event_time} (${resolved_event_time_source})`);
    console.log(`Dry run: ${dryRun ? "yes" : "no"}`);
    console.log(`Keep browser open: ${keepBrowserOpen ? "yes" : "no"}`);

    currentStep = "login";
    const loginResult = await ensureLoggedIn(page);
    console.log(`Login status: ${loginResult.status}`);

    currentStep = "search";
    const searchResult = await searchLots(page, candidate, resolved_event_time);
    console.log(`Search completed for: ${searchResult.locationQuery}`);
    console.log(
      `Checkout window: ${searchResult.checkoutWindow.startDisplay} -> ${searchResult.checkoutWindow.endDisplay}`,
    );

    currentStep = "select_lot";
    const selectionResult = await selectLot(page, candidate);
    console.log(`Selection status: ${selectionResult.status}`);

    currentStep = "review_checkout";
    const reviewResult = await reviewCheckout(page);
    console.log(`Checkout price snapshot: ${reviewResult.priceSnapshot || "not found"}`);

    if (dryRun) {
      console.log("Dry run enabled. Stopping before final checkout click.");
      return;
    }

    currentStep = "complete_checkout";
    const checkoutResult = await completeCheckout(page);
    console.log(`Checkout status: ${checkoutResult.status}`);

    currentStep = "capture_reservation";
    const reservationResult = await captureReservationDetails(page, candidate, resolved_event_time);
    console.log(`Reservation capture status: ${reservationResult.status}`);
    console.log(`Reservation ID: ${reservationResult.reservation_id || "not found"}`);
    console.log(`Reservation URL: ${reservationResult.reservation_url || "not found"}`);
    console.log(`Reservation matched title: ${reservationResult.matched_title || "not found"}`);
    console.log(`Reservation matched address: ${reservationResult.matched_address || "not found"}`);
    console.log(`Reservation pass validation: ${reservationResult.pass_validation_status || "not checked"}`);
  } catch (error) {
    const buyingPaths = getBuyingBotOperativePaths();
    console.error(`Way checkout failed during step: ${currentStep}`);
    console.error(`Current page: ${page.url()}`);
    await page
      .screenshot({
        path: buyingPaths.screenshots.wayDryRunFailure,
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    if (keepBrowserOpen) {
      console.log("Browser left open for review. Close it manually when finished.");
      return;
    }

    if (context) {
      await context.close();
      return;
    }

    if (browser) {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
