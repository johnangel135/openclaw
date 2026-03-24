'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAuthThrottle } = require('../src/rate-limit');

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

test('auth throttle applies lockout after repeated failures and clears on success', () => {
  const throttle = createAuthThrottle({
    keyFn: (req) => `${req.body.email}:${req.ip}`,
    maxFailures: 2,
    initialBackoffMs: 60 * 1000,
  });

  const req = makeReq('throttle@example.com');

  for (let i = 0; i < 3; i += 1) {
    const res = makeRes();
    let allowed = false;
    throttle.preflight(req, res, () => {
      allowed = true;
    });
    assert.equal(allowed, true);
    throttle.recordFailure(req);
  }

  const blockedRes = makeRes();
  let blockedAllowed = false;
  throttle.preflight(req, blockedRes, () => {
    blockedAllowed = true;
  });

  assert.equal(blockedAllowed, false);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(blockedRes.body.error.code, 'auth_rate_limited');
  assert.ok(Number(blockedRes.headers['Retry-After']) >= 1);

  throttle.recordSuccess(req);

  const unblockedRes = makeRes();
  let unblocked = false;
  throttle.preflight(req, unblockedRes, () => {
    unblocked = true;
  });

  assert.equal(unblocked, true);
});
