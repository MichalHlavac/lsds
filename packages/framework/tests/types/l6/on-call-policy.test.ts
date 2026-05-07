// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  COVERAGE_TYPES,
  OnCallPolicySchema,
} from "../../../src/types/l6/on-call-policy.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const samplePerson = {
  kind: "person" as const,
  id: "person-pat",
  name: "Pat Patterson",
};

const baseLevels = [
  {
    level: 1,
    respondent: sampleTeam,
    escalationDelay: "PT0S",
    notificationChannels: ["pagerduty:primary"],
  },
  {
    level: 2,
    respondent: samplePerson,
    escalationDelay: "PT15M",
    notificationChannels: ["pagerduty:secondary", "slack:#oncall"],
  },
];

const basePolicy = {
  ...tknBase({ type: "OnCallPolicy", layer: "L6", name: "checkout-oncall" }),
  description: "Primary on-call rotation for the checkout service.",
  owner: sampleTeam,
  coverage: "ROTATING_WEEKLY" as const,
  escalationLevels: baseLevels,
  responseTimeSla: { p1: "PT15M", p2: "PT1H", p3: "PT4H" },
};

describe("OnCallPolicy (kap. 4 § L6, lines 637–682)", () => {
  it("accepts a fully populated policy", () => {
    expect(OnCallPolicySchema.parse(basePolicy)).toMatchObject({
      type: "OnCallPolicy",
      layer: "L6",
      coverage: "ROTATING_WEEKLY",
    });
  });

  it("accepts a single-level policy (≥ 1 level required)", () => {
    expect(
      OnCallPolicySchema.parse({
        ...basePolicy,
        escalationLevels: [
          {
            level: 1,
            respondent: sampleTeam,
            escalationDelay: "PT0S",
            notificationChannels: ["pagerduty:primary"],
          },
        ],
      }),
    ).toMatchObject({ type: "OnCallPolicy" });
  });

  it("rejects empty escalationLevels", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({ ...basePolicy, escalationLevels: [] }),
      /must contain ≥ 1 level/,
    );
  });

  it("rejects non-contiguous escalation levels (1, 3 — missing 2)", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          {
            level: 1,
            respondent: sampleTeam,
            escalationDelay: "PT0S",
            notificationChannels: ["pagerduty:primary"],
          },
          {
            level: 3,
            respondent: sampleTeam,
            escalationDelay: "PT30M",
            notificationChannels: ["email:lead"],
          },
        ],
      }),
      /numbered 1\.\.N contiguously/,
    );
  });

  it("rejects duplicate level numbers", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          {
            level: 1,
            respondent: sampleTeam,
            escalationDelay: "PT0S",
            notificationChannels: ["pagerduty:primary"],
          },
          {
            level: 1,
            respondent: samplePerson,
            escalationDelay: "PT0S",
            notificationChannels: ["pagerduty:secondary"],
          },
        ],
      }),
      /numbered 1\.\.N contiguously/,
    );
  });

  it("rejects escalation levels that don't start at 1", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          {
            level: 2,
            respondent: sampleTeam,
            escalationDelay: "PT0S",
            notificationChannels: ["pagerduty:primary"],
          },
        ],
      }),
      /numbered 1\.\.N contiguously/,
    );
  });

  it("rejects level=1 with non-zero escalationDelay (primary is paged at t=0)", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          {
            level: 1,
            respondent: sampleTeam,
            escalationDelay: "PT5M",
            notificationChannels: ["pagerduty:primary"],
          },
          {
            level: 2,
            respondent: samplePerson,
            escalationDelay: "PT15M",
            notificationChannels: ["slack:#oncall"],
          },
        ],
      }),
      /level=1\].escalationDelay must be PT0S/,
    );
  });

  it("rejects escalation level with no notification channels", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          {
            level: 1,
            respondent: sampleTeam,
            escalationDelay: "PT0S",
            notificationChannels: [],
          },
        ],
      }),
      /must list ≥ 1 channel/,
    );
  });

  it("requires p1 SLA (kap. 4 invariant — GR-L6-008)", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        responseTimeSla: { p2: "PT1H" },
      }),
      /Required/,
    );
  });

  it("requires p2 SLA (kap. 4 spec — p2 is mandatory alongside p1)", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        responseTimeSla: { p1: "PT15M" },
      }),
      /Required/,
    );
  });

  it("accepts policy without optional p3/p4", () => {
    const parsed = OnCallPolicySchema.parse({
      ...basePolicy,
      responseTimeSla: { p1: "PT15M", p2: "PT1H" },
    });
    expect(parsed.responseTimeSla.p3).toBeUndefined();
    expect(parsed.responseTimeSla.p4).toBeUndefined();
  });

  it("rejects unknown coverage type (closed enum)", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({ ...basePolicy, coverage: "BEST_EFFORT" }),
      /Invalid enum value/,
    );
  });

  it("rejects layer other than L6", () => {
    expectIssue(OnCallPolicySchema.safeParse({ ...basePolicy, layer: "L5" }), /Invalid literal value/);
  });

  it("rejects p1 that is not a valid ISO duration", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        responseTimeSla: { p1: "15 minutes", p2: "PT1H" },
      }),
      /ISO-8601 duration/,
    );
  });


  it("exposes all 4 coverage types (closed enum)", () => {
    expect(COVERAGE_TYPES).toEqual([
      "FOLLOW_THE_SUN",
      "ROTATING_WEEKLY",
      "ROTATING_DAILY",
      "DEDICATED",
    ]);
  });
});
