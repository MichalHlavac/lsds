// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { sql, DB_POOL_MIN } from "./db/client.js";
import { cache } from "./cache/index.js";
import { warmCache } from "./cache/warm.js";
import { warmPool } from "./db/pool-warm.js";
import { logger } from "./logger.js";

const port = Number(process.env["PORT"] ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "LSDS API listening");
  warmPool(sql, DB_POOL_MIN).catch((err) =>
    logger.warn({ err }, "pool warm-up failed")
  );
  warmCache(sql, cache).catch((err) =>
    logger.warn({ err }, "cache warm-up failed")
  );
});
