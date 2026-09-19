import { MSG, JOB_STATE } from '../shared/messages.js';
import { createJob, updateJob, saveRowsBatch, openDatabase, getAllJobs, getRowsForJob } from '../lib/db.js';
import { VirtualTable } from './components/virtual-table.js';
import { FilterBar } from './components/filter-bar.js';
import { generateCsv, generateTsv, generateFilename, downloadFile, generateXlsx, generateJson, generateLeadSummary } from '../lib/export.js';


// DOM Element References
const el = {
  detectedQuery: document.getElementById('detectedQuery'),
  stateBadge: document.getElementById('stateBadge'),
  btnRefreshQuery: document.getElementById('btnRefreshQuery'),
  noticeBanner: document.getElementById('noticeBanner'),
  noticeText: document.getElementById('noticeText'),
  noticeIcon: document.getElementById('noticeIcon'),
  btnStart: document.getElementById('btnStart'),
  btnPause: document.getElementById('btnPause'),
  btnStop: document.getElementById('btnStop'),
  btnClear: document.getElementById('btnClear'),
  btnDetailPass: document.getElementById('btnDetailPass'),
  btnToggleLog: document.getElementById('btnToggleLog'),
  btnToggleSettings: document.getElementById('btnToggleSettings'),
  btnToggleHistory: document.getElementById('btnToggleHistory'),
  btnCloseSettings: document.getElementById('btnCloseSettings'),
  historyChevron: document.getElementById('historyChevron'),
  logChevron: document.getElementById('logChevron'),
  logDrawer: document.getElementById('logDrawer'),
  logContent: document.getElementById('logContent'),
  settingsDrawer: document.getElementById('settingsDrawer'),
  historyDrawer: document.getElementById('historyDrawer'),
  historyList: document.getElementById('historyList'),
  settingMaxResults: document.getElementById('settingMaxResults'),
  settingDetailPass: document.getElementById('settingDetailPass'),
  statCollected: document.getElementById('statCollected'),
  statPhone: document.getElementById('statPhone'),
  statWebsite: document.getElementById('statWebsite'),
  statNoWebsite: document.getElementById('statNoWebsite'),
  statErrors: document.getElementById('statErrors'),
  statDetailed: document.getElementById('statDetailed'),
  emptyState: document.getElementById('emptyState'),
  tableContainer: document.getElementById('tableContainer'),
  exportStatus: document.getElementById('exportStatus'),
  btnCopySummary: document.getElementById('btnCopySummary'),
  btnExportCsv: document.getElementById('btnExportCsv'),
  btnExportXlsx: document.getElementById('btnExportXlsx'),
  btnExportJson: document.getElementById('btnExportJson'),
  btnCopyTsv: document.getElementById('btnCopyTsv'),
  filterText: document.getElementById('filterText'),
  filterMinRating: document.getElementById('filterMinRating'),
  filterNoWeb: document.getElementById('filterNoWeb'),
  filterHasPhone: document.getElementById('filterHasPhone'),
  filterHasWeb: document.getElementById('filterHasWeb')
};



// Panel State
let currentState = JOB_STATE.IDLE;
let currentTabStatus = null;
let currentTabId = null;
let currentJob = null;
let activePort = null;
let collectedRows = [];
let pendingDbBatch = [];
let batchFlushTimer = null;

// Virtual Table & Filter Bar Instances
let virtualTable = null;
let filterBar = null;

/**
 * Log message to the in-panel console drawer
 */
