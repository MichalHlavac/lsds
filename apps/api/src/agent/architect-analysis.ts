// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "../db/client.js";
import type { NodeRow, SnapshotRow } from "../db/types.js";
import type { GuardrailsRegistry } from "../guardrails/index.js";
import type { AgentAnalyze, ClassifyChange, ImpactPredict } from "../routes/schemas.js";
import { PostgresTraversalAdapter } from "../db/traversal-adapter.js";

export const ARCH_STRUCTURAL_TYPES = ["BoundedContext", "ArchitectureComponent", "ArchitectureSystem"];

export class SnapshotNotFoundError extends Error {
  constructor(id: string) {
    super(`Snapshot not found: ${id}`);
    this.name = "SnapshotNotFoundError";
  }
}

export async function analyzeNodes(
  sql: Sql,
  guardrails: GuardrailsRegistry,
  tenantId: string,
  params: AgentAnalyze,
) {
  const { persist, types, layers, lifecycleStatuses, sampleLimit } = params;
  const effectiveLifecycle = lifecycleStatuses ?? ["ACTIVE", "DEPRECATED"];

  const nodes = await sql<NodeRow[]>`
    SELECT * FROM nodes
    WHERE tenant_id = ${tenantId}
      AND lifecycle_status = ANY(${effectiveLifecycle})
      ${types && types.length > 0 ? sql`AND type = ANY(${types})` : sql``}
      ${layers && layers.length > 0 ? sql`AND layer = ANY(${layers})` : sql``}
  `;

  const { rules, violations } = await guardrails.evaluateBatch(tenantId, nodes);

  let persistedCount = 0;
  if (persist && violations.length > 0) {
    await guardrails.persistViolations(tenantId, violations);
    persistedCount = violations.length;
  }

  const bySeverity: Record<string, number> = { ERROR: 0, WARN: 0, INFO: 0 };
  const byRuleMap = new Map<string, { ruleKey: string; severity: string; count: number }>();
  for (const v of violations) {
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    const existing = byRuleMap.get(v.ruleKey);
    if (existing) existing.count += 1;
    else byRuleMap.set(v.ruleKey, { ruleKey: v.ruleKey, severity: v.severity, count: 1 });
  }
  const byRule = Array.from(byRuleMap.values()).sort((a, b) => b.count - a.count);

  return {
    scannedAt: new Date().toISOString(),
    scope: {
      nodeCount: nodes.length,
      filters: {
        types: types ?? null,
        layers: layers ?? null,
        lifecycleStatuses: effectiveLifecycle,
      },
    },
    rulesEvaluated: rules.length,
    summary: {
      totalViolations: violations.length,
      bySeverity,
      byRule,
    },
    samples: violations.slice(0, sampleLimit).map((v) => ({
      ruleKey: v.ruleKey,
      severity: v.severity,
      message: v.message,
      nodeId: v.nodeId ?? null,
      edgeId: v.edgeId ?? null,
    })),
    persisted: persist,
    persistedCount,
  };
}

export async function consistencyScan(sql: Sql, tenantId: string) {
  const patterns = [];

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

  return {
    scannedAt: new Date().toISOString(),
    patternCount: patterns.length,
    patterns,
  };
}

// Throws SnapshotNotFoundError when snapshotId is given but does not exist.
export async function driftAnalysis(sql: Sql, tenantId: string, snapshotId?: string) {
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
    throw new SnapshotNotFoundError(snapshotId);
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

  return {
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
  };
}

export async function debtAggregation(sql: Sql, tenantId: string) {
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

  return {
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
  };
}

export async function adrCoverageAnalysis(sql: Sql, tenantId: string, minEdges: number) {
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

  return {
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
  };
}

