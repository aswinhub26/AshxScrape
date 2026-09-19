/**
 * AshxScrape Detail Panel Scraper (Pass B)
 * Opens each card's detail view, extracts richer fields, then navigates back.
 */

import { cleanText, normalizePhone, extractDomain } from '../lib/schema.js';
import { extractPlaceIdentifiers } from '../lib/dedupe.js';
import { sleepJitter } from '../lib/throttle.js';

/** Selector chains for the detail panel (right-side info pane) */
const DETAIL_SELECTORS = {
  // The panel container that appears after clicking a card
  panel: [
    'div[role="main"] div.m6QErb',
    'div.TIHn2',
    'div[data-testid="place-tip"]',
    'div.bJzME'
  ],
  // Full address line
  address: [
    'button[data-item-id="address"] .Io6YTe',
    'div[data-item-id="address"] .Io6YTe',
    'button[data-item-id="address"]',
    'div[data-tooltip="Copy address"] .Io6YTe',
    'button[aria-label*="ddress" i] .Io6YTe',
    'button[aria-label*="Address:" i]',
    '.rogA2c .Io6YTe'
  ],
  // Website link
  website: [
    'a[data-item-id="authority"] .Io6YTe',
    'a[data-item-id="authority"]',
    'a[aria-label*="ebsite" i] .Io6YTe',
    'a[data-tooltip="Open website"] .Io6YTe',
    'a[data-item-id="web"]'
  ],
  // Phone
  phone: [
    'button[data-item-id^="phone:tel"] .Io6YTe',
    'button[data-item-id^="phone:tel"]',
    'a[data-item-id^="phone:tel"] .Io6YTe',
    'a[data-item-id^="phone:tel"]',
    'button[aria-label*="Phone" i] .Io6YTe',
    'button[aria-label*="Phone" i]',
    'span[aria-label*="Phone" i] .Io6YTe',
    'div[data-tooltip="Copy phone number"] .Io6YTe',
    'button[data-tooltip*="phone" i] .Io6YTe',
    'button[data-tooltip*="phone" i]',
    'a[href^="tel:"]'
  ],

  // Opening hours block
  hours: [
    'table.WgFkxc',
    'div[aria-label*="ours"] table',
    '.t39EBf.GUrTXd',
    'div[jsaction*="openhours"]'
  ],
  // Price level dots
  priceLevel: [
    'span[aria-label*="Price"]',
    '.mgr77e',
    'span.ZDu9vd'
  ],
  // Plus code
  plusCode: [
    'button[data-item-id="oloc"] .Io6YTe',
    'div[data-item-id="oloc"] .Io6YTe',
    '.QSFF4-text'
  ],
  // "Claim this business" indicator (if present, it means unclaimed)
  claimBusiness: [
    'a[href*="claimthisbusiness"]',
    'a[aria-label*="Claim this business"]',
    'button[aria-label*="Claim this business"]'
  ]
};

/**
 * Waits for a selector to appear on the detail panel
 */
