'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function resetModules() {
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/redis')];
  delete require.cache[require.resolve('../src/user-auth')];
}

function makeReq(token) {
  return {
    get(name) {
      if (String(name).toLowerCase() === 'cookie') return `openclaw_session=${token}`;
      return '';
    },
  };
}

test('session store defaults to in-memory when REDIS_URL is missing', async () => {
  delete process.env.REDIS_URL;
  resetModules();
  const userAuth = require('../src/user-auth');

  const result = await userAuth.initSessionStore({ logger: { info() {}, warn() {} } });
  assert.equal(result.mode, 'memory');

  const token = await userAuth.createSession({ id: 'u1', email: 'u1@example.com' });
  const user = await userAuth.getSessionUser(makeReq(token));
  assert.equal(user.email, 'u1@example.com');
});

test('session store uses redis when available', async () => {
  const map = new Map();
  const fakeRedis = {
    on() {},
    off() {},
    async connect() {},
    async ping() {},
    async pSetEx(key, ttlMs, value) {
      map.set(key, value);
      this.lastTtl = ttlMs;
    },
    async get(key) {
      return map.get(key) || null;
    },
    async del(key) {
      map.delete(key);
    },
  };

  process.env.REDIS_URL = 'redis://ok';
  resetModules();
  const userAuth = require('../src/user-auth');

  const result = await userAuth.initSessionStore({
    redisUrl: 'redis://ok',
    clientFactory: () => fakeRedis,
    logger: { info() {}, warn() {} },
  });
  assert.equal(result.mode, 'redis');

  const token = await userAuth.createSession({ id: 'u2', email: 'u2@example.com' });
  const user = await userAuth.getSessionUser(makeReq(token));
  assert.equal(user.id, 'u2');
  assert.ok(fakeRedis.lastTtl > 0);
});

test('session store gracefully falls back when redis connect fails', async () => {
  process.env.REDIS_URL = 'redis://bad';
  resetModules();
  const userAuth = require('../src/user-auth');

  const result = await userAuth.initSessionStore({
    redisUrl: 'redis://bad',
    clientFactory: () => ({
      on() {},
      off() {},
      async connect() { throw new Error('down'); },
      async quit() {},
    }),
    logger: { info() {}, warn() {} },
  });

  assert.equal(result.mode, 'memory');
  const token = await userAuth.createSession({ id: 'u3', email: 'u3@example.com' });
  const user = await userAuth.getSessionUser(makeReq(token));
  assert.equal(user.id, 'u3');
});