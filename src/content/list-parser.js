import { SELECTORS, pick } from './selectors.js';
import { createEmptyRow, cleanText, normalizePhone, extractDomain, cleanUrl } from '../lib/schema.js';
import { extractPlaceIdentifiers, generateFallbackKey } from '../lib/dedupe.js';

// Classification helpers for card text tokens
function isRatingOrReview(str) {
  if (!str) return false;
  const s = str.trim();
  if (/^([0-5][.,]\d|\d+)\s*(\([\d,.]+[kKmM+]?\))?$/.test(s)) return true;
  if (/^\([\d,.]+[kKmM+]?\)$/.test(s)) return true;
  if (/^([0-5][.,]\d|\d+)\s*(★|stars?)/i.test(s)) return true;
  if (/\b(stars?|reviews?|no reviews)\b/i.test(s) && (/\d/.test(s) || /no reviews/i.test(s))) return true;
  return false;
}

function isPrice(str) {
  if (!str) return false;
  const s = str.trim();
  if (/^[₹$€£¥\d\s–\-\+.,]+$/.test(s) && /[₹$€£¥]/.test(s)) return true;
  if (/^(\$|₹|€|£|¥)+$/.test(s)) return true;
  if (/^(Inexpensive|Moderate|Moderately expensive|Expensive|Very expensive|Free)$/i.test(s)) return true;
  return false;
}

function isStatusOrHours(str) {
  if (!str) return false;
  const s = str.trim();
  return /^(Open|Closed|Opens|Closes|Temporarily closed|Permanently closed|24 hours)\b/i.test(s);
}

function isServiceOption(str) {
  if (!str) return false;
  const s = str.trim();
  return /^(Dine-in|Takeaway|Delivery|Kerbside pickup|Curbside pickup|No-contact delivery|In-store shopping|In-store pick-up|Drive-through|On-site services|Online appointments|Wheelchair accessible)\b/i.test(s);
}

function isPhone(str) {
  if (!str) return false;
  const s = str.trim();
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  return /^(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}$/.test(s);
}

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

    // 4. Category, Price, Address & Phone from W4Efsd info containers
    let category = null;
    let address = null;
    let priceLevel = null;
    let area = null;
    let rawPhoneCandidate = null;

    const infoContainers = card.querySelectorAll('div.W4Efsd');
    for (const div of infoContainers) {
      const text = (div.innerText || '').trim();
      if (!text || text === String(rating)) continue;

      // Split line by separators (bullets, middle dots, vertical bars)
      const parts = text.split(/[·⋅•|]/).map(s => cleanText(s)).filter(Boolean);
      for (const part of parts) {
        if (isRatingOrReview(part)) {
          continue;
        }
        if (isPrice(part)) {
          if (!priceLevel) priceLevel = part;
          continue;
        }
        if (isStatusOrHours(part)) {
          continue;
        }
        if (isServiceOption(part)) {
          continue;
        }
        if (isPhone(part)) {
          if (!rawPhoneCandidate) rawPhoneCandidate = part;
          continue;
        }

        // Unclassified text: first is Category, second is Address, third is Area
        if (!category) {
          category = part;
        } else if (!address) {
          address = part;
        } else if (!area) {
          area = part;
        }
      }
    }

    // 5. Phone directly visible on card (if rendered)
    if (!rawPhoneCandidate) {
      const phoneEl = pick(card, SELECTORS.cardPhone) || card.querySelector('a[href^="tel:"], button[data-item-id^="phone"], [data-tooltip*="phone" i], span[aria-label*="phone" i]');
      if (phoneEl) {
        rawPhoneCandidate = phoneEl.innerText || phoneEl.textContent || phoneEl.getAttribute('aria-label') || phoneEl.getAttribute('data-tooltip') || phoneEl.href?.replace(/^tel:/, '');
      }
    }

    // Fallback: search text blocks in the card for phone number patterns
    if (!rawPhoneCandidate) {
      const cardFullText = card.innerText || '';
      const phoneMatch = cardFullText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}/);
      if (phoneMatch && phoneMatch[0]) {
        const cleanedCandidate = phoneMatch[0].replace(/[^\d+]/g, '');
        // Validate sensible phone length (7-15 digits) and exclude review count
        if (cleanedCandidate.length >= 7 && cleanedCandidate.length <= 15 && !cardFullText.includes(`(${phoneMatch[0]})`)) {
          rawPhoneCandidate = phoneMatch[0];
        }
      }
    }

    const { phone, phoneRaw } = normalizePhone(rawPhoneCandidate || null);

    // 6. Website button/link directly on card (if rendered)
    let website = null;
    let domain = null;
    const webEl = pick(card, SELECTORS.cardWebsite);
    if (webEl && webEl.href && !webEl.href.includes('google.com/maps')) {
      website = cleanUrl(webEl.href);
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
      area,
      priceLevel,
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
