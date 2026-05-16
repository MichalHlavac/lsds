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

const SEMVER_RE = /^\d+\.\d+\.\d+/;

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
  // ── GR-L5-007: ExternalDependency with GPL-family license in COMMERCIAL context
  // Catalog condition: !(object.license matches 'GPL*' && config.distribution.context == 'COMMERCIAL')
  // Only flags GPL when the tenant has configured distribution.context = 'COMMERCIAL';
  // open-source and internal deployments are intentionally exempt.
  [
    "GR-L5-007",
    (subject, config) => {
      const node = nodeOfType(subject, "ExternalDependency");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const license = attrs["license"];
      if (typeof license !== "string" || !license.toUpperCase().startsWith("GPL")) return null;
      const distribution = config["distribution"] as Record<string, unknown> | undefined;
      if ((distribution?.["context"] as string | undefined) !== "COMMERCIAL") return null;
      return {
        ruleKey: "GR-L5-007",
        severity: "WARN",
        message: `ExternalDependency '${node.name}' uses GPL-family license '${license}' which may impose copyleft obligations in commercial distribution`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L1-002: BusinessGoal must have at least one success_metric ─────────────
  [
    "GR-L1-002",
    (subject) => {
      const node = nodeOfType(subject, "BusinessGoal");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const metrics = attrs["success_metrics"] ?? attrs["successMetrics"];
      if (Array.isArray(metrics) && metrics.length >= 1) return null;
      return {
        ruleKey: "GR-L1-002",
        severity: "ERROR",
        message: `BusinessGoal '${node.name}' has no success_metrics (at least 1 required)`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L1-003: Requirement.motivation non-null/non-empty ─────────────────────
  [
    "GR-L1-003",
    (subject) => {
      const node = nodeOfType(subject, "Requirement");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const motivation = attrs["motivation"];
      if (motivation && String(motivation).trim().length > 0) return null;
      return {
        ruleKey: "GR-L1-003",
        severity: "ERROR",
        message: `Requirement '${node.name}' has no motivation`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L1-004: Requirement must have at least one acceptance_criterion ────────
  [
    "GR-L1-004",
    (subject) => {
      const node = nodeOfType(subject, "Requirement");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const criteria = attrs["acceptance_criteria"] ?? attrs["acceptanceCriteria"];
      if (Array.isArray(criteria) && criteria.length >= 1) return null;
      return {
        ruleKey: "GR-L1-004",
        severity: "ERROR",
        message: `Requirement '${node.name}' has no acceptance_criteria (at least 1 required)`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L2-003: DomainEntity must have at least one invariant ─────────────────
  [
    "GR-L2-003",
    (subject) => {
      const node = nodeOfType(subject, "DomainEntity");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const invariants = attrs["invariants"];
      if (Array.isArray(invariants) && invariants.length >= 1) return null;
      return {
        ruleKey: "GR-L2-003",
        severity: "ERROR",
        message: `DomainEntity '${node.name}' has no invariants (at least 1 required)`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L2-004: Aggregate.transaction_boundary non-null ───────────────────────
  [
    "GR-L2-004",
    (subject) => {
      const node = nodeOfType(subject, "Aggregate");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const boundary = attrs["transaction_boundary"] ?? attrs["transactionBoundary"];
      if (boundary != null && String(boundary).trim().length > 0) return null;
      return {
        ruleKey: "GR-L2-004",
        severity: "ERROR",
        message: `Aggregate '${node.name}' has no transaction_boundary defined`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L3-001: ArchitectureComponent.technology non-null/non-empty ────────────
  [
    "GR-L3-001",
    (subject) => {
      const node = nodeOfType(subject, "ArchitectureComponent");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const technology = attrs["technology"];
      if (technology && String(technology).trim().length > 0) return null;
      return {
        ruleKey: "GR-L3-001",
        severity: "ERROR",
        message: `ArchitectureComponent '${node.name}' has no technology specified`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L3-002: ADR must have at least one alternative considered ──────────────
  [
    "GR-L3-002",
    (subject) => {
      const node = nodeOfType(subject, "ADR");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const alternatives = attrs["alternatives_considered"] ?? attrs["alternativesConsidered"];
      if (Array.isArray(alternatives) && alternatives.length >= 1) return null;
      return {
        ruleKey: "GR-L3-002",
        severity: "ERROR",
        message: `ADR '${node.name}' has no alternatives_considered (at least 1 required)`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L4-001: APIEndpoint must have at least one error_response ──────────────
  [
    "GR-L4-001",
    (subject) => {
      const node = nodeOfType(subject, "APIEndpoint");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const errorResponses = attrs["error_responses"] ?? attrs["errorResponses"];
      if (Array.isArray(errorResponses) && errorResponses.length >= 1) return null;
      return {
        ruleKey: "GR-L4-001",
        severity: "ERROR",
        message: `APIEndpoint '${node.name}' has no error_responses defined (at least 1 required)`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L4-002: APIEndpoint.response_schema non-null ──────────────────────────
  [
    "GR-L4-002",
    (subject) => {
      const node = nodeOfType(subject, "APIEndpoint");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const responseSchema = attrs["response_schema"] ?? attrs["responseSchema"];
      if (responseSchema != null) return null;
      return {
        ruleKey: "GR-L4-002",
        severity: "ERROR",
        message: `APIEndpoint '${node.name}' has no response_schema defined`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L4-003: EventContract ordering_guarantee AND delivery_guarantee non-null
  [
    "GR-L4-003",
    (subject) => {
      const node = nodeOfType(subject, "EventContract");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const ordering = attrs["ordering_guarantee"] ?? attrs["orderingGuarantee"];
      const delivery = attrs["delivery_guarantee"] ?? attrs["deliveryGuarantee"];
      if (ordering != null && delivery != null) return null;
      const missing = [
        ordering == null ? "ordering_guarantee" : null,
        delivery == null ? "delivery_guarantee" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        ruleKey: "GR-L4-003",
        severity: "ERROR",
        message: `EventContract '${node.name}' is missing required attributes: ${missing}`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L4-004: APIContract.version non-null AND valid semver ─────────────────
  [
    "GR-L4-004",
    (subject) => {
      const node = nodeOfType(subject, "APIContract");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const version = attrs["version"];
      if (typeof version === "string" && SEMVER_RE.test(version)) return null;
      return {
        ruleKey: "GR-L4-004",
        severity: "ERROR",
        message: `APIContract '${node.name}' has no valid semver version (got: ${String(version ?? "null")})`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L5-001: TechnicalDebt.rationale non-null/non-empty ────────────────────
  [
    "GR-L5-001",
    (subject) => {
      const node = nodeOfType(subject, "TechnicalDebt");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const rationale = attrs["rationale"];
      if (rationale && String(rationale).trim().length > 0) return null;
      return {
        ruleKey: "GR-L5-001",
        severity: "ERROR",
        message: `TechnicalDebt '${node.name}' has no rationale`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L5-002: CodeModule.repository_reference non-null ──────────────────────
  [
    "GR-L5-002",
    (subject) => {
      const node = nodeOfType(subject, "CodeModule");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const repoRef = attrs["repository_reference"] ?? attrs["repositoryReference"];
      if (repoRef != null && String(repoRef).trim().length > 0) return null;
      return {
        ruleKey: "GR-L5-002",
        severity: "ERROR",
        message: `CodeModule '${node.name}' has no repository_reference`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L6-001: InfrastructureComponent.iac_reference non-null ────────────────
  [
    "GR-L6-001",
    (subject) => {
      const node = nodeOfType(subject, "InfrastructureComponent");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const iacRef = attrs["iac_reference"] ?? attrs["iacReference"];
      if (iacRef != null && String(iacRef).trim().length > 0) return null;
      return {
        ruleKey: "GR-L6-001",
        severity: "ERROR",
        message: `InfrastructureComponent '${node.name}' has no iac_reference`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L6-002: Alert.runbook_reference non-null ───────────────────────────────
  [
    "GR-L6-002",
    (subject) => {
      const node = nodeOfType(subject, "Alert");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const runbookRef = attrs["runbook_reference"] ?? attrs["runbookReference"];
      if (runbookRef != null && String(runbookRef).trim().length > 0) return null;
      return {
        ruleKey: "GR-L6-002",
        severity: "ERROR",
        message: `Alert '${node.name}' has no runbook_reference`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L6-006: Environment (PRODUCTION/DR) must have iac_reference ────────────
  [
    "GR-L6-006",
    (subject) => {
      const node = nodeOfType(subject, "Environment");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const envType = attrs["environment_type"] ?? attrs["environmentType"];
      if (envType !== "PRODUCTION" && envType !== "DR") return null;
      const iacRef = attrs["iac_reference"] ?? attrs["iacReference"];
      if (iacRef != null && String(iacRef).trim().length > 0) return null;
      return {
        ruleKey: "GR-L6-006",
        severity: "ERROR",
        message: `Environment '${node.name}' (${String(envType)}) has no iac_reference (required for PRODUCTION/DR)`,
        nodeId: node.id,
      };
    },
  ],
  // ── GR-L6-007: Environment (PRODUCTION/DR) must have promotion_gate ──────────
  [
    "GR-L6-007",
    (subject) => {
      const node = nodeOfType(subject, "Environment");
      if (!node) return null;
      const attrs = nodeAttrs(subject);
      if (!attrs) return null;
      const envType = attrs["environment_type"] ?? attrs["environmentType"];
      if (envType !== "PRODUCTION" && envType !== "DR") return null;
      const promotionGate = attrs["promotion_gate"] ?? attrs["promotionGate"];
      if (promotionGate != null && String(promotionGate).trim().length > 0) return null;
      return {
        ruleKey: "GR-L6-007",
        severity: "ERROR",
        message: `Environment '${node.name}' (${String(envType)}) has no promotion_gate (required for PRODUCTION/DR)`,
        nodeId: node.id,
      };
    },
  ],

  // ── Phase 2: Relationship-traversal rules ────────────────────────────────────

  // ── GR-XL-002: Relationship targets a non-existent object ────────────────────
  // Callers pre-populate attributes.targetExists = false when the target cannot
  // be resolved; the check fires on that signal.
  [
    "GR-XL-002",
    (subject) => {
      if (!("sourceId" in subject)) return null;
      const edge = subject as EdgeRow;
      const attrs = edge.attributes as Record<string, unknown>;
      const exists = attrs?.["targetExists"] ?? attrs?.["target_exists"];
      if (exists !== false) return null;
      return {
        ruleKey: "GR-XL-002",
        severity: "ERROR",
        message: `Relationship '${edge.type}' from '${edge.sourceId}' targets non-existent object '${edge.targetId}'`,
        edgeId: edge.id,
        sourceNodeId: edge.sourceId,
        targetNodeId: edge.targetId,
      };
    },
  ],

  // ── GR-XL-003: Relationship violates layer rules ──────────────────────────────
  // Checks that the numeric distance between source and target layers does not
  // exceed config.maxLayerDistance (default 2). Requires attributes.sourceLayer
  // and attributes.targetLayer (or snake_case variants) to be pre-populated.
  [
    "GR-XL-003",
    (subject, config) => {
      if (!("sourceId" in subject)) return null;
      const edge = subject as EdgeRow;
      const attrs = edge.attributes as Record<string, unknown>;
      const srcStr = String(attrs?.["sourceLayer"] ?? attrs?.["source_layer"] ?? "");
      const tgtStr = String(attrs?.["targetLayer"] ?? attrs?.["target_layer"] ?? "");
      if (!srcStr.startsWith("L") || !tgtStr.startsWith("L")) return null;
      const srcNum = parseInt(srcStr.slice(1), 10);
      const tgtNum = parseInt(tgtStr.slice(1), 10);
      if (isNaN(srcNum) || isNaN(tgtNum)) return null;
      const maxDist = Number(config["maxLayerDistance"] ?? 2);
      const dist = Math.abs(srcNum - tgtNum);
      if (dist <= maxDist) return null;
      return {
        ruleKey: "GR-XL-003",
        severity: "ERROR",
        message: `Relationship '${edge.type}' crosses from ${srcStr} to ${tgtStr} (distance ${dist}, max allowed ${maxDist})`,
        edgeId: edge.id,
        sourceNodeId: edge.sourceId,
        targetNodeId: edge.targetId,
      };
    },
  ],

  // ── GR-XL-004: Archiving an object with ACTIVE incoming dependents ────────────
  // Callers pre-populate attributes.activeIncomingCount with the count of ACTIVE
  // nodes that have an incoming relationship targeting this node.
  // Uses "name" in subject (NodeRow-only field) to discriminate nodes from edges,
  // since EdgeRow also carries lifecycleStatus in the production schema.
  [
    "GR-XL-004",
    (subject) => {
      if (!("name" in subject)) return null;
      const node = subject as NodeRow;
      if (node.lifecycleStatus !== "ARCHIVED") return null;
      const attrs = node.attributes as Record<string, unknown>;
      const count = Number(attrs?.["activeIncomingCount"] ?? attrs?.["active_incoming_count"] ?? 0);
      if (count === 0) return null;
      return {
        ruleKey: "GR-XL-004",
        severity: "ERROR",
        message: `Node '${node.name}' is ARCHIVED but has ${count} ACTIVE incoming dependent(s); archive or migrate dependents first`,
        nodeId: node.id,
      };
    },
  ],

  // ── GR-XL-006: DEPRECATED object still has active depends-on dependents ───────
  // Callers pre-populate attributes.activeDependsOnCount with the count of ACTIVE
  // nodes that depend-on this node.
  [
    "GR-XL-006",
    (subject) => {
      if (!("name" in subject)) return null;
      const node = subject as NodeRow;
      if (node.lifecycleStatus !== "DEPRECATED") return null;
      const attrs = node.attributes as Record<string, unknown>;
      const count = Number(attrs?.["activeDependsOnCount"] ?? attrs?.["active_depends_on_count"] ?? 0);
      if (count === 0) return null;
      return {
        ruleKey: "GR-XL-006",
        severity: "WARN",
        message: `Node '${node.name}' is DEPRECATED but has ${count} ACTIVE depends-on dependent(s); open migration tasks for each`,
        nodeId: node.id,
      };
    },
  ],

  // ── GR-XL-010: ARCHIVED object has non-archived contains children ─────────────
  // Callers pre-populate attributes.nonArchivedContainsCount with the count of
  // contains-children that are not yet ARCHIVED or PURGE.
  [
    "GR-XL-010",
    (subject) => {
      if (!("name" in subject)) return null;
      const node = subject as NodeRow;
      if (node.lifecycleStatus !== "ARCHIVED") return null;
      const attrs = node.attributes as Record<string, unknown>;
      const count = Number(attrs?.["nonArchivedContainsCount"] ?? attrs?.["non_archived_contains_count"] ?? 0);
      if (count === 0) return null;
      return {
        ruleKey: "GR-XL-010",
        severity: "ERROR",
        message: `Node '${node.name}' is ARCHIVED but has ${count} non-archived contained child(ren); archive children before the parent`,
        nodeId: node.id,
      };
    },
  ],

  // ── GR-L5-003: DOMAIN CodeModule depends-on INFRASTRUCTURE module ─────────────
  // Edge-based check. Requires attributes.sourceModuleType and
  // attributes.targetModuleType (or snake_case variants) to be pre-populated.
  [
    "GR-L5-003",
    (subject) => {
      if (!("sourceId" in subject)) return null;
      const edge = subject as EdgeRow;
      if (edge.type !== "depends-on") return null;
      const attrs = edge.attributes as Record<string, unknown>;
      const srcType = attrs?.["sourceModuleType"] ?? attrs?.["source_module_type"];
      const tgtType = attrs?.["targetModuleType"] ?? attrs?.["target_module_type"];
      if (srcType !== "DOMAIN" || tgtType !== "INFRASTRUCTURE") return null;
      return {
        ruleKey: "GR-L5-003",
        severity: "ERROR",
        message: `DOMAIN CodeModule (edge '${edge.id}') depends-on INFRASTRUCTURE module; invert the dependency using a port/adapter pattern`,
        edgeId: edge.id,
        sourceNodeId: edge.sourceId,
        targetNodeId: edge.targetId,
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
