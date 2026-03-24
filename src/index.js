'use strict';

const { createApp } = require('./app');
const { PORT, USAGE_RETENTION_DAYS } = require('./config');
const { initDatabase, isDatabaseConfigured, startRetentionPurgeScheduler } = require('./db');

let app;

async function bootstrap() {
  app = await createApp();

  if (isDatabaseConfigured()) {
    try {
      await initDatabase();
      startRetentionPurgeScheduler(USAGE_RETENTION_DAYS);
      console.log('Usage database initialized');
    } catch (error) {
      console.error('Failed to initialize usage database:', error.message);
    }
  } else {
    console.warn('DATABASE_URL is not configured; LLM usage tracking endpoints will return 503');
  }

  app.listen(PORT, () => {
    console.log(`🌿 OpenClaw server running on http://localhost:${PORT}`);
  });
}

bootstrap();

module.exports = {
  bootstrap,
  get app() {
    return app;
  },
};