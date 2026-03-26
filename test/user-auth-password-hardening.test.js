'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function resetModules() {
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/user-auth')];
}

test('authenticateUser returns null (not throw) when stored password hash is malformed', async () => {
  const pg = require('pg');
  const originalPool = pg.Pool;

  pg.Pool = class FakePool {
    async query(sql) {
      if (String(sql).includes('CREATE TABLE')) {
        return { rows: [] };
      }
      return {
        rows: [{ id: 'u-malformed', email: 'bad@example.com', password_hash: 'salt:not-hex', created_at: new Date().toISOString() }],
      };
    }
  };

  try {
    process.env.DATABASE_URL = 'postgres://unit-test';
    resetModules();
    const userAuth = require('../src/user-auth');

    const user = await userAuth.authenticateUser('bad@example.com', 'password123');
    assert.equal(user, null);
  } finally {
    pg.Pool = originalPool;
  }
});
