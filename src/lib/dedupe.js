/**
 * Deduplication and Identifier Extraction
 */

/**
 * Extracts CID and coordinates from Google Maps URLs
 */
export function extractPlaceIdentifiers(url) {
  if (!url) return { placeId: null, latitude: null, longitude: null };

  let placeId = null;
  let latitude = null;
  let longitude = null;

  // 1. CID from !1s0x...:0x<CID>
  const fidMatch = url.match(/!1s(0x[0-9a-fA-F]+):(0x[0-9a-fA-F]+)/);
  if (fidMatch && fidMatch[2]) {
    placeId = fidMatch[2].toLowerCase();
  }

  // 2. CID from query parameter ?cid=12345
  if (!placeId) {
    const cidParam = url.match(/[?&]cid=(\d+)/);
    if (cidParam && cidParam[1]) {
      try {
        placeId = '0x' + BigInt(cidParam[1]).toString(16).toLowerCase();
      } catch (e) {
        placeId = cidParam[1];
      }
    }
  }

  // 3. Exact coordinates from data=!3d<lat>!4d<lng> (Place's exact point)
  const exactCoordMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (exactCoordMatch) {
    latitude = parseFloat(exactCoordMatch[1]);
    longitude = parseFloat(exactCoordMatch[2]);
  } else {
    // Fallback: Viewport center @<lat>,<lng>,<zoom>
    const viewportMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (viewportMatch) {
      latitude = parseFloat(viewportMatch[1]);
      longitude = parseFloat(viewportMatch[2]);
    }
  }

  return { placeId, latitude, longitude };
}

/**
 * Generates a stable fallback dedupe key if placeId is absent
 */
export function generateFallbackKey(name, category, extra = '') {
  const norm = `${name || ''}|${category || ''}|${extra || ''}`.toLowerCase().replace(/\s+/g, '');
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash << 5) - hash + norm.charCodeAt(i);
    hash |= 0;
  }
  return 'hash_' + Math.abs(hash).toString(16);
}

/**
 * In-memory dedupe set manager for scraping jobs
 */
export class DedupeTracker {
  constructor() {
    this.seenIds = new Set();
  }

  /**
   * Checks if an ID has been seen, and marks it as seen if not.
   * Returns true if newly added, false if already seen.
   */
  checkAndAdd(id) {
    if (!id) return false;
    if (this.seenIds.has(id)) {
      return false;
    }
    this.seenIds.add(id);
    return true;
  }

  has(id) {
    return this.seenIds.has(id);
  }

  clear() {
    this.seenIds.clear();
  }

  get size() {
    return this.seenIds.size;
  }
}
