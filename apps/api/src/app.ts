// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
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

const adapter = new PostgresTraversalAdapter(sql);
const guardrails = new GuardrailsRegistry(sql);
const lifecycle = new LifecycleService(sql, cache);

export const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }));

const v1 = new Hono();
v1.route("/nodes", nodesRouter(sql, cache));
v1.route("/nodes", traversalRouter(sql, cache, adapter));
v1.route("/edges", edgesRouter(sql, cache));
v1.route("/violations", violationsRouter(sql));
v1.route("/guardrails", guardrailsRouter(sql));
v1.route("/lifecycle", lifecycleRouter(lifecycle));
v1.route("/users", usersRouter(sql));
v1.route("/teams", teamsRouter(sql));
v1.route("/query", queryRouter(sql));

app.route("/v1", v1);
app.route("/agent/v1", agentRouter(sql, cache, adapter, guardrails, lifecycle));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof ZodError) return c.json({ error: "validation error", issues: err.issues }, 400);
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});