async function waitForSelector(selector, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

/**
 * Picks first matching element from selector chain
 */
function pickDetail(selector) {
  if (Array.isArray(selector)) {
    for (const s of selector) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }
  return document.querySelector(selector);
}

/**
 * Extracts opening hours from the detail panel table.
 * Returns a compact string like: "Mon–Fri: 9am–6pm; Sat: 10am–4pm; Sun: Closed"
 */
function extractHours() {
  // Try to find the hours table
  const table = pickDetail(DETAIL_SELECTORS.hours);
  if (!table) {
    // Fallback: look for aria-label on hours button
    const btn = document.querySelector('button[aria-label*="hours"]');
    if (btn) {
      const aria = btn.getAttribute('aria-label') || '';
      // Extract text like "Tuesday, 9 AM to 9 PM" from aria-label
      return cleanText(aria.replace(/^(Hours|Opening hours)[:\s]*/i, ''));
    }
    return null;
  }

  const rows = table.querySelectorAll('tr');
  const parts = [];
  for (const tr of rows) {
    const cells = tr.querySelectorAll('td');
    if (cells.length >= 2) {
      const day = cleanText(cells[0]?.innerText);
      const time = cleanText(cells[1]?.innerText);
      if (day && time) {
        parts.push(`${day}: ${time}`);
      }
    }
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * Extracts price level from detail panel (e.g. "$$" → 2)
 */
function extractPriceLevel() {
  const el = pickDetail(DETAIL_SELECTORS.priceLevel);
  if (!el) return null;
  const aria = el.getAttribute('aria-label') || el.innerText || '';
  // Match patterns like "Price: $$$", "Moderately expensive", or just "$$"
  const moneyMatch = aria.match(/(\$+)/);
  if (moneyMatch) return moneyMatch[1];
  if (aria.toLowerCase().includes('inexpensive')) return '$';
  if (aria.toLowerCase().includes('expensive')) return '$$$';
  if (aria.toLowerCase().includes('moderate')) return '$$';
  return cleanText(aria) || null;
}

/**
 * Scrapes all extractable fields from the currently-open place detail panel.
 * Call AFTER clicking on a card and waiting for the panel to load.
 */
export function scrapeDetailPanel() {
  const result = {};

  // Address
  const addrEl = pickDetail(DETAIL_SELECTORS.address);
  result.address = cleanText(addrEl?.innerText || addrEl?.textContent || addrEl?.getAttribute('aria-label')?.replace(/^Address:\s*/i, '')) || null;

  // Website
  const webEl = pickDetail(DETAIL_SELECTORS.website);
  if (webEl) {
    const webHref = webEl.closest('a')?.href || webEl.href || null;
    if (webHref && !webHref.includes('google.com/maps')) {
      result.website = webHref;
      result.domain = extractDomain(webHref);
    }
  }
  if (!result.website) {
    const webLink = document.querySelector('a[data-item-id="authority"]');
    if (webLink?.href && !webLink.href.includes('google.com/maps')) {
      result.website = webLink.href;
      result.domain = extractDomain(webLink.href);
    }
  }

  // Phone: check dedicated buttons, tooltips, and tel links
  let rawPhone = null;
  const phoneEl = pickDetail(DETAIL_SELECTORS.phone) || document.querySelector('button[data-item-id^="phone"], a[data-item-id^="phone"], button[aria-label*="phone" i], a[href^="tel:"]');
  if (phoneEl) {
    rawPhone = phoneEl.innerText || phoneEl.textContent || phoneEl.getAttribute('aria-label') || phoneEl.getAttribute('data-item-id')?.replace(/^phone:tel:/, '') || phoneEl.href?.replace(/^tel:/, '');
  }

  // Fallback: search detail pane text for phone number pattern if button missed
  if (!rawPhone) {
    const panelEl = pickDetail(DETAIL_SELECTORS.panel) || document.body;
    const panelText = panelEl.innerText || '';
    const phoneMatch = panelText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}/);
    if (phoneMatch && phoneMatch[0]) {
      const cleanedCandidate = phoneMatch[0].replace(/[^\d+]/g, '');
      if (cleanedCandidate.length >= 7 && cleanedCandidate.length <= 15) {
        rawPhone = phoneMatch[0];
      }
    }
  }

  if (rawPhone) {
    const { phone, phoneRaw } = normalizePhone(cleanText(rawPhone));
    result.phone = phone;
    result.phoneRaw = phoneRaw;
  }

  // Hours
  result.hours = extractHours();

  // Price level
  result.priceLevel = extractPriceLevel();

  // Plus Code
  const plusEl = pickDetail(DETAIL_SELECTORS.plusCode);
  result.plusCode = cleanText(plusEl?.innerText || plusEl?.textContent) || null;

  // Claimed status: if "Claim this business" link exists → NOT claimed
  const claimLink = pickDetail(DETAIL_SELECTORS.claimBusiness);
  result.claimed = claimLink ? false : true;

  // Area/locality from address (part after first comma)
  if (result.address) {
    const parts = result.address.split(',');
    if (parts.length > 1) {
      result.area = cleanText(parts[1]) || null;
    }
  }

  return result;
}

/**
 * Performs a full detail-pass on a list of card elements.
 * For each card: clicks it, waits for detail panel, scrapes extra fields, merges into row, goes back.
 *
 * @param {HTMLElement[]} cards - Array of card DOM elements to detail-scrape
 * @param {Object[]} existingRows - The existing harvested rows (keyed by placeId)
 * @param {Object} options
 * @param {Function} options.onProgress - (updatedRow, index, total) callback
 * @param {Function} options.onStateChange - (state) callback
 * @param {Function} options.isPaused - () => bool
 * @param {Function} options.isStopped - () => bool
 */
export async function runDetailPass(cards, existingRows, options = {}) {
  const { onProgress, isPaused, isStopped } = options;
  const rowMap = new Map(existingRows.map(r => [r.placeId, r]));
  const results = [];
  const total = cards.length;

  for (let i = 0; i < total; i++) {
    // Pause/stop checks
    while (isPaused && isPaused()) {
      await new Promise(r => setTimeout(r, 300));
    }
    if (isStopped && isStopped()) break;

    const card = cards[i];
    if (!card) continue;

    try {
      // Click the card link to open the detail panel
      const link = card.querySelector('a.hfpxzc, a[href*="/maps/place/"]') || card;
      link.click();

      // Wait for detail panel to load (look for address or hours section)
      await waitForSelector('div[data-item-id="address"], button[data-item-id^="phone:tel"], button[data-item-id="oloc"], h1.DUwDvf', 5000);
      await sleepJitter(800, 1400);

      // Scrape the detail panel
      const detailData = scrapeDetailPanel();

      // Extract placeId from current URL using canonical extractor
      const currentUrl = window.location.href;
      const { placeId } = extractPlaceIdentifiers(currentUrl);

      // Find matching row and merge
      let targetRow = null;
      if (placeId) {
        targetRow = rowMap.get(placeId);
      }
      if (!targetRow) {
        // Try name match from detail title
        const titleEl = document.querySelector('h1.DUwDvf, h1.fontHeadlineLarge');
        const panelName = cleanText(titleEl?.innerText);
        if (panelName) {
          for (const r of existingRows) {
            if (r.name && (r.name.toLowerCase().startsWith(panelName.toLowerCase().slice(0, 15)) || panelName.toLowerCase().startsWith(r.name.toLowerCase().slice(0, 15)))) {
              targetRow = r;
              break;
            }
          }
        }
      }
      if (!targetRow && existingRows[i]) {
        targetRow = existingRows[i];
      }

      if (targetRow) {
        // Enrich targetRow with higher-fidelity detail pass data
        if (detailData.address) targetRow.address = detailData.address;
        if (detailData.area) targetRow.area = detailData.area;
        if (detailData.phone) {
          targetRow.phone = detailData.phone;
          targetRow.phoneRaw = detailData.phoneRaw;
        }
        if (detailData.website) {
          targetRow.website = detailData.website;
          targetRow.domain = detailData.domain;
        }
        if (detailData.hours) targetRow.hours = detailData.hours;
        if (detailData.priceLevel) targetRow.priceLevel = detailData.priceLevel;
        if (detailData.plusCode) targetRow.plusCode = detailData.plusCode;
        if (typeof detailData.claimed === 'boolean') targetRow.claimed = detailData.claimed;
        results.push(targetRow);

        if (onProgress) onProgress(targetRow, i + 1, total);
      }

      // Navigate back using history API (fastest, no full page reload)
      window.history.back();
      await waitForSelector('div[role="feed"]', 5000);
      await sleepJitter(1000, 2000);

    } catch (err) {
      console.warn(`[AshxScrape DetailParser] Error on card ${i + 1}:`, err.message);
      // Try to recover by going back
      try { window.history.back(); } catch (e) {}
      await sleepJitter(1500, 2500);
    }
  }

  return results;
}
