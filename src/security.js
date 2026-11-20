/**
 * In-memory sliding window rate limiter for Cloudflare Workers
 */
const rateLimitMap = new Map();

/**
 * Check if a user is within the rate limit (30 actions per minute)
 *
 * @param {string|number} userId - Telegram User ID
 * @param {number} [limit=30] - Maximum requests per window
 * @param {number} [windowMs=60000] - Window duration in milliseconds (1 minute)
 * @returns {boolean} True if allowed, false if rate limited
 */
export function checkRateLimit(userId, limit = 30, windowMs = 60000) {
  if (!userId) return true;
  const now = Date.now();
  const key = String(userId);
  const timestamps = rateLimitMap.get(key) || [];

  // Remove timestamps outside window
  const activeTimestamps = timestamps.filter((t) => now - t < windowMs);

  if (activeTimestamps.length >= limit) {
    return false;
  }

  activeTimestamps.push(now);
  rateLimitMap.set(key, activeTimestamps);

  // Periodic memory cleanup
  if (rateLimitMap.size > 1000) {
    for (const [k, ts] of rateLimitMap.entries()) {
      if (ts.length === 0 || now - ts[ts.length - 1] > windowMs) {
        rateLimitMap.delete(k);
      }
    }
  }

  return true;
}
