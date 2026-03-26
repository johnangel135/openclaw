'use strict';

const { initDatabase, closeDatabase } = require('../src/db');
const { syncManagedUsageToStripe } = require('../src/payments');

function defaultHourlyWindow() {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCMinutes(0, 0, 0);
  const periodStart = new Date(periodEnd.getTime() - 60 * 60 * 1000);
  return { from: periodStart.toISOString(), to: periodEnd.toISOString() };
}

async function main() {
  const providedFrom = process.env.BILLING_SYNC_FROM || '';
  const providedTo = process.env.BILLING_SYNC_TO || '';
  const dryRun = String(process.env.BILLING_SYNC_DRY_RUN || 'false').toLowerCase() === 'true';

  const fallback = defaultHourlyWindow();
  const from = providedFrom || fallback.from;
  const to = providedTo || fallback.to;

  await initDatabase();
  const result = await syncManagedUsageToStripe({ from, to, dryRun });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));

  if (result.statusCode >= 400) {
    process.exitCode = 1;
  }

  await closeDatabase();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  try {
    await closeDatabase();
  } catch (closeError) {
    // eslint-disable-next-line no-console
    console.error('Failed to close database cleanly:', closeError.message);
  }
  process.exit(1);
});
