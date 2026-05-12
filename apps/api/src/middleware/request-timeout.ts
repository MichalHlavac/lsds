// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createMiddleware } from "hono/factory";
import { logger } from "../logger.js";
import { config } from "../config.js";

const EXCLUDED_PATHS = new Set(["/health/live", "/health/ready"]);

export function requestTimeoutMiddleware(timeoutMs = config.requestTimeoutMs) {
  return createMiddleware(async (c, next) => {
    if (EXCLUDED_PATHS.has(c.req.path)) {
      return next();
    }

    const start = Date.now();
    let didTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        didTimeout = true;
        reject(new Error("request timeout"));
      }, timeoutMs);
    });

    try {
      await Promise.race([next(), timeoutPromise]);
    } catch (err) {
      if (didTimeout) {
        const log = c.get("log") ?? logger;
        const tenantId = c.req.header("X-Tenant-Id") ?? c.get("tenantId");
        const entry: Record<string, unknown> = {
          path: c.req.path,
          method: c.req.method,
          durationMs: Date.now() - start,
        };
        if (tenantId) entry["tenantId"] = tenantId;
        log.warn(entry, "request timeout");
        c.res = new Response(JSON.stringify({ error: "request timeout" }), {
          status: 503,
          headers: { "Retry-After": "5", "Content-Type": "application/json" },
        });
        return;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  });
}
