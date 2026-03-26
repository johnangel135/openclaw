'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAuthThrottle, createLimiterDependencies, createRateLimiter } = require('../src/rate-limit');

function makeReq(email = 'user@example.com') {
  return {
    body: { email },
    ip: '127.0.0.1',
    get() {
      return '';
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    set(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
    },
  };
}

async function runPreflight(throttle, req) {
  return new Promise((resolve) => {
    const res = makeRes();
    let allowed = false;
    throttle.preflight(req, res, () => {
      allowed = true;
      resolve({ allowed, res });
    });
    setImmediate(() => {
      if (!allowed) resolve({ allowed, res });
    });
  });
}

test('auth throttle applies lockout after repeated failures and clears on success', async () => {
  const throttle = createAuthThrottle({
    keyFn: (req) => `${req.body.email}:${req.ip}`,
    maxFailures: 2,
    initialBackoffMs: 60 * 1000,
  });

  const req = makeReq('throttle@example.com');

  for (let i = 0; i < 3; i += 1) {
    const { allowed } = await runPreflight(throttle, req);
    assert.equal(allowed, true);
    throttle.recordFailure(req);
    await new Promise((resolve) => setImmediate(resolve));
  }

  const blocked = await runPreflight(throttle, req);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.body.error.code, 'auth_rate_limited');
  assert.ok(Number(blocked.res.headers['Retry-After']) >= 1);
  assert.ok(Number(blocked.res.body.error.retry_after_seconds) >= 1);

  throttle.recordSuccess(req);
  await new Promise((resolve) => setImmediate(resolve));

  const unblocked = await runPreflight(throttle, req);
  assert.equal(unblocked.allowed, true);
});

test('createLimiterDependencies falls back to in-memory when redis is unavailable', async () => {
  const deps = await createLimiterDependencies({
    redisUrl: 'redis://127.0.0.1:6399',
    clientFactory: () => ({
      on() {},
      off() {},
      async connect() { throw new Error('connect failed'); },
      async quit() {},
    }),
    logger: { info() {}, warn() {} },
  });

  assert.equal(deps.mode, 'memory');
  assert.ok(deps.rateLimitStore);
  assert.ok(deps.authThrottleStore);
});

test('rate limiter uses redis-backed store when dependency returns redis client', async () => {
  const state = new Map();
  const ttls = new Map();
  const fakeRedis = {
    multi() {
      const commands = [];
      return {
        incr(key) { commands.push(['incr', key]); return this; },
        pttl(key) { commands.push(['pttl', key]); return this; },
        async exec() {
          const key = commands[0][1];
          const next = (state.get(key) || 0) + 1;
          state.set(key, next);
          const ttl = ttls.get(key) || -1;
          return [next, ttl];
        },
      };
    },
    async pExpire(key, ttl) { ttls.set(key, ttl); },
    async pSetEx() {},
    async get() { return null; },
    async del() {},
    on() {},
    off() {},
    async connect() {},
    async ping() {},
  };

  const deps = await createLimiterDependencies({
    redisUrl: 'redis://ok',
    clientFactory: () => fakeRedis,
    logger: { info() {}, warn() {} },
  });

  assert.equal(deps.mode, 'redis');

  const limiter = createRateLimiter({
    maxRequests: 1,
    windowMs: 60_000,
    keyFn: () => 'k1',
    store: deps.rateLimitStore,
  });

  const req = makeReq();
  const first = await new Promise((resolve) => {
    const res = makeRes();
    limiter(req, res, () => resolve({ ok: true, res }));
    setImmediate(() => resolve({ ok: false, res }));
  });
  assert.equal(first.ok, true);

  const second = await new Promise((resolve) => {
    const res = makeRes();
    limiter(req, res, () => resolve({ ok: true, res }));
    setImmediate(() => resolve({ ok: false, res }));
  });
  assert.equal(second.ok, false);
  assert.equal(second.res.statusCode, 429);
  assert.ok(Number(second.res.body.error.retry_after_seconds) >= 1);
});