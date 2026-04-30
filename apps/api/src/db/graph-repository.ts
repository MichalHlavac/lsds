// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type {
  GraphRepository,
  ViolationRecord,
  TknBase,
  RelationshipEdge,
  RelationshipType,
  LayerId,
  RuleId,
  Severity,
  ViolationStatus,
} from "@lsds/framework";
import type { Sql } from "./client.js";
import type { NodeRow, ViolationRow } from "./types.js";

type EdgeJoinRow = {
  type: string;
  sourceId: string;
  targetId: string;
  sourceLayer: string;
  targetLayer: string;
};

function nodeRowToTknBase(row: NodeRow): TknBase {
  return {
    id: row.id,
    type: row.type,
    layer: row.layer as LayerId,
    name: row.name,
    version: row.version,
    lifecycle: row.lifecycleStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function edgeJoinRowToRelationshipEdge(row: EdgeJoinRow): RelationshipEdge {
  return {
    type: row.type as RelationshipType,
    sourceTknId: row.sourceId,
    targetTknId: row.targetId,
    sourceLayer: row.sourceLayer as LayerId,
    targetLayer: row.targetLayer as LayerId,
  };
}

function dbSeverityToFramework(s: string): Severity {
  // DB stores "WARN"; framework expects "WARNING".
  return (s === "WARN" ? "WARNING" : s) as Severity;
}

function violationRowToRecord(row: ViolationRow): ViolationRecord {
  return {
    id: row.id,
    rule_id: row.ruleKey as RuleId,
    object_id: row.nodeId ?? row.edgeId ?? row.id,
    object_type: row.nodeId ? "node" : "edge",
    severity: dbSeverityToFramework(row.severity),
    status: (row.resolved ? "RESOLVED" : "OPEN") as ViolationStatus,
    detectedAt: row.createdAt.toISOString(),
    message: row.message,
    inherited: false,
  };
}

/**
 * Postgres implementation of GraphRepository (kap. 8).
 * Tenant scoping is enforced here — the engine is intentionally tenant-agnostic (ADR-A6).
 */
export class PostgresGraphRepository implements GraphRepository {
  constructor(
    private readonly sql: Sql,
    private readonly tenantId: string,
  ) {}

  async getNode(id: string): Promise<TknBase | null> {
    const rows = await this.sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${this.tenantId}
    `;
    return rows[0] ? nodeRowToTknBase(rows[0]) : null;
  }

  async getNodes(ids: ReadonlyArray<string>): Promise<TknBase[]> {
    if (ids.length === 0) return [];
    const rows = await this.sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE id = ANY(${ids as string[]}) AND tenant_id = ${this.tenantId}
    `;
    return rows.map(nodeRowToTknBase);
  }

  async getOutgoingEdges(nodeId: string): Promise<RelationshipEdge[]> {
    const rows = await this.sql<EdgeJoinRow[]>`
      SELECT e.type, e.source_id, e.target_id,
             sn.layer AS source_layer, tn.layer AS target_layer
      FROM edges e
      JOIN nodes sn ON sn.id = e.source_id
      JOIN nodes tn ON tn.id = e.target_id
      WHERE e.source_id = ${nodeId} AND e.tenant_id = ${this.tenantId}
    `;
    return rows.map(edgeJoinRowToRelationshipEdge);
  }

  async getIncomingEdges(nodeId: string): Promise<RelationshipEdge[]> {
    const rows = await this.sql<EdgeJoinRow[]>`
      SELECT e.type, e.source_id, e.target_id,
             sn.layer AS source_layer, tn.layer AS target_layer
      FROM edges e
      JOIN nodes sn ON sn.id = e.source_id
      JOIN nodes tn ON tn.id = e.target_id
      WHERE e.target_id = ${nodeId} AND e.tenant_id = ${this.tenantId}
    `;
    return rows.map(edgeJoinRowToRelationshipEdge);
  }

  async getViolations(nodeIds: ReadonlyArray<string>): Promise<ViolationRecord[]> {
    if (nodeIds.length === 0) return [];
    const rows = await this.sql<ViolationRow[]>`
      SELECT * FROM violations
      WHERE node_id = ANY(${nodeIds as string[]}) AND tenant_id = ${this.tenantId}
        AND resolved = FALSE
    `;
    return rows.map(violationRowToRecord);
  }
}
