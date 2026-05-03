// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { sql } from "./db/client.js";
import { cache } from "./cache/index.js";
import { warmCache } from "./cache/warm.js";

const port = Number(process.env["PORT"] ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`LSDS API listening on http://localhost:${info.port}`);
  warmCache(sql, cache).catch((err) =>
    console.warn("[cache] warm-up failed:", err)
  );
});
