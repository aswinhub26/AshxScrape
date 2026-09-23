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
  { key: 'instagram', label: 'Instagram', source: 'enrich', default: null },
  { key: 'facebook', label: 'Facebook', source: 'enrich', default: null },
  { key: 'linkedin', label: 'LinkedIn', source: 'enrich', default: null },
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

  // Remove prefixes like "Phone:", "Call", "Tel:"
  const cleanedRaw = raw.replace(/^(phone|call|tel)[:\s]*/i, '').trim();

  // Strip non-digit characters except leading '+'
  let cleaned = cleanedRaw.replace(/[^\d+]/g, '');

  // Handle India 10-digit mobile numbers (starting with 6-9) or standard landlines
  if (/^0?[6-9]\d{9}$/.test(cleaned.replace(/^\+/, ''))) {
    const digits = cleaned.replace(/^\+?0?/, '');
    if (digits.length === 10) {
      cleaned = '+91' + digits;
    }
  }

  return {
    phone: cleaned || null,
    phoneRaw: cleanedRaw || raw
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

/**
 * Cleans tracking parameters (utm_*, gclid, fbclid) from URLs
 */
export function cleanUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ref', '_ga'];
    trackingParams.forEach(p => parsed.searchParams.delete(p));
    // If no query params left, clean trailing '?'
    let clean = parsed.toString();
    if (clean.endsWith('?')) clean = clean.slice(0, -1);
    return clean;
  } catch (e) {
    return url;
  }
}

/**
 * Extracts valid business email addresses from text strings or href lists
 */
export function extractEmail(input) {
  if (!input) return null;
  const list = Array.isArray(input) ? input : [input];
  const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/;
  const ignoredDomains = ['sentry.io', 'example.com', 'wixpress.com', 'schema.org', 'domain.com', 'google.com', 'googleapis.com'];
  const ignoredExtensions = /\.(png|jpe?g|webp|gif|svg|css|js|woff2?)$/i;

  for (const item of list) {
    if (!item || typeof item !== 'string') continue;
    
    // Check mailto: links
    if (item.toLowerCase().startsWith('mailto:')) {
      const email = item.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
      if (email && emailRegex.test(email) && !ignoredExtensions.test(email)) {
        const domain = email.split('@')[1];
        if (!ignoredDomains.some(d => domain?.endsWith(d))) {
          return email;
        }
      }
    }

    // Check plaintext regex
    const match = item.match(emailRegex);
    if (match) {
      const email = match[0].trim().toLowerCase();
      if (!ignoredExtensions.test(email)) {
        const domain = email.split('@')[1];
        if (!ignoredDomains.some(d => domain?.endsWith(d))) {
          return email;
        }
      }
    }
  }
  return null;
}

/**
 * Generates direct WhatsApp click-to-chat URL (https://wa.me/<digits>)
 */
export function generateWhatsAppUrl(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;

  // Handle standard Indian 10-digit mobile number prefixing
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    digits = '91' + digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = '91' + digits.slice(1);
  }

  return `https://wa.me/${digits}`;
}

/**
 * Extracts recognized social media profile links from array of URLs or strings
 */
export function extractSocialHandles(urls) {
  const result = { instagram: null, facebook: null, linkedin: null };
  if (!urls) return result;
  const list = Array.isArray(urls) ? urls : [urls];
  for (const item of list) {
    if (!item || typeof item !== 'string') continue;
    const url = item.trim();

    if (!result.instagram && /instagram\.com\/([a-zA-Z0-9._]+)/i.test(url)) {
      const match = url.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
      if (match && !['p', 'reel', 'stories', 'explore', 'about'].includes(match[1].toLowerCase())) {
        result.instagram = 'https://www.instagram.com/' + match[1].replace(/\/$/, '');
      }
    }

    if (!result.facebook && /facebook\.com\/([a-zA-Z0-9._\-]+)/i.test(url)) {
      const match = url.match(/facebook\.com\/([a-zA-Z0-9._\-]+)/i);
      if (match && !['sharer', 'pages', 'groups', 'help', 'login'].includes(match[1].toLowerCase())) {
        result.facebook = 'https://www.facebook.com/' + match[1].replace(/\/$/, '');
      }
    }

    if (!result.linkedin && /linkedin\.com\/(?:company|in)\/([a-zA-Z0-9._\-]+)/i.test(url)) {
      result.linkedin = url.split('?')[0];
    }
  }
  return result;
}


