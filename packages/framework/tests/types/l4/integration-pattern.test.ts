// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  INTEGRATION_PATTERN_TRAVERSAL_WEIGHT,
  INTEGRATION_PATTERN_TYPES,
  IntegrationPatternSchema,
} from "../../../src/types/l4/integration-pattern.js";
import { expectIssue } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const basePattern = {
  ...tknBase({
    type: "IntegrationPattern",
    layer: "L4",
    name: "billing.outbox",
  }),
  description:
    "Transactional outbox between billing-service and the event bus to bridge ACID writes with at-least-once event delivery.",
  patternType: "OUTBOX" as const,
  rationale:
    "Avoids dual-writes by committing the event to the outbox table inside the same transaction as the domain write; a relay polls the outbox and publishes to Kafka.",
  referenceUrl: "https://microservices.io/patterns/data/transactional-outbox.html",
};

describe("IntegrationPattern (kap. 4 § L4)", () => {
  it("accepts a fully populated outbox pattern", () => {
    expect(IntegrationPatternSchema.parse(basePattern)).toMatchObject({
      type: "IntegrationPattern",
      layer: "L4",
      patternType: "OUTBOX",
    });
  });

  it("rejects too-short description (< 30 chars)", () => {
    expectIssue(
      IntegrationPatternSchema.safeParse({ ...basePattern, description: "outbox" }),
      /description must explain/,
    );
  });

  it("rejects too-short rationale (< 30 chars)", () => {
    expectIssue(
      IntegrationPatternSchema.safeParse({ ...basePattern, rationale: "TBD" }),
      /rationale must explain why this pattern was chosen/,
    );
  });

  it("rejects unknown patternType (closed enum)", () => {
    expectIssue(
      IntegrationPatternSchema.safeParse({ ...basePattern, patternType: "EVENT_SOURCING" }),
      /Invalid enum value/,
    );
  });

  it("rejects malformed referenceUrl when supplied", () => {
    expectIssue(
      IntegrationPatternSchema.safeParse({ ...basePattern, referenceUrl: "not-a-url" }),
      /Invalid url/,
    );
  });

  it("declares LAZY traversal weight (patterns are reference material, not hot path)", () => {
    expect(INTEGRATION_PATTERN_TRAVERSAL_WEIGHT).toBe("LAZY");
  });

  it("enumerates 11 well-known integration patterns", () => {
    expect(INTEGRATION_PATTERN_TYPES).toHaveLength(11);
  });
});