function log(msg, type = 'info') {
  if (!el.logContent) return;
  const time = new Date().toTimeString().split(' ')[0];
  const div = document.createElement('div');
  div.className = 'log-line';
  
  let typeClass = 'log-info';
  if (type === 'warn') typeClass = 'log-warn';
  if (type === 'error') typeClass = 'log-error';
  if (type === 'success') typeClass = 'log-success';

  div.innerHTML = `<span class="log-time">${time}</span> <span class="${typeClass}">[${type.toUpperCase()}]</span> ${escapeHtml(msg)}`;
  el.logContent.appendChild(div);
  el.logDrawer.scrollTop = el.logDrawer.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

/**
 * Update the state chip UI
 */
function setState(state) {
  currentState = state;
  el.stateBadge.className = `state-chip state-${state}`;
  el.stateBadge.textContent = state.charAt(0).toUpperCase() + state.slice(1);

  const isActive = state === JOB_STATE.SCROLLING || state === JOB_STATE.DETAILING;

  if (isActive) {
    el.btnStart.disabled = true;
    el.btnPause.disabled = false;
    el.btnPause.textContent = '⏸ Pause';
    el.btnStop.disabled = false;
  } else if (state === JOB_STATE.PAUSED) {
    el.btnStart.disabled = true;
    el.btnPause.disabled = false;
    el.btnPause.textContent = '▶ Resume';
    el.btnStop.disabled = false;
  } else {
    el.btnStart.disabled = !(currentTabStatus && currentTabStatus.isSearchPage);
    el.btnPause.disabled = true;
    el.btnPause.textContent = '⏸ Pause';
    el.btnStop.disabled = true;
  }

  // Re-evaluate Detail Pass button: enabled when rows exist and not actively running
  if (el.btnDetailPass) {
    el.btnDetailPass.disabled = collectedRows.length === 0 || isActive;
  }
}


function showNotice(text, isDanger = false, icon = '⚠️') {
  el.noticeText.textContent = text;
  el.noticeIcon.textContent = icon;
  el.noticeBanner.className = `notice-banner ${isDanger ? 'danger' : ''}`;
  el.noticeBanner.classList.remove('hidden');
}

function hideNotice() {
  el.noticeBanner.classList.add('hidden');
}

async function getTargetTab() {
  const tabs = await chrome.tabs.query({ active: true });
  const normalTabs = tabs.filter(t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));

  const activeMaps = normalTabs.find(t => t.url && t.url.includes('google.') && t.url.includes('/maps'));
  if (activeMaps) return activeMaps;

  const allMaps = await chrome.tabs.query({
    url: [
      'https://*.google.com/maps/*',
      'https://*.google.co.in/maps/*',
      'https://*.google.co.uk/maps/*',
      'https://*.google.ca/maps/*'
    ]
  });
  if (allMaps.length > 0) return allMaps[0];

  return normalTabs[0] || tabs[0] || null;
}

async function ensureInjected(tabId) {
  try {
    const ping = await Promise.race([
      chrome.tabs.sendMessage(tabId, { action: MSG.PING }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))
    ]);
    if (ping?.status === 'ok') return true;
  } catch (e) {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/index.js']
    });
    await new Promise(r => setTimeout(r, 200));
    return true;
  } catch (err) {
    log(`Cannot inject script into tab ${tabId}: ${err.message}`, 'warn');
    return false;
  }
}

