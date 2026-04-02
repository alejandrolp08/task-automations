const fs = require("fs/promises");
const path = require("path");

const { loadEnv } = require("../../../Workspace/loadEnv");
const { getFulfillmentIntegrationOperativePaths } = require("../../../Workspace/operativePaths");
const { normalizeFulfillmentRecord } = require("./normalizeFulfillmentRecord");
const {
  resolveFulfillmentInputFromSmartsuite,
} = require("./smartsuiteFulfillmentSource");
const {
  buildStubhubHeaders,
  buildStubhubInvoiceAssetsUrl,
  buildStubhubInvoiceByMarketplaceSaleUrl,
  buildStubhubInvoiceUrl,
  buildStubhubSaleUpdateRequest,
} = require("./stubhubFulfillmentApi");
const {
  markFulfillmentRecordFulfilled,
} = require("./updateSmartsuiteFulfillmentStatus");

loadEnv();

const PATHS = getFulfillmentIntegrationOperativePaths();

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function resolveInputSources(record) {
  const shouldUseSmartsuite =
    record.useSmartsuiteSource || Boolean(record.smartsuiteRecordId || record.externalOrderNumber);

  if (!shouldUseSmartsuite) {
    return record;
  }

  const downloadsDir = path.join(PATHS.outputs, "downloads");
  await ensureDirectory(downloadsDir);
  const resolved = await resolveFulfillmentInputFromSmartsuite(record, { downloadsDir });
  return normalizeFulfillmentRecord(resolved);
}

function maskSecret(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  if (text.length <= 8) {
    return `${text.slice(0, 2)}***`;
  }

  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function sanitizeStubhubValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStubhubValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};

  for (const [key, rawChild] of Object.entries(value)) {
    if (key === "content" && typeof rawChild === "string") {
      sanitized[key] = `[redacted base64 content, ${rawChild.length} chars]`;
      continue;
    }

    if (key === "eTicket" && rawChild && typeof rawChild === "object") {
      sanitized[key] = {
        name: rawChild.name || "",
        contentType: rawChild.contentType || "",
        content: typeof rawChild.content === "string"
          ? `[redacted base64 content, ${rawChild.content.length} chars]`
          : "",
      };
      continue;
    }

    sanitized[key] = sanitizeStubhubValue(rawChild);
  }

  return sanitized;
}

async function writeLatestResult(result) {
  await ensureDirectory(PATHS.outputs);
  await fs.writeFile(PATHS.latestJson, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function buildRunContext() {
  const token = String(process.env.STUBHUB_POS_API_TOKEN || "").trim();
  const accountId = String(process.env.STUBHUB_POS_ACCOUNT_ID || "").trim();
  const dryRun = process.env.FULFILLMENT_INTEGRATION_APPLY === "1" ? false : true;

  return {
    token,
    accountId,
    dryRun,
  };
}

async function stubhubRequest(url, options = {}) {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  let body = null;

  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
  }

  if (!response.ok) {
    const detail =
      body && typeof body === "object"
        ? body.message || JSON.stringify(body)
        : bodyText || response.statusText;
    const error = new Error(`StubHub POS API ${response.status}: ${detail}`);
    error.status = response.status;
    error.url = url;
    error.response_body = body;
    error.response_text = bodyText;
    error.retryable = response.status >= 500;
    throw error;
  }

  return {
    status: response.status,
    body,
  };
}

function isRetryableStubhubError(error) {
  return Boolean(error && Number(error.status) >= 500);
}

async function waitBeforeRetry(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function stubhubRequestWithRetry(url, options = {}, retryOptions = {}) {
  const maxAttempts = Math.max(1, Number(retryOptions.maxAttempts || 3));
  const baseDelayMs = Math.max(0, Number(retryOptions.baseDelayMs || 1500));

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await stubhubRequest(url, options);
    } catch (error) {
      lastError = error;

      if (!isRetryableStubhubError(error) || attempt >= maxAttempts) {
        error.attempts = attempt;
        throw error;
      }

      await waitBeforeRetry(baseDelayMs * attempt);
    }
  }

  throw lastError;
}

