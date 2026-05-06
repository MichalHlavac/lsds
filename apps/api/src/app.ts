// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { logger } from "./logger.js";
import { sql, DB_POOL_MAX } from "./db/client.js";
import { PostgresTraversalAdapter } from "./db/traversal-adapter.js";
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
import { oidcMiddleware, oidcEnabled } from "./auth/oidc.js";
import { apiKeyMiddleware } from "./auth/api-key.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLoggerMiddleware } from "./middleware/request-logger.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { createEmbeddingProvider, EmbeddingService } from "./embeddings/index.js";

const adapter = new PostgresTraversalAdapter(sql);
const guardrails = new GuardrailsRegistry(sql);
const lifecycle = new LifecycleService(sql, cache);

const embeddingProvider = createEmbeddingProvider();
const embeddingService = embeddingProvider ? new EmbeddingService(embeddingProvider, sql) : undefined;

export const app = new Hono();

const corsOrigin = process.env["CORS_ORIGIN"] ?? "http://localhost:3000";
app.use(
  "*",
  cors({
    origin: corsOrigin.includes(",") ? corsOrigin.split(",").map((o) => o.trim()) : corsOrigin,
    allowHeaders: ["Authorization", "Content-Type", "X-Tenant-Id", "X-Request-Id", "X-Api-Key"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 600,
  })
);

app.use("*", requestIdMiddleware);
app.use("*", requestLoggerMiddleware);

app.get("/health", async (c) => {
  try {
    const [poolRow] = await sql<[{ active: string; idle: string; waiting: string }]>`
      SELECT
        count(*) FILTER (WHERE state != 'idle') AS active,
        count(*) FILTER (WHERE state = 'idle') AS idle,
        count(*) FILTER (WHERE state = 'active' AND wait_event IS NOT NULL) AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = 'lsds-api'
        AND pid != pg_backend_pid()
    `;
    return c.json({
      status: "ok",
      db: "ok",
      pool: {
        size: DB_POOL_MAX,
        active: Number(poolRow.active),
        idle: Number(poolRow.idle),
        waiting: Number(poolRow.waiting),
      },
      ts: new Date().toISOString(),
      oidc: oidcEnabled,
    });
  } catch {
    return c.json({ status: "error", db: "unreachable", ts: new Date().toISOString() }, 503);
  }
});

app.use("/v1/*", apiKeyMiddleware(sql));
app.use("/agent/*", apiKeyMiddleware(sql));
app.use("/v1/*", oidcMiddleware);
app.use("/agent/*", oidcMiddleware);
app.use("/v1/*", rateLimitMiddleware);
app.use("/agent/*", rateLimitMiddleware);

const v1 = new Hono();
v1.route("/nodes", nodesRouter(sql, cache, lifecycle, embeddingService, guardrails));
v1.route("/nodes", traversalRouter(sql, cache, adapter));
v1.route("/edges", edgesRouter(sql, cache, lifecycle, guardrails));
v1.route("/violations", violationsRouter(sql));
v1.route("/guardrails", guardrailsRouter(sql));
v1.route("/lifecycle", lifecycleRouter(lifecycle));
v1.route("/users", usersRouter(sql));
v1.route("/teams", teamsRouter(sql));
v1.route("/query", queryRouter(sql));
v1.route("/snapshots", snapshotsRouter(sql));
v1.route("/layers", layersRouter(sql));
v1.route("/api-keys", apiKeysRouter(sql));

app.route("/v1", v1);
app.route("/agent/v1", agentRouter(sql, cache, guardrails, lifecycle, embeddingService));
app.route("/agent/v1/architect", architectRouter(sql, guardrails));
app.route("/agent/v1/migration", migrationRouter(sql));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof ZodError) return c.json({ error: "validation error", issues: err.issues }, 400);
  const log = c.get("log") ?? logger;
  log.error({ err }, "unhandled error");
  return c.json({ error: "internal server error" }, 500);
});
