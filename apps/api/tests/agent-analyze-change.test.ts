// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// E2E contract tests for POST /agent/v1/architect/analyze-change (ADR A4).
//
// Coverage:
//   - Positive test per layer (L1–L6): correct policy + decision status returned
//   - Negative test per layer: contradictory input rejected with 422
//   - L3/L4 boundary: ambiguous confirmation mis-route returns 422 (AUTO_WITH_OVERRIDE
//     does not accept confirmation — that is the signal that triggers CTO escalation)
//   - L5/L6 AUTO: always passes without confirmation or override
//   - L1/L2 REQUIRE_CONFIRMATION: gate blocks until confirmation is provided
//   - Zod validation: unknown layer/kind and short override rationale → 400
//
// No database writes — this endpoint is a pure ADR A4 policy gate.

import { describe, it, expect } from "vitest";
import { app } from "../src/app";

const HEADERS = { "content-type": "application/json", "x-tenant-id": "policy-tests" };

const post = (body: unknown) =>
  app.request("/agent/v1/architect/analyze-change", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

// Shared fixtures ─────────────────────────────────────────────────────────────

const override = (severity: string, rationale = "Required change with cross-layer blast radius") => ({
  severity,
  rationale,
  overriddenBy: "architect-agent",
  overriddenAt: "2026-05-08T00:00:00.000Z",
});

const confirmation = (severity: string) => ({
  severity,
  confirmedBy: "domain-owner@example.com",
  confirmedAt: "2026-05-08T00:00:00.000Z",
});

// ── L1 (Business) — REQUIRE_CONFIRMATION ─────────────────────────────────────

describe("L1 — REQUIRE_CONFIRMATION", () => {
  it("[positive] RENAME without confirmation → PENDING_CONFIRMATION gate", async () => {
    const res = await post({ layer: "L1", kind: "RENAME" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("PENDING_CONFIRMATION");
    expect(data.decisionStatus).toBe("PENDING_CONFIRMATION");
    expect(data.policy).toBe("REQUIRE_CONFIRMATION");
    expect(data.proposedSeverity).toBe("MAJOR");
    expect(data.effectiveSeverity).toBeNull();
    expect(data.propagation).toBeNull();
  });

  it("[positive] RENAME with confirmation → CONFIRMED and propagation applied", async () => {
    const res = await post({ layer: "L1", kind: "RENAME", confirmation: confirmation("MAJOR") });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("CONFIRMED");
    expect(data.policy).toBe("REQUIRE_CONFIRMATION");
    expect(data.proposedSeverity).toBe("MAJOR");
    expect(data.effectiveSeverity).toBe("MAJOR");
    expect(data.propagation.mode).toBe("ALL_RELATIONSHIPS");
    expect(data.propagation.staleSeverity).toBe("ERROR");
  });

  it("[negative] RENAME with override instead of confirmation → 422", async () => {
    const res = await post({ layer: "L1", kind: "RENAME", override: override("MINOR") });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/REQUIRE_CONFIRMATION/);
  });
});

// ── L2 (Domain) — REQUIRE_CONFIRMATION ───────────────────────────────────────

describe("L2 — REQUIRE_CONFIRMATION", () => {
  it("[positive] TYPE_CHANGE without confirmation → PENDING_CONFIRMATION gate", async () => {
    const res = await post({ layer: "L2", kind: "TYPE_CHANGE" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("PENDING_CONFIRMATION");
    expect(data.decisionStatus).toBe("PENDING_CONFIRMATION");
    expect(data.policy).toBe("REQUIRE_CONFIRMATION");
    expect(data.proposedSeverity).toBe("MAJOR");
    expect(data.effectiveSeverity).toBeNull();
  });

  it("[positive] DESCRIPTION_CHANGED with confirmation → CONFIRMED (PATCH severity)", async () => {
    const res = await post({
      layer: "L2",
      kind: "DESCRIPTION_CHANGED",
      confirmation: confirmation("PATCH"),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("CONFIRMED");
    expect(data.effectiveSeverity).toBe("PATCH");
    expect(data.propagation.mode).toBe("DIRECT_PARENTS");
    expect(data.propagation.staleSeverity).toBe("INFO");
  });

  it("[negative] TYPE_CHANGE with override on REQUIRE_CONFIRMATION layer → 422", async () => {
    const res = await post({ layer: "L2", kind: "TYPE_CHANGE", override: override("MINOR") });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/REQUIRE_CONFIRMATION/);
  });
});

// ── L3 (Architecture) — AUTO_WITH_OVERRIDE ───────────────────────────────────

describe("L3 — AUTO_WITH_OVERRIDE", () => {
  it("[positive] RELATIONSHIP_ADDED without override → AUTO_APPLIED (MINOR)", async () => {
    const res = await post({ layer: "L3", kind: "RELATIONSHIP_ADDED" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("AUTO_APPLIED");
    expect(data.policy).toBe("AUTO_WITH_OVERRIDE");
    expect(data.proposedSeverity).toBe("MINOR");
    expect(data.effectiveSeverity).toBe("MINOR");
    expect(data.propagation.mode).toBe("SELECTED_RELATIONSHIPS");
    expect(data.propagation.staleSeverity).toBe("WARNING");
    expect(data.propagation.selectedRelationships).toContain("realizes");
  });

  it("[positive] RELATIONSHIP_ADDED with override escalates to MAJOR", async () => {
    const res = await post({
      layer: "L3",
      kind: "RELATIONSHIP_ADDED",
      override: override("MAJOR"),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("OVERRIDDEN");
    expect(data.proposedSeverity).toBe("MINOR");
    expect(data.effectiveSeverity).toBe("MAJOR");
    expect(data.propagation.mode).toBe("ALL_RELATIONSHIPS");
  });

  // L3/L4 boundary: supplying a confirmation (L1/L2 flow) on an AUTO_WITH_OVERRIDE
  // layer is the signal that a change is mis-routed. The endpoint rejects it with 422;
  // the calling agent should escalate to CTO for re-classification.
  it("[negative/boundary] RELATIONSHIP_ADDED with confirmation on L3 → 422 (triggers CTO escalation)", async () => {
    const res = await post({
      layer: "L3",
      kind: "RELATIONSHIP_ADDED",
      confirmation: confirmation("MINOR"),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/AUTO_WITH_OVERRIDE/);
  });
});

// ── L4 (Application) — AUTO_WITH_OVERRIDE ────────────────────────────────────

describe("L4 — AUTO_WITH_OVERRIDE", () => {
  it("[positive] DESCRIPTION_CHANGED without override → AUTO_APPLIED (PATCH)", async () => {
    const res = await post({ layer: "L4", kind: "DESCRIPTION_CHANGED" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("AUTO_APPLIED");
    expect(data.policy).toBe("AUTO_WITH_OVERRIDE");
    expect(data.proposedSeverity).toBe("PATCH");
    expect(data.effectiveSeverity).toBe("PATCH");
    expect(data.propagation.mode).toBe("DIRECT_PARENTS");
  });

  it("[positive] RENAME with override downgrades to PATCH", async () => {
    const res = await post({
      layer: "L4",
      kind: "RENAME",
      override: override("PATCH"),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("OVERRIDDEN");
    expect(data.proposedSeverity).toBe("MAJOR");
    expect(data.effectiveSeverity).toBe("PATCH");
  });

  it("[negative/boundary] DESCRIPTION_CHANGED with confirmation on L4 → 422 (mis-routed confirmation)", async () => {
    const res = await post({
      layer: "L4",
      kind: "DESCRIPTION_CHANGED",
      confirmation: confirmation("PATCH"),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/AUTO_WITH_OVERRIDE/);
  });
});

// ── L5 (Code) — AUTO ──────────────────────────────────────────────────────────

describe("L5 — AUTO", () => {
  it("[positive] TAGS_CHANGED → AUTO_APPLIED without any input", async () => {
    const res = await post({ layer: "L5", kind: "TAGS_CHANGED" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("AUTO_APPLIED");
    expect(data.policy).toBe("AUTO");
    expect(data.proposedSeverity).toBe("PATCH");
    expect(data.effectiveSeverity).toBe("PATCH");
  });

  it("[positive] RENAME with override (frictionless L5 escape hatch) → OVERRIDDEN", async () => {
    const res = await post({
      layer: "L5",
      kind: "RENAME",
      override: override("PATCH"),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("OVERRIDDEN");
    expect(data.proposedSeverity).toBe("MAJOR");
    expect(data.effectiveSeverity).toBe("PATCH");
  });

  it("[negative] TAGS_CHANGED with confirmation on AUTO layer → 422", async () => {
    const res = await post({
      layer: "L5",
      kind: "TAGS_CHANGED",
      confirmation: confirmation("PATCH"),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/AUTO/);
  });
});

// ── L6 (Environment) — AUTO ───────────────────────────────────────────────────

describe("L6 — AUTO", () => {
  it("[positive] METADATA_CHANGED → AUTO_APPLIED (PATCH + DIRECT_PARENTS propagation)", async () => {
    const res = await post({ layer: "L6", kind: "METADATA_CHANGED" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("AUTO_APPLIED");
    expect(data.policy).toBe("AUTO");
    expect(data.proposedSeverity).toBe("PATCH");
    expect(data.effectiveSeverity).toBe("PATCH");
    expect(data.propagation.mode).toBe("DIRECT_PARENTS");
  });

  it("[positive] ENUM_VALUE_CHANGED → AUTO_APPLIED (MINOR + SELECTED_RELATIONSHIPS)", async () => {
    const res = await post({ layer: "L6", kind: "ENUM_VALUE_CHANGED" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("APPLIED");
    expect(data.decisionStatus).toBe("AUTO_APPLIED");
    expect(data.policy).toBe("AUTO");
    expect(data.proposedSeverity).toBe("MINOR");
    expect(data.propagation.mode).toBe("SELECTED_RELATIONSHIPS");
  });

  it("[negative] both override AND confirmation supplied → 422 (contradictory input)", async () => {
    const res = await post({
      layer: "L6",
      kind: "METADATA_CHANGED",
      override: override("PATCH"),
      confirmation: confirmation("PATCH"),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/override OR confirmation/);
  });
});

// ── Zod input validation (400) ────────────────────────────────────────────────

describe("input validation", () => {
  it("unknown layer → 400", async () => {
    const res = await post({ layer: "L9", kind: "RENAME" });
    expect(res.status).toBe(400);
  });

  it("unknown kind → 400", async () => {
    const res = await post({ layer: "L3", kind: "INVENTED_CHANGE" });
    expect(res.status).toBe(400);
  });

  it("missing body fields → 400", async () => {
    const res = await post({ layer: "L3" });
    expect(res.status).toBe(400);
  });

  it("override rationale shorter than 20 chars → 400 (Zod ChangeOverrideSchema)", async () => {
    const res = await post({
      layer: "L3",
      kind: "RENAME",
      override: { severity: "MINOR", rationale: "too short", overriddenBy: "agent", overriddenAt: "2026-05-08T00:00:00.000Z" },
    });
    expect(res.status).toBe(400);
  });

  it("empty JSON body → 400", async () => {
    const res = await app.request("/agent/v1/architect/analyze-change", {
      method: "POST",
      headers: HEADERS,
      body: "{}",
    });
    expect(res.status).toBe(400);
  });
});