async function resolveStubhubInvoice(record, context) {
  const headers = buildStubhubHeaders({
    token: context.token,
    accountId: context.accountId,
    contentType: "application/json",
  });

  if (record.invoiceId) {
    const response = await stubhubRequest(buildStubhubInvoiceUrl(record.invoiceId), {
      method: "GET",
      headers,
    });

    return {
      lookup: "invoiceId",
      invoice: response.body,
      status: response.status,
    };
  }

  if (record.marketplaceSaleId) {
    const response = await stubhubRequest(
      buildStubhubInvoiceByMarketplaceSaleUrl(record.marketplaceSaleId, record.marketplace),
      {
        method: "GET",
        headers,
      },
    );

    return {
      lookup: "marketplaceSaleId",
      invoice: response.body,
      status: response.status,
    };
  }

  throw new Error("StubHub fulfillment requires `invoiceId` or `marketplaceSaleId`.");
}

async function runStubhubFulfillment(record, context) {
  const canCallApi = Boolean(context.token && context.accountId);
  const updatePayload = await buildStubhubSaleUpdateRequest(record);

  if (!canCallApi && context.dryRun) {
    return {
      ok: true,
      provider: "stubhub",
      dry_run: true,
      status: "dry_run_local_only",
      next_step:
        "Set STUBHUB_POS_API_TOKEN and STUBHUB_POS_ACCOUNT_ID to validate against StubHub, or set FULFILLMENT_INTEGRATION_APPLY=1 to run live once credentials are configured.",
      lookup: record.invoiceId ? "invoiceId" : record.marketplaceSaleId ? "marketplaceSaleId" : "none",
      invoice_id: record.invoiceId || "",
      marketplace_sale_id: record.marketplaceSaleId || "",
      marketplace: record.marketplace,
      request_preview: {
        internalNotes: updatePayload.internalNotes,
        paymentReferenceNumber: updatePayload.paymentReferenceNumber,
        eTicketsCount: Array.isArray(updatePayload.eTickets) ? updatePayload.eTickets.length : 0,
        transferProofIncluded: Boolean(updatePayload.transferProofUploadRequest),
        transferProofUrlsCount: Array.isArray(updatePayload.transferProofUrls)
          ? updatePayload.transferProofUrls.length
          : 0,
        autoFulfill: updatePayload.autoFulfill,
      },
    };
  }

  if (!context.token) {
    throw new Error("Missing STUBHUB_POS_API_TOKEN.");
  }

  if (!context.accountId) {
    throw new Error("Missing STUBHUB_POS_ACCOUNT_ID.");
  }

  const invoiceLookup = await resolveStubhubInvoice(record, context);
  const invoiceId = String(invoiceLookup.invoice?.id || record.invoiceId || "").trim();

  const baseResult = {
    ok: true,
    provider: "stubhub",
    dry_run: context.dryRun,
    lookup: invoiceLookup.lookup,
    invoice_id: invoiceId,
    marketplace_sale_id:
      invoiceLookup.invoice?.marketplaceSaleId || record.marketplaceSaleId || "",
    marketplace: invoiceLookup.invoice?.marketplace || record.marketplace,
    invoice_summary: {
      event_name: invoiceLookup.invoice?.event?.name || record.eventName || "",
      event_date: invoiceLookup.invoice?.event?.eventDate || record.eventDate || "",
      quantity_sold: invoiceLookup.invoice?.quantitySold ?? record.quantity ?? null,
      stock_type: invoiceLookup.invoice?.stockType || "",
      fulfillment_date: invoiceLookup.invoice?.fulfillmentDate || null,
    },
    request_preview: {
      internalNotes: updatePayload.internalNotes,
      paymentReferenceNumber: updatePayload.paymentReferenceNumber,
      eTicketsCount: Array.isArray(updatePayload.eTickets) ? updatePayload.eTickets.length : 0,
      transferProofIncluded: Boolean(updatePayload.transferProofUploadRequest),
      transferProofUrlsCount: Array.isArray(updatePayload.transferProofUrls)
        ? updatePayload.transferProofUrls.length
        : 0,
      autoFulfill: updatePayload.autoFulfill,
    },
    endpoints: {
      invoice: buildStubhubInvoiceUrl(invoiceId),
      assets: buildStubhubInvoiceAssetsUrl(invoiceId),
    },
  };

  if (context.dryRun) {
    return {
      ...baseResult,
      status: "dry_run",
      next_step: "Set FULFILLMENT_INTEGRATION_APPLY=1 to PATCH the invoice.",
    };
  }

  const headers = buildStubhubHeaders({
    token: context.token,
    accountId: context.accountId,
    contentType: "application/json",
  });

  const patchResponse = await stubhubRequestWithRetry(buildStubhubInvoiceUrl(invoiceId), {
    method: "PATCH",
    headers,
    body: JSON.stringify(updatePayload),
  }, {
    maxAttempts: Number(process.env.FULFILLMENT_STUBHUB_PATCH_MAX_ATTEMPTS || 3),
    baseDelayMs: Number(process.env.FULFILLMENT_STUBHUB_PATCH_RETRY_DELAY_MS || 1500),
  });

  let assetsResponse = null;

  try {
    assetsResponse = await stubhubRequest(buildStubhubInvoiceAssetsUrl(invoiceId), {
      method: "GET",
      headers,
    });
  } catch (error) {
    assetsResponse = {
      error: error.message,
    };
  }

  return {
    ...baseResult,
    status: "applied",
    patch_status_code: patchResponse.status,
    patch_response: patchResponse.body,
    assets_response: assetsResponse.body || assetsResponse,
  };
}