async function refreshPageStatus() {
  el.detectedQuery.textContent = 'Checking active tab...';
  try {
    const targetTab = await getTargetTab();
    if (!targetTab || !targetTab.id || !targetTab.url) {
      el.detectedQuery.textContent = 'No tab detected';
      showNotice('Please open a Google Maps tab to start harvesting.');
      setState(JOB_STATE.IDLE);
      return;
    }

    currentTabId = targetTab.id;
    const isGoogleMaps = targetTab.url.includes('google.') && targetTab.url.includes('/maps');

    if (!isGoogleMaps) {
      el.detectedQuery.textContent = 'Not on Google Maps';
      showNotice('Active tab is not Google Maps. Open google.com/maps to start.', true);
      setState(JOB_STATE.IDLE);
      return;
    }

    const injected = await ensureInjected(targetTab.id);
    if (!injected) {
      el.detectedQuery.textContent = 'Script injection failed';
      showNotice('Please refresh the Google Maps tab and try again.', true);
      setState(JOB_STATE.IDLE);
      return;
    }

    const status = await Promise.race([
      chrome.tabs.sendMessage(targetTab.id, { action: MSG.GET_PAGE_STATUS }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ]);

    currentTabStatus = status;

    if (!status || !status.isSearchPage) {
      el.detectedQuery.textContent = status?.query || 'No search query';
      showNotice('Please search for a keyword (e.g. "dentists in Chennai") on Google Maps.');
      setState(JOB_STATE.IDLE);
      return;
    }

    hideNotice();
    el.detectedQuery.textContent = status.query;
    setState(status.isHarvesting ? JOB_STATE.SCROLLING : currentState);
    log(`Ready on: "${status.query}" (Cards in view: ${status.cardCount || 0})`, 'info');

  } catch (err) {
    el.detectedQuery.textContent = 'Error inspecting page';
    showNotice('Error: ' + err.message, true);
    setState(JOB_STATE.IDLE);
  }
}

/**
 * Applies filters to table and updates stats/export display
 */
function updateFilteredView() {
  const filtered = filterBar ? filterBar.apply(collectedRows) : collectedRows;

  if (collectedRows.length === 0) {
    el.emptyState.style.display = 'block';
    el.tableContainer.style.display = 'none';
  } else {
    el.emptyState.style.display = 'none';
    el.tableContainer.style.display = 'block';
  }

  if (virtualTable) {
    virtualTable.setRows(filtered);
  }

  // Update live stats based on all collected
  const total = collectedRows.length;
  let withPhone = 0;
  let withWeb = 0;
  let withoutWeb = 0;

  for (const r of collectedRows) {
    if (r.phone || r.phoneRaw) withPhone++;
    if (r.website) withWeb++;
    else withoutWeb++;
  }

  el.statCollected.textContent = total;
  el.statPhone.textContent = withPhone;
  el.statWebsite.textContent = withWeb;
  el.statNoWebsite.textContent = withoutWeb;

  // Export status reflects current filtered subset
  el.exportStatus.textContent = `${filtered.length} of ${total} items ready`;

  // Enable Detail Pass button when rows are collected and not actively scraping
  if (el.btnDetailPass) {
    el.btnDetailPass.disabled = total === 0 || (currentState === JOB_STATE.SCROLLING || currentState === JOB_STATE.DETAILING);
  }
}


/**
 * Flushes buffered rows into IndexedDB
 */
async function flushDbBatch() {
  if (!currentJob || pendingDbBatch.length === 0) return;
  const toSave = [...pendingDbBatch];
  pendingDbBatch = [];
  try {
    await saveRowsBatch(currentJob.id, toSave);
    await updateJob(currentJob.id, { collectedCount: collectedRows.length });
  } catch (err) {
    console.error('[AshxScrape DB] Failed to save batch:', err);
    log('DB save error: ' + err.message, 'error');
  }
}

// Controls
el.btnStart.addEventListener('click', async () => {
  try {
    const targetTab = await getTargetTab();
    if (!targetTab || !targetTab.id) {
      log('No Google Maps tab found to harvest', 'error');
      return;
    }
    currentTabId = targetTab.id;

    if (activePort) {
      try { activePort.disconnect(); } catch (e) {}
      activePort = null;
    }

    activePort = chrome.tabs.connect(currentTabId, { name: 'ashxscrape-stream' });

    activePort.onMessage.addListener((message) => {
      if (message.action === MSG.ROW_COLLECTED && message.payload?.row) {
        const { row } = message.payload;
        collectedRows.push(row);
        pendingDbBatch.push(row);

        updateFilteredView();

        if (pendingDbBatch.length >= 5) {
          flushDbBatch();
        } else if (!batchFlushTimer) {
          batchFlushTimer = setTimeout(() => {
            flushDbBatch();
            batchFlushTimer = null;
          }, 1000);
        }
      }

      if (message.action === MSG.STATUS_UPDATE && message.payload) {
        if (message.payload.state) setState(message.payload.state);
        if (message.payload.message) log(message.payload.message, 'info');
      }

      if (message.action === MSG.JOB_COMPLETED) {
        flushDbBatch();
        setState(JOB_STATE.DONE);
        log(`Finished. Collected ${collectedRows.length} unique places.`, 'info');
        log(`Job completed! Total: ${collectedRows.length} places.`, 'success');
      }

      if (message.action === MSG.JOB_ERROR) {
        setState(JOB_STATE.ERROR);
        log(`Scraper error: ${message.payload.error}`, 'error');
      }

      // Phase 4: Detail pass row update
      if (message.action === MSG.ROW_UPDATED && message.payload?.row) {
        const updatedRow = message.payload.row;
        const idx = collectedRows.findIndex(r => r.placeId === updatedRow.placeId);
        if (idx !== -1) collectedRows[idx] = updatedRow;
        updateFilteredView();
        if (el.statDetailed) {
          el.statDetailed.textContent = message.payload.index || '';
        }
        log(`Detail [${message.payload.index}/${message.payload.total}]: ${updatedRow.name}`, 'info');
      }

      // Phase 4: Detail pass complete
      if (message.action === MSG.DETAIL_PASS_COMPLETE) {
        setState(JOB_STATE.DONE);
        flushDbBatch();
        log(`Detail pass complete! Enriched ${message.payload.count} places.`, 'success');
      }

    });

    activePort.onDisconnect.addListener(() => {
      log('Streaming port disconnected.', 'info');
    });

    const query = el.detectedQuery.textContent || 'Unknown';
    currentJob = await createJob(query);
    log(`Started harvest job #${currentJob.id} for "${query}"`, 'info');
    setState(JOB_STATE.SCROLLING);

    activePort.postMessage({
      action: MSG.START_JOB,
      payload: { maxResults: 200 }
    });

  } catch (err) {
    log('Failed to start scrape: ' + err.message, 'error');
    setState(JOB_STATE.ERROR);
  }
});

el.btnPause.addEventListener('click', async () => {
  if (!activePort) return;
  if (currentState === JOB_STATE.SCROLLING) {
    activePort.postMessage({ action: MSG.PAUSE_JOB });
    setState(JOB_STATE.PAUSED);
  } else if (currentState === JOB_STATE.PAUSED) {
    activePort.postMessage({ action: MSG.RESUME_JOB });
    setState(JOB_STATE.SCROLLING);
  }
});

el.btnStop.addEventListener('click', async () => {
  if (activePort) {
    activePort.postMessage({ action: MSG.STOP_JOB });
  }
  await flushDbBatch();
  setState(JOB_STATE.STOPPED);
  log(`Stopped by user. Total collected: ${collectedRows.length}`, 'warn');
});

el.btnClear.addEventListener('click', () => {
  collectedRows = [];
  pendingDbBatch = [];
  if (filterBar) filterBar.reset();
  updateFilteredView();
  log('Cleared preview table.', 'info');
});

el.btnRefreshQuery.addEventListener('click', refreshPageStatus);

// Collapsible Accordion: Console Log
if (el.btnToggleLog) {
  el.btnToggleLog.addEventListener('click', () => {
    if (!el.logDrawer) return;
    const isHidden = el.logDrawer.classList.toggle('hidden');
    if (el.logChevron) {
      el.logChevron.classList.toggle('expanded', !isHidden);
    }
  });
}

/**
 * Sets the active highlighted export button (switches the blue pill highlight dynamically)
 */
function setExportActiveButton(clickedBtn, temporaryLabel, originalLabel) {
  const exportButtons = [el.btnCopySummary, el.btnCopyTsv, el.btnExportCsv, el.btnExportXlsx, el.btnExportJson].filter(Boolean);
  
  // Remove primary highlight from all buttons
  exportButtons.forEach(btn => {
    btn.classList.remove('btn-primary', 'active');
  });

  // Highlight the clicked button
  if (clickedBtn) {
    clickedBtn.classList.add('btn-primary', 'active');
    if (temporaryLabel) {
      const origText = originalLabel || clickedBtn.textContent;
      clickedBtn.textContent = temporaryLabel;
      setTimeout(() => {
        clickedBtn.textContent = origText;
      }, 1400);
    }
  }
}

// Export Triggers
el.btnExportCsv.addEventListener('click', async () => {
  const filtered = filterBar ? filterBar.apply(collectedRows) : collectedRows;
  if (filtered.length === 0) {
    log('No records matching current filters to export.', 'warn');
    return;
  }

  setExportActiveButton(el.btnExportCsv, '✓ CSV', 'CSV');
  const query = el.detectedQuery.textContent || 'leads';
  const csvContent = generateCsv(filtered);
  const filename = generateFilename(query, 'csv');

  await downloadFile(csvContent, filename, 'text/csv;charset=utf-8');
  if (el.exportStatus) el.exportStatus.textContent = `✓ Exported ${filename} (${filtered.length} items)`;
  log(`Exported ${filtered.length} rows to ${filename}`, 'success');
});

el.btnCopyTsv.addEventListener('click', async () => {
  const filtered = filterBar ? filterBar.apply(collectedRows) : collectedRows;
  if (filtered.length === 0) {
    log('No records to copy.', 'warn');
    return;
  }

  setExportActiveButton(el.btnCopyTsv, '✓ Copied', 'Copy');
  const tsvContent = generateTsv(filtered);
  try {
    await navigator.clipboard.writeText(tsvContent);
    if (el.exportStatus) el.exportStatus.textContent = `✓ Copied ${filtered.length} items as TSV`;
    log(`Copied ${filtered.length} rows to clipboard as TSV (paste directly into Google Sheets/Excel).`, 'success');
  } catch (err) {
    log('Failed to copy to clipboard: ' + err.message, 'error');
  }
});

// Copy Executive Lead Analytics Summary
if (el.btnCopySummary) {
  el.btnCopySummary.addEventListener('click', async () => {
    const filtered = filterBar ? filterBar.apply(collectedRows) : collectedRows;
    if (filtered.length === 0) {
      log('No records to summarize. Collect places first.', 'warn');
      return;
    }

    setExportActiveButton(el.btnCopySummary, '✓ Copied', 'Summary');
    const query = el.detectedQuery.textContent || 'Google Maps Leads';
    const summaryMd = generateLeadSummary(filtered, query);
    try {
      await navigator.clipboard.writeText(summaryMd);
      if (el.exportStatus) el.exportStatus.textContent = `✓ Copied Executive Summary (Markdown)`;
      log(`📋 Copied Lead Analytics Summary for ${filtered.length} places to clipboard (Markdown)!`, 'success');
    } catch (err) {
      log('Failed to copy summary to clipboard: ' + err.message, 'error');
    }
  });
}

// XLSX Export
if (el.btnExportXlsx) {
  el.btnExportXlsx.addEventListener('click', async () => {
    const filtered = filterBar ? filterBar.apply(collectedRows) : collectedRows;
    if (filtered.length === 0) {
      log('No records matching current filters to export.', 'warn');
      return;
    }
    setExportActiveButton(el.btnExportXlsx, '⏳ XLSX', 'XLSX');
    try {
      el.btnExportXlsx.disabled = true;
      const query = el.detectedQuery.textContent || 'leads';
      const buffer = await generateXlsx(filtered, query);
      const filename = generateFilename(query, 'xlsx');
      await downloadFile(buffer, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      setExportActiveButton(el.btnExportXlsx, '✓ XLSX', 'XLSX');
      if (el.exportStatus) el.exportStatus.textContent = `✓ Exported ${filename} (${filtered.length} items)`;
      log(`Exported ${filtered.length} rows to ${filename}`, 'success');
    } catch (err) {
      log('XLSX export error: ' + err.message, 'error');
    } finally {
      el.btnExportXlsx.disabled = false;
    }
  });
}

// JSON Export
if (el.btnExportJson) {
  el.btnExportJson.addEventListener('click', async () => {
    const filtered = filterBar ? filterBar.apply(collectedRows) : collectedRows;
    if (filtered.length === 0) {
      log('No records matching current filters to export.', 'warn');
      return;
    }
    setExportActiveButton(el.btnExportJson, '✓ JSON', 'JSON');
    const query = el.detectedQuery.textContent || 'leads';
    const jsonContent = generateJson(filtered, query, currentJob?.id);
    const filename = generateFilename(query, 'json');
    await downloadFile(jsonContent, filename, 'application/json');
    if (el.exportStatus) el.exportStatus.textContent = `✓ Exported ${filename} (${filtered.length} items)`;
    log(`Exported ${filtered.length} rows to ${filename}`, 'success');
  });
}


// Detail Pass Button
if (el.btnDetailPass) {
  el.btnDetailPass.addEventListener('click', async () => {
    if (!activePort || collectedRows.length === 0) {
      log('Start harvesting first to collect rows before running detail pass.', 'warn');
      return;
    }
    log(`Starting detail pass on ${collectedRows.length} places...`, 'info');
    setState(JOB_STATE.DETAILING);
    activePort.postMessage({
      action: MSG.START_DETAIL_PASS,
      payload: { rows: collectedRows }
    });
  });
}

// Settings Drawer Toggle
if (el.btnToggleSettings) {
  el.btnToggleSettings.addEventListener('click', () => {
    if (el.settingsDrawer) el.settingsDrawer.classList.toggle('hidden');
  });
}

if (el.btnCloseSettings) {
  el.btnCloseSettings.addEventListener('click', () => {
    if (el.settingsDrawer) el.settingsDrawer.classList.add('hidden');
  });
}

// Collapsible Accordion: Job History
if (el.btnToggleHistory) {
  el.btnToggleHistory.addEventListener('click', async () => {
    if (!el.historyDrawer) return;
    const isHidden = el.historyDrawer.classList.toggle('hidden');
    if (el.historyChevron) {
      el.historyChevron.classList.toggle('expanded', !isHidden);
    }
    if (!isHidden) {
      await renderJobHistory();
    }
  });
}

/**
 * Renders job history list from IndexedDB
 */
async function renderJobHistory() {
  if (!el.historyList) return;
  try {
    const jobs = await getAllJobs();
    if (!jobs || jobs.length === 0) {
      el.historyList.innerHTML = '<div class="history-empty">No jobs yet. Start your first harvest!</div>';
      return;
    }

    // Sort newest first
    jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    el.historyList.innerHTML = '';

    for (const job of jobs.slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'history-item';
      const date = job.createdAt ? new Date(job.createdAt).toLocaleString() : '?';
      row.innerHTML = `
        <div class="history-query">${escapeHtml(job.query || 'Unknown Query')}</div>
        <div class="history-meta">${job.collectedCount || 0} places &bull; ${date}</div>
        <button class="btn history-load-btn" data-jobid="${job.id}">Load</button>
      `;
      row.querySelector('.history-load-btn').addEventListener('click', async () => {
        try {
          const rows = await getRowsForJob(job.id);
          collectedRows = rows || [];
          currentJob = job;
          updateFilteredView();
          el.detectedQuery.textContent = job.query || 'Loaded';
          if (el.historyDrawer) el.historyDrawer.classList.add('hidden');
          log(`Loaded ${rows.length} rows from job #${job.id}: "${job.query}"`, 'success');
        } catch (err) {
          log('Failed to load job: ' + err.message, 'error');
        }
      });
      el.historyList.appendChild(row);
    }
  } catch (err) {
    el.historyList.innerHTML = `<div class="history-empty">Error loading history: ${escapeHtml(err.message)}</div>`;
  }
}

// Settings: wire up max results and detail pass auto-run settings persistence
function loadSettings() {
  try {
    const stored = localStorage.getItem('ashxscrape_settings');
    if (stored) {
      const s = JSON.parse(stored);
      if (el.settingMaxResults && s.maxResults) el.settingMaxResults.value = s.maxResults;
      if (el.settingDetailPass && s.autoDetailPass !== undefined) el.settingDetailPass.checked = s.autoDetailPass;
    }
  } catch (e) {}
}

function saveSettings() {
  try {
    const settings = {
      maxResults: el.settingMaxResults ? parseInt(el.settingMaxResults.value, 10) || 200 : 200,
      autoDetailPass: el.settingDetailPass ? el.settingDetailPass.checked : false
    };
    localStorage.setItem('ashxscrape_settings', JSON.stringify(settings));
    return settings;
  } catch (e) {
    return { maxResults: 200, autoDetailPass: false };
  }
}

if (el.settingMaxResults) el.settingMaxResults.addEventListener('change', saveSettings);
if (el.settingDetailPass) el.settingDetailPass.addEventListener('change', saveSettings);

// Phase 6: Selector Health Probe
function runSelectorHealthCheck(tabId) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { action: MSG.SELECTOR_HEALTH_CHECK }).then(result => {
    if (!result) return;
    const issues = result.issues || [];
    if (issues.length > 0) {
      log(`⚠️ Selector health: ${issues.join(', ')}`, 'warn');
    } else {
      log('Selector health: OK', 'info');
    }
  }).catch(() => {});
}

