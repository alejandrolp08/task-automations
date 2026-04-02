const {
  SMARTSUITE_API_BASE_URL,
  getSmartsuiteHeaders,
} = require("../../../Shared/src/shared/smartsuite/api");
const { INVENTORY_SMARTSUITE } = require("../../../Shared/src/shared/smartsuite/config");
const {
  appendAutomationNote,
} = require("./fulfillmentAutomationNotes");

function getConfiguredFieldId(envKey, fallback = "") {
  return String(process.env[envKey] || fallback || "").trim();
}

function getFulfillmentUpdateConfig() {
  return {
    tableId:
      process.env.SMARTSUITE_INVENTORY_TABLE_ID || INVENTORY_SMARTSUITE.applicationId,
    fulfilledFieldId: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_FULFILLED_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.fulfilled,
    ),
    commentFieldId: getConfiguredFieldId(
      "SMARTSUITE_FULFILLMENT_COMMENT_FIELD_ID",
      INVENTORY_SMARTSUITE.fields.requestCommentDetail,
    ),
  };
}

async function patchSmartsuiteRecord(recordId, payload, config = getFulfillmentUpdateConfig()) {
  if (!recordId) {
    throw new Error("patchSmartsuiteRecord requires a recordId.");
  }

  const headers = getSmartsuiteHeaders();
  const response = await fetch(
    `${SMARTSUITE_API_BASE_URL}/applications/${config.tableId}/records/${recordId}/`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SmartSuite fulfillment update failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function markFulfillmentRecordFulfilled(recordId, config = getFulfillmentUpdateConfig()) {
  const payload = {
    [config.fulfilledFieldId]: "FULFILLED",
  };

  const record = await patchSmartsuiteRecord(recordId, payload, config);
  return {
    status: "fulfilled_updated",
    record_id: recordId,
    payload,
    smartsuite_record: record,
  };
}

async function appendFulfillmentAutomationComment(
  recordId,
  existingComment,
  note,
  config = getFulfillmentUpdateConfig(),
) {
  const nextComment = appendAutomationNote(existingComment, note);

  if (String(nextComment || "").trim() === String(existingComment || "").trim()) {
    return {
      status: "no_comment_change_needed",
      record_id: recordId,
      comment: nextComment,
    };
  }

  const payload = {
    [config.commentFieldId]: nextComment,
  };

  const record = await patchSmartsuiteRecord(recordId, payload, config);
  return {
    status: "comment_updated",
    record_id: recordId,
    comment: nextComment,
    payload,
    smartsuite_record: record,
  };
}

module.exports = {
  appendFulfillmentAutomationComment,
  getFulfillmentUpdateConfig,
  markFulfillmentRecordFulfilled,
  patchSmartsuiteRecord,
};
