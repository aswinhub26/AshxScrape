import { SELECTORS, pick, pickAll } from './selectors.js';
import { parseCard } from './list-parser.js';
import { DedupeTracker } from '../lib/dedupe.js';
import { sleepJitter, DEFAULT_DELAYS } from '../lib/throttle.js';
import { JOB_STATE } from '../shared/messages.js';

export class FeedScroller {
  constructor(options = {}) {
    this.maxResults = options.maxResults || 200;
    this.delays = { ...DEFAULT_DELAYS, ...(options.delays || {}) };
    this.query = options.query || '';
    
    // Callbacks
    this.onRowCollected = options.onRowCollected || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});

    this.state = JOB_STATE.IDLE;
    this.dedupe = new DedupeTracker();
    this.observer = null;
    this.feedEl = null;
    this.collectedRows = [];
  }

  /**
   * Locates the scrollable Google Maps results feed container
   */
  findFeed() {
    return pick(document, SELECTORS.feed);
  }

  /**
   * Checks if the end of list sentinel is displayed in DOM
   */
  isEndOfList() {
    if (!this.feedEl) return false;

    // Check sentinel elements in fallback chain
    for (const selector of SELECTORS.endSentinel) {
      const sentinel = this.feedEl.querySelector(selector);
      if (sentinel && sentinel.offsetParent !== null) {
        return true;
      }
    }

    // Check text match case-insensitively
    const feedText = this.feedEl.innerText || '';
    if (
      feedText.includes("You've reached the end of the list") ||
      feedText.includes("reached the end of the list") ||
      feedText.includes("No more results")
    ) {
      return true;
    }

    return false;
  }

  /**
   * Scans currently rendered card elements in feed and extracts unseen items
   */
  harvestCurrentCards() {
    if (!this.feedEl) {
      console.log('[MapHarvest] harvestCurrentCards: feedEl is null!');
      return [];
    }

    const cards = pickAll(this.feedEl, SELECTORS.card);
    console.log('[MapHarvest] harvestCurrentCards: cards found by selector =', cards.length);
    const newlyHarvested = [];

    for (const card of cards) {
      const row = parseCard(card, this.query);
      if (!row) {
        console.log('[MapHarvest] parseCard returned null for card:', card.tagName, card.className);
        continue;
      }
      if (!row.placeId) {
        console.log('[MapHarvest] row has no placeId:', row.name);
        continue;
      }
      const isNew = this.dedupe.checkAndAdd(row.placeId);
      if (isNew) {
        this.collectedRows.push(row);
        newlyHarvested.push(row);
        console.log('[MapHarvest] Harvested row #' + this.collectedRows.length + ':', row.name, '| CID:', row.placeId);
        this.onRowCollected(row, this.collectedRows.length);

        if (this.collectedRows.length >= this.maxResults) {
          return newlyHarvested;
        }
      }
    }

    console.log('[MapHarvest] newlyHarvested count =', newlyHarvested.length, 'total collected =', this.collectedRows.length);
    return newlyHarvested;
  }

  /**
   * Starts auto-scroll loop
   */
  async start() {
    this.feedEl = this.findFeed();
    if (!this.feedEl) {
      const err = new Error('Results feed element (div[role="feed"]) not found on page.');
      this.onError(err);
      return;
    }

    this.state = JOB_STATE.SCROLLING;
    this.onStatusChange(this.state, 'Starting feed auto-scroll...');

    // Set up MutationObserver to capture dynamically mounted card nodes immediately
    this.observer = new MutationObserver(() => {
      if (this.state === JOB_STATE.SCROLLING) {
        this.harvestCurrentCards();
      }
    });
    this.observer.observe(this.feedEl, { childList: true, subtree: true });

    // Initial pass on existing cards
    this.harvestCurrentCards();

    let consecutiveStalls = 0;
    let consecutiveBottoms = 0;

    try {
      while (this.state === JOB_STATE.SCROLLING) {
        // Condition 1: Max results limit hit
        if (this.collectedRows.length >= this.maxResults) {
          console.log(`[MapHarvest] Reached max results cap (${this.maxResults}). Stopping.`);
          break;
        }

        // Condition 2: End-of-list sentinel appears
        if (this.isEndOfList()) {
          console.log('[MapHarvest] End of list sentinel reached.');
          break;
        }

        // Target last card and scroll it into view to trigger Google Maps virtual loader
        const renderedCards = pickAll(this.feedEl, SELECTORS.card);
        if (renderedCards.length > 0) {
          const lastRenderedCard = renderedCards[renderedCards.length - 1];
          try {
            lastRenderedCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
          } catch (e) {}
        }

        // Also scroll the feed element directly
        const clientH = this.feedEl.clientHeight || 600;
        const scrollHeight = this.feedEl.scrollHeight;
        this.feedEl.scrollTop += clientH * 0.85;

        // Dispatch synthetic scroll and wheel events to trigger Google Maps lazy loading handlers
        this.feedEl.dispatchEvent(new Event('scroll', { bubbles: true }));
        this.feedEl.dispatchEvent(new CustomEvent('scroll'));

        // Condition 3: Bottom reached check (stable across 6 consecutive checks with extra wait)
        if (this.feedEl.scrollTop + clientH >= scrollHeight - 30) {
          consecutiveBottoms++;
          // Give Google Maps time to fetch next batch
          await sleepJitter(1200, 2000);
          if (consecutiveBottoms >= 6) {
            console.log('[MapHarvest] Reached bottom of scroll container across 6 cycles.');
            break;
          }
        } else {
          consecutiveBottoms = 0;
        }

        // Wait with human-like jitter
        await sleepJitter(this.delays.scrollMin, this.delays.scrollMax);

        // Harvest newly visible cards after scroll
        const newCards = this.harvestCurrentCards();

        // Condition 4: Stall detector (no new cards for 8 consecutive cycles)
        if (newCards.length === 0) {
          consecutiveStalls++;
          if (consecutiveStalls >= 8) {
            console.log('[MapHarvest] No new places found after 8 scroll cycles. Ending search.');
            break;
          }
        } else {
          consecutiveStalls = 0;
        }
      }

    } catch (err) {
      console.error('[MapHarvest] Scroller error:', err);
      this.onError(err);
    } finally {
      this.stop();
    }
  }

  pause() {
    if (this.state === JOB_STATE.SCROLLING) {
      this.state = JOB_STATE.PAUSED;
      this.onStatusChange(this.state, 'Scraping paused by user.');
    }
  }

  resume() {
    if (this.state === JOB_STATE.PAUSED) {
      this.state = JOB_STATE.SCROLLING;
      this.onStatusChange(this.state, 'Resuming scrape...');
      this.start();
    }
  }

  stop() {
    const wasActive = this.state === JOB_STATE.SCROLLING || this.state === JOB_STATE.PAUSED;
    this.state = JOB_STATE.DONE;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (wasActive) {
      this.onStatusChange(this.state, `Finished. Collected ${this.collectedRows.length} unique places.`);
      this.onComplete(this.collectedRows);
    }
  }
}
