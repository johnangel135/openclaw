'use strict';

const { getPool } = require('./db');

const REQUEST_STATUS = {
  PENDING: 'pending',
  LEASED: 'leased',
  PROVISIONING: 'provisioning',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const FINAL_STATUSES = new Set([
  REQUEST_STATUS.SUCCEEDED,
  REQUEST_STATUS.FAILED,
  REQUEST_STATUS.CANCELLED,
]);

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function normalizeRecord(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    node_pool_id: row.node_pool_id,
    status: row.status,
    requested_by: row.requested_by,
    worker_id: row.worker_id,
    leased_until: row.leased_until ? new Date(row.leased_until).toISOString() : null,
    payload: row.payload || {},
    result: row.result || {},
    error_code: row.error_code,
    error_message: row.error_message,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  };
}

async function createProvisioningRequest({ nodePoolId, payload = {}, requestedBy = null }) {
  const db = getPool();
  const result = await db.query(
    `
    INSERT INTO node_pool_provisioning_requests (
      node_pool_id,
      status,
      requested_by,
      payload,
      result,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4::jsonb, '{}'::jsonb, NOW(), NOW())
    RETURNING *
    `,
    [nodePoolId, REQUEST_STATUS.PENDING, requestedBy, JSON.stringify(payload || {})],
  );

  return normalizeRecord(result.rows[0]);
}

async function getProvisioningRequestById(requestId) {
  const db = getPool();
  const result = await db.query(
    'SELECT * FROM node_pool_provisioning_requests WHERE id = $1 LIMIT 1',
    [requestId],
  );
  return normalizeRecord(result.rows[0]);
}

async function acquireProvisioningLease({ nodePoolId, workerId, leaseTtlSeconds = 120 }) {
  const db = getPool();
  const leaseSeconds = Math.max(Number.parseInt(leaseTtlSeconds, 10) || 120, 30);

  const result = await db.query(
    `
    WITH candidate AS (
      SELECT id
      FROM node_pool_provisioning_requests
      WHERE node_pool_id = $1
        AND (
          status = $2
          OR (status = $3 AND (leased_until IS NULL OR leased_until < NOW()))
        )
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE node_pool_provisioning_requests r
    SET
      status = $3,
      worker_id = $4,
      leased_until = NOW() + ($5::text || ' seconds')::interval,
      updated_at = NOW()
    FROM candidate
    WHERE r.id = candidate.id
    RETURNING r.*
    `,
    [nodePoolId, REQUEST_STATUS.PENDING, REQUEST_STATUS.LEASED, workerId, String(leaseSeconds)],
  );

  return normalizeRecord(result.rows[0] || null);
}

async function updateProvisioningRequestStatus({ requestId, status, workerId = null, result = null, errorCode = null, errorMessage = null }) {
  const db = getPool();
  const nextStatus = normalizeStatus(status);
  if (!Object.values(REQUEST_STATUS).includes(nextStatus) || nextStatus === REQUEST_STATUS.PENDING) {
    throw new Error('invalid_status');
  }

  const values = [requestId, nextStatus, workerId || null, JSON.stringify(result || {})];
  let where = 'WHERE id = $1';
  let workerFilter = '';
  if (workerId) {
    workerFilter = ' AND worker_id = $3';
  }

  const sql = `
    UPDATE node_pool_provisioning_requests
    SET
      status = $2,
      worker_id = COALESCE($3, worker_id),
      leased_until = CASE WHEN $2 = '${REQUEST_STATUS.LEASED}' THEN leased_until ELSE NULL END,
      result = CASE WHEN jsonb_typeof($4::jsonb) = 'object' THEN result || $4::jsonb ELSE result END,
      error_code = $5,
      error_message = $6,
      completed_at = CASE WHEN $2 IN ('${REQUEST_STATUS.SUCCEEDED}','${REQUEST_STATUS.FAILED}','${REQUEST_STATUS.CANCELLED}') THEN NOW() ELSE completed_at END,
      updated_at = NOW()
    ${where}${workerFilter}
      AND status NOT IN ('${REQUEST_STATUS.SUCCEEDED}', '${REQUEST_STATUS.FAILED}', '${REQUEST_STATUS.CANCELLED}')
    RETURNING *
  `;

  const update = await db.query(sql, [...values, errorCode || null, errorMessage || null]);
  return normalizeRecord(update.rows[0] || null);
}

module.exports = {
  FINAL_STATUSES,
  REQUEST_STATUS,
  acquireProvisioningLease,
  createProvisioningRequest,
  getProvisioningRequestById,
  updateProvisioningRequestStatus,
};
