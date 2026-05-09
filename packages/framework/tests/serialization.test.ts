// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  NdjsonEdgeSchema,
  NdjsonNodeSchema,
  NdjsonParseError,
  NdjsonRecordSchema,
  WIRE_OMITTED_EDGE_FIELDS,
  WIRE_OMITTED_NODE_BASE_FIELDS,
  parseEdgeRecord,
  parseNodeRecord,
  parseRecord,
  serializeEdge,
  serializeNode,
} from "../src/serialization.js";
import { TknBaseSchema } from "../src/shared/base.js";
import { RelationshipEdgeSchema } from "../src/relationship/types.js";

const owner = { kind: "team" as const, id: "team-platform", name: "Platform" };

const baseNode = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "BusinessGoal",
  layer: "L1" as const,
  name: "Reach 100k MAU",
  version: "1.0.0",
  lifecycle: "ACTIVE" as const,
  owner,
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-02-01T10:00:00.000Z",
  attributes: { description: "drives Q1 product strategy" },
};

const baseEdge = {
  id: "22222222-2222-2222-2222-222222222222",
  type: "realizes" as const,
  sourceId: "33333333-3333-3333-3333-333333333333",
  targetId: "44444444-4444-4444-4444-444444444444",
  sourceLayer: "L4" as const,
  targetLayer: "L3" as const,
  traversalWeight: 1.0,
  lifecycle: "ACTIVE" as const,
  attributes: {},
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T10:00:00.000Z",
};

