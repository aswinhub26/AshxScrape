/**
 * AshxScrape Selector Registry & Fallback Chains
 * Config-driven DOM selectors ordered by stability:
 * ARIA roles/attributes -> semantic structure -> data attributes -> text anchors -> obfuscated classes.
 */

export const SELECTORS = {
  // Feed Container
  feed: [
    'div[role="feed"]',
    'div[aria-label^="Results for"]',
    'div[aria-label*="results" i]',
    'div.m6QErb[aria-label]'
  ],

  // Individual Result Card in Feed (searched INSIDE feed)
  card: [
    'div.Nv2PK',
    'div[jsaction*="mouseover"]',
    ':scope > div > div[jsaction]',
    'div[role="article"]',
    'a.hfpxzc'
  ],

  // Business Name inside Card
  cardName: [
    '.qBF1Pd',
    'div.fontHeadlineSmall',
    'div[role="heading"]',
    'a.hfpxzc[aria-label]'
  ],

  // Card Place Link / URL
  cardLink: [
    'a.hfpxzc',
    'a[href*="/maps/place/"]'
  ],

  // Rating Container
  cardRatingWrapper: [
    '.MW4etd',
    'span[aria-label*="star" i]',
    'span[role="img"][aria-label*="star" i]'
  ],

  // Review Count
  cardReviews: [
    '.UY7F9',
    'span[aria-label*="review" i]'
  ],

  // Phone snippet on card
  cardPhone: [
    '.UsdlK',
    'span.UsdlK'
  ],

  // Website button/link directly on card
  cardWebsite: [
    'a[data-value="Website"]',
    'a[aria-label*="website" i]',
    'a[href*="http"]:not([href*="google."])'
  ],

  // Thumbnail Image
  cardImage: [
    'img[src*="googleusercontent.com"]',
    'img[src*="ggpht.com"]',
    'img[decoding="async"]'
  ],

  // Detail Pane Container
  detailPane: [
    'div[role="main"][aria-label]',
    'div.m6QErb.DxyBCb.kA9KIf.dS8AEf',
    'div[role="main"]'
  ],

  // Detail Pane: Phone button/link (strict business contact only)
  detailPhone: [
    'button[data-item-id^="phone:tel:"]',
    'a[data-item-id^="phone:tel:"]',
    'button[data-item-id*="phone:tel"]',
    'button[data-tooltip="Copy phone number"]',
    'div[data-tooltip="Copy phone number"]',
    'button[aria-label^="Phone:" i]',
    'button[aria-label^="Call:" i]',
    'a[href^="tel:"]'
  ],

  // Detail Pane: Website link
  detailWebsite: [
    'a[data-item-id="authority"]',
    'a[aria-label*="website" i]',
    'a[data-tooltip*="website" i]',
    'a[data-item-id="web"]'
  ],

  // Detail Pane: Full Address
  detailAddress: [
    'button[data-item-id="address"]',
    'button[data-item-id*="address"]',
    'button[data-tooltip*="address" i]',
    'button[aria-label*="Address:" i]'
  ],

  // Detail Pane: Plus Code
  detailPlusCode: [
    '[data-item-id^="oloc"]',
    'button[data-item-id="oloc"]',
    'button[aria-label*="Plus code" i]'
  ],

  // Detail Pane: Opening Hours
  detailHours: [
    'div[data-item-id*="opening_hours"]',
    'div[aria-label*="hours" i]',
    'div.t39EBf'
  ],

  // Detail Pane: Claim business button
  detailClaim: [
    'button[data-item-id="merchant"]',
    'a[data-item-id="merchant"]',
    'button[aria-label*="Claim this business" i]',
    'a[aria-label*="Claim this business" i]'
  ],

  // Detail Pane: Back Button
  detailBackButton: [
    'button[aria-label="Back"]',
    'button[aria-label="Back to results"]',
    'button[jsaction*="back"]',
    'button.hYBOP'
  ],

  // End of List Sentinel Indicators
  endSentinel: [
    'span.HlvSq',
    'div.m6QErb.tLzqHg',
    'div.PbZDve'
  ]
};

/**
 * Tries each selector in the chain on the given parent element until one returns a matching element.
 */
export function pick(parent, chain) {
  if (!parent || !chain) return null;
  const root = parent.shadowRoot || parent;
  for (const selector of chain) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch (e) {
      // Invalid selector syntax in chain; skip
    }
  }
  return null;
}

/**
 * Tries each selector in the chain on the given parent element until one returns elements.
 */
export function pickAll(parent, chain) {
  if (!parent || !chain) return [];
  const root = parent.shadowRoot || parent;
  for (const selector of chain) {
    try {
      const els = root.querySelectorAll(selector);
      if (els && els.length > 0) return Array.from(els);
    } catch (e) {
      // Skip
    }
  }
  return [];
}