// Scan APPROVED requirements for implementation gaps using node_history as the
// mutation signal. A requirement is "reflected" when at least one active-edge
// neighbor has a node_history entry recorded after the requirement's updatedAt
// (proxy for approval time). All others are "gap" items.
export async function requirementFulfillmentScan(sql: Sql, tenantId: string) {
  const requirements = await sql<NodeRow[]>`
    SELECT * FROM nodes
    WHERE tenant_id = ${tenantId}
      AND type = 'Requirement'
      AND lifecycle_status NOT IN ('PURGE')
      AND attributes->>'status' = 'APPROVED'
    ORDER BY updated_at DESC
  `;

  if (requirements.length === 0) {
    return {
      scannedAt: new Date().toISOString(),
      summary: { total: 0, gap: 0, reflected: 0 },
      gaps: [],
      requirements: [] as never[],
    };
  }

  const reqIds = requirements.map((r) => r.id);

  // For each APPROVED requirement, check if any linked neighbor node has a
  // node_history entry with changed_at >= req.updated_at. Using >= so that
  // nodes created in the same database transaction as the approval are counted.
  const reflectedRows = await sql<{ reqId: string }[]>`
    SELECT DISTINCT
      CASE WHEN e.source_id = ANY(${reqIds}::uuid[]) THEN e.source_id ELSE e.target_id END AS req_id
    FROM edges e
    JOIN nodes req_node ON req_node.id =
      CASE WHEN e.source_id = ANY(${reqIds}::uuid[]) THEN e.source_id ELSE e.target_id END
    JOIN node_history nh ON nh.tenant_id = ${tenantId}
      AND nh.node_id =
        CASE WHEN e.source_id = ANY(${reqIds}::uuid[]) THEN e.target_id ELSE e.source_id END
      AND nh.changed_at >= req_node.updated_at
    WHERE e.tenant_id = ${tenantId}
      AND e.lifecycle_status = 'ACTIVE'
      AND (e.source_id = ANY(${reqIds}::uuid[]) OR e.target_id = ANY(${reqIds}::uuid[]))
  `;

  const reflectedSet = new Set(reflectedRows.map((r) => r.reqId));

  const classified = requirements.map((req) => {
    const fulfillmentStatus: "gap" | "reflected" = reflectedSet.has(req.id) ? "reflected" : "gap";
    return {
      id: req.id,
      name: req.name,
      approvedAt: req.updatedAt,
      fulfillmentStatus,
    };
  });

  const summary = classified.reduce(
    (acc, r) => {
      acc[r.fulfillmentStatus]++;
      return acc;
    },
    { total: classified.length, gap: 0, reflected: 0 },
  );

  return {
    scannedAt: new Date().toISOString(),
    summary,
    gaps: classified.filter((r) => r.fulfillmentStatus === "gap"),
    requirements: classified,
  };
}

const HIGH_IMPACT_LAYERS = new Set(["L1", "L2"]);

