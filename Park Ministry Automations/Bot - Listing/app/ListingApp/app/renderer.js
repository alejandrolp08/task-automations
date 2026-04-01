const form = document.getElementById('runForm');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const runButton = document.getElementById('runButton');
const statusLine = document.getElementById('statusLine');
const logOutput = document.getElementById('logOutput');
const metrics = document.getElementById('metrics');
const reviewState = document.getElementById('reviewState');
const blockedList = document.getElementById('blockedList');
const openOutputsButton = document.getElementById('openOutputs');
const openCsvButton = document.getElementById('openCsv');
const licenseBadge = document.getElementById('licenseBadge');
const licenseDetail = document.getElementById('licenseDetail');
const runForceButton = document.getElementById('runForceButton');
const marketplaceFeePercentInput = document.getElementById('marketplaceFeePercent');
const saveFeeButton = document.getElementById('saveFeeButton');
const saveFeeStatus = document.getElementById('saveFeeStatus');

let currentLicenseStatus = null;
let removeRunLogListener = null;
let liveLogBuffer = '';

const today = new Date().toISOString().slice(0, 10);
startDateInput.value = today;
endDateInput.value = today;

function setStatus(text, state) {
  statusLine.textContent = text;
  statusLine.className = `status-line ${state}`;
}

function applyLicenseState(licenseStatus) {
  currentLicenseStatus = licenseStatus;
  const active = Boolean(licenseStatus?.active);

  licenseBadge.textContent = active ? 'Active' : 'Renew';
  licenseBadge.className = `license-badge ${active ? 'active' : 'expired'}`;
  licenseDetail.textContent = '';

  runButton.disabled = !active;
  runForceButton.disabled = !active;
  saveFeeButton.disabled = !active;
  startDateInput.disabled = !active;
  endDateInput.disabled = !active;
  marketplaceFeePercentInput.disabled = !active;

  if (!active) {
    setStatus('There is an issue. Bot - Listing cannot be run.', 'error');
    logOutput.textContent = licenseStatus?.message || 'License expired.';
  }
}

