/**
 * Sliding-window in-memory rate limiter (design §4.5).
 *
 * A distributed store (Redis) can replace this implementation without
 * changing call sites; the middleware contract stays identical.
 */

function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 100,
  keyGenerator = (req) => req.ip,
  onBlocked = () => {},
} = {}) {
  const buckets = new Map();

  // Periodic cleanup prevents unbounded memory growth from dead keys.
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.resetAt > windowMs) buckets.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  interval.unref?.();

  return function rateLimiter(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));

    if (bucket.count > max) {
      onBlocked(req, key);
      return res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
          retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
        },
      });
    }

    next();
  };
}

module.exports = { createRateLimiter };
