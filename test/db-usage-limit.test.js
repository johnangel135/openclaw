'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadDbWithMockedPool({ usageMaxLimit = '500', rows = [] } = {}) {
  process.env.DATABASE_URL = 'postgres://qa:qa@localhost:5432/qa';
  process.env.USAGE_REQUESTS_MAX_LIMIT = usageMaxLimit;

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/pg-ssl')];
  delete require.cache[require.resolve('../src/db')];

  const pg = require('pg');
  const OriginalPool = pg.Pool;
  let lastQueryArgs = null;

  pg.Pool = class MockPool {
    async query(text, values) {
      lastQueryArgs = { text, values };
      return { rows };
    }
  };

  const db = require('../src/db');

  return {
    db,
    getLastQueryArgs: () => lastQueryArgs,
    restore() {
      pg.Pool = OriginalPool;
      delete require.cache[require.resolve('../src/db')];
      delete require.cache[require.resolve('../src/config')];
    },
  };
}

test('getUsageRequests honors configurable USAGE_REQUESTS_MAX_LIMIT above 100', async () => {
  const { db, getLastQueryArgs, restore } = loadDbWithMockedPool({ usageMaxLimit: '500' });

  try {
    const result = await db.getUsageRequests(null, null, 999, null, null);
    assert.equal(result.limit, 500);

    const query = getLastQueryArgs();
    assert.ok(query);
    assert.equal(query.values[2], 501); // safeLimit + 1 for pagination lookahead
  } finally {
    restore();
  }
});
