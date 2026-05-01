// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { NodeRow, SnapshotRow } from "../db/types.js";
import { getTenantId, jsonb } from "../routes/util.js";

// Architect Agent API (kap. 6.3) — aggregated graph views for architectural
// analysis. All endpoints work on the full tenant graph, not individual nodes.

const ARCH_STRUCTURAL_TYPES = ["BoundedContext", "ArchitectureComponent", "ArchitectureSystem"];

export function architectRouter(sql: Sql): Hono {
  const app = new Hono();

  // ── Consistency scan ────────────────────────────────────────────────────────
  // Traverses the entire knowledge graph and surfaces structural violation
  // patterns. Returns grouped findings — not flat object lists.
  app.get("/consistency", async (c) => {
    const tenantId = getTenantId(c);
    const patterns = [];

    // Pattern: ArchitectureComponent without any link to a BoundedContext
    const unlinkedComponents = await sql<{ id: string; name: string }[]>`
      SELECT n.id, n.name
      FROM nodes n
      WHERE n.tenant_id = ${tenantId}
        AND n.type = 'ArchitectureComponent'
        AND n.lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
        AND NOT EXISTS (
          SELECT 1 FROM edges e
          JOIN nodes t ON t.id = e.target_id
          WHERE e.tenant_id = ${tenantId}
            AND e.source_id = n.id
            AND t.type = 'BoundedContext'
            AND e.lifecycle_status = 'ACTIVE'
        )
        AND NOT EXISTS (
          SELECT 1 FROM edges e
          JOIN nodes s ON s.id = e.source_id
          WHERE e.tenant_id = ${tenantId}
            AND e.target_id = n.id
            AND s.type = 'BoundedContext'
            AND e.lifecycle_status = 'ACTIVE'
        )
    `;
    if (unlinkedComponents.length > 0) {
      patterns.push({
        patternId: "ARCH_COMPONENT_WITHOUT_BOUNDED_CONTEXT",
        description: "ArchitectureComponent nodes without any link to a BoundedContext",
        severity: "WARN",
        count: unlinkedComponents.length,
        affectedNodes: unlinkedComponents,
      });
    }

    // Pattern: TechnicalDebt without an owner attribute
    const ownerlessDebt = await sql<{ id: string; name: string }[]>`
      SELECT id, name
      FROM nodes
      WHERE tenant_id = ${tenantId}
        AND type = 'TechnicalDebt'
        AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
        AND (attributes->>'owner' IS NULL OR trim(attributes->>'owner') = '')
    `;
    if (ownerlessDebt.length > 0) {
      patterns.push({
        patternId: "TECHNICAL_DEBT_WITHOUT_OWNER",
        description: "TechnicalDebt nodes missing an owner attribute",
        severity: "WARN",
        count: ownerlessDebt.length,
        affectedNodes: ownerlessDebt,
      });
    }

    // Pattern: DEPRECATED nodes missing a deprecatedAt timestamp
    const deprecatedWithoutDate = await sql<{ id: string; name: string; type: string }[]>`
      SELECT id, name, type
      FROM nodes
      WHERE tenant_id = ${tenantId}
        AND lifecycle_status = 'DEPRECATED'
        AND deprecated_at IS NULL
    `;
    if (deprecatedWithoutDate.length > 0) {
      patterns.push({
        patternId: "DEPRECATED_WITHOUT_DATE",
        description: "DEPRECATED nodes missing a deprecatedAt timestamp",
        severity: "WARN",
        count: deprecatedWithoutDate.length,
        affectedNodes: deprecatedWithoutDate,
      });
    }

    // Pattern: Orphaned ACTIVE nodes with no edges whatsoever
    const orphaned = await sql<{ id: string; name: string; type: string; layer: string }[]>`
      SELECT n.id, n.name, n.type, n.layer
      FROM nodes n
      WHERE n.tenant_id = ${tenantId}
        AND n.lifecycle_status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM edges e
          WHERE e.tenant_id = ${tenantId}
            AND e.lifecycle_status = 'ACTIVE'
            AND (e.source_id = n.id OR e.target_id = n.id)
        )
      LIMIT 50
    `;
    if (orphaned.length > 0) {
      patterns.push({
        patternId: "ORPHANED_NODE",
        description: "Active nodes with no active edges — disconnected from the knowledge graph",
        severity: "INFO",
        count: orphaned.length,
        affectedNodes: orphaned,
      });
    }

    return c.json({
      data: {
        scannedAt: new Date().toISOString(),
        patternCount: patterns.length,
        patterns,
      },
    });
  });

  // ── Drift detection ─────────────────────────────────────────────────────────
  // Compares current graph state against the most recent (or a named) snapshot.
  // Returns delta counts and recently modified nodes since the snapshot.
  // ?snapshotId=<uuid>  — compare against a specific snapshot (default: latest)
  app.get("/drift", async (c) => {
    const tenantId = getTenantId(c);
    const snapshotId = c.req.query("snapshotId");

    const snapshots = snapshotId
      ? await sql<SnapshotRow[]>`
          SELECT * FROM snapshots
          WHERE id = ${snapshotId} AND tenant_id = ${tenantId}
          LIMIT 1
        `
      : await sql<SnapshotRow[]>`
          SELECT * FROM snapshots
          WHERE tenant_id = ${tenantId}
          ORDER BY created_at DESC
          LIMIT 1
        `;

    if (snapshotId && snapshots.length === 0) {
      return c.json({ error: "snapshot not found" }, 404);
    }

    const snapshot = snapshots[0] ?? null;

    const [counts] = await sql<{ nodeCount: string; edgeCount: string }[]>`
      SELECT
        (SELECT COUNT(*) FROM nodes WHERE tenant_id = ${tenantId}) AS node_count,
        (SELECT COUNT(*) FROM edges WHERE tenant_id = ${tenantId}) AS edge_count
    `;

    const nodesByType = await sql<{ type: string; layer: string; count: string }[]>`
      SELECT type, layer, COUNT(*) AS count
      FROM nodes
      WHERE tenant_id = ${tenantId}
        AND lifecycle_status NOT IN ('PURGE')
      GROUP BY type, layer
      ORDER BY count DESC
    `;

    const since = snapshot
      ? snapshot.createdAt
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const recentChanges = await sql<
      { id: string; name: string; type: string; layer: string; updatedAt: Date }[]
    >`
      SELECT id, name, type, layer, updated_at
      FROM nodes
      WHERE tenant_id = ${tenantId}
        AND updated_at > ${since}
      ORDER BY updated_at DESC
      LIMIT 100
    `;

    const currentNodeCount = Number(counts.nodeCount);
    const currentEdgeCount = Number(counts.edgeCount);

    return c.json({
      data: {
        scannedAt: new Date().toISOString(),
        snapshot: snapshot
          ? {
              id: snapshot.id,
              label: snapshot.label,
              createdAt: snapshot.createdAt,
              nodeCount: snapshot.nodeCount,
              edgeCount: snapshot.edgeCount,
            }
          : null,
        current: { nodeCount: currentNodeCount, edgeCount: currentEdgeCount },
        delta: snapshot
          ? {
              nodesDelta: currentNodeCount - snapshot.nodeCount,
              edgesDelta: currentEdgeCount - snapshot.edgeCount,
            }
          : null,
        nodesByType: nodesByType.map((r) => ({
          type: r.type,
          layer: r.layer,
          count: Number(r.count),
        })),
        recentChanges: recentChanges.map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          layer: n.layer,
          updatedAt: n.updatedAt,
        })),
      },
    });
  });

  // ── Debt aggregation ────────────────────────────────────────────────────────
  // Aggregates TechnicalDebt objects and surfaces systemic patterns.
  // Returns grouped summaries; call /agent/v1/search?type=TechnicalDebt for items.
  app.get("/debt", async (c) => {
    const tenantId = getTenantId(c);

    const [totals] = await sql<{ total: string; open: string; inProgress: string }[]>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE attributes->>'status' = 'OPEN')        AS open,
        COUNT(*) FILTER (WHERE attributes->>'status' = 'IN_PROGRESS') AS "inProgress"
      FROM nodes
      WHERE tenant_id = ${tenantId}
        AND type = 'TechnicalDebt'
        AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
    `;

    const byDebtType = await sql<{ debtType: string; count: string }[]>`
      SELECT attributes->>'debtType' AS debt_type, COUNT(*) AS count
      FROM nodes
      WHERE tenant_id = ${tenantId}
        AND type = 'TechnicalDebt'
        AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
        AND (attributes->>'status') != 'RESOLVED'
      GROUP BY attributes->>'debtType'
      ORDER BY count DESC
    `;

    const byInterestRate = await sql<{ interestRate: string; count: string }[]>`
      SELECT attributes->>'interestRate' AS interest_rate, COUNT(*) AS count
      FROM nodes
      WHERE tenant_id = ${tenantId}
        AND type = 'TechnicalDebt'
        AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
        AND (attributes->>'status') != 'RESOLVED'
      GROUP BY attributes->>'interestRate'
      ORDER BY
        CASE attributes->>'interestRate'
          WHEN 'HIGH'   THEN 1
          WHEN 'MEDIUM' THEN 2
          WHEN 'LOW'    THEN 3
          ELSE 4
        END
    `;

    // Nodes with 2+ unresolved debt entries attached (via outgoing edges)
    const systemicPatterns = await sql<
      { nodeId: string; nodeName: string; nodeType: string; debtCount: string }[]
    >`
      SELECT n.id AS node_id, n.name AS node_name, n.type AS node_type,
             COUNT(DISTINCT d.id) AS debt_count
      FROM nodes n
      JOIN edges e  ON e.tenant_id = ${tenantId} AND e.source_id = n.id
                    AND e.lifecycle_status = 'ACTIVE'
      JOIN nodes d  ON d.id = e.target_id
                    AND d.type = 'TechnicalDebt'
                    AND d.lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
                    AND (d.attributes->>'status') != 'RESOLVED'
      WHERE n.tenant_id = ${tenantId}
        AND n.type != 'TechnicalDebt'
      GROUP BY n.id, n.name, n.type
      HAVING COUNT(DISTINCT d.id) >= 2
      ORDER BY debt_count DESC
      LIMIT 20
    `;

    return c.json({
      data: {
        scannedAt: new Date().toISOString(),
        totals: {
          total: Number(totals.total),
          open: Number(totals.open),
          inProgress: Number(totals.inProgress),
        },
        byDebtType: byDebtType.map((r) => ({
          debtType: r.debtType,
          count: Number(r.count),
        })),
        byInterestRate: byInterestRate.map((r) => ({
          interestRate: r.interestRate,
          count: Number(r.count),
        })),
        systemicPatterns: systemicPatterns.map((r) => ({
          nodeId: r.nodeId,
          nodeName: r.nodeName,
          nodeType: r.nodeType,
          debtCount: Number(r.debtCount),
        })),
      },
    });
  });

  // ── ADR coverage heuristic ──────────────────────────────────────────────────
  // Detects structurally significant nodes (BoundedContext, ArchitectureComponent,
  // ArchitectureSystem) with many edges but no linked ADR.
  // ?minEdges=<n>  — edge-count threshold to flag a node (default 5)
  app.get("/adr-coverage", async (c) => {
    const tenantId = getTenantId(c);
    const minEdges = Math.max(1, Number(c.req.query("minEdges") ?? 5));

    const uncovered = await sql<{ id: string; name: string; type: string; edgeCount: string }[]>`
      SELECT n.id, n.name, n.type,
             COUNT(DISTINCT e.id) AS edge_count
      FROM nodes n
      LEFT JOIN edges e ON e.tenant_id = ${tenantId}
            AND (e.source_id = n.id OR e.target_id = n.id)
            AND e.lifecycle_status = 'ACTIVE'
      WHERE n.tenant_id = ${tenantId}
        AND n.type = ANY(${ARCH_STRUCTURAL_TYPES})
        AND n.lifecycle_status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM edges ae
          WHERE ae.tenant_id = ${tenantId}
            AND (ae.source_id = n.id OR ae.target_id = n.id)
            AND ae.lifecycle_status = 'ACTIVE'
            AND EXISTS (
              SELECT 1 FROM nodes adr
              WHERE adr.type = 'ADR'
                AND adr.id = CASE
                  WHEN ae.source_id = n.id THEN ae.target_id
                  ELSE ae.source_id
                END
            )
        )
      GROUP BY n.id, n.name, n.type
      HAVING COUNT(DISTINCT e.id) >= ${minEdges}
      ORDER BY edge_count DESC
      LIMIT 50
    `;

    const [coverageStats] = await sql<
      {
        totalArchNodes: string;
        coveredNodes: string;
        totalAdrs: string;
        acceptedAdrs: string;
      }[]
    >`
      SELECT
        (SELECT COUNT(*) FROM nodes
          WHERE tenant_id = ${tenantId}
            AND type = ANY(${ARCH_STRUCTURAL_TYPES})
            AND lifecycle_status = 'ACTIVE') AS total_arch_nodes,
        (SELECT COUNT(DISTINCT n.id) FROM nodes n
          JOIN edges e  ON e.tenant_id = ${tenantId}
                        AND (e.source_id = n.id OR e.target_id = n.id)
                        AND e.lifecycle_status = 'ACTIVE'
          JOIN nodes adr ON adr.type = 'ADR'
                        AND adr.id = CASE
                          WHEN e.source_id = n.id THEN e.target_id
                          ELSE e.source_id
                        END
          WHERE n.tenant_id = ${tenantId}
            AND n.type = ANY(${ARCH_STRUCTURAL_TYPES})
            AND n.lifecycle_status = 'ACTIVE') AS covered_nodes,
        (SELECT COUNT(*) FROM nodes
          WHERE tenant_id = ${tenantId} AND type = 'ADR') AS total_adrs,
        (SELECT COUNT(*) FROM nodes
          WHERE tenant_id = ${tenantId}
            AND type = 'ADR'
            AND attributes->>'status' = 'ACCEPTED') AS accepted_adrs
    `;

    return c.json({
      data: {
        scannedAt: new Date().toISOString(),
        minEdgesThreshold: minEdges,
        coverage: {
          totalArchitectureNodes: Number(coverageStats.totalArchNodes),
          coveredByAdr: Number(coverageStats.coveredNodes),
          uncoveredCount: uncovered.length,
          totalAdrs: Number(coverageStats.totalAdrs),
          acceptedAdrs: Number(coverageStats.acceptedAdrs),
        },
        uncoveredNodes: uncovered.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          edgeCount: Number(r.edgeCount),
          suggestion: `Document the architectural decisions behind '${r.name}' — it has ${r.edgeCount} connections but no linked ADR.`,
        })),
      },
    });
  });

  // ── Requirement fulfillment ─────────────────────────────────────────────────
  // Checks all Requirements against their implementation state.
  // Classification: fulfilled (IMPLEMENTED), in_progress (IN_PROGRESS or APPROVED+linked),
  // unfulfilled (APPROVED+no links), obsolete (OBSOLETE).
  app.get("/requirements", async (c) => {
    const tenantId = getTenantId(c);

    const requirements = await sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE tenant_id = ${tenantId}
        AND type = 'Requirement'
        AND lifecycle_status NOT IN ('PURGE')
      ORDER BY updated_at DESC
    `;

    if (requirements.length === 0) {
      return c.json({
        data: {
          scannedAt: new Date().toISOString(),
          summary: { total: 0, fulfilled: 0, inProgress: 0, unfulfilled: 0, obsolete: 0 },
          requirements: [],
        },
      });
    }

    const reqIds = requirements.map((r) => r.id);

    // Count edges touching each requirement (proxy for "has linked implementation work")
    const linkedCounts = await sql<{ reqId: string; linkedCount: string }[]>`
      SELECT
        CASE WHEN e.source_id = ANY(${reqIds}::uuid[]) THEN e.source_id ELSE e.target_id END AS req_id,
        COUNT(*) AS linked_count
      FROM edges e
      WHERE e.tenant_id = ${tenantId}
        AND e.lifecycle_status = 'ACTIVE'
        AND (e.source_id = ANY(${reqIds}::uuid[]) OR e.target_id = ANY(${reqIds}::uuid[]))
      GROUP BY req_id
    `;

    const linkedMap = new Map(linkedCounts.map((r) => [r.reqId, Number(r.linkedCount)]));

    const classified = requirements.map((req) => {
      const attrs = req.attributes as Record<string, unknown>;
      const reqStatus = (attrs?.status as string | undefined) ?? "PROPOSED";
      const linkedCount = linkedMap.get(req.id) ?? 0;

      let fulfillmentStatus: "fulfilled" | "inProgress" | "unfulfilled" | "obsolete";
      if (reqStatus === "IMPLEMENTED") {
        fulfillmentStatus = "fulfilled";
      } else if (reqStatus === "OBSOLETE") {
        fulfillmentStatus = "obsolete";
      } else if (reqStatus === "IN_PROGRESS" || (reqStatus === "APPROVED" && linkedCount > 0)) {
        fulfillmentStatus = "inProgress";
      } else {
        fulfillmentStatus = "unfulfilled";
      }

      return {
        id: req.id,
        name: req.name,
        requirementStatus: reqStatus,
        fulfillmentStatus,
        linkedNodes: linkedCount,
        lifecycleStatus: req.lifecycleStatus,
      };
    });

    const summary = classified.reduce(
      (acc, r) => {
        acc[r.fulfillmentStatus]++;
        return acc;
      },
      { total: classified.length, fulfilled: 0, inProgress: 0, unfulfilled: 0, obsolete: 0 } as {
        total: number;
        fulfilled: number;
        inProgress: number;
        unfulfilled: number;
        obsolete: number;
      }
    );

    return c.json({
      data: {
        scannedAt: new Date().toISOString(),
        summary,
        requirements: classified,
      },
    });
  });

  // ── Snapshots ───────────────────────────────────────────────────────────────

  // GET /architect/snapshots — list snapshots newest-first (limit 50)
  app.get("/snapshots", async (c) => {
    const tenantId = getTenantId(c);
    const rows = await sql<SnapshotRow[]>`
      SELECT * FROM snapshots
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return c.json({
      data: rows.map((r) => ({
        id: r.id,
        label: r.label,
        nodeCount: r.nodeCount,
        edgeCount: r.edgeCount,
        createdAt: r.createdAt,
      })),
    });
  });

  // POST /architect/snapshots — capture a point-in-time snapshot of the live graph
  // ?label=<string>  optional human-readable label
  app.post("/snapshots", async (c) => {
    const tenantId = getTenantId(c);
    const label = c.req.query("label") ?? "";

    const [nodeIds, edgeIds, violationCount] = await Promise.all([
      sql<{ id: string }[]>`
        SELECT id FROM nodes WHERE tenant_id = ${tenantId} AND lifecycle_status != 'PURGE'
      `,
      sql<{ id: string }[]>`
        SELECT id FROM edges WHERE tenant_id = ${tenantId} AND lifecycle_status != 'PURGE'
      `,
      sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM violations WHERE tenant_id = ${tenantId} AND resolved = FALSE
      `,
    ]);

    const snapshotData = {
      nodeIds: nodeIds.map((r) => r.id),
      edgeIds: edgeIds.map((r) => r.id),
      openViolationCount: Number(violationCount[0]?.count ?? 0),
    };

    const [row] = await sql<SnapshotRow[]>`
      INSERT INTO snapshots (tenant_id, label, node_count, edge_count, snapshot_data)
      VALUES (
        ${tenantId},
        ${label},
        ${nodeIds.length},
        ${edgeIds.length},
        ${jsonb(sql, snapshotData)}
      )
      RETURNING *
    `;

    return c.json(
      {
        data: {
          id: row.id,
          label: row.label,
          nodeCount: row.nodeCount,
          edgeCount: row.edgeCount,
          createdAt: row.createdAt,
        },
      },
      201
    );
  });

  return app;
}
