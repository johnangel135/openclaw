'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadModuleWithMockQuery(mockQuery) {
  delete require.cache[require.resolve('../src/db')];
  const db = require('../src/db');
  db.getPool = () => ({ query: mockQuery });

  delete require.cache[require.resolve('../src/node-pool-provisioning')];
  return require('../src/node-pool-provisioning');
}

test('updateProvisioningRequestStatus does not update finalized requests', async () => {
  let capturedSql = '';
  const { updateProvisioningRequestStatus } = loadModuleWithMockQuery(async (sql) => {
    capturedSql = sql;
    return { rows: [] };
  });

  const result = await updateProvisioningRequestStatus({
    requestId: '123',
    status: 'provisioning',
    workerId: 'worker-1',
  });

  assert.equal(result, null);
  assert.match(capturedSql, /status NOT IN \('succeeded', 'failed', 'cancelled'\)/);
});

test('updateProvisioningRequestStatus rejects invalid status before querying db', async () => {
  let called = false;
  const { updateProvisioningRequestStatus } = loadModuleWithMockQuery(async () => {
    called = true;
    return { rows: [] };
  });

  await assert.rejects(
    () => updateProvisioningRequestStatus({ requestId: '123', status: 'pending' }),
    /invalid_status/,
  );

  assert.equal(called, false);
});
