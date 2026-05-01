// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import type { NodeRow, MigrationDraftRow } from "../db/types.js";
import { getTenantId, jsonb } from "../routes/util.js";

// Migration Agent API (kap. 6.4) — read-then-write with per-attribute confidence.
// Proposes TKN objects into a draft staging table; a human approves before commit.
// Owner is required on every draft — never creates a node without one.

const LayerEnum = z.enum(["L1", "L2", "L3", "L4", "L5", "L6"]);
const ConfidenceEnum = z.enum(["HIGH", "MEDIUM", "LOW"]);

const ProposeSchema = z.object({
  sessionId: z.string().uuid(),
  sourceRef: z.string().min(1),
  proposedType: z.string().min(1),
  proposedLayer: LayerEnum,
  proposedName: z.string().min(1),
  proposedAttrs: z.record(z.unknown()).optional().default({}),
  confidence: z.record(ConfidenceEnum).optional().default({}),
  owner: z.string().min(1),
});

const ReviewDraftSchema = z.object({
  status: z.enum(["approved", "rejected"]).optional(),
  proposedAttrs: z.record(z.unknown()).optional(),
});

export function migrationRouter(sql: Sql): Hono {
  const app = new Hono();

  // ── POST /migration/propose ──────────────────────────────────────────────────
  // Stage one proposed TKN. Computes review_flags from LOW-confidence attributes.
  app.post("/propose", async (c) => {
    const tenantId = getTenantId(c);
    const body = ProposeSchema.parse(await c.req.json());

    const reviewFlags = Object.entries(body.confidence ?? {})
      .filter(([, v]) => v === "LOW")
      .map(([k]) => k);

    const [draft] = await sql<MigrationDraftRow[]>`
      INSERT INTO migration_drafts (
        tenant_id, session_id, source_ref,
        proposed_type, proposed_layer, proposed_name,
        proposed_attrs, confidence, owner, review_flags
      ) VALUES (
        ${tenantId},
        ${body.sessionId},
        ${body.sourceRef},
        ${body.proposedType},
        ${body.proposedLayer},
        ${body.proposedName},
        ${jsonb(sql, body.proposedAttrs ?? {})},
        ${jsonb(sql, body.confidence as Record<string, unknown>)},
        ${body.owner},
        ${reviewFlags}
      )
      RETURNING *
    `;

    return c.json({ data: draft }, 201);
  });

  // ── GET /migration/sessions/:sessionId ──────────────────────────────────────
  // List all draft proposals for a session with status counts.
  app.get("/sessions/:sessionId", async (c) => {
    const tenantId = getTenantId(c);
    const { sessionId } = c.req.param();

    const drafts = await sql<MigrationDraftRow[]>`
      SELECT * FROM migration_drafts
      WHERE tenant_id = ${tenantId} AND session_id = ${sessionId}
      ORDER BY created_at ASC
    `;

    const total = drafts.length;
    const pending = drafts.filter((d) => d.status === "pending").length;
    const approved = drafts.filter((d) => d.status === "approved").length;
    const rejected = drafts.filter((d) => d.status === "rejected").length;
    const flaggedForReview = drafts.filter((d) => d.reviewFlags.length > 0).length;

    return c.json({
      data: {
        sessionId,
        total,
        pending,
        approved,
        rejected,
        flaggedForReview,
        drafts,
      },
    });
  });

  // ── POST /migration/sessions/:sessionId/commit ───────────────────────────────
  // Commit all approved drafts in the session to the live nodes table.
  // Rejects if any approved draft has an empty owner.
  app.post("/sessions/:sessionId/commit", async (c) => {
    const tenantId = getTenantId(c);
    const { sessionId } = c.req.param();

    const approved = await sql<MigrationDraftRow[]>`
      SELECT * FROM migration_drafts
      WHERE tenant_id = ${tenantId}
        AND session_id = ${sessionId}
        AND status = 'approved'
        AND committed_node_id IS NULL
    `;

    if (approved.length === 0) {
      const [summary] = await sql<{ total: string; alreadyCommitted: string }[]>`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE committed_node_id IS NOT NULL) AS already_committed
        FROM migration_drafts
        WHERE tenant_id = ${tenantId} AND session_id = ${sessionId}
      `;
      const total = Number(summary?.total ?? 0);
      const alreadyCommitted = Number(summary?.alreadyCommitted ?? 0);
      const alreadyCommittedIds = alreadyCommitted > 0
        ? (await sql<{ committedNodeId: string }[]>`
            SELECT committed_node_id FROM migration_drafts
            WHERE tenant_id = ${tenantId}
              AND session_id = ${sessionId}
              AND committed_node_id IS NOT NULL
          `).map((r) => r.committedNodeId)
        : [];
      return c.json({
        data: {
          committed: alreadyCommitted,
          nodeIds: alreadyCommittedIds,
          skipped: total - alreadyCommitted,
          idempotent: alreadyCommitted > 0,
        },
      });
    }

    // Defensive: reject if any approved draft somehow has an empty owner
    const missingOwner = approved.find((d) => !d.owner || d.owner.trim() === "");
    if (missingOwner) {
      return c.json(
        { error: `draft ${missingOwner.id} has no owner — commit rejected` },
        400
      );
    }

    const [all] = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM migration_drafts
      WHERE tenant_id = ${tenantId} AND session_id = ${sessionId}
    `;
    const skipped = Number(all.count) - approved.length;

    const nodeIds: string[] = [];

    await sql.begin(async (tx) => {
      for (const draft of approved) {
        const attrs: Record<string, unknown> = {
          ...(draft.proposedAttrs as Record<string, unknown>),
          owner: draft.owner,
          migratedFrom: draft.sourceRef,
        };

        const [node] = await tx<NodeRow[]>`
          INSERT INTO nodes (tenant_id, type, layer, name, attributes)
          VALUES (
            ${tenantId},
            ${draft.proposedType},
            ${draft.proposedLayer},
            ${draft.proposedName},
            ${jsonb(sql, attrs)}
          )
          RETURNING *
        `;

        await tx`
          UPDATE migration_drafts
          SET committed_node_id = ${node.id}, updated_at = now()
          WHERE id = ${draft.id}
        `;

        nodeIds.push(node.id);
      }
    });

    return c.json({ data: { committed: nodeIds.length, nodeIds, skipped, idempotent: false } });
  });

  // ── PATCH /migration/drafts/:draftId ────────────────────────────────────────
  // Update a draft's status (approved / rejected) or override attributes.
  // Human-review endpoint — transitions: pending → approved | rejected.
  app.patch("/drafts/:draftId", async (c) => {
    const tenantId = getTenantId(c);
    const { draftId } = c.req.param();
    const body = ReviewDraftSchema.parse(await c.req.json());

    const [existing] = await sql<MigrationDraftRow[]>`
      SELECT * FROM migration_drafts
      WHERE id = ${draftId} AND tenant_id = ${tenantId}
    `;
    if (!existing) return c.json({ error: "not found" }, 404);

    if (existing.status !== "pending" && body.status !== undefined) {
      return c.json(
        { error: `draft is already '${existing.status}' — only pending drafts can be reviewed` },
        400
      );
    }

    const newStatus = body.status ?? existing.status;
    const newAttrs =
      body.proposedAttrs !== undefined
        ? body.proposedAttrs
        : (existing.proposedAttrs as Record<string, unknown>);
    const reviewedAt = body.status !== undefined ? new Date() : existing.reviewedAt;

    const [updated] = await sql<MigrationDraftRow[]>`
      UPDATE migration_drafts
      SET
        status         = ${newStatus},
        proposed_attrs = ${jsonb(sql, newAttrs)},
        reviewed_at    = ${reviewedAt},
        updated_at     = now()
      WHERE id = ${draftId} AND tenant_id = ${tenantId}
      RETURNING *
    `;

    return c.json({ data: updated });
  });

  return app;
}
