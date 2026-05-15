// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import type { EmbeddingService } from "../embeddings/index.js";

const BackfillBodySchema = z.object({
  tenantId: z.string().uuid().optional(),
  batchSize: z.number().int().min(1).max(500).default(100),
  onlyMissing: z.boolean().default(true),
});

interface NodeBackfillRow {
  id: string;
  tenant_id: string;
  type: string;
  layer: string;
  name: string;
  attributes: Record<string, unknown>;
}

export function adminEmbeddingsRouter(
  sql: Sql,
  embeddingService: EmbeddingService | undefined
): Hono {
  const app = new Hono();

  app.post("/backfill", async (c) => {
    if (!embeddingService) {
      return c.json({ error: "embedding provider is disabled" }, 422);
    }

    const rawBody = await c.req.json().catch(() => ({}));
    const parsed = BackfillBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: "validation error", issues: parsed.error.issues }, 400);
    }

    const { tenantId, batchSize, onlyMissing } = parsed.data;

    const missingFilter = onlyMissing ? sql`AND embedding IS NULL` : sql``;
    const tenantFilter = tenantId ? sql`AND tenant_id = ${tenantId}` : sql``;

    const nodes = await sql<NodeBackfillRow[]>`
      SELECT id, tenant_id, type, layer, name, attributes
      FROM nodes
      WHERE true ${missingFilter} ${tenantFilter}
      LIMIT ${batchSize}
    `;

    for (const node of nodes) {
      const text = embeddingService.nodeText({
        type: node.type,
        layer: node.layer,
        name: node.name,
        attributes: node.attributes,
      });
      embeddingService.embedNodeAsync(node.tenant_id, node.id, text);
    }

    const result: { queued: number; tenantId?: string } = { queued: nodes.length };
    if (tenantId) result.tenantId = tenantId;

    return c.json({ data: result });
  });

  return app;
}
