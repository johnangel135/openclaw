'use strict';

const { initDatabase, closeDatabase } = require('../src/db');
const { syncManagedUsageToStripe } = require('../src/payments');

async function main() {
  const from = process.env.BILLING_SYNC_FROM || undefined;
  const to = process.env.BILLING_SYNC_TO || undefined;
  const dryRun = String(process.env.BILLING_SYNC_DRY_RUN || 'false').toLowerCase() === 'true';

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
  try { await closeDatabase(); } catch {}
  process.exit(1);
});
