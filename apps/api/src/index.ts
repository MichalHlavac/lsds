// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { sql, DB_POOL_MIN } from "./db/client.js";
import { cache } from "./cache/index.js";
import { warmCache } from "./cache/warm.js";
import { warmPool } from "./db/pool-warm.js";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { runMigrations } from "./db/run-migrations.js";
import { createWebhookDispatcher } from "./webhooks/dispatcher.js";
import { isWebhookEncryptionKeySet } from "./webhooks/crypto.js";

if (config.skipMigrations) {
  logger.info({}, "SKIP_MIGRATIONS=true — skipping startup migration run");
} else {
  try {
    await runMigrations(sql);
  } catch (err) {
    logger.error({ err }, "migrations failed — exiting");
    await sql.end();
    process.exit(1);
  }
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info({ port: info.port }, "LSDS API listening");
  warmPool(sql, DB_POOL_MIN).catch((err) =>
    logger.warn({ err }, "pool warm-up failed")
  );
  warmCache(sql, cache).catch((err) =>
    logger.warn({ err }, "cache warm-up failed")
  );

  if (isWebhookEncryptionKeySet()) {
    const dispatcher = createWebhookDispatcher(sql);
    dispatcher.start();
    logger.info({}, "webhook dispatcher started");
  } else {
    logger.warn({}, "LSDS_WEBHOOK_ENCRYPTION_KEY is not set — webhook subsystem disabled");
  }
});
