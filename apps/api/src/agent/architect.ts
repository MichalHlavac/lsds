// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { GuardrailsRegistry } from "../guardrails/index.js";
import { getTenantId } from "../routes/util.js";
import { AgentAnalyzeSchema, ClassifyChangeSchema, ImpactPredictSchema } from "../routes/schemas.js";
import {
  analyzeNodes,
  analyzeChange,
  consistencyScan,
  driftAnalysis,
  debtAggregation,
  adrCoverageAnalysis,
  impactPredict,
  requirementsFulfillment,
  requirementFulfillmentScan,
  SnapshotNotFoundError,
} from "./architect-analysis.js";

// Architect Agent API (kap. 6.3) — aggregated graph views for architectural
// analysis. All endpoints work on the full tenant graph, not individual nodes.

export function architectRouter(sql: Sql, guardrails: GuardrailsRegistry): Hono {
  const app = new Hono();

  // ── Bulk drift scan (kap. 5) ────────────────────────────────────────────────
  // Body (all optional): { persist, types[], layers[], lifecycleStatuses[], sampleLimit }
  // Default scope: every node not in ARCHIVED/PURGE.
  app.post("/analyze", async (c) => {
    const tenantId = getTenantId(c);
    const body = AgentAnalyzeSchema.parse(await c.req.json().catch(() => ({})));
    const data = await analyzeNodes(sql, guardrails, tenantId, body);
    return c.json({ data });
  });

  // ── Consistency scan ────────────────────────────────────────────────────────
  // Traverses the entire knowledge graph and surfaces structural violation
  // patterns. Returns grouped findings — not flat object lists.
  app.get("/consistency", async (c) => {
    const tenantId = getTenantId(c);
    const data = await consistencyScan(sql, tenantId);
    return c.json({ data });
  });

  // ── Drift detection ─────────────────────────────────────────────────────────
  // Compares current graph state against the most recent (or a named) snapshot.
  // ?snapshotId=<uuid>  — compare against a specific snapshot (default: latest)
  app.get("/drift", async (c) => {
    const tenantId = getTenantId(c);
    const snapshotId = c.req.query("snapshotId");
    try {
      const data = await driftAnalysis(sql, tenantId, snapshotId);
      return c.json({ data });
    } catch (e) {
      if (e instanceof SnapshotNotFoundError) {
        return c.json({ error: "snapshot not found" }, 404);
      }
      throw e;
    }
  });

  // ── Debt aggregation ────────────────────────────────────────────────────────
  // Aggregates TechnicalDebt objects and surfaces systemic patterns.
  // Returns grouped summaries; call /agent/v1/search?type=TechnicalDebt for items.
  app.get("/debt", async (c) => {
    const tenantId = getTenantId(c);
    const data = await debtAggregation(sql, tenantId);
    return c.json({ data });
  });

  // ── ADR coverage heuristic ──────────────────────────────────────────────────
  // Detects structurally significant nodes with many edges but no linked ADR.
  // ?minEdges=<n>  — edge-count threshold to flag a node (default 5)
  app.get("/adr-coverage", async (c) => {
    const tenantId = getTenantId(c);
    const minEdges = Math.max(1, Number(c.req.query("minEdges") ?? 5));
    const data = await adrCoverageAnalysis(sql, tenantId, minEdges);
    return c.json({ data });
  });

  // ── Requirement fulfillment ─────────────────────────────────────────────────
  // Checks all Requirements against their implementation state.
  // Classification: fulfilled (IMPLEMENTED), in_progress (IN_PROGRESS or APPROVED+linked),
  // unfulfilled (APPROVED+no links), obsolete (OBSOLETE).
  app.get("/requirements", async (c) => {
    const tenantId = getTenantId(c);
    const data = await requirementsFulfillment(sql, tenantId);
    return c.json({ data });
  });

  // ── Pre-change impact analysis ──────────────────────────────────────────────
  // Simulates a proposed node/edge change in-memory, traverses neighbors up to
  // maxDepth, runs guardrails against the proposed state, and flags L1/L2 blast
  // radius per ADR A4 layer-dependent policy. Never writes to DB.
  app.post("/impact-predict", async (c) => {
    const tenantId = getTenantId(c);
    const body = ImpactPredictSchema.parse(await c.req.json());
    const data = await impactPredict(sql, guardrails, tenantId, body);
    if (data === null) return c.json({ error: "node not found" }, 404);
    return c.json({ data });
  });

  // ── Requirement fulfillment gap scan (kap. 6.3 cap. 4/4) ───────────────────
  // Focused scan: APPROVED requirements only. Checks node_history for mutations
  // on linked neighbor nodes since approval. Surfaces requirements with no
  // post-approval graph work ("gap"). Returns gaps[] for easy triage.
  app.get("/requirement-fulfillment", async (c) => {
    const tenantId = getTenantId(c);
    const data = await requirementFulfillmentScan(sql, tenantId);
    return c.json({ data });
  });

  // ── Change classification (ADR A4) ──────────────────────────────────────────
  // Classifies a proposed change (diff / file-path list / node types / node IDs)
  // into L1–L6 and returns the corresponding ADR A4 review path:
  //   L1-L2 → REQUIRE_CONFIRMATION
  //   L3-L4 → AUTO_WITH_OVERRIDE
  //   L5-L6 → AUTO
  app.post("/classify-change", async (c) => {
    const tenantId = getTenantId(c);
    const body = ClassifyChangeSchema.parse(await c.req.json());
    const data = await analyzeChange(sql, tenantId, body);
    return c.json({ data });
  });

  return app;
}
