// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().default("postgres://lsds:lsds@localhost:5432/lsds"),
    DB_POOL_MAX: z.coerce.number().int().positive().default(20),
    DB_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
    DB_IDLE_TIMEOUT: z.coerce.number().int().positive().default(30),
    DB_ACQUIRE_TIMEOUT: z.coerce.number().int().positive().default(10),
    DB_MAX_LIFETIME: z.coerce.number().int().positive().default(1800),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info"),
    CACHE_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
    CACHE_WARMUP_LIMIT: z.coerce.number().int().positive().default(500),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    LSDS_RATE_LIMIT_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    LSDS_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(600),
    OIDC_ISSUER: z.string().url().optional(),
    OIDC_AUDIENCE: z.string().optional(),
    OIDC_JWKS_URI: z.string().url().optional(),
    EMBEDDING_PROVIDER: z.enum(["disabled", "stub", "openai"]).optional(),
    OPENAI_API_KEY: z.string().optional(),
    LSDS_API_KEY_AUTH_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    PORT: z.coerce.number().int().positive().default(3001),
    LIFECYCLE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  })
  .superRefine((data, ctx) => {
    if (data.EMBEDDING_PROVIDER === "openai" && !data.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai",
        path: ["OPENAI_API_KEY"],
      });
    }
  })
  .transform((data) => ({
    databaseUrl: data.DATABASE_URL,
    dbPoolMax: data.DB_POOL_MAX,
    dbPoolMin: data.DB_POOL_MIN,
    dbIdleTimeout: data.DB_IDLE_TIMEOUT,
    dbAcquireTimeout: data.DB_ACQUIRE_TIMEOUT,
    dbMaxLifetime: data.DB_MAX_LIFETIME,
    logLevel: data.LOG_LEVEL,
    cacheTtlMs: data.CACHE_TTL_MS,
    cacheWarmupLimit: data.CACHE_WARMUP_LIMIT,
    corsOrigin: data.CORS_ORIGIN,
    rateLimitEnabled: data.LSDS_RATE_LIMIT_ENABLED,
    rateLimitRpm: data.LSDS_RATE_LIMIT_RPM,
    oidcIssuer: data.OIDC_ISSUER,
    oidcAudience: data.OIDC_AUDIENCE,
    oidcJwksUri:
      data.OIDC_JWKS_URI ??
      (data.OIDC_ISSUER ? `${data.OIDC_ISSUER}/.well-known/jwks.json` : undefined),
    embeddingProvider: data.EMBEDDING_PROVIDER,
    openaiApiKey: data.OPENAI_API_KEY,
    apiKeyAuthEnabled: data.LSDS_API_KEY_AUTH_ENABLED,
    port: data.PORT,
    lifecycleRetentionDays: data.LIFECYCLE_RETENTION_DAYS,
  }));

function parseConfig() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`[config] Invalid environment configuration:\n${errors}`);
    process.exit(1);
  }
  return result.data;
}

export const config = parseConfig();
