const {
  createWayBrowserSession,
  ensureLoggedIn,
  searchLots,
  selectLot,
  reviewCheckout,
  completeCheckout,
  captureReservationDetails,
  getVisibleReservationIdsSnapshot,
  buildCheckoutWindow,
} = require("./browserFlow");
const { getAirportParkingMetadata } = require("./airportParking");
const { updateSmartsuiteReservation } = require("../../updateSmartsuiteReservation");
const { buildCheckoutWindowPlan } = require("../../../../../Shared/src/shared/stubhub/windowPlan");
const { getBuyingBotOperativePaths } = require("../../../../../Workspace/operativePaths");

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeAirportMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectionMatchesAirportMetadata(selectionResult, airportMetadata) {
  if (!airportMetadata) {
    return true;
  }

  const combinedText = normalizeAirportMatchText([
    selectionResult?.matched_title || "",
    selectionResult?.matched_address || "",
    selectionResult?.matched_text || "",
  ].join(" "));

  if (!combinedText) {
    return false;
  }

  const aliases = Array.isArray(airportMetadata.normalized_aliases)
    ? airportMetadata.normalized_aliases
    : [];

  return aliases.some((alias) => alias && combinedText.includes(alias));
}

function evaluateCheckoutPrice(candidate, reviewResult) {
  const buyCost = Number(candidate.buy_cost);
  const sellPrice = Number(candidate.sell_price);
  const priceAmount = reviewResult?.priceAmount;
  const maxAllowed = isFiniteNumber(buyCost) ? buyCost + 3 : null;
  const priceTooHigh = isFiniteNumber(priceAmount) && isFiniteNumber(maxAllowed) && priceAmount > maxAllowed;
  const exceedsSellPrice = isFiniteNumber(priceAmount) && isFiniteNumber(sellPrice) && priceAmount >= sellPrice;

  return {
    priceAmount,
    maxAllowed,
    priceTooHigh,
    exceedsSellPrice,
    accepted: !priceTooHigh && !exceedsSellPrice,
  };
}

function cloneCheckoutStrategy(strategy) {
  if (!strategy || typeof strategy !== "object") {
    return null;
  }

  return {
    ...strategy,
    checkoutWindow:
      strategy.checkoutWindow && typeof strategy.checkoutWindow === "object"
        ? { ...strategy.checkoutWindow }
        : strategy.checkoutWindow || null,
  };
}

