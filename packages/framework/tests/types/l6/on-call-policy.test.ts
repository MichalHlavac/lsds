// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  ON_CALL_POLICY_TRAVERSAL_WEIGHT,
  ONCALL_COVERAGE_MODES,
  OnCallPolicySchema,
} from "../../../src/types/l6/on-call-policy.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const samplePerson = {
  kind: "person" as const,
  id: "person-jane-doe",
  name: "Jane Doe",
};

const basePolicy = {
  ...tknBase({ type: "OnCallPolicy", layer: "L6", name: "checkout-api-oncall" }),
  description: "Coverage for the checkout-api Service across PROD regions.",
  owner: sampleTeam,
  coverage: "ROTATING_WEEKLY" as const,
  escalationLevels: [
    {
      level: 1,
      respondent: sampleTeam,
      escalationDelay: "PT0S",
      notificationChannels: ["pagerduty", "slack"],
    },
    {
      level: 2,
      respondent: samplePerson,
      escalationDelay: "PT15M",
      notificationChannels: ["pagerduty"],
    },
  ],
  responseTimeSla: {
    p1: "PT15M",
    p2: "PT1H",
  },
};

describe("OnCallPolicy (kap. 4 § L6)", () => {
  it("accepts a fully populated policy with team primary + person secondary", () => {
    expect(OnCallPolicySchema.parse(basePolicy)).toMatchObject({
      type: "OnCallPolicy",
      layer: "L6",
      coverage: "ROTATING_WEEKLY",
    });
  });

  it("accepts optional p3/p4 SLAs", () => {
    const parsed = OnCallPolicySchema.parse({
      ...basePolicy,
      responseTimeSla: { p1: "PT15M", p2: "PT1H", p3: "PT4H", p4: "P1D" },
    });
    expect(parsed.responseTimeSla.p3).toBe("PT4H");
    expect(parsed.responseTimeSla.p4).toBe("P1D");
  });

  it("rejects empty escalationLevels", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({ ...basePolicy, escalationLevels: [] }),
      /at least one level/,
    );
  });

  it("rejects gap in escalation levels (1, 3)", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          { ...basePolicy.escalationLevels[0], level: 1 },
          { ...basePolicy.escalationLevels[1], level: 3 },
        ],
      }),
      /must be 2 \(levels are contiguous starting at 1\)/,
    );
  });

  it("rejects primary level not starting at 1", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          { ...basePolicy.escalationLevels[0], level: 2 },
        ],
      }),
      /must be 1/,
    );
  });

  it("rejects non-zero escalationDelay on primary level", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          { ...basePolicy.escalationLevels[0], escalationDelay: "PT5M" },
          basePolicy.escalationLevels[1],
        ],
      }),
      /primary level pages immediately/,
    );
  });

  it("accepts P0D as a zero-duration form on primary level", () => {
    const parsed = OnCallPolicySchema.parse({
      ...basePolicy,
      escalationLevels: [
        { ...basePolicy.escalationLevels[0], escalationDelay: "P0D" },
        basePolicy.escalationLevels[1],
      ],
    });
    expect(parsed.escalationLevels[0].escalationDelay).toBe("P0D");
  });

  it("rejects empty notificationChannels", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          { ...basePolicy.escalationLevels[0], notificationChannels: [] },
          basePolicy.escalationLevels[1],
        ],
      }),
      /at least one channel/,
    );
  });

  it("rejects empty channel string inside notificationChannels", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          { ...basePolicy.escalationLevels[0], notificationChannels: [""] },
          basePolicy.escalationLevels[1],
        ],
      }),
      /entries must be non-empty/,
    );
  });

  it("rejects unknown coverage mode (closed enum)", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({ ...basePolicy, coverage: "ON_DEMAND" }),
      /Invalid enum value/,
    );
  });

  it("rejects missing p1 in responseTimeSla", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        responseTimeSla: { p2: "PT1H" },
      }),
      /Required/,
    );
  });

  it("rejects missing p2 in responseTimeSla", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        responseTimeSla: { p1: "PT15M" },
      }),
      /Required/,
    );
  });

  it("rejects malformed ISO duration in responseTimeSla.p1", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        responseTimeSla: { p1: "15m", p2: "PT1H" },
      }),
      /ISO-8601 duration/,
    );
  });

  it("rejects respondent that is neither team nor person", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({
        ...basePolicy,
        escalationLevels: [
          {
            ...basePolicy.escalationLevels[0],
            respondent: { kind: "robot", id: "bot-1", name: "Bot" },
          },
          basePolicy.escalationLevels[1],
        ],
      }),
      /Invalid discriminator value/,
    );
  });

  it("rejects layer mismatch", () => {
    expectIssue(
      OnCallPolicySchema.safeParse({ ...basePolicy, layer: "L5" }),
      /Invalid literal value/,
    );
  });

  it("declares EAGER traversal weight", () => {
    expect(ON_CALL_POLICY_TRAVERSAL_WEIGHT).toBe("EAGER");
  });

  it("exposes 4 coverage modes (closed enum)", () => {
    expect(ONCALL_COVERAGE_MODES).toHaveLength(4);
  });
});
