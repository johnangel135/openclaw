'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const { DATABASE_URL, PG_SSL_INSECURE_ALLOW, USER_KEYS_ENCRYPTION_KEY } = require('./config');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const sessions = new Map();
let pool;
let initialized = false;

function getEncryptionKeyBuffer() {
  const key = String(USER_KEYS_ENCRYPTION_KEY || '').trim();
  if (!key) return null;

  const fromHex = /^[a-fA-F0-9]{64}$/.test(key) ? Buffer.from(key, 'hex') : null;
  if (fromHex && fromHex.length === 32) return fromHex;

  try {
    const fromBase64 = Buffer.from(key, 'base64');
    if (fromBase64.length === 32) return fromBase64;
  } catch {
    // ignore invalid base64
  }

  return null;
}

function encryptSecret(plainText) {
  const text = String(plainText || '');
  if (!text) return '';

  const key = getEncryptionKeyBuffer();
  if (!key) return text;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptSecret(cipherText) {
  const text = String(cipherText || '');
  if (!text) return '';
  if (!text.startsWith('enc:v1:')) return text;

  const key = getEncryptionKeyBuffer();
  if (!key) return '';

  const [, , ivB64, tagB64, dataB64] = text.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return '';

  try {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function getPool() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (pool) return pool;

  let ssl = { rejectUnauthorized: !PG_SSL_INSECURE_ALLOW };
  try {
    const parsed = new URL(DATABASE_URL);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isLocal || process.env.PGSSLMODE === 'disable') ssl = false;
  } catch {
    if (process.env.PGSSLMODE === 'disable') ssl = false;
  }

  pool = new Pool({ connectionString: DATABASE_URL, ssl });
  return pool;
}

async function ensureUsersTable() {
  if (initialized) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      api_openai TEXT NOT NULL DEFAULT '',
      api_anthropic TEXT NOT NULL DEFAULT '',
      api_gemini TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  initialized = true;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, digest) {
  const [salt, hash] = String(digest || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function sanitizeUser(row) {
  return {
    id: row.id,
    email: row.email,
    created_at: row.created_at,
  };
}

async function createUser(email, password) {
  await ensureUsersTable();

  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail || !password || String(password).length < 8) {
    throw new Error('Email and password (8+ chars) are required');
  }

  const db = getPool();
  const id = crypto.randomUUID();
  const digest = hashPassword(password);

  try {
    const result = await db.query(
      `
      INSERT INTO user_accounts (id, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, email, created_at
      `,
      [id, safeEmail, digest],
    );
    return sanitizeUser(result.rows[0]);
  } catch (error) {
    if (String(error.message).toLowerCase().includes('unique')) {
      throw new Error('User already exists');
    }
    throw error;
  }
}

async function authenticateUser(email, password) {
  await ensureUsersTable();
  const safeEmail = String(email || '').trim().toLowerCase();
  const db = getPool();
  const result = await db.query(
    'SELECT id, email, password_hash, created_at FROM user_accounts WHERE email = $1 LIMIT 1',
    [safeEmail],
  );

  const row = result.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    return null;
  }

  return sanitizeUser(row);
}

async function getUserApiKeys(userId) {
  await ensureUsersTable();
  const db = getPool();
  const result = await db.query(
    'SELECT api_openai, api_anthropic, api_gemini FROM user_accounts WHERE id = $1 LIMIT 1',
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    openai: decryptSecret(row.api_openai || ''),
    anthropic: decryptSecret(row.api_anthropic || ''),
    gemini: decryptSecret(row.api_gemini || ''),
  };
}

function maskApiKeys(apiKeys) {
  const out = {};
  for (const [provider, value] of Object.entries(apiKeys || {})) {
    if (!value) {
      out[provider] = '';
      continue;
    }
    out[provider] = `${value.slice(0, 4)}...${value.slice(-4)}`;
  }
  return out;
}

async function updateUserApiKeys(userId, updates) {
  await ensureUsersTable();
  const db = getPool();
  await db.query(
    `
    UPDATE user_accounts
    SET
      api_openai = COALESCE($2, api_openai),
      api_anthropic = COALESCE($3, api_anthropic),
      api_gemini = COALESCE($4, api_gemini)
    WHERE id = $1
    `,
    [
      userId,
      typeof updates?.openai === 'string' ? encryptSecret(updates.openai.trim()) : null,
      typeof updates?.anthropic === 'string' ? encryptSecret(updates.anthropic.trim()) : null,
      typeof updates?.gemini === 'string' ? encryptSecret(updates.gemini.trim()) : null,
    ],
  );
  return maskApiKeys(await getUserApiKeys(userId));
}

function parseCookies(req) {
  const header = req.get('cookie') || '';
  const cookies = {};
  for (const chunk of header.split(';')) {
    const [rawKey, ...rawValue] = chunk.trim().split('=');
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rawValue.join('='));
  }
  return cookies;
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.openclaw_session || '';
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session.user || null;
}

function buildSessionCookie(value, maxAgeSeconds) {
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `openclaw_session=${value}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=${maxAgeSeconds}`;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', buildSessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)));
}

function clearSessionCookie(req, res) {
  const token = parseCookies(req).openclaw_session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', buildSessionCookie('', 0));
}

function requireUserSession(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: { message: 'Login required', code: 'unauthorized' } });
    return;
  }
  req.user = user;
  next();
}

module.exports = {
  authenticateUser,
  clearSessionCookie,
  createSession,
  createUser,
  decryptSecret,
  encryptSecret,
  getSessionUser,
  getUserApiKeys,
  maskApiKeys,
  requireUserSession,
  setSessionCookie,
  updateUserApiKeys,
};