async function executeWayCheckout({
  candidate,
  resolvedEventTime,
  resolvedEventStatus = "scheduled",
  checkoutStrategies = [],
  dryRun = true,
  keepBrowserOpen = dryRun,
  updateSmartsuite = !dryRun,
  excludeReservationIds = [],
} = {}) {
  if (!candidate?.record_id) {
    throw new Error("executeWayCheckout requires a candidate record.");
  }
  if (!resolvedEventTime && !["tbd", "tbh"].includes(String(resolvedEventStatus || "").trim().toLowerCase())) {
    throw new Error("executeWayCheckout requires a resolved event time.");
  }

  const { browser, context, page } = await createWayBrowserSession();
  let currentStep = "starting";
  let preCheckoutReservationIds = [];

  async function finalizeResult(payload) {
    const postAttemptReservationIds = await getVisibleReservationIdsSnapshot(page).catch(
      () => preCheckoutReservationIds || [],
    );

    return {
      ...payload,
      pre_checkout_reservation_ids: preCheckoutReservationIds || [],
      post_attempt_reservation_ids: postAttemptReservationIds || [],
    };
  }

  try {
    currentStep = "login";
    const loginResult = await ensureLoggedIn(page);
    preCheckoutReservationIds = await getVisibleReservationIdsSnapshot(page);
    const airportMetadata = getAirportParkingMetadata(candidate);

    let searchResult = null;
    let selectionResult = null;
    let reviewResult = null;
    let priceEvaluation = null;
    let selectedCheckoutStrategy = null;
    let lastRecoverableNotFoundResult = null;
    const plannedStrategies = Array.isArray(checkoutStrategies) && checkoutStrategies.length > 0
      ? checkoutStrategies
      : buildCheckoutWindowPlan(candidate, {
          resolved_event_time: resolvedEventTime,
          event_status: resolvedEventStatus,
        }).checkout_strategies;

    for (const strategy of plannedStrategies) {
      currentStep = "search";
      console.log(`Way checkout strategy: ${strategy.label}`);
      let airportFallbackUsed = false;
      const shouldUseAirportSearchFirst = Boolean(airportMetadata);
      searchResult = await searchLots(page, candidate, resolvedEventTime, {
        checkoutWindow: strategy.checkoutWindow,
        locationQueryOverride: shouldUseAirportSearchFirst ? airportMetadata.airport_query : undefined,
        searchMode: shouldUseAirportSearchFirst ? "airport" : undefined,
        airportMetadata: shouldUseAirportSearchFirst ? airportMetadata : null,
      });
      airportFallbackUsed = shouldUseAirportSearchFirst;

      currentStep = "select_lot";
      const trySelectLot = async (lotAliases = []) => {
        try {
          return await selectLot(page, candidate, { lotAliases });
        } catch (error) {
          if (String(error?.message || "").includes("Way results did not contain a strong address match for the target parking location.")) {
            return {
              status: "parking_lot_not_found",
              error_message: "Parking lot not found.",
            };
          }
          throw error;
        }
      };

      selectionResult = await trySelectLot(airportFallbackUsed ? (airportMetadata?.lot_aliases || []) : []);
      const shouldTryAirportFallback =
        airportMetadata &&
        !airportFallbackUsed &&
        (
          ["parking_lot_not_found", "target_lot_sold_out", "best_match_unavailable"].includes(selectionResult?.status) ||
          (
            ["lot_selected", "fallback_lot_selected"].includes(selectionResult?.status) &&
            !selectionMatchesAirportMetadata(selectionResult, airportMetadata)
          )
        );

      if (shouldTryAirportFallback) {
        searchResult = await searchLots(page, candidate, resolvedEventTime, {
          checkoutWindow: strategy.checkoutWindow,
          locationQueryOverride: airportMetadata.airport_query,
          searchMode: "airport",
          airportMetadata,
        });
        selectionResult = await trySelectLot(airportMetadata.lot_aliases || []);
        airportFallbackUsed = true;
      }

      if (airportFallbackUsed) {
        searchResult = {
          ...searchResult,
          airport_fallback_used: true,
          airport_metadata: airportMetadata,
        };
      }

      if (!["lot_selected", "fallback_lot_selected"].includes(selectionResult.status)) {
        if (selectionResult?.status === "parking_lot_not_found") {
          lastRecoverableNotFoundResult = {
            status: selectionResult.status,
            current_step: currentStep,
            login: loginResult,
            search: searchResult,
            selection: selectionResult,
            airport_fallback_used: airportFallbackUsed,
            airport_metadata: airportFallbackUsed ? airportMetadata : null,
            error_message: selectionResult?.error_message || null,
          };
          continue;
        }
        return finalizeResult({
          status: selectionResult.status,
          current_step: currentStep,
          login: loginResult,
          search: searchResult,
          selection: selectionResult,
          airport_fallback_used: airportFallbackUsed,
          airport_metadata: airportFallbackUsed ? airportMetadata : null,
          error_message: selectionResult?.error_message || null,
        });
      }

      currentStep = "review_checkout";
      reviewResult = await reviewCheckout(page, candidate, selectionResult, searchResult?.checkoutWindow || null);
      if (reviewResult?.status !== "checkout_reviewed") {
        return finalizeResult({
          status: reviewResult?.status || "checkout_review_failed",
          current_step: currentStep,
          login: loginResult,
          search: searchResult,
          selection: selectionResult,
          review: reviewResult,
          airport_fallback_used: airportFallbackUsed,
          airport_metadata: airportFallbackUsed ? airportMetadata : null,
          error_message: reviewResult?.error_message || null,
        });
      }
      priceEvaluation = evaluateCheckoutPrice(candidate, reviewResult);

      console.log(
        `Way checkout price check: ${JSON.stringify({
          strategy: strategy.label,
          priceAmount: priceEvaluation.priceAmount,
          maxAllowed: priceEvaluation.maxAllowed,
          priceTooHigh: priceEvaluation.priceTooHigh,
          exceedsSellPrice: priceEvaluation.exceedsSellPrice,
        })}`,
      );

      if (!isFiniteNumber(priceEvaluation.priceAmount)) {
        return finalizeResult({
          status: "checkout_price_unavailable",
          current_step: currentStep,
          login: loginResult,
          search: searchResult,
          selection: selectionResult,
          review: reviewResult,
          price_evaluation: priceEvaluation,
          airport_fallback_used: airportFallbackUsed,
          airport_metadata: airportFallbackUsed ? airportMetadata : null,
          error_message: "Checkout price could not be confirmed.",
        });
      }

      if (priceEvaluation.accepted) {
        selectedCheckoutStrategy = cloneCheckoutStrategy(strategy);
        searchResult = {
          ...searchResult,
          airport_fallback_used: airportFallbackUsed,
          airport_metadata: airportFallbackUsed ? airportMetadata : null,
        };
        break;
      }
    }

    if (lastRecoverableNotFoundResult) {
      return finalizeResult(lastRecoverableNotFoundResult);
    }

    if (!priceEvaluation?.accepted) {
      return finalizeResult({
        status: "parking_lot_overpriced",
        current_step: currentStep,
        login: loginResult,
        search: searchResult,
        selection: selectionResult,
        review: reviewResult,
        price_evaluation: priceEvaluation,
        airport_fallback_used: Boolean(searchResult?.airport_fallback_used),
        airport_metadata: searchResult?.airport_metadata || null,
        error_message: "Parking lot overpriced.",
      });
    }

    if (dryRun) {
      return finalizeResult({
        status: "dry_run_ready_for_checkout",
        current_step: currentStep,
        login: loginResult,
        search: searchResult,
        selection: selectionResult,
        review: reviewResult,
        price_evaluation: priceEvaluation,
        selected_checkout_strategy: selectedCheckoutStrategy,
        airport_fallback_used: Boolean(searchResult?.airport_fallback_used),
        airport_metadata: searchResult?.airport_metadata || null,
      });
    }

    currentStep = "complete_checkout";
    const checkoutResult = await completeCheckout(page);
    if (checkoutResult?.status === "license_plate_required") {
      return finalizeResult({
        status: "license_plate_required",
        current_step: currentStep,
        login: loginResult,
        search: searchResult,
        selection: selectionResult,
        review: reviewResult,
        price_evaluation: priceEvaluation,
        checkout: checkoutResult,
        airport_fallback_used: Boolean(searchResult?.airport_fallback_used),
        airport_metadata: searchResult?.airport_metadata || null,
        error_message: checkoutResult.license_plate_requirement?.message || "License plate is required for this parking lot.",
      });
    }
    if (checkoutResult?.status === "checkout_not_confirmed") {
      currentStep = "capture_reservation";
      let reservationResult = null;
      for (const delayMs of [8000, 12000]) {
        await page.waitForTimeout(delayMs).catch(() => {});
        reservationResult = await captureReservationDetails(page, candidate, resolvedEventTime, {
          excludeReservationIds,
          preCheckoutReservationIds,
          checkoutWindow: searchResult?.checkoutWindow || null,
          airportMetadata: searchResult?.airport_metadata || null,
          airportFallbackUsed: Boolean(searchResult?.airport_fallback_used),
          selectionResult,
        });
        if (reservationResult?.status === "reservation_captured") {
          break;
        }
      }

      if (reservationResult.status === "reservation_captured") {
        let smartsuiteUpdate = null;
        if (updateSmartsuite) {
          currentStep = "update_smartsuite";
          smartsuiteUpdate = await updateSmartsuiteReservation(candidate.record_id, {
            reservationId: reservationResult.reservation_id,
            reservationUrl: reservationResult.reservation_url,
            actualBuyCost: priceEvaluation?.priceAmount,
          });
        }

        return finalizeResult({
          status: "purchase_completed",
          current_step: currentStep,
          login: loginResult,
          search: searchResult,
          selection: selectionResult,
          review: reviewResult,
          price_evaluation: priceEvaluation,
          selected_checkout_strategy: selectedCheckoutStrategy,
          checkout: checkoutResult,
          reservation: reservationResult,
          airport_fallback_used: Boolean(searchResult?.airport_fallback_used),
          airport_metadata: searchResult?.airport_metadata || null,
          smartsuite_update: smartsuiteUpdate,
        });
      }

      const postCheckoutReservationIds = await getVisibleReservationIdsSnapshot(page).catch(
        () => preCheckoutReservationIds || [],
      );
      const unexpectedReservationIds = Array.isArray(postCheckoutReservationIds)
        ? postCheckoutReservationIds.filter((reservationId) => !preCheckoutReservationIds.includes(reservationId))
        : [];
      const unexpectedReservationDetected = Array.isArray(postCheckoutReservationIds)
        && unexpectedReservationIds.length > 0;

      return finalizeResult({
        status: unexpectedReservationDetected
          ? "unexpected_reservation_detected"
          : "checkout_not_confirmed",
        current_step: currentStep,
        login: loginResult,
        search: searchResult,
        selection: selectionResult,
        review: reviewResult,
        price_evaluation: priceEvaluation,
        selected_checkout_strategy: selectedCheckoutStrategy,
        checkout: checkoutResult,
        reservation: reservationResult,
        airport_fallback_used: Boolean(searchResult?.airport_fallback_used),
        airport_metadata: searchResult?.airport_metadata || null,
        unexpected_reservation_ids: unexpectedReservationIds,
        error_message: unexpectedReservationDetected
          ? "A new reservation appeared in Orders after checkout, but it did not match the intended parking lot."
          : "Checkout click did not reach Way order confirmation.",
      });
    }

    currentStep = "capture_reservation";
    const reservationResult = await captureReservationDetails(page, candidate, resolvedEventTime, {
      excludeReservationIds,
      preCheckoutReservationIds,
      checkoutWindow: searchResult?.checkoutWindow || null,
      airportMetadata: searchResult?.airport_metadata || null,
      airportFallbackUsed: Boolean(searchResult?.airport_fallback_used),
      selectionResult,
    });
    if (reservationResult.status !== "reservation_captured") {
      const postCheckoutReservationIds = await getVisibleReservationIdsSnapshot(page).catch(
        () => preCheckoutReservationIds || [],
      );
      const unexpectedReservationIds = Array.isArray(postCheckoutReservationIds)
        ? postCheckoutReservationIds.filter((reservationId) => !preCheckoutReservationIds.includes(reservationId))
        : [];
      const unexpectedReservationDetected = Array.isArray(postCheckoutReservationIds)
        && unexpectedReservationIds.length > 0;
      return finalizeResult({
        status: unexpectedReservationDetected
          ? "unexpected_reservation_detected"
          : "checkout_completed_but_reservation_not_captured",
        current_step: currentStep,
        login: loginResult,
        search: searchResult,
        selection: selectionResult,
        review: reviewResult,
        price_evaluation: priceEvaluation,
        selected_checkout_strategy: selectedCheckoutStrategy,
        checkout: checkoutResult,
        reservation: reservationResult,
        airport_fallback_used: Boolean(searchResult?.airport_fallback_used),
        airport_metadata: searchResult?.airport_metadata || null,
        unexpected_reservation_ids: unexpectedReservationIds,
        error_message: unexpectedReservationDetected
          ? "A new reservation appeared in Orders but it did not match the intended parking lot."
          : null,
      });
    }

    let smartsuiteUpdate = null;
    if (updateSmartsuite) {
      currentStep = "update_smartsuite";
      smartsuiteUpdate = await updateSmartsuiteReservation(candidate.record_id, {
        reservationId: reservationResult.reservation_id,
        reservationUrl: reservationResult.reservation_url,
        actualBuyCost: priceEvaluation?.priceAmount,
      });
    }

    return finalizeResult({
      status: "purchase_completed",
      current_step: currentStep,
      login: loginResult,
      search: searchResult,
      selection: selectionResult,
      review: reviewResult,
      price_evaluation: priceEvaluation,
      selected_checkout_strategy: selectedCheckoutStrategy,
      checkout: checkoutResult,
      reservation: reservationResult,
      airport_fallback_used: Boolean(searchResult?.airport_fallback_used),
      airport_metadata: searchResult?.airport_metadata || null,
      smartsuite_update: smartsuiteUpdate,
    });
  } catch (error) {
    const buyingPaths = getBuyingBotOperativePaths();
    await page
      .screenshot({
        path: buyingPaths.screenshots.wayLiveRunFailure,
        fullPage: true,
      })
      .catch(() => {});

    error.message = `Way live checkout failed during step ${currentStep}: ${error.message}`;
    throw error;
  } finally {
    if (!keepBrowserOpen && context) {
      await context.close().catch(() => {});
    } else if (!keepBrowserOpen && browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = { executeWayCheckout };
