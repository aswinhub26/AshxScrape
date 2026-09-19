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
    'button[aria-label*="Address:" i]',
    'button[aria-label*="address" i] .Io6YTe',
    '.rogA2c .Io6YTe'
  ],
  // Website link
  website: [
    'a[data-item-id="authority"] .Io6YTe',
    'a[data-item-id="authority"]',
    'a[aria-label*="website" i] .Io6YTe',
    'a[data-tooltip="Open website"] .Io6YTe',
    'a[data-item-id="web"]'
  ],
  // Strict Phone button/link
  phone: [
    'button[data-item-id^="phone:tel:"]',
    'a[data-item-id^="phone:tel:"]',
    'button[data-item-id*="phone:tel"]',
    'button[data-tooltip="Copy phone number"]',
    'div[data-tooltip="Copy phone number"]',
    'button[aria-label^="Phone:" i]',
    'button[aria-label^="Call:" i]',
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
 */
function extractHours() {
  const table = pickDetail(DETAIL_SELECTORS.hours);
  if (!table) {
    const btn = document.querySelector('button[aria-label*="hours"]');
    if (btn) {
      const aria = btn.getAttribute('aria-label') || '';
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
 * Extracts price level from detail panel
 */
function extractPriceLevel() {
  const el = pickDetail(DETAIL_SELECTORS.priceLevel);
  if (!el) return null;
  const aria = el.getAttribute('aria-label') || el.innerText || '';
  const moneyMatch = aria.match(/(\$+)/);
  if (moneyMatch) return moneyMatch[1];
  if (aria.toLowerCase().includes('inexpensive')) return '$';
  if (aria.toLowerCase().includes('expensive')) return '$$$';
  if (aria.toLowerCase().includes('moderate')) return '$$';
  return cleanText(aria) || null;
}

/**
 * Scrapes all extractable fields from the currently-open place detail panel.
 */
export function scrapeDetailPanel() {
  const result = {};

  // Address
  const addrEl = pickDetail(DETAIL_SELECTORS.address);
  result.address = cleanText(addrEl?.querySelector('.Io6YTe')?.innerText || addrEl?.innerText || addrEl?.textContent || addrEl?.getAttribute('aria-label')?.replace(/^Address:\s*/i, '')) || null;

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

  // Phone: check dedicated business phone element (strictly excluding "Send to phone")
  let rawPhone = null;
  const phoneBtn = pickDetail(DETAIL_SELECTORS.phone) || document.querySelector('button[data-item-id^="phone:tel:"], a[data-item-id^="phone:tel:"], [data-tooltip="Copy phone number"], button[aria-label^="Phone:" i], a[href^="tel:"]');
  if (phoneBtn) {
    rawPhone = phoneBtn.getAttribute('data-item-id')?.replace(/^phone:tel:/, '') ||
               phoneBtn.querySelector('.Io6YTe')?.innerText ||
               phoneBtn.innerText?.replace(/^[^\d+]+/g, '') ||
               phoneBtn.getAttribute('aria-label')?.replace(/^Phone:\s*/i, '') ||
               phoneBtn.href?.replace(/^tel:/, '');
  }

  // Fallback: search .Io6YTe or .rogA2c elements for valid phone numbers
  if (!rawPhone) {
    const ioElements = Array.from(document.querySelectorAll('.Io6YTe, .rogA2c'));
    for (const el of ioElements) {
      const txt = (el.innerText || '').trim();
      if (/^(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}$/.test(txt) && txt.replace(/\D/g, '').length >= 7) {
        rawPhone = txt;
        break;
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
 * For each card: queries live link, clicks it, scrapes extra fields, goes back.
 */
export async function runDetailPass(cards, existingRows, options = {}) {
  const { onProgress, isPaused, isStopped } = options;
  const rowMap = new Map(existingRows.map(r => [r.placeId, r]));
  const results = [];
  const total = existingRows.length;

  for (let i = 0; i < total; i++) {
    // Pause/stop checks
    while (isPaused && isPaused()) {
      await new Promise(r => setTimeout(r, 300));
    }
    if (isStopped && isStopped()) break;

    try {
      // Find live card link from current DOM feed
      const liveFeed = document.querySelector('div[role="feed"]');
      if (!liveFeed) {
        console.warn('[AshxScrape DetailParser] Feed element missing during detail pass.');
        break;
      }
      const links = Array.from(liveFeed.querySelectorAll('a.hfpxzc, div.Nv2PK a[href*="/maps/place/"]'));
      const link = links[i];
      if (!link) {
        console.log(`[AshxScrape DetailParser] No card link found at index ${i}. Reached rendered end.`);
        break;
      }

      link.scrollIntoView({ block: 'center' });
      link.click();

      // Wait for detail panel to load
      await waitForSelector('div[data-item-id="address"], button[data-item-id^="phone:tel:"], button[data-item-id="oloc"], h1.DUwDvf, .DUwDvf', 4000);
      await sleepJitter(600, 1000);

      // Scrape the detail panel
      const detailData = scrapeDetailPanel();

      // Extract placeId from current URL using canonical extractor
      const currentUrl = window.location.href;
      const { placeId } = extractPlaceIdentifiers(currentUrl);

      // Match target row
      let targetRow = null;
      if (placeId) {
        targetRow = rowMap.get(placeId);
      }
      if (!targetRow) {
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

      // Return to feed via Google Maps Back button (fastest and most reliable)
      const backBtn = document.querySelector('button[aria-label*="Back" i], button[jsaction*="pane.back"], button.hYBOP, button[data-tooltip*="Back" i]');
      if (backBtn) {
        backBtn.click();
      } else {
        window.history.back();
      }

      await waitForSelector('div[role="feed"]', 4000);
      await sleepJitter(600, 1000);

    } catch (err) {
      console.warn(`[AshxScrape DetailParser] Error on card ${i + 1}:`, err.message);
      try {
        const backBtn = document.querySelector('button[aria-label*="Back" i], button.hYBOP');
        if (backBtn) backBtn.click(); else window.history.back();
      } catch (e) {}
      await sleepJitter(1000, 1500);
    }
  }

  return results;
}
