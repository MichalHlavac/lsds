// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { getMetricsSnapshot } from "../middleware/metrics.js";

export function adminMetricsRouter(): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      uptime: Math.floor(process.uptime()),
      routes: getMetricsSnapshot(),
    });
  });

  return app;
}
