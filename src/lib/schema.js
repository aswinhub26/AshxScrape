/**
 * AshxScrape Canonical Data Schema & Field Definitions
 * Single source of truth for all scraped fields across list, detail, and export.
 */

export const FIELD_DEFINITIONS = [
  { key: 'name', label: 'Business Name', source: 'list', default: null },
  { key: 'category', label: 'Category', source: 'list', default: null },
  { key: 'rating', label: 'Rating', source: 'list', default: null },
  { key: 'reviewCount', label: 'Reviews', source: 'list', default: null },
  { key: 'address', label: 'Address', source: 'detail', default: null },
  { key: 'area', label: 'Area / Locality', source: 'detail', default: null },
  { key: 'phone', label: 'Phone', source: 'detail', default: null },
  { key: 'phoneRaw', label: 'Raw Phone', source: 'detail', default: null },
  { key: 'website', label: 'Website', source: 'detail', default: null },
  { key: 'domain', label: 'Domain', source: 'derived', default: null },
  { key: 'hours', label: 'Opening Hours', source: 'detail', default: null },
  { key: 'priceLevel', label: 'Price Level', source: 'detail', default: null },
  { key: 'plusCode', label: 'Plus Code', source: 'detail', default: null },
  { key: 'latitude', label: 'Latitude', source: 'url', default: null },
  { key: 'longitude', label: 'Longitude', source: 'url', default: null },
  { key: 'placeUrl', label: 'Maps URL', source: 'url', default: null },
  { key: 'placeId', label: 'Place CID', source: 'url', default: null },
  { key: 'imageUrl', label: 'Thumbnail', source: 'list', default: null },
  { key: 'claimed', label: 'Claimed', source: 'detail', default: null },
  { key: 'email', label: 'Email', source: 'enrich', default: null },
  { key: 'scrapedAt', label: 'Scraped At', source: 'meta', default: null },
  { key: 'query', label: 'Source Query', source: 'meta', default: null }
];

/**
 * Creates an empty row initialized with schema defaults
 */
export function createEmptyRow(overrides = {}) {
  const row = {};
  for (const field of FIELD_DEFINITIONS) {
    row[field.key] = field.default;
  }
  row.scrapedAt = new Date().toISOString();
  return { ...row, ...overrides };
}

/**
 * Cleans string: trims non-breaking spaces, zero-width spaces, and bullets
 */
export function cleanText(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
    .replace(/\u00A0/g, ' ')               // Non-breaking space to regular space
    .replace(/^[\s·•\-–—|]+|[\s·•\-–—|]+$/g, '') // Trim bullets and leading/trailing separators
    .trim();
  return cleaned || null;
}

/**
 * Normalizes phone numbers (special support for India +91, international prefixes)
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone) return { phone: null, phoneRaw: null };
  const raw = cleanText(rawPhone);
  if (!raw) return { phone: null, phoneRaw: null };

  // Strip non-digit characters except leading '+'
  let cleaned = raw.replace(/[^\d+]/g, '');

  // Handle India 10-digit mobile/landline numbers starting with 0 or no country code
  if (/^0?[6-9]\d{9}$/.test(cleaned.replace(/^\+/, ''))) {
    const digits = cleaned.replace(/^\+?0?/, '');
    if (digits.length === 10) {
      cleaned = '+91' + digits;
    }
  }

  return {
    phone: cleaned,
    phoneRaw: raw
  };
}

/**
 * Extracts domain name from website URL
 */
export function extractDomain(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}
