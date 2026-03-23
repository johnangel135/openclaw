'use strict';

const { CONSOLE_ADMIN_TOKEN } = require('./config');

function extractAdminToken(req) {
  const headerToken = req.get('x-admin-token');
  if (headerToken) {
    return headerToken;
  }

  const authorization = req.get('authorization') || '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  if (typeof req.query.token === 'string' && req.query.token.length > 0) {
    return req.query.token;
  }

  return '';
}

function respondAuthError(req, res, statusCode, message, code) {
  const acceptHeader = req.get('accept') || '';
  const wantsHtml = acceptHeader.includes('text/html');

  if (wantsHtml) {
    res.status(statusCode).send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px"><h1>${statusCode}</h1><p>${message}</p><p><code>${code}</code></p></body></html>`);
    return;
  }

  res.status(statusCode).json({
    error: {
      message,
      code,
    },
  });
}

function requireAdminToken(req, res, next) {
  if (!CONSOLE_ADMIN_TOKEN) {
    respondAuthError(req, res, 503, 'CONSOLE_ADMIN_TOKEN is not configured', 'config_missing_admin_token');
    return;
  }

  const token = extractAdminToken(req);
  if (!token || token !== CONSOLE_ADMIN_TOKEN) {
    respondAuthError(req, res, 401, 'Invalid or missing admin token', 'unauthorized');
    return;
  }

  next();
}

module.exports = {
  extractAdminToken,
  requireAdminToken,
};
