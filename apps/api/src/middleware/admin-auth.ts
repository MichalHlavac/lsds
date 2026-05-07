// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createMiddleware } from "hono/factory";
import { config } from "../config.js";

const WINDOW_MS = 60_000;
const ADMIN_RPM = 10;
const RETRY_AFTER = "60";

// In-memory sliding window keyed by IP — acceptable for low-volume admin surface.
const windows = new Map<string, number[]>();

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export const adminAuthMiddleware = createMiddleware(async (c, next) => {
  const secret = config.adminSecret;
  if (!secret) return c.json({ error: "unauthorized" }, 401);

  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return c.json({ error: "unauthorized" }, 401);

  const token = auth.slice(7);
  if (token !== secret) return c.json({ error: "unauthorized" }, 401);

  // IP rate limit: 10 req/min per IP (after auth, so bad tokens still count against IP)
  const ip = getClientIp(c.req.raw);
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let timestamps = windows.get(ip);
  if (!timestamps) {
    timestamps = [];
    windows.set(ip, timestamps);
  }

  let i = 0;
  while (i < timestamps.length && (timestamps[i] as number) < cutoff) i++;
  if (i > 0) timestamps.splice(0, i);

  if (timestamps.length >= ADMIN_RPM) {
    return c.json({ error: "too many requests" }, 429, { "Retry-After": RETRY_AFTER });
  }

  timestamps.push(now);
  return next();
});
