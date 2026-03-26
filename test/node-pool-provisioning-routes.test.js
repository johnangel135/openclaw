'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

async function loadApp(overrides = {}) {
  process.env.CONSOLE_ADMIN_TOKEN = 'admin-token';
  process.env.DATA_PLANE_SHARED_TOKEN = 'dp-token';
  process.env.DATABASE_URL = 'postgres://not-used';

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/auth')];
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/providers')];
  delete require.cache[require.resolve('../src/rate-limit')];
  delete require.cache[require.resolve('../src/user-auth')];
  delete require.cache[require.resolve('../src/node-pool-provisioning')];
  delete require.cache[require.resolve('../src/app')];

  const provisioning = require('../src/node-pool-provisioning');
  Object.assign(provisioning, overrides);

  const { createApp } = require('../src/app');
  return createApp();
}

test('data plane token is required for provisioning internal routes', async () => {
  const app = await loadApp();

  const response = await request(app)
    .post('/api/internal/node-pools/pool-a/provisioning-requests')
    .send({ payload: { bot: 'b1' } });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'unauthorized');
});

test('creates provisioning request via internal route', async () => {
  const app = await loadApp({
    createProvisioningRequest: async ({ nodePoolId, payload, requestedBy }) => ({
      id: '101',
      node_pool_id: nodePoolId,
      status: 'pending',
      payload,
      requested_by: requestedBy,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  const response = await request(app)
    .post('/api/internal/node-pools/pool-a/provisioning-requests')
    .set('x-data-plane-token', 'dp-token')
    .send({ requested_by: 'cp-test', payload: { bot_name: 'bot-1' } });

  assert.equal(response.status, 201);
  assert.equal(response.body.request.id, '101');
  assert.equal(response.body.request.node_pool_id, 'pool-a');
  assert.equal(response.body.request.payload.bot_name, 'bot-1');
});

test('lease route returns 204 when no pending work', async () => {
  const app = await loadApp({
    acquireProvisioningLease: async () => null,
  });

  const response = await request(app)
    .post('/api/internal/node-pools/pool-a/provisioning-requests/lease')
    .set('x-data-plane-token', 'dp-token')
    .send({ worker_id: 'worker-a', lease_ttl_seconds: 90 });

  assert.equal(response.status, 204);
  assert.equal(response.text, '');
});

test('lease route returns a leased request when available', async () => {
  const app = await loadApp({
    acquireProvisioningLease: async ({ nodePoolId, workerId }) => ({
      id: '102',
      node_pool_id: nodePoolId,
      worker_id: workerId,
      status: 'leased',
      payload: { bot_name: 'bot-2' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  const response = await request(app)
    .post('/api/internal/node-pools/pool-b/provisioning-requests/lease')
    .set('x-data-plane-token', 'dp-token')
    .send({ worker_id: 'worker-b' });

  assert.equal(response.status, 200);
  assert.equal(response.body.request.id, '102');
  assert.equal(response.body.request.worker_id, 'worker-b');
});

test('status update route validates statuses', async () => {
  const app = await loadApp({
    updateProvisioningRequestStatus: async () => {
      throw new Error('invalid_status');
    },
  });

  const response = await request(app)
    .post('/api/internal/provisioning-requests/77/status')
    .set('x-data-plane-token', 'dp-token')
    .send({ worker_id: 'worker-1', status: 'wat' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_status');
});

test('status update route returns updated request', async () => {
  const app = await loadApp({
    updateProvisioningRequestStatus: async ({ requestId, status }) => ({
      id: requestId,
      status,
      node_pool_id: 'pool-z',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }),
  });

  const response = await request(app)
    .post('/api/internal/provisioning-requests/88/status')
    .set('x-data-plane-token', 'dp-token')
    .send({ status: 'succeeded', worker_id: 'worker-z', result: { bot_id: 'bot-88' } });

  assert.equal(response.status, 200);
  assert.equal(response.body.request.id, '88');
  assert.equal(response.body.request.status, 'succeeded');
});
