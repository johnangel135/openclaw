'use strict';

const { REDIS_URL } = require('./config');
const { createOptionalRedisClient, prefixedKey } = require('./redis');

function createInMemoryRateLimitStore() {
  const buckets = new Map();

  function cleanup(now) {
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }

  return {
    async consume(key, maxRequests, windowMs, now = Date.now()) {
      if (buckets.size > 10000) cleanup(now);

      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        const resetAt = now + windowMs;
        buckets.set(key, { count: 1, resetAt });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      current.count += 1;
      if (current.count > maxRequests) {
        const retryAfterSeconds = Math.max(Math.ceil((current.resetAt - now) / 1000), 1);
        return { allowed: false, retryAfterSeconds };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function createInMemoryAuthThrottleStore() {
  const attempts = new Map();

  return {
    async get(key) {
      return attempts.get(key) || null;
    },
    async set(key, value) {
      attempts.set(key, value);
    },
    async delete(key) {
      attempts.delete(key);
    },
  };
}

function computeBackoffMs(failureCount, maxFailures, initialBackoffMs, maxBackoffMs) {
  if (failureCount <= maxFailures) return 0;
  const exponent = failureCount - maxFailures - 1;
  const backoff = initialBackoffMs * (2 ** Math.max(exponent, 0));
  return Math.min(backoff, maxBackoffMs);
}

function createRateLimiter({ maxRequests, windowMs, keyFn, store } = {}) {
  const activeStore = store || createInMemoryRateLimitStore();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = keyFn(req);

    Promise.resolve(activeStore.consume(key, maxRequests, windowMs, now))
      .then((result) => {
        if (!result.allowed) {
          res.set('Retry-After', String(result.retryAfterSeconds));
          res.status(429).json({
            error: {
              message: 'Rate limit exceeded',
              code: 'rate_limit_exceeded',
            },
          });
          return;
        }

        next();
      })
      .catch(() => {
        // Fail-open: continue requests on limiter backend errors.
        next();
      });
  };
}

function createAuthThrottle({
  keyFn,
  failureWindowMs = 15 * 60 * 1000,
  maxFailures = 5,
  initialBackoffMs = 1000,
  maxBackoffMs = 10 * 60 * 1000,
  onBlocked,
  store,
} = {}) {
  const activeStore = store || createInMemoryAuthThrottleStore();

  function getFreshRecord(now) {
    return {
      failureCount: 0,
      lockUntil: 0,
      windowExpiresAt: now + failureWindowMs,
    };
  }

  async function getRecord(key, now) {
    const current = await activeStore.get(key);
    if (!current || current.windowExpiresAt <= now) {
      const fresh = getFreshRecord(now);
      await activeStore.set(key, fresh);
      return fresh;
    }
    return current;
  }

  function preflight(req, res, next) {
    const now = Date.now();
    const key = keyFn(req);

    Promise.resolve(getRecord(key, now))
      .then((record) => {
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
      })
      .catch(() => {
        req.authThrottleKey = key;
        next();
      });
  }

  function recordFailure(req) {
    const now = Date.now();
    const key = req.authThrottleKey || keyFn(req);

    Promise.resolve(getRecord(key, now))
      .then((record) => {
        record.failureCount += 1;
        const backoffMs = computeBackoffMs(record.failureCount, maxFailures, initialBackoffMs, maxBackoffMs);
        if (backoffMs > 0) {
          record.lockUntil = now + backoffMs;
        }
        return activeStore.set(key, record);
      })
      .catch(() => {
        // best-effort only
      });
  }

  function recordSuccess(req) {
    const key = req.authThrottleKey || keyFn(req);
    Promise.resolve(activeStore.delete(key)).catch(() => {
      // best-effort only
    });
  }

  return {
    preflight,
    recordFailure,
    recordSuccess,
  };
}

function createRedisRateLimitStore(client) {
  return {
    async consume(key, maxRequests, windowMs) {
      const bucketKey = prefixedKey(`ratelimit:${key}`);
      const tx = client.multi();
      tx.incr(bucketKey);
      tx.pttl(bucketKey);
      const [countRaw, ttlRaw] = await tx.exec();
      const count = Number(countRaw || 0);
      let ttl = Number(ttlRaw || -1);

      if (count === 1 || ttl < 0) {
        await client.pExpire(bucketKey, windowMs);
        ttl = windowMs;
      }

      if (count > maxRequests) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(Math.ceil(ttl / 1000), 1),
        };
      }

      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function createRedisAuthThrottleStore(client) {
  return {
    async get(key) {
      const raw = await client.get(prefixedKey(`auththrottle:${key}`));
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const ttlMs = Math.max(Number(value.windowExpiresAt || 0) - Date.now(), 1000);
      await client.pSetEx(prefixedKey(`auththrottle:${key}`), ttlMs, JSON.stringify(value));
    },
    async delete(key) {
      await client.del(prefixedKey(`auththrottle:${key}`));
    },
  };
}

async function createLimiterDependencies({ logger = console, redisUrl = REDIS_URL, clientFactory } = {}) {
  const redisClient = await createOptionalRedisClient({
    redisUrl,
    clientFactory,
    logger,
    role: 'rate-limit redis',
  });

  if (!redisClient) {
    return {
      mode: 'memory',
      rateLimitStore: createInMemoryRateLimitStore(),
      authThrottleStore: createInMemoryAuthThrottleStore(),
    };
  }

  return {
    mode: 'redis',
    rateLimitStore: createRedisRateLimitStore(redisClient),
    authThrottleStore: createRedisAuthThrottleStore(redisClient),
    redisClient,
  };
}

module.exports = {
  createAuthThrottle,
  createLimiterDependencies,
  createRateLimiter,
  createInMemoryRateLimitStore,
  createInMemoryAuthThrottleStore,
};