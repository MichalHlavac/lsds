// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Guard: no two migration files may share a numeric prefix unless explicitly grandfathered.
// Grandfathered duplicates (004, 011) predate this guard and are accepted by the runner's
// `filename TEXT PRIMARY KEY` constraint. Do NOT extend this list — fix the root cause.

import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

// Prefixes that already existed as duplicates before this guard was introduced.
// Do NOT add new entries here — fix the root cause instead.
const GRANDFATHERED_DUPLICATES = new Set(["004", "011"]);

function extractPrefix(filename: string): string | null {
  const match = /^(\d+)_/.exec(filename);
  return match ? match[1] : null;
}

function findDuplicatePrefixes(
  filenames: string[],
  grandfathered: Set<string>,
): Array<{ prefix: string; files: string[] }> {
  const prefixMap = new Map<string, string[]>();
  for (const file of filenames) {
    const prefix = extractPrefix(file);
    if (prefix === null) continue;
    const existing = prefixMap.get(prefix) ?? [];
    prefixMap.set(prefix, [...existing, file]);
  }

  const violations: Array<{ prefix: string; files: string[] }> = [];
  for (const [prefix, files] of prefixMap) {
    if (files.length > 1 && !grandfathered.has(prefix)) {
      violations.push({ prefix, files });
    }
  }
  return violations;
}

// ── prefix extraction unit tests ──────────────────────────────────────────────

describe("extractPrefix()", () => {
  it("extracts leading digits before underscore", () => {
    expect(extractPrefix("004_history.sql")).toBe("004");
    expect(extractPrefix("011_tenants.sql")).toBe("011");
    expect(extractPrefix("001_initial_schema.sql")).toBe("001");
  });

  it("returns null for filenames without a numeric prefix", () => {
    expect(extractPrefix("README.md")).toBeNull();
    expect(extractPrefix("no-prefix.sql")).toBeNull();
    expect(extractPrefix("_no_leading_digits.sql")).toBeNull();
  });

  it("handles multi-digit prefixes", () => {
    expect(extractPrefix("012_something.sql")).toBe("012");
    expect(extractPrefix("100_big.sql")).toBe("100");
  });
});

// ── duplicate-detection logic (synthetic data) ────────────────────────────────

describe("findDuplicatePrefixes() — negative: detects new duplicates", () => {
  it("flags a new duplicate prefix not in the grandfathered set", () => {
    const files = [
      "001_initial.sql",
      "002_indexes.sql",
      "002_extra.sql", // new duplicate
    ];
    const violations = findDuplicatePrefixes(files, GRANDFATHERED_DUPLICATES);
    expect(violations).toHaveLength(1);
    expect(violations[0].prefix).toBe("002");
    expect(violations[0].files).toContain("002_indexes.sql");
    expect(violations[0].files).toContain("002_extra.sql");
  });

  it("does not flag grandfathered prefixes 004 and 011", () => {
    const files = [
      "004_history.sql",
      "004_migration_drafts.sql",
      "011_nodes_owner.sql",
      "011_tenants.sql",
    ];
    const violations = findDuplicatePrefixes(files, GRANDFATHERED_DUPLICATES);
    expect(violations).toHaveLength(0);
  });

  it("flags multiple independent new duplicates in one pass", () => {
    const files = [
      "005_a.sql",
      "005_b.sql",
      "007_a.sql",
      "007_b.sql",
    ];
    const violations = findDuplicatePrefixes(files, GRANDFATHERED_DUPLICATES);
    expect(violations).toHaveLength(2);
    const prefixes = violations.map((v) => v.prefix).sort();
    expect(prefixes).toEqual(["005", "007"]);
  });

  it("ignores non-sql files when computing prefixes", () => {
    const files = ["README.md", "001_schema.sql", "001_dup.sql"];
    const violations = findDuplicatePrefixes(files, GRANDFATHERED_DUPLICATES);
    expect(violations).toHaveLength(1);
    expect(violations[0].prefix).toBe("001");
  });
});

describe("findDuplicatePrefixes() — positive: unique prefixes produce no violations", () => {
  it("returns empty array when all prefixes are unique", () => {
    const files = ["001_a.sql", "002_b.sql", "003_c.sql"];
    expect(findDuplicatePrefixes(files, GRANDFATHERED_DUPLICATES)).toHaveLength(0);
  });

  it("returns empty array for a single file", () => {
    expect(findDuplicatePrefixes(["001_schema.sql"], GRANDFATHERED_DUPLICATES)).toHaveLength(0);
  });

  it("returns empty array for an empty list", () => {
    expect(findDuplicatePrefixes([], GRANDFATHERED_DUPLICATES)).toHaveLength(0);
  });
});

// ── real migrations directory guard ───────────────────────────────────────────

describe("apps/api/migrations/ — prefix uniqueness guard", () => {
  it("has no NEW duplicate prefixes beyond grandfathered 004 and 011", () => {
    const files = readdirSync(MIGRATIONS_DIR);
    const sqlFiles = files.filter((f) => f.endsWith(".sql"));

    const violations = findDuplicatePrefixes(sqlFiles, GRANDFATHERED_DUPLICATES);

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  prefix ${v.prefix}: ${v.files.join(", ")}`)
        .join("\n");
      throw new Error(
        `New duplicate migration prefixes detected — rename or merge before merging:\n${details}`,
      );
    }

    expect(violations).toHaveLength(0);
  });

  it("confirms grandfathered prefix 004 has exactly 2 files", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const files004 = files.filter((f) => extractPrefix(f) === "004");
    expect(files004).toHaveLength(2);
  });

  it("confirms grandfathered prefix 011 has exactly 2 files", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const files011 = files.filter((f) => extractPrefix(f) === "011");
    expect(files011).toHaveLength(2);
  });

  it("all sql files have a numeric prefix", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const withoutPrefix = files.filter((f) => extractPrefix(f) === null);
    expect(withoutPrefix).toHaveLength(0);
  });
});
