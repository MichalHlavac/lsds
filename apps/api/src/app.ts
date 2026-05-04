// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { logger } from "./logger.js";
import { sql } from "./db/client.js";
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
import { oidcMiddleware, oidcEnabled } from "./auth/oidc.js";
import { requestIdMiddleware } from "./middleware/request-id.js";

const adapter = new PostgresTraversalAdapter(sql);
const guardrails = new GuardrailsRegistry(sql);
const lifecycle = new LifecycleService(sql, cache);

export const app = new Hono();

const corsOrigin = process.env["CORS_ORIGIN"] ?? "http://localhost:3000";
app.use(
  "*",
  cors({
    origin: corsOrigin.includes(",") ? corsOrigin.split(",").map((o) => o.trim()) : corsOrigin,
    allowHeaders: ["Authorization", "Content-Type", "X-Tenant-Id", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 600,
  })
);

app.use("*", requestIdMiddleware);

app.get("/health", async (c) => {
  try {
    await sql`SELECT 1`;
    return c.json({ status: "ok", db: "ok", ts: new Date().toISOString(), oidc: oidcEnabled });
  } catch {
    return c.json({ status: "error", db: "unreachable", ts: new Date().toISOString() }, 503);
  }
});

app.use("/v1/*", oidcMiddleware);
app.use("/agent/*", oidcMiddleware);

const v1 = new Hono();
v1.route("/nodes", nodesRouter(sql, cache, lifecycle));
v1.route("/nodes", traversalRouter(sql, cache, adapter));
v1.route("/edges", edgesRouter(sql, cache, lifecycle));
v1.route("/violations", violationsRouter(sql));
v1.route("/guardrails", guardrailsRouter(sql));
v1.route("/lifecycle", lifecycleRouter(lifecycle));
v1.route("/users", usersRouter(sql));
v1.route("/teams", teamsRouter(sql));
v1.route("/query", queryRouter(sql));
v1.route("/snapshots", snapshotsRouter(sql));
v1.route("/layers", layersRouter(sql));

app.route("/v1", v1);
app.route("/agent/v1", agentRouter(sql, cache, guardrails, lifecycle));
app.route("/agent/v1/architect", architectRouter(sql, guardrails));
app.route("/agent/v1/migration", migrationRouter(sql));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof ZodError) return c.json({ error: "validation error", issues: err.issues }, 400);
  const log = c.get("log") ?? logger;
  log.error({ err }, "unhandled error");
  return c.json({ error: "internal server error" }, 500);
});
