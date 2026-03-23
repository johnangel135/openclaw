'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'db', 'users.json');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const sessions = new Map();

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ users: [] }, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return { users: [] };
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
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

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
  };
}

function createUser(email, password) {
  const safeEmail = String(email || '').trim().toLowerCase();
  if (!safeEmail || !password || String(password).length < 8) {
    throw new Error('Email and password (8+ chars) are required');
  }

  const store = readStore();
  if (store.users.some((user) => user.email === safeEmail)) {
    throw new Error('User already exists');
  }

  const user = {
    id: crypto.randomUUID(),
    email: safeEmail,
    password_hash: hashPassword(password),
    api_keys: {
      openai: '',
      anthropic: '',
      gemini: '',
    },
    created_at: new Date().toISOString(),
  };

  store.users.push(user);
  writeStore(store);
  return sanitizeUser(user);
}

function authenticateUser(email, password) {
  const safeEmail = String(email || '').trim().toLowerCase();
  const store = readStore();
  const user = store.users.find((entry) => entry.email === safeEmail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return null;
  }
  return sanitizeUser(user);
}

function getUserById(userId) {
  const store = readStore();
  const user = store.users.find((entry) => entry.id === userId);
  return user ? sanitizeUser(user) : null;
}

function getUserApiKeys(userId) {
  const store = readStore();
  const user = store.users.find((entry) => entry.id === userId);
  if (!user) return null;
  return {
    openai: user.api_keys?.openai || '',
    anthropic: user.api_keys?.anthropic || '',
    gemini: user.api_keys?.gemini || '',
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

function updateUserApiKeys(userId, updates) {
  const store = readStore();
  const user = store.users.find((entry) => entry.id === userId);
  if (!user) {
    throw new Error('User not found');
  }

  user.api_keys = user.api_keys || {};
  for (const provider of ['openai', 'anthropic', 'gemini']) {
    if (typeof updates?.[provider] === 'string') {
      user.api_keys[provider] = updates[provider].trim();
    }
  }

  writeStore(store);
  return maskApiKeys(user.api_keys);
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

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    userId,
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
  return getUserById(session.userId);
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `openclaw_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function clearSessionCookie(req, res) {
  const token = parseCookies(req).openclaw_session;
  if (token) {
    sessions.delete(token);
  }
  res.setHeader('Set-Cookie', 'openclaw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function requireUserSession(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({
      error: {
        message: 'Login required',
        code: 'unauthorized',
      },
    });
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
