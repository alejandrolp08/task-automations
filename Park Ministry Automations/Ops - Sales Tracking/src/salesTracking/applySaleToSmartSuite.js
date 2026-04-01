const { INVENTORY_SMARTSUITE } = require("../../../Shared/src/shared/smartsuite/config");

const SMARTSUITE_API_BASE_URL = "https://app.smartsuite.com/api/v1";

function getSmartsuiteHeaders() {
  const apiToken = process.env.SMARTSUITE_API_TOKEN;
  const accountId = process.env.SMARTSUITE_ACCOUNT_ID;

  if (!apiToken || !accountId) {
    throw new Error(
      "Missing SmartSuite credentials. Set SMARTSUITE_API_TOKEN and SMARTSUITE_ACCOUNT_ID in .env.",
    );
  }

  return {
    Authorization: `Token ${apiToken}`,
    "Account-Id": accountId,
    "Content-Type": "application/json",
  };
}

function buildSaleUpdateItems(selectionResult) {
  const sale = selectionResult.sale;
  const qty = Math.max(1, Number(sale.qty) || 1);
  const unitPayout = Number((Number(sale.sale_value || 0) / qty).toFixed(2));

  return selectionResult.selected_candidates.map((candidate) => ({
    id: candidate.record_id,
    [INVENTORY_SMARTSUITE.fields.totalPayout]: unitPayout,
    [INVENTORY_SMARTSUITE.fields.profit]: Number((unitPayout - Number(candidate.buy_cost || 0)).toFixed(2)),
    [INVENTORY_SMARTSUITE.fields.externalOrderNumber]: sale.order_id,
    [INVENTORY_SMARTSUITE.fields.clientFullName]: sale.buyer_name || "",
    [INVENTORY_SMARTSUITE.fields.clientEmail]: sale.buyer_email || "",
    [INVENTORY_SMARTSUITE.fields.sold]: { value: "YES" },
  }));
}

async function applySaleToSmartSuite(selectionResult) {
  const tableId =
    process.env.SMARTSUITE_INVENTORY_TABLE_ID || INVENTORY_SMARTSUITE.applicationId;
  const response = await fetch(`${SMARTSUITE_API_BASE_URL}/applications/${tableId}/records/bulk/`, {
    method: "PATCH",
    headers: getSmartsuiteHeaders(),
    body: JSON.stringify({ items: buildSaleUpdateItems(selectionResult) }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SmartSuite bulk update failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

module.exports = {
  applySaleToSmartSuite,
  buildSaleUpdateItems,
};