// Pre-change impact analysis: traverses the graph from the affected node(s),
// simulates the proposed change in-memory, runs guardrail checks, and flags
// any L1/L2 nodes in the blast radius (ADR A4 layer-dependent policy).
export async function impactPredict(
  sql: Sql,
  guardrails: GuardrailsRegistry,
  tenantId: string,
  params: ImpactPredict
) {
  const { changeType, nodeId, proposedNode, edgeChanges, maxDepth } = params;
  const adapter = new PostgresTraversalAdapter(sql, tenantId);

  // Fetch existing node for update/delete
  let existingNode: NodeRow | null = null;
  if (nodeId) {
    const [row] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${nodeId} AND tenant_id = ${tenantId}
    `;
    existingNode = row ?? null;
    if (!existingNode && (changeType === "update" || changeType === "delete")) {
      return null; // caller handles 404
    }
  }

  // Collect traversal roots: the changed node + any edge-change endpoints
  const traversalRoots: string[] = [];
  if (nodeId && existingNode) traversalRoots.push(nodeId);
  for (const ec of edgeChanges ?? []) {
    if (!traversalRoots.includes(ec.fromId)) traversalRoots.push(ec.fromId);
    if (!traversalRoots.includes(ec.toId)) traversalRoots.push(ec.toId);
  }

  // Traverse neighbors up to maxDepth from each root
  const affectedMap = new Map<string, string[]>(); // nodeId → path
  for (const root of traversalRoots) {
    const results = await adapter.traverseWithDepth(root, maxDepth, "both");
    for (const r of results) {
      if (r.nodeId !== nodeId && !affectedMap.has(r.nodeId)) {
        affectedMap.set(r.nodeId, r.path);
      }
    }
  }

  // Fetch full rows for all affected neighbor nodes
  const affectedNodeIds = Array.from(affectedMap.keys());
  let affectedNodes: NodeRow[] = [];
  if (affectedNodeIds.length > 0) {
    affectedNodes = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ANY(${affectedNodeIds}) AND tenant_id = ${tenantId}
    `;
  }

  // Build simulated subjects for guardrail evaluation:
  //   create → synthetic node from proposedNode
  //   update → existing node with proposed fields merged in
  //   delete → no simulated subject (the node is gone)
  const simulatedSubjects: NodeRow[] = [];

  if (changeType === "create" && proposedNode) {
    simulatedSubjects.push({
      id: "00000000-0000-0000-0000-000000000000",
      tenantId,
      type: proposedNode.type,
      layer: proposedNode.layer,
      name: proposedNode.name,
      version: proposedNode.version ?? "0.1.0",
      lifecycleStatus: proposedNode.lifecycleStatus ?? "ACTIVE",
      attributes: proposedNode.attributes ?? {},
      ownerId: (proposedNode.owner as { id?: string } | undefined)?.id ?? '',
      ownerName: (proposedNode.owner as { name?: string } | undefined)?.name ?? '',
      ownerKind: 'team',
      createdAt: new Date(),
      updatedAt: new Date(),
      deprecatedAt: null,
      archivedAt: null,
      purgeAfter: null,
    });
  } else if (changeType === "update" && existingNode) {
    simulatedSubjects.push({
      ...existingNode,
      name: proposedNode?.name ?? existingNode.name,
      type: proposedNode?.type ?? existingNode.type,
      layer: proposedNode?.layer ?? existingNode.layer,
      version: proposedNode?.version ?? existingNode.version,
      lifecycleStatus: proposedNode?.lifecycleStatus ?? existingNode.lifecycleStatus,
      attributes: proposedNode?.attributes ?? existingNode.attributes,
    });
  }
  // Affected neighbors are evaluated as-is
  simulatedSubjects.push(...affectedNodes);

  const { violations } = await guardrails.evaluateBatch(tenantId, simulatedSubjects);

  // Flag requiresConfirmation when any L1/L2 node is in the blast radius
  let requiresConfirmation =
    (existingNode != null && HIGH_IMPACT_LAYERS.has(existingNode.layer)) ||
    (proposedNode != null && HIGH_IMPACT_LAYERS.has(proposedNode.layer)) ||
    affectedNodes.some((n) => HIGH_IMPACT_LAYERS.has(n.layer));

  const predictedViolations = violations.map((v) => ({
    ruleKey: v.ruleKey,
    severity: v.severity,
    nodeId: v.nodeId ?? null,
    description: v.message,
  }));

  const errorCount = predictedViolations.filter((v) => v.severity === "ERROR").length;
  const warnCount = predictedViolations.filter((v) => v.severity === "WARN").length;

  const summary = [
    `${changeType.toUpperCase()} affects ${affectedNodes.length} neighboring node(s).`,
    predictedViolations.length > 0
      ? `Predicted ${predictedViolations.length} violation(s): ${errorCount} ERROR, ${warnCount} WARN.`
      : "No guardrail violations predicted.",
    requiresConfirmation
      ? "Requires confirmation — L1/L2 (Business/Domain) node(s) in blast radius."
      : "No high-impact layer nodes in blast radius.",
  ].join(" ");

  return {
    predictedAt: new Date().toISOString(),
    changeType,
    maxDepth,
    affectedNodes: affectedNodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      layer: n.layer,
      relationshipPath: affectedMap.get(n.id) ?? [],
    })),
    predictedViolations,
    requiresConfirmation,
    summary,
  };
}

