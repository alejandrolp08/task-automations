const { SMARTSUITE, BUYING_SMARTSUITE, INVENTORY_SMARTSUITE } = require('./config');

const SMARTSUITE_API_BASE_URL = 'https://app.smartsuite.com/api/v1';

function getSmartsuiteHeaders() {
  const apiToken = process.env.SMARTSUITE_API_TOKEN;
  const accountId = process.env.SMARTSUITE_ACCOUNT_ID;

  if (!apiToken || !accountId) {
    throw new Error(
      'Missing SmartSuite credentials. Set SMARTSUITE_API_TOKEN and SMARTSUITE_ACCOUNT_ID in .env.',
    );
  }

  return {
    Authorization: `Token ${apiToken}`,
    'Account-Id': accountId,
    'Content-Type': 'application/json',
  };
}

async function listSmartsuiteRecords(
  tableId,
  { hydrated = true, limit = 100, filter = {}, sort = [] } = {},
) {
  const headers = getSmartsuiteHeaders();
  const items = [];
  let offset = 0;
  let total = null;

  while (total === null || offset < total) {
    const url = new URL(`${SMARTSUITE_API_BASE_URL}/applications/${tableId}/records/list/`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        hydrated,
        sort,
        filter,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SmartSuite API request failed (${response.status}): ${errorText}`);
    }

    const payload = await response.json();
    const pageItems = Array.isArray(payload.items) ? payload.items : [];

    items.push(...pageItems);
    total = Number(payload.total ?? pageItems.length);
    offset += pageItems.length;

    if (pageItems.length === 0) {
      break;
    }
  }

  return items;
}

module.exports = {
  SMARTSUITE_API_BASE_URL,
  getSmartsuiteHeaders,
  listSmartsuiteRecords,
  BUYING_SMARTSUITE,
  INVENTORY_SMARTSUITE,
  SMARTSUITE,
};
