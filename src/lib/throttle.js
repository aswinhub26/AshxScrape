/**
 * Human-like throttling and randomized delays
 */

export const DEFAULT_DELAYS = {
  scrollMin: 900,
  scrollMax: 1800,
  detailMin: 1200,
  detailMax: 2500,
  backMin: 800,
  backMax: 1500
};

/**
 * Returns a randomized jitter delay between min and max ms
 */
export function getJitterDelay(min, max) {
  const actualMin = Math.max(100, min);
  const actualMax = Math.max(actualMin, max);
  const jitter = Math.floor(Math.random() * (actualMax - actualMin + 1));
  return actualMin + jitter;
}

/**
 * Async sleep for specified ms
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sleep with randomized jitter
 */
export async function sleepJitter(min, max) {
  const delay = getJitterDelay(min, max);
  await sleep(delay);
  return delay;
}
