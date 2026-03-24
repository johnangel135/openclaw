'use strict';

const {
  DATABASE_URL,
  PG_CA_CERT,
  PG_CA_CERT_BASE64,
  PG_SSL_INSECURE_ALLOW,
} = require('./config');

function decodeCaCert() {
  const inline = String(PG_CA_CERT || '').trim();
  if (inline) {
    return inline.replace(/\\n/g, '\n');
  }

  const b64 = String(PG_CA_CERT_BASE64 || '').trim();
  if (!b64) return '';

  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function isLocalDatabaseUrl(value) {
  try {
    const parsed = new URL(value || DATABASE_URL || '');
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function getPgSslConfig(databaseUrl = DATABASE_URL) {
  if (!databaseUrl) return false;

  if (isLocalDatabaseUrl(databaseUrl) || process.env.PGSSLMODE === 'disable') {
    return false;
  }

  if (PG_SSL_INSECURE_ALLOW) {
    return { rejectUnauthorized: false };
  }

  const ca = decodeCaCert();
  if (ca) {
    return {
      rejectUnauthorized: true,
      ca,
    };
  }

  return { rejectUnauthorized: true };
}

module.exports = {
  decodeCaCert,
  getPgSslConfig,
};
