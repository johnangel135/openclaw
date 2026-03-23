'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractUsageFromOpenAI,
  extractUsageFromAnthropic,
  extractUsageFromGemini,
} = require('../src/providers');

test('extractUsageFromOpenAI maps prompt/completion/total tokens', () => {
  const usage = extractUsageFromOpenAI({
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
    },
  });

  assert.deepEqual(usage, {
    input_tokens: 120,
    output_tokens: 30,
    total_tokens: 150,
  });
});

test('extractUsageFromAnthropic maps input/output and computes total', () => {
  const usage = extractUsageFromAnthropic({
    usage: {
      input_tokens: 91,
      output_tokens: 29,
    },
  });

  assert.deepEqual(usage, {
    input_tokens: 91,
    output_tokens: 29,
    total_tokens: 120,
  });
});

test('extractUsageFromGemini maps usageMetadata fields', () => {
  const usage = extractUsageFromGemini({
    usageMetadata: {
      promptTokenCount: 55,
      candidatesTokenCount: 25,
      totalTokenCount: 80,
    },
  });

  assert.deepEqual(usage, {
    input_tokens: 55,
    output_tokens: 25,
    total_tokens: 80,
  });
});
