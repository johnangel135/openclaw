'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const { DATABASE_URL } = require('./config');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const sessions = new Map();
let pool;
let initialized = false;

function getPool() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (pool) return pool;

  let ssl = { rejectUnauthorized: false };
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
    openai: row.api_openai || '',
    anthropic: row.api_anthropic || '',
    gemini: row.api_gemini || '',
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
      typeof updates?.openai === 'string' ? updates.openai.trim() : null,
      typeof updates?.anthropic === 'string' ? updates.anthropic.trim() : null,
      typeof updates?.gemini === 'string' ? updates.gemini.trim() : null,
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
  getSessionUser,
  getUserApiKeys,
  maskApiKeys,
  requireUserSession,
  setSessionCookie,
  updateUserApiKeys,
};