export async function requirementsFulfillment(sql: Sql, tenantId: string) {
  const requirements = await sql<NodeRow[]>`
    SELECT * FROM nodes
    WHERE tenant_id = ${tenantId}
      AND type = 'Requirement'
      AND lifecycle_status NOT IN ('PURGE')
    ORDER BY updated_at DESC
  `;

  if (requirements.length === 0) {
    return {
      scannedAt: new Date().toISOString(),
      summary: { total: 0, fulfilled: 0, inProgress: 0, unfulfilled: 0, obsolete: 0 },
      requirements: [] as never[],
    };
  }

  const reqIds = requirements.map((r) => r.id);

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
    },
  );

  return {
    scannedAt: new Date().toISOString(),
    summary,
    requirements: classified,
  };
}

// ── Change classification (ADR A4) ──────────────────────────────────────────

export type ChangeLayer = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
type ReviewPath = "REQUIRE_CONFIRMATION" | "AUTO_WITH_OVERRIDE" | "AUTO";
export type SignalConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface ChangeSignal {
  source: "file_path" | "diff_content" | "node_type" | "node_id";
  value: string;
  inferredLayer: ChangeLayer;
  confidence: SignalConfidence;
  rationale: string;
}

const LAYER_REVIEW_PATH: Record<ChangeLayer, ReviewPath> = {
  L1: "REQUIRE_CONFIRMATION",
  L2: "REQUIRE_CONFIRMATION",
  L3: "AUTO_WITH_OVERRIDE",
  L4: "AUTO_WITH_OVERRIDE",
  L5: "AUTO",
  L6: "AUTO",
};

const LAYER_ORDER: Record<ChangeLayer, number> = {
  L1: 1, L2: 2, L3: 3, L4: 4, L5: 5, L6: 6,
};

export function classifyFilePath(
  filePath: string
): { layer: ChangeLayer; confidence: SignalConfidence; rationale: string } | null {
  const p = filePath.toLowerCase();

  if (p.includes("/db/migrations/") || p.includes("/migrations/") && p.endsWith(".sql")) {
    return { layer: "L1", confidence: "HIGH", rationale: "Database schema migration" };
  }
  if (
    p.match(/packages\/framework\/src\/(types|schema|layers)/)
  ) {
    return { layer: "L1", confidence: "HIGH", rationale: "Framework type/schema/layer definition" };
  }
  if (p.includes("packages/framework/")) {
    return { layer: "L2", confidence: "HIGH", rationale: "Framework core module" };
  }
  if (p.includes("packages/shared/")) {
    return { layer: "L2", confidence: "MEDIUM", rationale: "Shared types package" };
  }
  if (p.includes("/guardrails/")) {
    return { layer: "L2", confidence: "HIGH", rationale: "Guardrail rule or registry" };
  }
  if (p.includes("/routes/") || p.includes("/endpoints/")) {
    return { layer: "L3", confidence: "HIGH", rationale: "API route definition" };
  }
  if (p.includes("apps/mcp/")) {
    return { layer: "L3", confidence: "HIGH", rationale: "MCP integration layer" };
  }
  if (p.includes("/agent/")) {
    return { layer: "L3", confidence: "MEDIUM", rationale: "Agent API module" };
  }
  if (p.includes("/db/")) {
    return { layer: "L4", confidence: "HIGH", rationale: "Database access / persistence layer" };
  }
  if (p.includes("/embeddings/")) {
    return { layer: "L4", confidence: "MEDIUM", rationale: "Embedding / data enrichment layer" };
  }
  if (p.includes("apps/web/")) {
    return { layer: "L5", confidence: "HIGH", rationale: "Frontend application module" };
  }
  if (p.endsWith(".test.ts") || p.endsWith(".spec.ts") || p.includes("/__tests__/") || p.includes("/test/")) {
    return { layer: "L6", confidence: "MEDIUM", rationale: "Test file" };
  }
  if (
    p.includes(".github/") ||
    p.includes("/scripts/") ||
    p.endsWith(".sh") ||
    p.startsWith("dockerfile") ||
    p.includes("docker-compose") ||
    p.endsWith(".yml") ||
    p.endsWith(".yaml")
  ) {
    return { layer: "L6", confidence: "HIGH", rationale: "CI/CD, infrastructure, or operations config" };
  }
  if (p.includes("apps/api/")) {
    return { layer: "L4", confidence: "LOW", rationale: "API application code (layer uncertain)" };
  }
  return null;
}

