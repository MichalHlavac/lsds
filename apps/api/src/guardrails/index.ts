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

const BUILT_IN_CHECKS: Map<string, GuardrailCheck> = new Map([
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
    const violations: ViolationCandidate[] = [];
    for (const rule of rules) {
      const check = BUILT_IN_CHECKS.get(rule.ruleKey);
      if (!check) continue;
      const v = check(subject, rule.config);
      if (v) violations.push(v);
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
      ruleKey: v.ruleKey,
      severity: v.severity,
      message: v.message,
    }));
    await this.sql`
      INSERT INTO violations ${this.sql(rows, "tenantId", "nodeId", "edgeId", "ruleKey", "severity", "message")}
      ON CONFLICT DO NOTHING
    `;
  }
}