async function runFulfillmentIntegration(input) {
  const normalizedInput = normalizeFulfillmentRecord(input);
  const record = await resolveInputSources(normalizedInput);
  const context = buildRunContext();

  if (!record.provider) {
    throw new Error("Missing fulfillment provider.");
  }

  if (record.provider === "stubhub") {
    const result = await runStubhubFulfillment(record, context);
    let smartsuiteUpdate = null;

    if (
      !context.dryRun &&
      result?.ok &&
      result?.status === "applied" &&
      String(record?.smartsuite?.recordId || "").trim()
    ) {
      smartsuiteUpdate = await markFulfillmentRecordFulfilled(record.smartsuite.recordId);
    }

    await writeLatestResult({
      run_type: "fulfillment_integration_v1",
      recorded_at: new Date().toISOString(),
      auth: {
        token_present: Boolean(context.token),
        token_hint: maskSecret(context.token),
        account_id: maskSecret(context.accountId),
      },
      input: {
        provider: record.provider,
        invoiceId: record.invoiceId,
        marketplaceSaleId: record.marketplaceSaleId,
        marketplace: record.marketplace,
        smartsuiteRecordId: record.smartsuiteRecordId,
        externalOrderNumber: record.externalOrderNumber,
        pdfPath: record.pdfPath ? path.resolve(record.pdfPath) : "",
        pdfUrl: record.pdfUrl || "",
        transferProofPath: record.transferProofPath
          ? path.resolve(record.transferProofPath)
          : "",
        ticketIds: record.ticketIds,
      },
      result: sanitizeStubhubValue(result),
      smartsuite_update: smartsuiteUpdate,
    });
    return {
      ...result,
      smartsuite_update: smartsuiteUpdate,
    };
  }

  if (record.provider === "reachpro") {
    const result = {
      ok: true,
      provider: "reachpro",
      status: "waiting_for_api_spec",
      nextStep: "Add ReachPro endpoint details, auth requirements, and request payload format.",
      record,
    };
    await writeLatestResult(result);
    return result;
  }

  throw new Error(`Unsupported fulfillment provider: ${record.provider}`);
}

async function readCliInput() {
  const filePath = process.argv[2] || process.env.FULFILLMENT_INPUT_FILE;

  if (!filePath) {
    throw new Error(
      "Missing fulfillment input. Pass a JSON file path as the first argument or set FULFILLMENT_INPUT_FILE.",
    );
  }

  const raw = await fs.readFile(path.resolve(filePath), "utf8");
  return JSON.parse(raw);
}

if (require.main === module) {
  readCliInput()
    .then((input) => runFulfillmentIntegration(input))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("Fulfillment integration run failed.");
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runFulfillmentIntegration,
};
