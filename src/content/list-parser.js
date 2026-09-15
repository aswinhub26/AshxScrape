import { SELECTORS, pick } from './selectors.js';
import { createEmptyRow, cleanText, normalizePhone, extractDomain } from '../lib/schema.js';
import { extractPlaceIdentifiers, generateFallbackKey } from '../lib/dedupe.js';

/**
 * Parses a single Google Maps card node into a schema row
 */
export function parseCard(cardEl, query = '') {
  if (!cardEl) return null;

  try {
    const card = cardEl.classList.contains('Nv2PK') ? cardEl : (cardEl.closest('div.Nv2PK') || cardEl);

    // 1. Place Link & Identifiers
    const linkEl = pick(card, SELECTORS.cardLink) || card.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
    const placeUrl = linkEl?.href || null;

    // 2. Business Name
    let name = null;
    const nameEl = pick(card, SELECTORS.cardName);
    if (nameEl) {
      name = cleanText(nameEl.innerText || nameEl.textContent) || nameEl.getAttribute('aria-label') || null;
    }
    if (!name && linkEl) {
      name = cleanText(linkEl.getAttribute('aria-label')) || null;
    }
    if (!name) return null; // An element without a name is not a valid business card

    // 3. Rating & Reviews
    let rating = null;
    let reviewCount = null;

    const ratingEl = pick(card, SELECTORS.cardRatingWrapper);
    if (ratingEl) {
      const aria = ratingEl.getAttribute('aria-label') || ratingEl.innerText || '';
      const rMatch = aria.match(/([0-5][.,]\d)/);
      if (rMatch) {
        rating = parseFloat(rMatch[1].replace(',', '.'));
      }
    }

    const revEl = pick(card, SELECTORS.cardReviews);
    if (revEl) {
      const aria = revEl.getAttribute('aria-label') || revEl.innerText || '';
      const numMatch = aria.match(/\(?([\d,.]+)\)?/);
      if (numMatch && numMatch[1]) {
        const digits = numMatch[1].replace(/[^\d]/g, '');
        if (digits) reviewCount = parseInt(digits, 10);
      }
    }

    // 4. Category & Address snippet from W4Efsd info containers
    let category = null;
    let address = null;

    const infoContainers = card.querySelectorAll('div.W4Efsd');
    for (const div of infoContainers) {
      const text = (div.innerText || '').trim();
      if (!text || text === String(rating)) continue;

      // The line with category often looks like: "Dental clinic · 1st Floor..."
      if (text.includes('·')) {
        const parts = text.split('·').map(s => cleanText(s)).filter(Boolean);
        if (parts.length > 0) {
          // If first part is not rating/reviews, it's category
          if (!category && !/^\d+(\.\d+)?$/.test(parts[0]) && !parts[0].includes('stars')) {
            category = parts[0];
            if (parts.length > 1 && !address) {
              address = parts[1];
            }
          } else if (!address && parts.length > 1) {
            address = parts[1];
          }
        }
      } else if (!category && !/^\d+(\.\d+)?$/.test(text) && !text.includes('stars')) {
        category = cleanText(text);
      }
    }

    // 5. Phone directly visible on card (if rendered)
    const phoneEl = pick(card, SELECTORS.cardPhone);
    const { phone, phoneRaw } = normalizePhone(phoneEl?.innerText || null);

    // 6. Website button/link directly on card (if rendered)
    let website = null;
    let domain = null;
    const webEl = pick(card, SELECTORS.cardWebsite);
    if (webEl && webEl.href && !webEl.href.includes('google.com/maps')) {
      website = webEl.href;
      domain = extractDomain(website);
    }

    // 7. Thumbnail image
    const imgEl = pick(card, SELECTORS.cardImage);
    const imageUrl = imgEl?.src || imgEl?.dataset?.src || null;

    // 8. Place Identifiers & Coordinates
    const { placeId: extractedCid, latitude, longitude } = extractPlaceIdentifiers(placeUrl);
    const placeId = extractedCid || generateFallbackKey(name, category, placeUrl);

    return createEmptyRow({
      name,
      category,
      rating,
      reviewCount,
      address,
      phone,
      phoneRaw,
      website,
      domain,
      latitude,
      longitude,
      placeUrl,
      placeId,
      imageUrl,
      query
    });

  } catch (err) {
    const snippet = cardEl.outerHTML ? cardEl.outerHTML.slice(0, 200) : 'unknown';
    console.warn('[AshxScrape] Error parsing card:', err.message, 'Card snippet:', snippet);
    return null;
  }
}
