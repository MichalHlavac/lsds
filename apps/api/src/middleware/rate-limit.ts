// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createMiddleware } from "hono/factory";

// In-memory sliding-window store. Single-process only — replace with a shared
// store (e.g. Redis) if the API ever runs as multiple processes.
const windows = new Map<string, number[]>();

const WINDOW_MS = 60_000;
const RETRY_AFTER = "60";

const enabled = process.env["LSDS_RATE_LIMIT_ENABLED"] === "true";
const rpm = Number(process.env["LSDS_RATE_LIMIT_RPM"] ?? 600);

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  if (!enabled) return next();

  const tenantId = c.req.header("X-Tenant-Id");
  // Auth middleware enforces X-Tenant-Id presence on protected routes; skip if absent.
  if (!tenantId) return next();

  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let timestamps = windows.get(tenantId);
  if (!timestamps) {
    timestamps = [];
    windows.set(tenantId, timestamps);
  }

  // Prune timestamps outside the current window.
  let i = 0;
  while (i < timestamps.length && (timestamps[i] as number) < cutoff) i++;
  if (i > 0) timestamps.splice(0, i);

  if (timestamps.length >= rpm) {
    return c.json({ error: "too many requests" }, 429, { "Retry-After": RETRY_AFTER });
  }

  timestamps.push(now);
  return next();
});
