import { MSG, JOB_STATE } from '../shared/messages.js';

console.log('[MapHarvest] Service worker initializing...');

// Configure Side Panel behavior to open when user clicks extension action icon
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  ?.catch((error) => console.warn('[MapHarvest] setPanelBehavior error:', error));

// Keep-alive heartbeat alarm for Manifest V3 service worker
chrome.alarms.create('keepAliveHeartbeat', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAliveHeartbeat') {
    // Keeps worker responsive
  }
});

/**
 * Finds the most relevant tab to inspect:
 * 1. Checks active tabs that are NOT extension/devtools pages.
 * 2. If active tab is Google Maps, use it.
 * 3. If active tab is not Google Maps, check if any open tab is Google Maps.
 * 4. Fall back to active tab.
 */
async function findTargetTab() {
  // Query all active tabs across all windows
  const activeTabs = await chrome.tabs.query({ active: true });
  const normalActiveTabs = activeTabs.filter(t => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));

  // Prefer an active tab on Google Maps
  const activeMapsTab = normalActiveTabs.find(t => t.url && t.url.includes('google.') && t.url.includes('/maps'));
  if (activeMapsTab) {
    return activeMapsTab;
  }

  // If active tab is not Google Maps, check if any Google Maps tab exists
  const allMapsTabs = await chrome.tabs.query({
    url: [
      'https://*.google.com/maps/*',
      'https://*.google.co.in/maps/*',
      'https://*.google.co.uk/maps/*',
      'https://*.google.ca/maps/*'
    ]
  });

  if (allMapsTabs.length > 0) {
    return allMapsTabs[0];
  }

  // Fallback to the first normal active tab or the very first tab
  return normalActiveTabs[0] || activeTabs[0] || null;
}

/**
 * Ensures the content script is injected into the specified tab with a timeout.
 */
async function ensureContentScript(tabId) {
  try {
    const pingPromise = chrome.tabs.sendMessage(tabId, { action: MSG.PING });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 1000));
    const response = await Promise.race([pingPromise, timeoutPromise]);
    if (response?.status === 'ok') {
      return true;
    }
  } catch (e) {
    // Content script not yet present, inject dynamically
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/index.js']
    });
    // Wait a brief tick for script initialization
    await new Promise(r => setTimeout(r, 200));
    return true;
  } catch (err) {
    console.warn(`[MapHarvest] Cannot inject into tab ${tabId}:`, err.message);
    return false;
  }
}

// Listen for messages from Side Panel and Content Scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  // Forward content script scraper events to Side Panel / other extension views
  if (sender.tab && (
    message.action === MSG.ROW_COLLECTED ||
    message.action === MSG.STATUS_UPDATE ||
    message.action === MSG.JOB_COMPLETED ||
    message.action === MSG.JOB_ERROR
  )) {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  if (message.action === MSG.GET_PAGE_STATUS) {
    (async () => {
      try {
        const targetTab = await findTargetTab();
        if (!targetTab || !targetTab.id || !targetTab.url) {
          sendResponse({
            isMaps: false,
            isSearchPage: false,
            query: 'No tab found'
          });
          return;
        }

        const isGoogleMaps = Boolean(
          targetTab.url.includes('google.') &&
          targetTab.url.includes('/maps')
        );

        if (!isGoogleMaps) {
          sendResponse({
            isMaps: false,
            isSearchPage: false,
            query: 'Not a Google Maps page',
            url: targetTab.url
          });
          return;
        }

        const ready = await ensureContentScript(targetTab.id);
        if (!ready) {
          sendResponse({
            isMaps: true,
            isSearchPage: false,
            query: 'Could not inject script',
            url: targetTab.url
          });
          return;
        }

        // Request status from content script with timeout
        const statusPromise = chrome.tabs.sendMessage(targetTab.id, { action: MSG.GET_PAGE_STATUS });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Status query timeout')), 2500));
        const status = await Promise.race([statusPromise, timeoutPromise]);

        sendResponse(status || {
          isMaps: true,
          isSearchPage: false,
          query: 'Empty response from tab'
        });

      } catch (err) {
        console.error('[MapHarvest] Error in GET_PAGE_STATUS:', err);
        sendResponse({
          isMaps: false,
          isSearchPage: false,
          query: 'Error: ' + err.message
        });
      }
    })();
    return true; // Keep message channel open for async response
  }

  return false;
});

// Broadcast tab changes to Side Panel
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    chrome.runtime.sendMessage({
      action: 'TAB_ACTIVATED',
      tabId: activeInfo.tabId
    }).catch(() => {});
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    chrome.runtime.sendMessage({
      action: 'TAB_UPDATED',
      tabId,
      url: tab.url
    }).catch(() => {});
  }
});
