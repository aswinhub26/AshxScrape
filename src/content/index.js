import { MSG, JOB_STATE } from '../shared/messages.js';
import { FeedScroller } from './feed-scroller.js';
import { runDetailPass } from './detail-parser.js';
import { SELECTORS, pickAll } from './selectors.js';


console.log('[AshxScrape] Content script active on:', window.location.href);

let activeScroller = null;
let detailPassActive = false;
let detailPassPaused = false;
let detailPassStopped = false;


/**
 * Extracts the current Google Maps query using multiple fallback strategies
 */
function extractQuery() {
  const url = window.location.href;
  
  // Strategy 1: URL /maps/search/<query>
  const searchMatch = url.match(/\/maps\/search\/([^/@?]+)/);
  if (searchMatch && searchMatch[1]) {
    try {
      const decoded = decodeURIComponent(searchMatch[1].replace(/\+/g, ' ')).trim();
      if (decoded) return decoded;
    } catch (e) {}
  }

  // Strategy 2: Search input DOM element
  const inputSelectors = [
    '#searchboxinput',
    'input#searchboxinput',
    'input[aria-label*="Search Google Maps"]',
    'input[name="q"]',
    'input[aria-label*="Search"]'
  ];
  for (const selector of inputSelectors) {
    const input = document.querySelector(selector);
    if (input && input.value && input.value.trim()) {
      return input.value.trim();
    }
  }

  // Strategy 3: Feed header / aria-label
  const feedWithLabel = document.querySelector('div[role="feed"][aria-label], div[aria-label^="Results for"]');
  if (feedWithLabel) {
    const label = feedWithLabel.getAttribute('aria-label') || '';
    const match = label.match(/Results for\s+(.+)/i);
    if (match && match[1]) return match[1].trim();
  }

  // Strategy 4: Document title
  const title = document.title || '';
  const titleMatch = title.match(/^(.+?)\s*[-–—|]\s*Google Maps/i);
  if (titleMatch && titleMatch[1] && !titleMatch[1].toLowerCase().includes('google maps')) {
    return titleMatch[1].trim();
  }

  return null;
}

/**
 * Determines current Google Maps page status
 */
function getPageStatus() {
  const isMapsUrl = window.location.hostname.includes('google.') && window.location.pathname.includes('/maps');
  const feed = document.querySelector('div[role="feed"]');
  const cards = feed ? feed.querySelectorAll('div.Nv2PK, a.hfpxzc') : [];
  const query = extractQuery();
  const isSearchPage = Boolean(
    window.location.pathname.includes('/maps/search') ||
    (feed && cards.length > 0) ||
    (query && (feed || cards.length > 0))
  );

  return {
    isMaps: isMapsUrl,
    isSearchPage,
    hasFeed: Boolean(feed),
    cardCount: cards.length,
    query: query || (isMapsUrl ? 'No search active' : 'Not on Google Maps'),
    url: window.location.href,
    isHarvesting: Boolean(activeScroller && activeScroller.state === JOB_STATE.SCROLLING)
  };
}

// 1. One-off messages for handshake and page queries
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  switch (message.action) {
    case MSG.PING:
      sendResponse({ status: 'ok', time: Date.now() });
      return false;

    case MSG.GET_PAGE_STATUS:
      sendResponse(getPageStatus());
      return false;

    case MSG.SELECTOR_HEALTH_CHECK: {
      // Phase 6: Probe critical selectors and report any that are broken/missing
      const issues = [];
      const checks = [
        { name: 'feed', selector: 'div[role="feed"]' },
        { name: 'card.Nv2PK', selector: 'div.Nv2PK' },
        { name: 'card.hfpxzc', selector: 'a.hfpxzc' },
        { name: 'name.qBF1Pd', selector: '.qBF1Pd' },
        { name: 'rating.MW4etd', selector: '.MW4etd' }
      ];
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) {
        issues.push('feed missing (div[role=feed] not found)');
      } else {
        for (const check of checks.slice(1)) {
          if (!feed.querySelector(check.selector) && !document.querySelector(check.selector)) {
            issues.push(`${check.name} selector missing`);
          }
        }
      }
      sendResponse({ ok: issues.length === 0, issues });
      return false;
    }

    default:
      return false;
  }
});

