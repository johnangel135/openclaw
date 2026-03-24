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

function createAuthThrottle({
  keyFn,
  failureWindowMs = 15 * 60 * 1000,
  maxFailures = 5,
  initialBackoffMs = 1000,
  maxBackoffMs = 10 * 60 * 1000,
  onBlocked,
} = {}) {
  const attempts = new Map();

  function computeBackoffMs(failureCount) {
    if (failureCount <= maxFailures) return 0;
    const exponent = failureCount - maxFailures - 1;
    const backoff = initialBackoffMs * (2 ** Math.max(exponent, 0));
    return Math.min(backoff, maxBackoffMs);
  }

  function getRecord(key, now) {
    const current = attempts.get(key);
    if (!current || current.windowExpiresAt <= now) {
      const fresh = {
        failureCount: 0,
        lockUntil: 0,
        windowExpiresAt: now + failureWindowMs,
      };
      attempts.set(key, fresh);
      return fresh;
    }
    return current;
  }

  function preflight(req, res, next) {
    const now = Date.now();
    const key = keyFn(req);
    const record = getRecord(key, now);

    if (record.lockUntil > now) {
      const retryAfterSeconds = Math.ceil((record.lockUntil - now) / 1000);
      res.set('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      if (typeof onBlocked === 'function') {
        onBlocked(req, retryAfterSeconds);
      }
      res.status(429).json({
        error: {
          message: 'Too many authentication attempts. Please retry later.',
          code: 'auth_rate_limited',
        },
      });
      return;
    }

    req.authThrottleKey = key;
    next();
  }

  function recordFailure(req) {
    const now = Date.now();
    const key = req.authThrottleKey || keyFn(req);
    const record = getRecord(key, now);

    record.failureCount += 1;
    const backoffMs = computeBackoffMs(record.failureCount);
    if (backoffMs > 0) {
      record.lockUntil = now + backoffMs;
    }
  }

  function recordSuccess(req) {
    const key = req.authThrottleKey || keyFn(req);
    attempts.delete(key);
  }

  return {
    preflight,
    recordFailure,
    recordSuccess,
  };
}

module.exports = {
  createRateLimiter,
  createAuthThrottle,
};