const DIFF_SIGNALS: Array<{ pattern: RegExp; layer: ChangeLayer; confidence: SignalConfidence; rationale: string }> = [
  { pattern: /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i, layer: "L1", confidence: "HIGH", rationale: "SQL DDL statement" },
  { pattern: /\b(BoundedContext|BusinessProcess|DomainEvent|ValueObject|Aggregate)\b/, layer: "L1", confidence: "HIGH", rationale: "Domain / L1 node type" },
  { pattern: /\b(Requirement)\b.*?(type|layer)\s*[:=]\s*["']?L1/, layer: "L1", confidence: "MEDIUM", rationale: "L1 Requirement node" },
  { pattern: /\b(ArchitectureSystem|ArchitectureComponent|ADR)\b/, layer: "L2", confidence: "HIGH", rationale: "L2 architecture node type" },
  { pattern: /guardrails\.register|GuardrailRegistry|REQUIRE_CONFIRMATION/, layer: "L2", confidence: "HIGH", rationale: "Guardrail registry or confirmation policy" },
  { pattern: /\b(ExternalSystem|ExternalDependency|APIEndpoint|Interface)\b/, layer: "L3", confidence: "HIGH", rationale: "L3 integration node type" },
  { pattern: /app\.(get|post|put|patch|delete)\s*\(|router\.(get|post|put|patch|delete)\s*\(/i, layer: "L3", confidence: "MEDIUM", rationale: "HTTP route registration" },
  { pattern: /McpServer|server\.tool\s*\(/, layer: "L3", confidence: "HIGH", rationale: "MCP server tool registration" },
  { pattern: /sql`|FROM\s+nodes\b|FROM\s+edges\b|TraversalAdapter/i, layer: "L4", confidence: "MEDIUM", rationale: "Database query or traversal layer" },
  { pattern: /\b(Module|Package|Library)\b.*?(type|layer)\s*[:=]\s*["']?L5/, layer: "L5", confidence: "HIGH", rationale: "L5 module/package node type" },
  { pattern: /\bdescribe\s*\(|it\s*\(|test\s*\(|expect\s*\(/, layer: "L6", confidence: "LOW", rationale: "Test assertion code" },
];

// Node types mapped to their canonical layer per the LSDS type registry.
const NODE_TYPE_LAYERS: Record<string, ChangeLayer> = {
  BoundedContext: "L1", BusinessProcess: "L1", DomainEvent: "L1", ValueObject: "L1",
  Aggregate: "L1", Requirement: "L1", Policy: "L1",
  ArchitectureSystem: "L2", ArchitectureComponent: "L2", ADR: "L2",
  ExternalSystem: "L3", ExternalDependency: "L3", APIEndpoint: "L3", Interface: "L3",
  Database: "L4", DataStore: "L4", Schema: "L4", Queue: "L4",
  Module: "L5", Package: "L5", Library: "L5", Service: "L5",
  Deployment: "L6", Infrastructure: "L6", CICDPipeline: "L6", TechnicalDebt: "L5",
};

export function pickLayer(signals: ChangeSignal[]): { layer: ChangeLayer; confidence: SignalConfidence; rationale: string } {
  if (signals.length === 0) {
    return { layer: "L5", confidence: "LOW", rationale: "No signals — defaulting to L5 (module level)" };
  }

  // Highest-risk (lowest L number) HIGH-confidence signal wins.
  const high = signals.filter((s) => s.confidence === "HIGH");
  const pool = high.length > 0 ? high : signals;
  const worst = pool.reduce((a, b) => (LAYER_ORDER[a.inferredLayer] <= LAYER_ORDER[b.inferredLayer] ? a : b));

  const sameLayer = pool.filter((s) => s.inferredLayer === worst.inferredLayer);
  const confidence: SignalConfidence = high.length > 0 ? "HIGH" : sameLayer.length >= 2 ? "MEDIUM" : "LOW";
  return { layer: worst.inferredLayer, confidence, rationale: worst.rationale };
}

export async function analyzeChange(
  sql: Sql,
  tenantId: string,
  params: ClassifyChange
): Promise<{
  classifiedAt: string;
  classification: { layer: ChangeLayer; confidence: SignalConfidence; reviewPath: ReviewPath; rationale: string };
  signals: Array<{ source: string; value: string; inferredLayer: string; confidence: string; rationale: string }>;
  recommendations: string[];
}> {
  const signals: ChangeSignal[] = [];

  // ── File-path signals ──────────────────────────────────────────────────────
  for (const fp of params.filePaths ?? []) {
    const result = classifyFilePath(fp);
    if (result) {
      signals.push({ source: "file_path", value: fp, inferredLayer: result.layer, confidence: result.confidence, rationale: result.rationale });
    }
  }

  // ── Diff-content signals ───────────────────────────────────────────────────
  if (params.diff) {
    for (const { pattern, layer, confidence, rationale } of DIFF_SIGNALS) {
      if (pattern.test(params.diff)) {
        const excerpt = params.diff.split("\n").find((l) => pattern.test(l))?.trim().slice(0, 120) ?? "";
        signals.push({ source: "diff_content", value: excerpt, inferredLayer: layer, confidence, rationale });
      }
    }
  }

  // ── Node-type signals ──────────────────────────────────────────────────────
  for (const nt of params.nodeTypes ?? []) {
    const layer = NODE_TYPE_LAYERS[nt];
    if (layer) {
      signals.push({ source: "node_type", value: nt, inferredLayer: layer, confidence: "HIGH", rationale: `Node type '${nt}' is canonical L${LAYER_ORDER[layer]}` });
    } else {
      signals.push({ source: "node_type", value: nt, inferredLayer: "L5", confidence: "LOW", rationale: `Unknown node type '${nt}' — defaulting to L5` });
    }
  }

  // ── Node-ID signals (DB lookup) ────────────────────────────────────────────
  if (params.nodeIds && params.nodeIds.length > 0) {
    const rows = await sql<{ id: string; type: string; layer: string }[]>`
      SELECT id, type, layer FROM nodes
      WHERE tenant_id = ${tenantId} AND id = ANY(${params.nodeIds})
    `;
    for (const row of rows) {
      const layer = row.layer as ChangeLayer;
      signals.push({
        source: "node_id",
        value: row.id,
        inferredLayer: layer,
        confidence: "HIGH",
        rationale: `Node ${row.id} (${row.type}) is ${layer}`,
      });
    }
  }

  const { layer, confidence, rationale } = pickLayer(signals);
  const reviewPath = LAYER_REVIEW_PATH[layer];

  const recommendations: string[] = [];
  if (layer === "L1" || layer === "L2") {
    recommendations.push("This change touches structural (L1/L2) elements — explicit board or CTO confirmation required before merge.");
    recommendations.push("Run lsds_architect_consistency and lsds_impact_predict to surface downstream blast radius before proceeding.");
  } else if (layer === "L3" || layer === "L4") {
    recommendations.push("L3/L4 change: notify CTO and observe a 2-hour hold before QA merges.");
    recommendations.push("Run lsds_impact_predict to verify no unexpected L1/L2 node is affected.");
  } else {
    recommendations.push("L5/L6 change: QA can merge autonomously — no hold required.");
  }

  return {
    classifiedAt: new Date().toISOString(),
    classification: { layer, confidence, reviewPath, rationale },
    signals: signals.map((s) => ({
      source: s.source,
      value: s.value,
      inferredLayer: s.inferredLayer,
      confidence: s.confidence,
      rationale: s.rationale,
    })),
    recommendations,
  };
}
