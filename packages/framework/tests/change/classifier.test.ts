import { describe, expect, it } from "vitest";
import {
  CHANGE_KINDS,
  CHANGE_SEVERITIES,
  ChangeKind,
  changeKindsBySeverity,
  classifyChange,
} from "../../src/change";

describe("classifyChange — structural rules (kap. 2.7)", () => {
  it.each<[ChangeKind, "MAJOR"]>([
    ["RENAME", "MAJOR"],
    ["TYPE_CHANGE", "MAJOR"],
    ["RELATIONSHIP_REMOVED", "MAJOR"],
  ])("%s → MAJOR", (kind, expected) => {
    expect(classifyChange(kind)).toBe(expected);
  });

  it.each<[ChangeKind, "MINOR"]>([
    ["RELATIONSHIP_ADDED", "MINOR"],
    ["ENUM_VALUE_CHANGED", "MINOR"],
  ])("%s → MINOR", (kind, expected) => {
    expect(classifyChange(kind)).toBe(expected);
  });

  it.each<[ChangeKind, "PATCH"]>([
    ["DESCRIPTION_CHANGED", "PATCH"],
    ["TAGS_CHANGED", "PATCH"],
    ["METADATA_CHANGED", "PATCH"],
  ])("%s → PATCH", (kind, expected) => {
    expect(classifyChange(kind)).toBe(expected);
  });

  it("covers every declared CHANGE_KIND", () => {
    for (const kind of CHANGE_KINDS) {
      expect(() => classifyChange(kind)).not.toThrow();
    }
  });

  it("throws for unknown kinds", () => {
    expect(() => classifyChange("WHATEVER" as ChangeKind)).toThrow(
      /Unknown change kind/,
    );
  });
});

describe("changeKindsBySeverity", () => {
  it("partitions kinds without overlap", () => {
    const buckets = CHANGE_SEVERITIES.map((s) => changeKindsBySeverity(s));
    const flattened = buckets.flat().sort();
    expect(flattened).toEqual([...CHANGE_KINDS].sort());

    const seen = new Set<string>();
    for (const bucket of buckets) {
      for (const k of bucket) {
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  });

  it("MAJOR bucket contains exactly the three breaking kinds", () => {
    expect(changeKindsBySeverity("MAJOR").sort()).toEqual([
      "RELATIONSHIP_REMOVED",
      "RENAME",
      "TYPE_CHANGE",
    ]);
  });
});