// Phase 6: Block detection — watch for CAPTCHA or unusual pages
(function setupBlockDetector() {
  const BLOCK_SIGNALS = [
    'unusual traffic',
    'detected unusual activity',
    'verify you are human',
    'captcha',
    'too many requests'
  ];

  function checkForBlock() {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    const isBlocked = BLOCK_SIGNALS.some(sig => bodyText.includes(sig));
    if (isBlocked) {
      chrome.runtime.sendMessage({ action: MSG.BLOCK_DETECTED }).catch(() => {});
    }
  }

  // Check once on load, then every 15s
  setTimeout(checkForBlock, 3000);
  setInterval(checkForBlock, 15000);
})();


// 2. Direct streaming port connection from Side Panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ashxscrape-stream') return;
  console.log('[AshxScrape] Direct streaming port connected from Side Panel.');

  let isPortConnected = true;

  function safePost(msg) {
    if (!isPortConnected) return;
    try {
      port.postMessage(msg);
    } catch (e) {
      isPortConnected = false;
      console.warn('[AshxScrape] Port postMessage failed (disconnected):', e.message);
    }
  }

  port.onDisconnect.addListener(() => {
    console.log('[AshxScrape] Streaming port disconnected.');
    isPortConnected = false;
    if (activeScroller) {
      activeScroller.stop();
      activeScroller = null;
    }
    detailPassStopped = true;
  });

  port.onMessage.addListener((message) => {
    if (!message || !message.action || !isPortConnected) return;

    if (message.action === MSG.START_JOB) {
      const options = message.payload || {};
      const query = extractQuery() || 'Unknown Query';

      if (activeScroller) {
        activeScroller.stop();
      }

      activeScroller = new FeedScroller({
        query,
        maxResults: options.maxResults || 200,
        delays: options.delays,
        onRowCollected: (row, totalCount) => {
          safePost({
            action: MSG.ROW_COLLECTED,
            payload: { row, totalCount }
          });
        },
        onStatusChange: (state, messageText) => {
          safePost({
            action: MSG.STATUS_UPDATE,
            payload: { state, message: messageText }
          });
        },
        onComplete: (allRows) => {
          safePost({
            action: MSG.JOB_COMPLETED,
            payload: { totalCount: allRows.length }
          });
        },
        onError: (err) => {
          safePost({
            action: MSG.JOB_ERROR,
            payload: { error: err.message }
          });
        }
      });

      activeScroller.start();
      safePost({ action: 'STARTED', query });
    }

    if (message.action === MSG.PAUSE_JOB) {
      if (activeScroller) activeScroller.pause();
      detailPassPaused = true;
    }

    if (message.action === MSG.RESUME_JOB) {
      if (activeScroller) activeScroller.resume();
      detailPassPaused = false;
    }

    if (message.action === MSG.STOP_JOB) {
      if (activeScroller) activeScroller.stop();
      detailPassStopped = true;
    }

    if (message.action === MSG.START_DETAIL_PASS) {
      const { rows = [] } = message.payload || {};
      detailPassActive = true;
      detailPassPaused = false;
      detailPassStopped = false;

      safePost({ action: MSG.STATUS_UPDATE, payload: { state: JOB_STATE.DETAILING, message: `Starting detail pass on ${rows.length} places...` } });

      // Collect current card elements from feed
      const feed = document.querySelector('div[role="feed"]');
      const cards = feed ? Array.from(pickAll(feed, SELECTORS.card)) : [];

      runDetailPass(cards, rows, {
        isPaused: () => detailPassPaused || !isPortConnected,
        isStopped: () => detailPassStopped || !isPortConnected,
        onProgress: (updatedRow, index, total) => {
          safePost({
            action: MSG.ROW_UPDATED,
            payload: { row: updatedRow, index, total }
          });
        }
      }).then((updatedRows) => {
        detailPassActive = false;
        safePost({
          action: MSG.DETAIL_PASS_COMPLETE,
          payload: { count: updatedRows.length }
        });
      }).catch((err) => {
        detailPassActive = false;
        safePost({
          action: MSG.JOB_ERROR,
          payload: { error: err.message }
        });
      });
    }
  }); // end port.onMessage
});


