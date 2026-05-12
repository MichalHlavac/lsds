// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createMiddleware } from "hono/factory";
import type { Sql } from "../db/client.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { insertAuditLog } from "../db/audit.js";

export interface BucketConfig {
  rpm: number;
  burst: number;
}

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds until 1 token available; 0 when allowed
}

export interface RateLimitStore {
  consume(key: string, cfg: BucketConfig): ConsumeResult;
}

interface Bucket {
  tokens: number;
  lastMs: number;
}

export class InMemoryTokenBucketStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, { rpm, burst }: BucketConfig): ConsumeResult {
    const now = Date.now();
    const refillRate = rpm / 60; // tokens per second

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, lastMs: now };
      this.buckets.set(key, bucket);
    }

    const elapsed = (now - bucket.lastMs) / 1000;
    const refilled = Math.min(bucket.tokens + elapsed * refillRate, burst);
    bucket.lastMs = now;

    if (refilled >= 1) {
      bucket.tokens = refilled - 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfter: 0 };
    }

    bucket.tokens = refilled;
    const retryAfter = Math.ceil((1 - refilled) / refillRate);
    return { allowed: false, remaining: 0, retryAfter };
  }
}

const DEFAULT_RPM = 600;
const DEFAULT_BURST = 60;

// Shared stores — single in-memory instances per process. Injectable via
// function arguments for test isolation.
const sharedStore = new InMemoryTokenBucketStore();
const sharedIpStore = new InMemoryTokenBucketStore();

export function rateLimitMiddleware(sql: Sql, store: RateLimitStore = sharedStore) {
  return createMiddleware(async (c, next) => {
    if (!config.rateLimitEnabled) return next();

    const tenantId =
      (c.get("tenantId") as string | undefined) ?? c.req.header("X-Tenant-Id");
    if (!tenantId) return next();

    const apiKeyId = c.get("apiKeyId") as string | undefined;

    // Fetch tenant defaults + per-key overrides in a single query
    const [row] = await sql<
      [
        {
          tenantRpm: number;
          tenantBurst: number;
          keyRpm: number | null;
          keyBurst: number | null;
        },
      ]
    >`
      SELECT
        t.rate_limit_rpm   AS tenant_rpm,
        t.rate_limit_burst AS tenant_burst,
        k.rate_limit_rpm   AS key_rpm,
        k.rate_limit_burst AS key_burst
      FROM tenants t
      LEFT JOIN api_keys k ON k.id = ${apiKeyId ?? null} AND k.tenant_id = t.id
      WHERE t.id = ${tenantId}
    `;

    const tenantRpm = row?.tenantRpm ?? DEFAULT_RPM;
    const tenantBurst = row?.tenantBurst ?? DEFAULT_BURST;
    const keyRpm = row?.keyRpm ?? tenantRpm;
    const keyBurst = row?.keyBurst ?? tenantBurst;

    const tenantResult = store.consume(`tenant:${tenantId}`, {
      rpm: tenantRpm,
      burst: tenantBurst,
    });
    const keyResult = apiKeyId
      ? store.consume(`key:${apiKeyId}`, { rpm: keyRpm, burst: keyBurst })
      : { allowed: true, remaining: tenantResult.remaining, retryAfter: 0 };

    // Tighter bucket wins
    const allowed = tenantResult.allowed && keyResult.allowed;
    const remaining = Math.min(tenantResult.remaining, keyResult.remaining);
    const retryAfter = Math.max(tenantResult.retryAfter, keyResult.retryAfter);
    const limit = Math.min(tenantBurst, keyBurst);
    const resetAt = Math.ceil(Date.now() / 1000) + 60;

    if (!allowed) {
      // Only audit when we have a verified API key (ensures tenant FK integrity)
      if (apiKeyId) {
        await insertAuditLog(
          sql,
          tenantId,
          apiKeyId,
          "rate_limit_hit",
          "rate_limit",
          tenantId,
          null,
        );
      }

      return c.json(
        { error: "too many requests" },
        429,
        {
          "Retry-After": String(retryAfter || 1),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetAt),
        },
      );
    }

    await next();
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(resetAt));
  });
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Per-IP token bucket applied only to mutating methods (POST/PUT/PATCH/DELETE).
 *  Controlled by RATE_LIMIT_WRITE_RPM env var (default 60 req/min).
 *  Requires X-Forwarded-For to be set by an upstream proxy; skipped otherwise. */
export function ipWriteRateLimitMiddleware(store: RateLimitStore = sharedIpStore) {
  return createMiddleware(async (c, next) => {
    if (!WRITE_METHODS.has(c.req.method)) return next();

    // Extract client IP: trust X-Forwarded-For (set by reverse proxy).
    // Skip limiting when the header is absent — direct connections without a
    // proxy cannot provide a reliable client IP.
    const xff = c.req.header("x-forwarded-for");
    if (!xff) return next();
    const ip = xff.split(",")[0].trim();

    const rpm = config.rateLimitWriteRpm;
    const result = store.consume(`ip:${ip}`, { rpm, burst: rpm });

    if (!result.allowed) {
      logger.warn(
        { ip, method: c.req.method, path: c.req.path },
        "rate limit write hit",
      );
      return c.json(
        { error: "too many requests" },
        429,
        { "Retry-After": String(result.retryAfter || 1) },
      );
    }

    return next();
  });
}