function renderMetrics(summary) {
  const items = [
    ['Event groups', summary?.event_groups ?? '-'],
    ['Eligible passes', summary?.eligible_candidates ?? '-'],
    ['Listing ready', summary?.listing_ready ?? '-'],
    ['Blocked by event', summary?.blocked_by_event_resolution ?? '-'],
  ];

  metrics.classList.remove('empty');
  metrics.innerHTML = items
    .map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`)
    .join('');
}

function renderBlocked(blockedRows) {
  blockedList.innerHTML = '';

  if (!blockedRows || blockedRows.length === 0) {
    reviewState.textContent = 'All eligible events were recognized.';
    reviewState.className = 'empty-state success';
    return;
  }

  const groupedRows = blockedRows.every((row) => Object.prototype.hasOwnProperty.call(row, 'line'))
    ? blockedRows.map((row) => {
        const line = String(row.line || '');
        const statusMatch = line.match(/\| status=([^|]+)/i);
        const resolvedMatch = line.match(/\| resolved_event_id=([^|]+)/i);
        const [event = '', venue = '', eventDate = '', parkingLocation = ''] = line.split(' | ');
        return {
          event,
          venue,
          event_date: eventDate,
          parking_location: parkingLocation,
          status: statusMatch?.[1]?.trim() || 'unknown',
          resolved_event_id: resolvedMatch?.[1]?.trim() || 'missing',
          notes: '',
          qty: row.qty || 1,
        };
      })
    : (() => {
        const grouped = new Map();

        for (const row of blockedRows) {
          const notes = Array.isArray(row.resolution_notes) ? row.resolution_notes.join(' ') : '';
          const key = [
            row.event || '',
            row.venue || '',
            row.event_date || '',
            row.event_status || row.resolution_status || 'unknown',
            row.resolved_event_id || 'missing',
            notes,
          ].join('||');

          if (!grouped.has(key)) {
            grouped.set(key, {
              event: row.event,
              venue: row.venue,
              event_date: row.event_date,
              parking_location: row.parking_location || '',
              status: row.event_status || row.resolution_status || 'unknown',
              resolved_event_id: row.resolved_event_id || 'missing',
              notes,
              qty: 0,
            });
          }

          grouped.get(key).qty += 1;
        }

        return Array.from(grouped.values());
      })();

  reviewState.textContent = `${groupedRows.length} grouped item(s) still need review.`;
  reviewState.className = 'empty-state warning';

  const reviewGroups = new Map();

  for (const row of groupedRows) {
    const status = String(row.status || '').toLowerCase();
    let key = 'review';
    let label = 'Review required';
    let badgeClass = 'review';

    if (status === 'missing_on_stubhub') {
      key = 'missing';
      label = 'Missing on StubHub';
      badgeClass = 'missing';
    } else if (status === 'scheduled_time_not_found' || status === 'tbd' || status === 'tbh') {
      key = 'time';
      label = 'Time not found / TBD';
      badgeClass = 'time';
    }

    if (!reviewGroups.has(key)) {
      reviewGroups.set(key, { label, badgeClass, rows: [] });
    }
    reviewGroups.get(key).rows.push(row);
  }

  blockedList.innerHTML = Array.from(reviewGroups.values())
    .map((group) => {
      const totalQty = group.rows.reduce((sum, row) => sum + (row.qty || 0), 0);
      const cards = group.rows
        .map((row) => {
          return `
            <article class="blocked-card">
              <div class="blocked-main">
                <strong>${row.event}</strong>
                <span>${row.venue} · ${row.event_date}</span>
                <span>Qty: ${row.qty}</span>
                <span>Status: ${row.status || 'unknown'}</span>
                <span>Resolved Event ID: ${row.resolved_event_id || 'missing'}</span>
              </div>
              <p>${row.notes || 'Review this event manually in StubHub.'}</p>
            </article>
          `;
        })
        .join('');

      return `
        <section class="review-group">
          <div class="review-group-title">
            <span class="review-group-badge ${group.badgeClass}">${group.label}</span>
            <span>${group.rows.length} event group(s) · ${totalQty} pass(es)</span>
          </div>
          ${cards}
        </section>
      `;
    })
    .join('');
}

function renderRun(result) {
  const stdout = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n');
  logOutput.textContent = stdout || 'Run finished with no console output.';

  if (!result.runJson) {
    renderMetrics(null);
    renderBlocked(null);
    return;
  }

  renderMetrics(result.runJson.summary);
  renderBlocked(
    result.runJson.blocked_by_event_resolution_grouped ||
      result.runJson.blocked_by_event_resolution ||
      [],
  );
}

function attachRunLogListener() {
  if (removeRunLogListener) {
    removeRunLogListener();
  }

  liveLogBuffer = '';
  removeRunLogListener = window.listingApp.onRunLog(({ text }) => {
    logOutput.textContent += text || '';
    logOutput.scrollTop = logOutput.scrollHeight;
    liveLogBuffer += text || '';

    const lines = liveLogBuffer.split(/\r?\n/);
    liveLogBuffer = lines.pop() || '';

    for (const line of lines) {
      const validationMatch = line.match(/StubHub validation\s+(\d+)\/(\d+)/i);
      if (validationMatch) {
        setStatus(`Processing ${validationMatch[1]}/${validationMatch[2]} event groups...`, 'running');
        continue;
      }

      if (/Listing candidates found:/i.test(line)) {
        setStatus('Preparing records...', 'running');
        continue;
      }

      if (/Listing ready:/i.test(line)) {
        setStatus('Generating ReachPro template...', 'running');
        continue;
      }

      if (/Forced Event ID listings:/i.test(line)) {
        setStatus('Generating template with fallback Event IDs...', 'running');
      }
    }
  });
}

async function loadLicenseStatus() {
  const licenseStatus = await window.listingApp.getLicenseStatus();
  applyLicenseState(licenseStatus);
}

async function loadSettings() {
  const settings = await window.listingApp.getSettings();
  marketplaceFeePercentInput.value = settings?.marketplaceFeePercent || '9';
}

async function runListing({ useForceEventIdFallback = false } = {}) {
  if (!currentLicenseStatus?.active) {
    applyLicenseState(currentLicenseStatus || { active: false, message: 'License expired.' });
    return;
  }

  runButton.disabled = true;
  runForceButton.disabled = true;

  const marketplaceFeePercent = String(marketplaceFeePercentInput.value || '').trim() || '9';

  setStatus(
    useForceEventIdFallback
      ? 'Running Bot - Listing with Force Event ID fallback... This can take a few minutes.'
      : 'Running Bot - Listing... This can take a few minutes.',
    'running',
  );
  logOutput.textContent = useForceEventIdFallback
    ? 'Starting run with Force Event ID fallback...\n'
    : 'Starting run...\n';
  attachRunLogListener();

  try {
    const result = await window.listingApp.runListing({
      startDate: startDateInput.value,
      endDate: endDateInput.value,
      useForceEventIdFallback,
      marketplaceFeePercent,
    });

    if (result.licenseStatus) {
      applyLicenseState(result.licenseStatus);
    }

    renderRun(result);
    setStatus(result.ok ? 'Run completed.' : 'Run finished with issues.', result.ok ? 'success' : 'error');
  } catch (error) {
    logOutput.textContent = error.message || String(error);
    setStatus('Run failed.', 'error');
  } finally {
    if (removeRunLogListener) {
      removeRunLogListener();
      removeRunLogListener = null;
    }
    if (currentLicenseStatus?.active) {
      runButton.disabled = false;
      runForceButton.disabled = false;
    }
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runListing({ useForceEventIdFallback: false });
});

runForceButton.addEventListener('click', async () => {
  await runListing({ useForceEventIdFallback: true });
});

saveFeeButton.addEventListener('click', async () => {
  try {
    const marketplaceFeePercent = String(marketplaceFeePercentInput.value || '').trim() || '9';
    const saved = await window.listingApp.saveSettings({ marketplaceFeePercent });
    marketplaceFeePercentInput.value = saved?.marketplaceFeePercent || marketplaceFeePercent;
    saveFeeStatus.textContent = 'Save completed';
    setStatus(`Marketplace fee saved at ${marketplaceFeePercentInput.value}%.`, 'success');
  } catch (error) {
    saveFeeStatus.textContent = 'Save failed';
    setStatus('Failed to save marketplace fee.', 'error');
    logOutput.textContent = error.message || String(error);
  }
});

openOutputsButton.addEventListener('click', () => {
  window.listingApp.openOutputs();
});

openCsvButton.addEventListener('click', () => {
  window.listingApp.openCsv();
});

loadLicenseStatus().catch((error) => {
  logOutput.textContent = error.message || String(error);
  setStatus('Failed to load license.', 'error');
});

loadSettings().catch((error) => {
  logOutput.textContent = error.message || String(error);
  setStatus('Failed to load settings.', 'error');
});
