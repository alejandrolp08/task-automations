const fs = require("fs/promises");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");

const { loadEnv } = require("../../../../../Workspace/loadEnv");
const { getBuyingBotOperativePaths } = require("../../../../../Workspace/operativePaths");
const {
  createWayBrowserSession,
  ensureLoggedIn,
  searchLots,
  selectLot,
  getActiveWayPage,
  reviewCheckout,
  completeCheckout,
  captureReservationDetails,
} = require("./browserFlow");
const { loadWayCheckoutCandidate } = require("./loadCheckoutCandidate");
const { updateSmartsuiteReservation } = require("../../updateSmartsuiteReservation");

loadEnv();

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }

  return !["false", "0", "no"].includes(String(value).trim().toLowerCase());
}

function getRecordIdFromArgs() {
  const args = process.argv.slice(2);
  const explicitIndex = args.findIndex((arg) => arg === "--record-id");
  if (explicitIndex !== -1 && args[explicitIndex + 1]) {
    return args[explicitIndex + 1];
  }

  return args[0] || process.env.WAY_RECORD_ID || "";
}

async function askForCheckoutConfirmation({ candidate, reviewResult, searchResult }) {
  const rl = readline.createInterface({
    input,
    output,
    terminal: true,
  });

  try {
    console.log("");
    console.log("Way checkout is ready.");
    console.log(`Record ID: ${candidate.record_id}`);
    console.log(`Event: ${candidate.event}`);
    console.log(`Venue: ${candidate.venue}`);
    console.log(`Date: ${candidate.event_date}`);
    console.log(`Location: ${candidate.parking_location}`);
    console.log(
      `Window: ${searchResult.checkoutWindow.startDisplay} -> ${searchResult.checkoutWindow.endDisplay}`,
    );
    console.log(`Checkout price snapshot: ${reviewResult.priceSnapshot || "not found"}`);
    console.log("");

    const answer = (await rl.question('Type "BUY" to press Checkout, or anything else to cancel: ')).trim();
    return answer === "BUY";
  } finally {
    rl.close();
  }
}

async function writeLastRunOutput(payload) {
  const outputPath = getBuyingBotOperativePaths().buyPassJson;
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return outputPath;
}

