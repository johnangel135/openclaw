'use strict';

const crypto = require('crypto');

function hashIdentifier(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'none';
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function logSecurityEvent(eventType, req, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    type: eventType,
    method: req.method,
    path: req.originalUrl || req.url,
    ip: getClientIp(req),
    user_agent: req.get('user-agent') || '',
    ...details,
  };

  console.info('[security]', JSON.stringify(payload));
}

module.exports = {
  hashIdentifier,
  logSecurityEvent,
};
