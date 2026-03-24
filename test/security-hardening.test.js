'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadProvidersWithEnv({ providers = '', models = '' } = {}) {
  if (providers) process.env.ALLOWED_LLM_PROVIDERS = providers;
  else delete process.env.ALLOWED_LLM_PROVIDERS;

  if (models) process.env.ALLOWED_LLM_MODELS = models;
  else delete process.env.ALLOWED_LLM_MODELS;

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/providers')];
  return require('../src/providers');
}

function loadUserAuthWithEnv({ key = '' } = {}) {
  if (key) process.env.USER_KEYS_ENCRYPTION_KEY = key;
  else delete process.env.USER_KEYS_ENCRYPTION_KEY;

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/user-auth')];
  return require('../src/user-auth');
}

test('invokeInfer rejects provider outside allowlist', async () => {
  const { invokeInfer } = loadProvidersWithEnv({ providers: 'openai' });

  await assert.rejects(
    invokeInfer({ provider: 'anthropic', model: 'claude-3-5-sonnet-latest', input: 'hi' }),
    (error) => error && error.errorCode === 'provider_not_allowed' && error.statusCode === 403,
  );
});

test('invokeInfer rejects model outside allowlist', async () => {
  const { invokeInfer } = loadProvidersWithEnv({ models: 'gpt-4o-mini' });

  await assert.rejects(
    invokeInfer({ provider: 'openai', model: 'gpt-4o', input: 'hi' }),
    (error) => error && error.errorCode === 'model_not_allowed' && error.statusCode === 403,
  );
});

test('user API key encryption round-trip works with a 32-byte key', () => {
  const keyHex = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  const { encryptSecret, decryptSecret } = loadUserAuthWithEnv({ key: keyHex });

  const encrypted = encryptSecret('sk-test-secret');
  assert.ok(encrypted.startsWith('enc:v1:'));
  assert.equal(decryptSecret(encrypted), 'sk-test-secret');
});

test('plaintext compatibility remains when encryption key is absent', () => {
  const { encryptSecret, decryptSecret } = loadUserAuthWithEnv({ key: '' });

  const stored = encryptSecret('plain-token');
  assert.equal(stored, 'plain-token');
  assert.equal(decryptSecret(stored), 'plain-token');
});

test('usage request pagination limit is clamped to safe max', () => {
  process.env.USAGE_REQUESTS_MAX_LIMIT = '50';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/app')];

  const { parseLimit } = require('../src/app');
  assert.equal(parseLimit('500', 20), 50);
  assert.equal(parseLimit('-1', 20), 1);
  assert.equal(parseLimit('nope', 20), 20);
});
