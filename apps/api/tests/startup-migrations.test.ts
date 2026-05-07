// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for auto-run migrations on server startup (LSDS-635).
// All DB assertions hit real Postgres — no database mocks (ADR A6).

import { describe, it, expect, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { sql } from "../src/db/client.js";
import { runMigrations } from "../src/db/run-migrations.js";

function makeTempDir(files: Record<string, string>): string {
  const dir = join(tmpdir(), `lsds-test-migrations-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf8");
  }
  return dir;
}

// Each test uses a unique filename prefix so entries don't collide across parallel runs.
function uniquePrefix() {
  return `ztest_${randomUUID().replace(/-/g, "").slice(0, 8)}_`;
}

// ── Core migration behaviour ───────────────────────────────────────────────────

describe("runMigrations() — applies pending migrations", () => {
  it("returns the applied filenames and records them in _migrations", async () => {
    const p = uniquePrefix();
    const file = `${p}001_noop.sql`;
    const dir = makeTempDir({ [file]: "SELECT 1" });
    try {
      const applied = await runMigrations(sql, dir);
      expect(applied).toEqual([file]);

      const [{ count }] = await sql<[{ count: string }]>`
        SELECT count(*)::text FROM _migrations WHERE filename = ${file}
      `;
      expect(Number(count)).toBe(1);
    } finally {
      await sql`DELETE FROM _migrations WHERE filename = ${file}`;
      rmSync(dir, { recursive: true });
    }
  });

  it("applies files in alphabetical order", async () => {
    const p = uniquePrefix();
    const f1 = `${p}001_a.sql`;
    const f2 = `${p}002_b.sql`;
    const dir = makeTempDir({ [f2]: "SELECT 2", [f1]: "SELECT 1" });
    try {
      const applied = await runMigrations(sql, dir);
      expect(applied).toEqual([f1, f2]);
    } finally {
      await sql`DELETE FROM _migrations WHERE filename LIKE ${p + "%"}`;
      rmSync(dir, { recursive: true });
    }
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("runMigrations() — idempotent second run", () => {
  it("returns an empty array when all migrations are already applied", async () => {
    const p = uniquePrefix();
    const file = `${p}001_once.sql`;
    const dir = makeTempDir({ [file]: "SELECT 1" });
    try {
      await runMigrations(sql, dir);
      const second = await runMigrations(sql, dir);
      expect(second).toEqual([]);
    } finally {
      await sql`DELETE FROM _migrations WHERE filename = ${file}`;
      rmSync(dir, { recursive: true });
    }
  });
});

// ── Failure handling ──────────────────────────────────────────────────────────

describe("runMigrations() — bad SQL", () => {
  it("throws on invalid SQL", async () => {
    const p = uniquePrefix();
    const file = `${p}001_bad.sql`;
    const dir = makeTempDir({ [file]: "THIS IS NOT VALID SQL !!!" });
    try {
      await expect(runMigrations(sql, dir)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("does not record a failed migration in _migrations", async () => {
    const p = uniquePrefix();
    const file = `${p}001_bad.sql`;
    const dir = makeTempDir({ [file]: "THIS IS NOT VALID SQL !!!" });
    try {
      await runMigrations(sql, dir).catch(() => {});
      const [{ count }] = await sql<[{ count: string }]>`
        SELECT count(*)::text FROM _migrations WHERE filename = ${file}
      `;
      expect(Number(count)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ── Startup guard (index.ts error path) ──────────────────────────────────────

describe("startup migration guard", () => {
  it("calls process.exit(1) when runMigrations throws — simulating index.ts behaviour", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });

    const p = uniquePrefix();
    const dir = makeTempDir({ [`${p}001_bad.sql`]: "NOT VALID SQL @@@" });

    try {
      // Replicate what index.ts does
      await expect(
        runMigrations(sql, dir).catch(async (err) => {
          process.exit(1);
        }),
      ).rejects.toThrow("process.exit(1)");
    } finally {
      exitSpy.mockRestore();
      rmSync(dir, { recursive: true });
    }
  });

  it("does NOT call process.exit when migrations succeed", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });

    const p = uniquePrefix();
    const file = `${p}001_ok.sql`;
    const dir = makeTempDir({ [file]: "SELECT 1" });

    try {
      await runMigrations(sql, dir).catch(async () => {
        process.exit(1);
      });
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      await sql`DELETE FROM _migrations WHERE filename = ${file}`;
      exitSpy.mockRestore();
      rmSync(dir, { recursive: true });
    }
  });
});
