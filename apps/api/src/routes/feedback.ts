// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { FeedbackRow } from "../db/types.js";
import { SubmitFeedbackBodySchema } from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

export function feedbackRouter(sql: Sql): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const body = SubmitFeedbackBodySchema.parse(await c.req.json());

    const [row] = await sql<FeedbackRow[]>`
      INSERT INTO feedback (tenant_id, api_key_id, type, message, metadata)
      VALUES (
        ${tenantId},
        ${apiKeyId},
        ${body.type},
        ${body.message},
        ${body.metadata != null ? jsonb(sql, body.metadata) : null}
      )
      RETURNING *
    `;

    return c.json({
      data: {
        id: row.id,
        type: row.type,
        message: row.message,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
      },
    }, 201);
  });

  return app;
}
