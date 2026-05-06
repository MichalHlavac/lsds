// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createMiddleware } from "hono/factory";
import { logger } from "../logger.js";

export const requestLoggerMiddleware = createMiddleware(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const log = c.get("log") ?? logger;
  const tenantId = c.req.header("X-Tenant-Id");
  const entry: Record<string, unknown> = {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: duration,
  };
  if (tenantId) entry["tenantId"] = tenantId;
  log.info(entry, "request");
});
