// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  ContextIntegrationAttributesSchema,
} from "../../../src/types/l2/context-map.js";
import { expectIssue } from "../../fixtures.js";

const base = {
  direction: "SOURCE_UPSTREAM",
  patternPrimary: "OPEN_HOST_SERVICE",
  patternSecondary: ["PUBLISHED_LANGUAGE"],
} as const;

describe("Context Map / context-integration attributes (A7)", () => {
  it("accepts well-formed integration attributes", () => {
    expect(ContextIntegrationAttributesSchema.parse(base)).toMatchObject({
      direction: "SOURCE_UPSTREAM",
      patternPrimary: "OPEN_HOST_SERVICE",
    });
  });

  it("defaults patternSecondary to empty array when omitted", () => {
    const { patternSecondary: _omitted, ...withoutSecondary } = base;
    expect(ContextIntegrationAttributesSchema.parse(withoutSecondary).patternSecondary).toEqual([]);
  });

  it("rejects patternSecondary length > 2", () => {
    expectIssue(
      ContextIntegrationAttributesSchema.safeParse({
        ...base,
        patternSecondary: ["PUBLISHED_LANGUAGE", "ACL", "CONFORMIST"],
      }),
      /at most 2/,
    );
  });

  it("rejects freetext direction (closed enum, A7)", () => {
    expectIssue(
      ContextIntegrationAttributesSchema.safeParse({ ...base, direction: "BIDIRECTIONAL" }),
      /Invalid enum value/,
    );
  });

  it("rejects freetext patternPrimary", () => {
    expectIssue(
      ContextIntegrationAttributesSchema.safeParse({ ...base, patternPrimary: "FRENEMIES" }),
      /Invalid enum value/,
    );
  });

  it("rejects patternSecondary containing patternPrimary (no double-counting)", () => {
    expectIssue(
      ContextIntegrationAttributesSchema.safeParse({
        ...base,
        patternSecondary: ["OPEN_HOST_SERVICE"],
      }),
      /must not contain patternPrimary/,
    );
  });

  it("rejects duplicate patternSecondary entries", () => {
    expectIssue(
      ContextIntegrationAttributesSchema.safeParse({
        ...base,
        patternSecondary: ["PUBLISHED_LANGUAGE", "PUBLISHED_LANGUAGE"],
      }),
      /must be unique/,
    );
  });

  it("rejects unknown extra fields (strict mode keeps the vocabulary closed)", () => {
    expectIssue(
      ContextIntegrationAttributesSchema.safeParse({ ...base, comment: "free text leak" }),
      /Unrecognized key/,
    );
  });
});