// Phase 6: Block / rate-limit detection
function checkForBlockSignals() {
  // Listen for BLOCK_DETECTED messages from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === MSG.BLOCK_DETECTED) {
      setState(JOB_STATE.BLOCKED);
      showNotice('⚠️ Google Maps may be rate-limiting. Pause for 2-5 minutes before resuming.', true, '🚫');
      log('Block signal detected from Google Maps. Auto-pausing.', 'warn');
      if (activePort) activePort.postMessage({ action: MSG.PAUSE_JOB });
    }
  });
}

// === iOS 26 Liquid Glass Interactive Physics & Effects ===

/**
 * Water Ripple effect for buttons and clickable surfaces
 */
function initWaterRipple() {
  document.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('.ripple-surface, .btn, .filter-chip');
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const ripple = document.createElement('span');
    const diameter = Math.max(rect.width, rect.height) * 1.6;
    const radius = diameter / 2;

    ripple.className = 'ripple-pulse';
    ripple.style.width = `${diameter}px`;
    ripple.style.height = `${diameter}px`;
    ripple.style.left = `${e.clientX - rect.left - radius}px`;
    ripple.style.top = `${e.clientY - rect.top - radius}px`;

    const oldRipple = target.querySelector('.ripple-pulse');
    if (oldRipple) oldRipple.remove();

    target.appendChild(ripple);

    setTimeout(() => {
      if (ripple.parentNode) ripple.remove();
    }, 700);
  });
}

