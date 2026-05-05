// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "../db/client.js";
import type { GuardrailRow, NodeRow, EdgeRow, Severity } from "../db/types.js";

export interface ViolationCandidate {
  ruleKey: string;
  severity: "ERROR" | "WARN" | "INFO";
  message: string;
  nodeId?: string;
  edgeId?: string;
  // For edge-targeted violations the framework records the offending endpoints
  // so the violation can be traced back to its source→target pair.
  sourceNodeId?: string;
  targetNodeId?: string;
}

export interface WriteGuidanceRule {
  ruleKey: string;
  severity: Severity;
  condition: string;
  rationale: string;
  remediation: string;
}

export type GuardrailCheck = (
  subject: NodeRow | EdgeRow,
  config: Record<string, unknown>
) => ViolationCandidate | null;

function nodeAttrs(subject: NodeRow | EdgeRow): Record<string, unknown> | null {
  if (!("type" in subject) || !("attributes" in subject)) return null;
  return (subject as NodeRow).attributes as Record<string, unknown>;
}

function nodeOfType(subject: NodeRow | EdgeRow, type: string): NodeRow | null {
  if (!("type" in subject)) return null;
  const node = subject as NodeRow;
  return node.type === type ? node : null;
}

const BUILT_IN_CHECKS = new Map<string, GuardrailCheck>([
  [
    "naming.node.min_length",
    (subject, config) => {
      if (!("name" in subject)) return null;
      const min = Number(config["min"] ?? 3);
      if ((subject as NodeRow).name.length < min) {
        return {
          ruleKey: "naming.node.min_length",
          severity: "WARN",
          message: `Node name '${(subject as NodeRow).name}' is shorter than minimum ${min}`,
          nodeId: subject.id,
        };
      }
      return null;
    },
  ],
  [
    "lifecycle.review_cycle",
    (subject, config) => {
      if (!("lifecycleStatus" in subject)) return null;
      const node = subject as NodeRow;
      if (node.lifecycleStatus !== "ACTIVE") return null;
      const maxAgeDays = Number(config["maxAgeDays"] ?? 365);
      const ageMs = Date.now() - node.updatedAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays > maxAgeDays) {
        return {
          ruleKey: "lifecycle.review_cycle",
          severity: "WARN",
          message: `Node '${node.name}' has not been updated in ${Math.floor(ageDays)} days (max: ${maxAgeDays})`,
          nodeId: node.id,
        };
      }
      return null;
    },
  ],
  // ── GR-L3-004: ExternalSystem CRITICAL without fallbackStrategy ──────────────
  [
    "GR-L3-004",
    (subject) => {
      const node = nodeOfType(subject, "ExternalSystem");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs || attrs["criticality"] !== "CRITICAL") return null;
      const fallback = attrs["fallbackStrategy"] ?? attrs["fallback_strategy"];
      if (fallback && String(fallback).length >= 20) return null;
      return {
        ruleKey: "GR-L3-004",
        severity: "ERROR",
        message: `ExternalSystem '${node.name}' has criticality=CRITICAL but no fallbackStrategy (≥ 20 chars required)`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L3-005: ExternalSystem CRITICAL/HIGH without slaReference ─────────────
  [
    "GR-L3-005",
    (subject) => {
      const node = nodeOfType(subject, "ExternalSystem");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const criticality = attrs["criticality"];
      if (criticality !== "CRITICAL" && criticality !== "HIGH") return null;
      const sla = attrs["slaReference"] ?? attrs["sla_reference"];
      if (sla && String(sla).length >= 10) return null;
      return {
        ruleKey: "GR-L3-005",
        severity: "ERROR",
        message: `ExternalSystem '${node.name}' has criticality=${String(criticality)} but no slaReference (≥ 10 chars required)`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L3-009: ExternalSystem last review older than 180 days ───────────────
  [
    "GR-L3-009",
    (subject) => {
      const node = nodeOfType(subject, "ExternalSystem");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const dateStr = attrs["lastReviewDate"] ?? attrs["last_review_date"];
      if (!dateStr) return null;
      const reviewDate = new Date(String(dateStr));
      if (isNaN(reviewDate.getTime())) return null;
      const ageDays = (Date.now() - reviewDate.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays <= 180) return null;
      return {
        ruleKey: "GR-L3-009",
        severity: "WARN",
        message: `ExternalSystem '${node.name}' was last reviewed ${Math.floor(ageDays)} days ago (max: 180)`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L5-004: ExternalDependency CRITICAL without securityAuditDate ─────────
  [
    "GR-L5-004",
    (subject) => {
      const node = nodeOfType(subject, "ExternalDependency");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs || attrs["criticality"] !== "CRITICAL") return null;
      const auditDate = attrs["securityAuditDate"] ?? attrs["security_audit_date"];
      if (auditDate) return null;
      return {
        ruleKey: "GR-L5-004",
        severity: "ERROR",
        message: `ExternalDependency '${node.name}' has criticality=CRITICAL but no securityAuditDate`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L5-007: ExternalDependency with GPL-family license ───────────────────
  [
    "GR-L5-007",
    (subject) => {
      const node = nodeOfType(subject, "ExternalDependency");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const license = attrs["license"];
      if (typeof license !== "string" || !license.toUpperCase().startsWith("GPL")) return null;
      return {
        ruleKey: "GR-L5-007",
        severity: "WARN",
        message: `ExternalDependency '${node.name}' uses GPL-family license '${license}' which may impose copyleft obligations in commercial distribution`,
        nodeId: node.id,
      };
    },
  ],
]);

export class GuardrailsRegistry {
  constructor(private readonly sql: Sql) {}

  async loadEnabled(tenantId: string): Promise<GuardrailRow[]> {
    return this.sql<GuardrailRow[]>`
      SELECT * FROM guardrails
      WHERE tenant_id = ${tenantId} AND enabled = TRUE
      ORDER BY rule_key
    `;
  }

  // Returns enabled guardrails scoped to a node type, plus wildcard ('*') rules.
  // Output is the LLM-relevant subset of each rule: ruleKey/severity for triage
  // plus condition/rationale/remediation so the agent can self-assess before
  // writing. Per kap. 6.2 the framework still runs final validation — this
  // surface is advisory guidance, not a precommit gate.
  async getForType(
    tenantId: string,
    nodeType: string
  ): Promise<WriteGuidanceRule[]> {
    const rows = await this.sql<GuardrailRow[]>`
      SELECT * FROM guardrails
      WHERE tenant_id = ${tenantId}
        AND enabled = TRUE
        AND (config->>'object_type' = ${nodeType} OR config->>'object_type' = '*')
      ORDER BY rule_key
    `;
    return rows.map((row) => {
      const cfg = row.config ?? {};
      return {
        ruleKey: row.ruleKey,
        severity: row.severity,
        condition: typeof cfg["condition"] === "string" ? (cfg["condition"] as string) : "",
        rationale: typeof cfg["rationale"] === "string" ? (cfg["rationale"] as string) : row.description,
        remediation: typeof cfg["remediation"] === "string" ? (cfg["remediation"] as string) : "",
      };
    });
  }

  async evaluate(
    tenantId: string,
    subject: NodeRow | EdgeRow
  ): Promise<ViolationCandidate[]> {
    const rules = await this.loadEnabled(tenantId);
    return this.applyRules(rules, [subject]);
  }

  // Bulk evaluation for drift scans (kap. 5). Loads enabled rules ONCE and runs
  // each built-in check against every subject — O(rules * subjects) in memory,
  // one DB round-trip total. Returns the rule set it loaded so callers can
  // report `rulesEvaluated` without a second round-trip.
  async evaluateBatch(
    tenantId: string,
    subjects: ReadonlyArray<NodeRow | EdgeRow>
  ): Promise<{ rules: GuardrailRow[]; violations: ViolationCandidate[] }> {
    const rules = await this.loadEnabled(tenantId);
    if (subjects.length === 0) return { rules, violations: [] };
    return { rules, violations: this.applyRules(rules, subjects) };
  }

  private applyRules(
    rules: ReadonlyArray<GuardrailRow>,
    subjects: ReadonlyArray<NodeRow | EdgeRow>
  ): ViolationCandidate[] {
    const violations: ViolationCandidate[] = [];
    for (const subject of subjects) {
      const isEdge = "sourceId" in subject && "targetId" in subject;
      for (const rule of rules) {
        const check = BUILT_IN_CHECKS.get(rule.ruleKey);
        if (!check) continue;
        const v = check(subject, rule.config);
        if (!v) continue;
        // Edge violations always carry the offending endpoints so the violation
        // can be traced back to its source→target pair. Checks may
        // return only edgeId; the evaluator fills in source/target from the row.
        if (isEdge) {
          const edge = subject as EdgeRow;
          v.edgeId ??= edge.id;
          v.sourceNodeId ??= edge.sourceId;
          v.targetNodeId ??= edge.targetId;
        }
        violations.push(v);
      }
    }
    return violations;
  }

  async persistViolations(
    tenantId: string,
    violations: ViolationCandidate[]
  ): Promise<void> {
    if (violations.length === 0) return;
    const rows = violations.map((v) => ({
      tenantId,
      nodeId: v.nodeId ?? null,
      edgeId: v.edgeId ?? null,
      sourceNodeId: v.sourceNodeId ?? null,
      targetNodeId: v.targetNodeId ?? null,
      ruleKey: v.ruleKey,
      severity: v.severity,
      message: v.message,
    }));
    await this.sql`
      INSERT INTO violations ${this.sql(
        rows,
        "tenantId",
        "nodeId",
        "edgeId",
        "sourceNodeId",
        "targetNodeId",
        "ruleKey",
        "severity",
        "message",
      )}
      ON CONFLICT DO NOTHING
    `;
  }
}