describe("NdjsonNodeSchema / NdjsonEdgeSchema — strict wire shapes", () => {
  it("accepts a canonical node record produced by serializeNode", () => {
    const record = serializeNode(baseNode);
    expect(NdjsonNodeSchema.safeParse(record).success).toBe(true);
    expect(record.kind).toBe("node");
  });

  it("accepts a canonical edge record produced by serializeEdge", () => {
    const record = serializeEdge(baseEdge);
    expect(NdjsonEdgeSchema.safeParse(record).success).toBe(true);
    expect(record.kind).toBe("edge");
  });

  it("rejects unknown top-level fields on node (strict catches forward drift)", () => {
    const tampered = { ...serializeNode(baseNode), bogus: 1 } as Record<string, unknown>;
    expect(NdjsonNodeSchema.safeParse(tampered).success).toBe(false);
  });

  it("rejects unknown top-level fields on edge", () => {
    const tampered = { ...serializeEdge(baseEdge), bogus: 1 } as Record<string, unknown>;
    expect(NdjsonEdgeSchema.safeParse(tampered).success).toBe(false);
  });

  it("rejects edge with non-positive traversalWeight", () => {
    const r = serializeEdge(baseEdge);
    expect(NdjsonEdgeSchema.safeParse({ ...r, traversalWeight: 0 }).success).toBe(false);
    expect(NdjsonEdgeSchema.safeParse({ ...r, traversalWeight: -1 }).success).toBe(false);
  });

  it("rejects records with malformed UUIDs", () => {
    const r = serializeNode(baseNode);
    expect(NdjsonNodeSchema.safeParse({ ...r, id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects records with malformed semver version", () => {
    const r = serializeNode(baseNode);
    expect(NdjsonNodeSchema.safeParse({ ...r, version: "v1" }).success).toBe(false);
  });
});

describe("serializeNode", () => {
  it("round-trip: parseNodeRecord(JSON.stringify(serializeNode(n))) deeply equals serializeNode(n)", () => {
    const record = serializeNode(baseNode);
    const reparsed = parseNodeRecord(JSON.stringify(record));
    expect(reparsed).toStrictEqual(record);
  });

  it("collects type-specific extension fields into `attributes`", () => {
    const businessGoal = {
      ...baseNode,
      // BusinessGoal extension fields outside TknBase
      description: "long description here describing the goal",
      timeHorizon: "LONG",
      successMetrics: ["MAU > 100k"],
      status: "ACTIVE",
      isLeaf: false,
    };
    const record = serializeNode(businessGoal);
    expect(record.attributes).toEqual({
      // baseNode's existing `attributes.description` is overwritten by the
      // type-level `description` field (top-level wins, by design).
      description: "long description here describing the goal",
      timeHorizon: "LONG",
      successMetrics: ["MAU > 100k"],
      status: "ACTIVE",
      isLeaf: false,
    });
  });

  it("merges existing `attributes` JSONB with new extension fields", () => {
    const node = {
      ...baseNode,
      attributes: { existingJsonbKey: "preserved" },
      newExtensionField: "extension-value",
    };
    const record = serializeNode(node);
    expect(record.attributes).toEqual({
      existingJsonbKey: "preserved",
      newExtensionField: "extension-value",
    });
  });

  it("normalizes Date objects in createdAt/updatedAt to ISO 8601 strings", () => {
    const node = {
      ...baseNode,
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
      updatedAt: new Date("2026-02-01T10:00:00.000Z"),
    };
    const record = serializeNode(node);
    expect(record.createdAt).toBe("2026-01-01T10:00:00.000Z");
    expect(record.updatedAt).toBe("2026-02-01T10:00:00.000Z");
  });

  it("preserves owner team ref end-to-end", () => {
    const record = serializeNode(baseNode);
    expect(record.owner).toEqual(owner);
  });

  it("rejects input missing owner (TknBase mandates an owning team)", () => {
    const { owner: _owner, ...rest } = baseNode;
    expect(() => serializeNode(rest as unknown as typeof baseNode)).toThrow();
  });

  it("defaults `attributes` to {} when input omits the field", () => {
    const { attributes: _attrs, ...rest } = baseNode;
    const record = serializeNode(rest as unknown as typeof baseNode);
    expect(record.attributes).toEqual({});
  });
});

describe("serializeEdge", () => {
  it("round-trip: parseEdgeRecord(JSON.stringify(serializeEdge(e))) deeply equals serializeEdge(e)", () => {
    const record = serializeEdge(baseEdge);
    const reparsed = parseEdgeRecord(JSON.stringify(record));
    expect(reparsed).toStrictEqual(record);
  });

  it("normalizes Date objects in timestamps", () => {
    const edge = {
      ...baseEdge,
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
      updatedAt: new Date("2026-02-01T10:00:00.000Z"),
    };
    const record = serializeEdge(edge);
    expect(record.createdAt).toBe("2026-01-01T10:00:00.000Z");
    expect(record.updatedAt).toBe("2026-02-01T10:00:00.000Z");
  });

  it("rejects non-positive traversalWeight at the input layer", () => {
    expect(() => serializeEdge({ ...baseEdge, traversalWeight: 0 })).toThrow();
    expect(() => serializeEdge({ ...baseEdge, traversalWeight: -1 })).toThrow();
  });

  it("rejects an unknown relationship type", () => {
    expect(() =>
      serializeEdge({ ...baseEdge, type: "totally-bogus" as unknown as "realizes" }),
    ).toThrow();
  });

  it("accepts every layer combination across the L1..L6 cube", () => {
    const layers = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;
    for (const s of layers) {
      for (const t of layers) {
        const edge = serializeEdge({ ...baseEdge, sourceLayer: s, targetLayer: t });
        expect(edge.sourceLayer).toBe(s);
        expect(edge.targetLayer).toBe(t);
      }
    }
  });

  it("defaults `attributes` to {} when omitted", () => {
    const { attributes: _attrs, ...rest } = baseEdge;
    const record = serializeEdge(rest as unknown as typeof baseEdge);
    expect(record.attributes).toEqual({});
  });
});

describe("parseNodeRecord / parseEdgeRecord", () => {
  it("throws NdjsonParseError on malformed JSON", () => {
    expect(() => parseNodeRecord("{not json")).toThrow(NdjsonParseError);
    expect(() => parseEdgeRecord("{also not")).toThrow(NdjsonParseError);
  });

  it("throws on missing required fields", () => {
    expect(() => parseNodeRecord(JSON.stringify({ kind: "node" }))).toThrow();
    expect(() => parseEdgeRecord(JSON.stringify({ kind: "edge" }))).toThrow();
  });

  it("rejects mixed shape — node payload parsed as edge fails", () => {
    const nodeJson = JSON.stringify(serializeNode(baseNode));
    expect(() => parseEdgeRecord(nodeJson)).toThrow();
  });

  it("rejects mixed shape — edge payload parsed as node fails", () => {
    const edgeJson = JSON.stringify(serializeEdge(baseEdge));
    expect(() => parseNodeRecord(edgeJson)).toThrow();
  });
});

describe("parseRecord — discriminated union dispatch", () => {
  it("dispatches to NdjsonNodeSchema when kind=node", () => {
    const json = JSON.stringify(serializeNode(baseNode));
    const r = parseRecord(json);
    expect(r.kind).toBe("node");
  });

  it("dispatches to NdjsonEdgeSchema when kind=edge", () => {
    const json = JSON.stringify(serializeEdge(baseEdge));
    const r = parseRecord(json);
    expect(r.kind).toBe("edge");
  });

  it("rejects records with an unknown kind discriminator", () => {
    expect(() => parseRecord(JSON.stringify({ kind: "violation", id: "x" }))).toThrow();
  });

  it("exports NdjsonRecordSchema as a Zod discriminated union for downstream reuse", () => {
    expect(NdjsonRecordSchema.options.length).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Drift guards — fail when the framework grows a base field that the wire
// format silently drops. New TknBase / RelationshipEdge field MUST be
// reflected at the wire top level OR explicitly whitelisted in
// WIRE_OMITTED_*_FIELDS with a documented reason.
// ──────────────────────────────────────────────────────────────────────────────

describe("drift guard — node wire fields cover TknBase", () => {
  it("every TknBaseSchema field is either top-level in NdjsonNodeSchema or explicitly omitted", () => {
    const baseFields = Object.keys(TknBaseSchema.shape);
    const wireFields = new Set(Object.keys(NdjsonNodeSchema.shape));
    const missing = baseFields.filter(
      (f) => !wireFields.has(f) && !WIRE_OMITTED_NODE_BASE_FIELDS.has(f),
    );
    expect(
      missing,
      `TknBase fields missing from NDJSON node wire shape: ${missing.join(", ")}. ` +
        `Add them to NdjsonNodeSchema or whitelist in WIRE_OMITTED_NODE_BASE_FIELDS.`,
    ).toEqual([]);
  });

  it("every WIRE_OMITTED_NODE_BASE_FIELDS entry actually exists on TknBaseSchema (no stale entries)", () => {
    const baseFields = new Set(Object.keys(TknBaseSchema.shape));
    for (const f of WIRE_OMITTED_NODE_BASE_FIELDS) {
      expect(baseFields.has(f), `stale omission entry: ${f}`).toBe(true);
    }
  });
});

describe("drift guard — edge wire fields cover RelationshipEdge structural fields", () => {
  it("every RelationshipEdgeSchema field is either top-level in NdjsonEdgeSchema or explicitly omitted", () => {
    const edgeFields = Object.keys(RelationshipEdgeSchema.shape);
    const wireFields = new Set(Object.keys(NdjsonEdgeSchema.shape));
    const missing = edgeFields.filter(
      (f) => !wireFields.has(f) && !WIRE_OMITTED_EDGE_FIELDS.has(f),
    );
    expect(
      missing,
      `RelationshipEdge fields missing from NDJSON edge wire shape: ${missing.join(", ")}. ` +
        `Add them to NdjsonEdgeSchema or whitelist in WIRE_OMITTED_EDGE_FIELDS.`,
    ).toEqual([]);
  });

  it("every WIRE_OMITTED_EDGE_FIELDS entry actually exists on RelationshipEdgeSchema (no stale entries)", () => {
    const edgeFields = new Set(Object.keys(RelationshipEdgeSchema.shape));
    for (const f of WIRE_OMITTED_EDGE_FIELDS) {
      expect(edgeFields.has(f), `stale omission entry: ${f}`).toBe(true);
    }
  });
});
