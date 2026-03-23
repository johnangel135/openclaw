'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateEstimatedCost } = require('../src/db');

test('calculateEstimatedCost computes cost using per-million rates', () => {
  const estimated = calculateEstimatedCost(20000, 5000, {
    input_cost_per_million_usd: 0.15,
    output_cost_per_million_usd: 0.6,
  });

  // ((20000 * 0.15) + (5000 * 0.6)) / 1_000_000 = 0.006
  assert.equal(estimated, 0.006);
});

test('calculateEstimatedCost returns zero when pricing row is missing', () => {
  assert.equal(calculateEstimatedCost(100, 200, null), 0);
});