async function main() {
  let browser = null;
  let context = null;
  let page = null;
  let currentStep = "starting";

  try {
    const recordId = getRecordIdFromArgs();
    const keepBrowserOpen = parseBoolean(process.env.WAY_KEEP_BROWSER_OPEN, false);
    const updateSmartsuite = parseBoolean(process.env.BUY_PASS_UPDATE_SMARTSUITE, true);
    const autoConfirm = parseBoolean(process.env.BUY_PASS_AUTO_CONFIRM, false);

    console.log("buyPass: starting...");
    console.log(`buyPass: requested record id -> ${recordId || "first Way candidate"}`);
    console.log(`buyPass: auto confirm checkout -> ${autoConfirm ? "yes" : "no"}`);

    currentStep = "load_candidate";
    const { candidate, resolved_event_time, resolved_event_time_source, resolved_event_status } = loadWayCheckoutCandidate(recordId);
    console.log(`buyPass: candidate loaded -> ${candidate.record_id} | ${candidate.event} | ${candidate.event_date}`);
    console.log(`buyPass: resolved event time -> ${resolved_event_time || "TBD"} (${resolved_event_time_source})`);
    console.log(`buyPass: resolved event status -> ${resolved_event_status}`);

    currentStep = "create_browser_session";
    ({ browser, context, page } = await createWayBrowserSession());
    console.log("buyPass: browser session created");

    currentStep = "login";
    const loginResult = await ensureLoggedIn(page);
    console.log(`buyPass: login status -> ${loginResult.status}`);

    currentStep = "search";
    const searchResult = await searchLots(page, candidate, resolved_event_time);

    currentStep = "select_lot";
    const selectionResult = await selectLot(page, candidate);
    page = await getActiveWayPage(page);
    console.log(`Way lot selection status: ${selectionResult.status}`);
    console.log(`Way page after lot selection: ${page.url()}`);
    if (!["lot_selected", "fallback_lot_selected"].includes(selectionResult.status)) {
      const result = {
        status: selectionResult.status,
        current_step: currentStep,
        candidate,
        resolved_event_time,
        resolved_event_time_source,
        login: loginResult,
        search: searchResult,
        selection: selectionResult,
      };
      const outputPath = await writeLastRunOutput(result);
      console.log(`Pass skipped: ${selectionResult.status}`);
      console.log(`Wrote ${outputPath}`);
      return;
    }

    currentStep = "review_checkout";
    console.log("Reached checkout page. Reviewing final price...");
    const reviewResult = await reviewCheckout(page);
    console.log(`Way checkout review status: ${reviewResult.status}`);
    console.log(`Way checkout review URL: ${reviewResult.current_url || page.url()}`);

    currentStep = "confirm_checkout";
    let shouldBuy = autoConfirm;
    if (autoConfirm) {
      console.log("Auto-confirm is enabled. Proceeding to final Checkout automatically...");
    } else {
      console.log("Waiting for terminal confirmation before pressing Checkout...");
      shouldBuy = await askForCheckoutConfirmation({
        candidate,
        reviewResult,
        searchResult,
      });
    }

    if (!shouldBuy) {
      const result = {
        status: "cancelled_by_operator",
        current_step: currentStep,
        candidate,
        resolved_event_time,
        resolved_event_time_source,
        login: loginResult,
        search: searchResult,
        selection: selectionResult,
        review: reviewResult,
      };
      const outputPath = await writeLastRunOutput(result);
      console.log("Checkout cancelled before payment.");
      console.log(`Wrote ${outputPath}`);
      return;
    }

    currentStep = "complete_checkout";
    const checkoutResult = await completeCheckout(page);

    currentStep = "capture_reservation";
    const reservationResult = await captureReservationDetails(page, candidate, resolved_event_time);
    if (reservationResult.status !== "reservation_captured") {
      const result = {
        status: "checkout_completed_but_reservation_not_captured",
        current_step: currentStep,
        candidate,
        resolved_event_time,
        resolved_event_time_source,
        login: loginResult,
        search: searchResult,
        selection: selectionResult,
        review: reviewResult,
        checkout: checkoutResult,
        reservation: reservationResult,
      };
      const outputPath = await writeLastRunOutput(result);
      console.log("Checkout submitted, but reservation capture did not validate.");
      console.log(`Wrote ${outputPath}`);
      return;
    }

    let smartsuiteUpdate = null;
    if (updateSmartsuite) {
      currentStep = "update_smartsuite";
      smartsuiteUpdate = await updateSmartsuiteReservation(candidate.record_id, {
        reservationId: reservationResult.reservation_id,
        reservationUrl: reservationResult.reservation_url,
        actualBuyCost: reviewResult?.priceAmount,
      });
    }

    const result = {
      status: "purchase_completed",
      current_step: currentStep,
      candidate,
      resolved_event_time,
      resolved_event_time_source,
      login: loginResult,
      search: searchResult,
      selection: selectionResult,
      review: reviewResult,
      checkout: checkoutResult,
      reservation: reservationResult,
      smartsuite_update: smartsuiteUpdate,
    };
    const outputPath = await writeLastRunOutput(result);

    console.log(`Purchase completed for ${candidate.record_id}`);
    console.log(`Reservation ID: ${reservationResult.reservation_id}`);
    console.log(`Reservation URL: ${reservationResult.reservation_url}`);
    console.log(`Wrote ${outputPath}`);
  } catch (error) {
    if (page) {
      const buyingPaths = getBuyingBotOperativePaths();
      await page
        .screenshot({
          path: buyingPaths.screenshots.buyPassFailure,
          fullPage: true,
        })
        .catch(() => {});
    }
    throw new Error(`buyPass failed during step ${currentStep}: ${error.message}`);
  } finally {
    const keepBrowserOpen = parseBoolean(process.env.WAY_KEEP_BROWSER_OPEN, false);
    if (keepBrowserOpen) {
      console.log("Browser left open for review. Close it manually when finished.");
    } else if (context) {
      await context.close().catch(() => {});
    } else if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = { main };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