/**
 * Liquid light hover tracking following the cursor
 */
function initLiquidHoverTracking() {
  document.addEventListener('mousemove', (e) => {
    const target = e.target.closest('.liquid-track, .stat-card, .btn');
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    target.style.setProperty('--mouse-x', `${x}%`);
    target.style.setProperty('--mouse-y', `${y}%`);
  });
}

// Expose for automated benchmarking and testing
window.testSetRows = (rows) => {
  collectedRows = rows || [];
  updateFilteredView();
};

// Boot
openDatabase().then(() => {
  log('IndexedDB storage initialized.', 'info');

  // Initialize Virtual Table
  virtualTable = new VirtualTable(el.tableContainer, {
    onRowClick: (row) => {
      if (row.placeUrl) {
        chrome.tabs.create({ url: row.placeUrl, active: false });
      }
    }
  });

  // Initialize Filter Bar
  filterBar = new FilterBar({
    filterText: el.filterText,
    filterMinRating: el.filterMinRating,
    filterNoWeb: el.filterNoWeb,
    filterHasPhone: el.filterHasPhone,
    filterHasWeb: el.filterHasWeb
  }, () => {
    updateFilteredView();
  });

  loadSettings();
  checkForBlockSignals();
  initWaterRipple();
  initLiquidHoverTracking();
  initKeyboardShortcuts();
  refreshPageStatus();
}).catch(err => {
  log('IndexedDB init error: ' + err.message, 'error');
  initWaterRipple();
  initLiquidHoverTracking();
  initKeyboardShortcuts();
  refreshPageStatus();
});

/**
 * Productivity keyboard shortcuts
 */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Escape: close open drawers
    if (e.key === 'Escape') {
      if (el.settingsDrawer && !el.settingsDrawer.classList.contains('hidden')) {
        el.settingsDrawer.classList.add('hidden');
      }
      if (el.historyDrawer && !el.historyDrawer.classList.contains('hidden')) {
        el.historyDrawer.classList.add('hidden');
      }
      if (el.logDrawer && !el.logDrawer.classList.contains('hidden')) {
        el.logDrawer.classList.add('hidden');
      }
    }

    // Ctrl+F / Cmd+F: focus lead filter search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      if (el.filterText) {
        e.preventDefault();
        el.filterText.focus();
        el.filterText.select();
      }
    }
  });
}


