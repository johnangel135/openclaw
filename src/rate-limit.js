'use strict';

function createRateLimiter({ maxRequests, windowMs, keyFn }) {
  const buckets = new Map();

  function cleanup(now) {
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = keyFn(req);

    if (buckets.size > 10000) {
      cleanup(now);
    }

    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      next();
      return;
    }

    current.count += 1;
    if (current.count > maxRequests) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      res.set('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      res.status(429).json({
        error: {
          message: 'Rate limit exceeded',
          code: 'rate_limit_exceeded',
        },
      });
      return;
    }

    next();
  };
}

module.exports = {
  createRateLimiter,
};
