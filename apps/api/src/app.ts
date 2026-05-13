// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { logger } from "./logger.js";
import { sql } from "./db/client.js";
import { config } from "./config.js";
import { cache } from "./cache/index.js";
import { GuardrailsRegistry } from "./guardrails/index.js";
import { LifecycleService } from "./lifecycle/index.js";
import { nodesRouter } from "./routes/nodes.js";
import { edgesRouter } from "./routes/edges.js";
import { violationsRouter } from "./routes/violations.js";
import { traversalRouter, queryRouter } from "./routes/traversal.js";
import { guardrailsRouter } from "./routes/guardrails.js";
import { lifecycleRouter } from "./routes/lifecycle.js";
import { usersRouter, teamsRouter } from "./routes/users.js";
import { agentRouter } from "./agent/index.js";
import { architectRouter } from "./agent/architect.js";
import { migrationRouter } from "./agent/migration.js";
import { snapshotsRouter } from "./routes/snapshots.js";
import { layersRouter } from "./routes/layers.js";
import { apiKeysRouter } from "./routes/api-keys.js";
import { importRouter } from "./routes/import.js";
import { exportRouter } from "./routes/export.js";
import { tenantRouter } from "./routes/tenant.js";
import { auditLogRouter } from "./routes/audit-log.js";
import { staleFlagsRouter } from "./routes/stale-flags.js";
import { adminTenantsRouter } from "./routes/admin-tenants.js";
import { adminWebhooksRouter } from "./routes/admin-webhooks.js";
import { adminDiagnosticsRouter } from "./routes/admin-diagnostics.js";
import { adminAuditLogRouter } from "./routes/admin-audit-log.js";
import { adminAuthMiddleware } from "./middleware/admin-auth.js";
import { openApiSpec } from "./openapi.js";
import { apiReference } from "@scalar/hono-api-reference";
import { oidcMiddleware, oidcEnabled } from "./auth/oidc.js";
import { apiKeyMiddleware } from "./auth/api-key.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLoggerMiddleware } from "./middleware/request-logger.js";
import { rateLimitMiddleware, ipWriteRateLimitMiddleware } from "./middleware/rate-limit.js";
import { requestTimeoutMiddleware } from "./middleware/request-timeout.js";
import { createEmbeddingProvider, EmbeddingService } from "./embeddings/index.js";

const PROCESS_START = Date.now();

const guardrails = new GuardrailsRegistry(sql);
const lifecycle = new LifecycleService(sql, cache);

const embeddingProvider = createEmbeddingProvider();
const embeddingService = embeddingProvider ? new EmbeddingService(embeddingProvider, sql) : undefined;

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: config.corsOrigin.includes(",")
      ? config.corsOrigin.split(",").map((o) => o.trim())
      : config.corsOrigin,
    allowHeaders: ["Authorization", "Content-Type", "X-Tenant-Id", "X-Request-Id", "X-Api-Key"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 600,
  })
);

app.use("*", requestIdMiddleware);
app.use("*", requestLoggerMiddleware);
app.use("*", requestTimeoutMiddleware());

app.get("/health/live", (c) => {
  return c.json({ status: "alive", ts: new Date().toISOString() });
});

app.get("/health/ready", async (c) => {
  try {
    await sql`SELECT 1`;
  } catch {
    return c.json({ status: "unavailable", reason: "db" }, 503);
  }
  return c.json({ status: "ready" });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    uptime: Math.floor((Date.now() - PROCESS_START) / 1000),
  });
});

app.use("/v1/*", apiKeyMiddleware(sql));
app.use("/agent/*", apiKeyMiddleware(sql));
app.use("/v1/*", oidcMiddleware);
app.use("/agent/*", oidcMiddleware);
app.use("/v1/*", rateLimitMiddleware(sql));
app.use("/agent/*", rateLimitMiddleware(sql));
app.use("/v1/*", ipWriteRateLimitMiddleware());

const v1 = new Hono();
v1.route("/nodes", nodesRouter(sql, cache, lifecycle, embeddingService, guardrails));
v1.route("/nodes", traversalRouter(sql, cache));
v1.route("/edges", edgesRouter(sql, cache, lifecycle, guardrails));
v1.route("/violations", violationsRouter(sql));
v1.route("/guardrails", guardrailsRouter(sql));
v1.route("/lifecycle", lifecycleRouter(lifecycle, sql));
v1.route("/audit-log", auditLogRouter(sql));
v1.route("/users", usersRouter(sql));
v1.route("/teams", teamsRouter(sql));
v1.route("/query", queryRouter(sql));
v1.route("/snapshots", snapshotsRouter(sql));
v1.route("/layers", layersRouter(sql));
v1.route("/api-keys", apiKeysRouter(sql));
v1.route("/import", importRouter(sql));
v1.route("/export", exportRouter(sql));
v1.route("/tenant", tenantRouter(sql));
v1.route("/stale-flags", staleFlagsRouter(sql));

app.route("/v1", v1);
app.route("/agent/v1", agentRouter(sql, cache, guardrails, lifecycle, embeddingService));
app.route("/agent/v1/architect", architectRouter(sql, guardrails));
app.route("/agent/v1/migration", migrationRouter(sql));

app.get("/api/openapi.json", (c) => c.json(openApiSpec));

app.get(
  "/docs",
  apiReference({
    url: "/api/openapi.json",
  })
);

app.use("/api/admin/*", adminAuthMiddleware);
app.route("/api/admin/tenants", adminTenantsRouter(sql));
app.route("/api/admin/webhooks", adminWebhooksRouter(sql));
app.route("/api/admin/diagnostics", adminDiagnosticsRouter(sql));
app.route("/api/admin/audit-log", adminAuditLogRouter(sql));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof ZodError) return c.json({ error: "validation error", issues: err.issues }, 400);
  const log = c.get("log") ?? logger;
  log.error({ err }, "unhandled error");
  return c.json({ error: "internal server error" }, 500);
});
