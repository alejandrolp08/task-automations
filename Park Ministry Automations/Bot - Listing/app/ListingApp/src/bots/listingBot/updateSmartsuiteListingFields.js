const {
  SMARTSUITE,
  SMARTSUITE_API_BASE_URL,
  getSmartsuiteHeaders,
} = require("../../shared/smartsuite/api");

async function fetchBuyingTableSchema() {
  const buyingTableId = process.env.SMARTSUITE_BUYING_TABLE_ID || SMARTSUITE.buyingTableId;
  const headers = getSmartsuiteHeaders();
  const response = await fetch(`${SMARTSUITE_API_BASE_URL}/applications/${buyingTableId}/`, {
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SmartSuite schema request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

function findMultiSelectChoice(field, label) {
  const normalizedLabel = String(label || "").trim().toLowerCase();
  const choices = field?.params?.choices || [];
  return choices.find((choice) => String(choice.label || "").trim().toLowerCase() === normalizedLabel) || null;
}

async function updateListingRecord(recordId, payload) {
  const buyingTableId = process.env.SMARTSUITE_BUYING_TABLE_ID || SMARTSUITE.buyingTableId;
  const headers = getSmartsuiteHeaders();
  const response = await fetch(`${SMARTSUITE_API_BASE_URL}/applications/${buyingTableId}/records/${recordId}/`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SmartSuite listing update failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function updateSmartsuiteListingFields(records, { platformLabel = "ReachPro" } = {}) {
  const schema = await fetchBuyingTableSchema();
  const platformField = (schema.structure || []).find((field) => field.slug === SMARTSUITE.fields.platformListedOn) || null;
  const platformChoice = findMultiSelectChoice(platformField, platformLabel);
  const updates = [];

  for (const record of records) {
    const payload = {};
    const currentEventId = String(record.event_id || "").trim();
    const resolvedEventId = String(record.resolved_event_id || "").trim();

    if (!currentEventId && resolvedEventId) {
      payload[SMARTSUITE.fields.eventId] = resolvedEventId;
    }

    if (
      platformChoice &&
      !record.platform_listed_on_labels.some(
        (label) => String(label).trim().toLowerCase() === String(platformLabel).trim().toLowerCase(),
      )
    ) {
      payload[SMARTSUITE.fields.platformListedOn] = [platformChoice.value];
    }

    if (Object.keys(payload).length === 0) {
      updates.push({
        record_id: record.record_id,
        status: "no_change_needed",
      });
      continue;
    }

    const updated = await updateListingRecord(record.record_id, payload);
    updates.push({
      record_id: record.record_id,
      status: "updated",
      payload,
      smartsuite_record: updated,
    });
  }

  return {
    platform_field_available: Boolean(platformField),
    platform_choice_available: Boolean(platformChoice),
    platform_choice_label: platformChoice?.label || null,
    platform_choice_value: platformChoice?.value || null,
    updates,
  };
}

module.exports = {
  updateSmartsuiteListingFields,
  fetchBuyingTableSchema,
};
