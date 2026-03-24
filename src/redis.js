'use strict';

const { REDIS_URL, REDIS_CONNECT_TIMEOUT_MS, REDIS_KEY_PREFIX } = require('./config');

function prefixedKey(key) {
  const prefix = String(REDIS_KEY_PREFIX || '').trim();
  if (!prefix) return key;
  return `${prefix}${key}`;
}

async function createOptionalRedisClient({
  redisUrl = REDIS_URL,
  connectTimeoutMs = REDIS_CONNECT_TIMEOUT_MS,
  clientFactory,
  logger = console,
  role = 'redis',
} = {}) {
  if (!redisUrl) {
    return null;
  }

  let createClientFn = clientFactory;
  if (!createClientFn) {
    ({ createClient: createClientFn } = require('redis'));
  }

  const client = createClientFn({
    url: redisUrl,
    socket: {
      connectTimeout: connectTimeoutMs,
    },
  });

  const onError = (error) => {
    logger.warn?.(`[${role}] runtime error: ${error.message}`);
  };

  try {
    client.on?.('error', onError);
    await client.connect();
    await client.ping();
    logger.info?.(`[${role}] enabled`);
    return client;
  } catch (error) {
    logger.warn?.(`[${role}] unavailable, falling back to in-memory store: ${error.message}`);
    try {
      client.off?.('error', onError);
      await client.quit?.();
    } catch {
      // no-op
    }
    return null;
  }
}

module.exports = {
  createOptionalRedisClient,
  prefixedKey,
};