// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration harness: import / export / verify CLI commands against a real
// Hono API instance backed by a testcontainers Postgres.  No responses are
// faked — the actual route handlers and DB queries run for every assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";

import { runImport } from "../src/commands/import.js";
import { runExport } from "../src/commands/export.js";
import { runVerify } from "../src/commands/verify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "../../api/migrations");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function applyMigrations(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO _migrations (filename) VALUES (${file}) ON CONFLICT DO NOTHING`;
      });
    } catch (err: unknown) {
      const pg = err as { code?: string };
      // Skip optional-extension migrations (pgvector etc.) when not installed.
      if (pg.code !== "42704" && pg.code !== "42883") throw err;
    }
  }
}

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ── State ─────────────────────────────────────────────────────────────────────

let container: StartedPostgreSqlContainer;
let sql: Sql;
let apiUrl: string;
let apiKey: string;
let tenantId: string;
let outDir: string;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(
  async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
    const dbUrl = container.getConnectionUri();

    // Env must be set before the API module is first imported so the postgres
    // singleton in db/client.ts connects to the right instance.
    process.env.DATABASE_URL = dbUrl;
    process.env.LOG_LEVEL = "silent";
    process.env.LSDS_ADMIN_SECRET = "test-admin-secret";
    process.env.LSDS_WEBHOOK_ENCRYPTION_KEY = "a".repeat(64);

    sql = postgres(dbUrl, { max: 1 });
    await applyMigrations(sql);

    // Create a test tenant + API key in the DB.
    tenantId = randomUUID();
    apiKey = `lsds_${randomUUID().replace(/-/g, "")}`;
    const keyHash = sha256hex(apiKey);
    await sql`
      INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix)
      VALUES (${tenantId}, 'test-key', ${keyHash}, 'lsds_test')
    `;

    // Dynamic import AFTER DATABASE_URL is set.
    const { app } = await import("../../api/src/app.js");

    // Route CLI fetch calls through the real Hono handler (no fake responses).
    global.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const req = new Request(typeof input === "string" ? input : String(input), init);
      return app.fetch(req);
    };

    apiUrl = "http://test-server";
    outDir = mkdtempSync(join(tmpdir(), "lsds-cli-integration-"));
  },
  120_000
);

afterAll(async () => {
  // Restore native fetch.
  // @ts-expect-error restoring native
  delete global.fetch;

  if (outDir) rmSync(outDir, { recursive: true, force: true });
  await sql?.end();
  await container?.stop();
});

// ── verify ────────────────────────────────────────────────────────────────────

describe("runVerify", () => {
  it("returns ready=true against a live API with a migrated DB", async () => {
    const result = await runVerify({ apiUrl, apiKey });
    expect(result.ready).toBe(true);
    expect(result.status).toBe(200);
  });
});

// ── import ────────────────────────────────────────────────────────────────────

describe("runImport", () => {
  it("imports a fixture graph and returns created count", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lsds-import-fixture-"));
    try {
      writeFileSync(
        join(dir, "svc-alpha.md"),
        `---\ntype: Service\nlayer: L4\nname: integration-svc-alpha\nowner: team-a\n---\n\nPrimary service.`
      );
      writeFileSync(
        join(dir, "svc-beta.md"),
        `---\ntype: Service\nlayer: L4\nname: integration-svc-beta\n---`
      );

      const result = await runImport({ format: "markdown", dir, apiUrl, apiKey });

      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts duplicate import (re-import same names) as skipped, not failed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lsds-import-dup-"));
    try {
      writeFileSync(
        join(dir, "dup.md"),
        `---\ntype: Service\nlayer: L4\nname: integration-dup-svc\n---`
      );

      // First import — creates the node.
      const first = await runImport({ format: "markdown", dir, apiUrl, apiKey });
      expect(first.created).toBe(1);

      // Second import — same name + type → 409 per-node retry → skipped.
      const second = await runImport({ format: "markdown", dir, apiUrl, apiKey });
      expect(second.skipped).toBe(1);
      expect(second.created).toBe(0);
      expect(second.failed).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips files with missing 'type' frontmatter without contacting the API", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lsds-import-missing-type-"));
    try {
      writeFileSync(join(dir, "no-type.md"), `---\nlayer: L4\n---\nBody text.`);

      const result = await runImport({ format: "markdown", dir, apiUrl, apiKey });

      expect(result.skipped).toBe(1);
      expect(result.created).toBe(0);
      expect(result.failed).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips files with an invalid 'layer' value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lsds-import-bad-layer-"));
    try {
      writeFileSync(
        join(dir, "bad.md"),
        `---\ntype: Service\nlayer: L99\n---`
      );

      const result = await runImport({ format: "markdown", dir, apiUrl, apiKey });

      expect(result.skipped).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts nodes as failed when API key is invalid (auth error)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lsds-import-badkey-"));
    try {
      writeFileSync(
        join(dir, "node.md"),
        `---\ntype: Service\nlayer: L4\nname: should-fail\n---`
      );

      const result = await runImport({
        format: "markdown",
        dir,
        apiUrl,
        apiKey: "lsds_invalidkeyXXXXXXXXXXXXXXXXXXXX",
      });

      expect(result.failed).toBe(1);
      expect(result.created).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recurses into subdirectories", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lsds-import-nested-"));
    try {
      const sub = join(dir, "subdir");
      mkdirSync(sub);
      writeFileSync(
        join(sub, "nested-svc.md"),
        `---\ntype: Service\nlayer: L3\nname: integration-nested-svc\n---`
      );

      const result = await runImport({ format: "markdown", dir, apiUrl, apiKey });

      expect(result.created).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── export ────────────────────────────────────────────────────────────────────

describe("runExport", () => {
  it("exports all nodes created for this tenant to a JSON file", async () => {
    const outFile = join(outDir, "export-all.json");

    const result = await runExport({
      format: "json",
      out: outFile,
      apiUrl,
      apiKey,
    });

    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.outPath).toBe(outFile);

    const parsed = JSON.parse(readFileSync(outFile, "utf8")) as {
      exportedAt: string;
      nodes: { name: string }[];
      edges: unknown[];
    };
    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.nodes.length).toBe(result.nodeCount);
    expect(Array.isArray(parsed.edges)).toBe(true);
  });

  it("throws on an invalid API key", async () => {
    const outFile = join(outDir, "export-badkey.json");

    await expect(
      runExport({
        format: "json",
        out: outFile,
        apiUrl,
        apiKey: "lsds_invalidkeyYYYYYYYYYYYYYYYYYYYY",
      })
    ).rejects.toThrow(/API error/);
  });
});

// ── round-trip ────────────────────────────────────────────────────────────────

describe("import → export round-trip", () => {
  it("exported JSON contains every node that was imported", async () => {
    // Use a fresh isolated tenant for the round-trip so other tests don't bleed in.
    const rtTenantId = randomUUID();
    const rtKey = `lsds_${randomUUID().replace(/-/g, "")}`;
    const rtHash = sha256hex(rtKey);
    await sql`
      INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix)
      VALUES (${rtTenantId}, 'rt-key', ${rtHash}, 'lsds_rt')
    `;

    const dir = mkdtempSync(join(tmpdir(), "lsds-roundtrip-"));
    const outFile = join(outDir, "round-trip.json");
    const nodeNames = ["rt-node-alpha", "rt-node-beta", "rt-node-gamma"];

    try {
      for (const name of nodeNames) {
        writeFileSync(
          join(dir, `${name}.md`),
          `---\ntype: Component\nlayer: L3\nname: ${name}\n---`
        );
      }

      // Import fixture graph.
      const importResult = await runImport({
        format: "markdown",
        dir,
        apiUrl,
        apiKey: rtKey,
      });
      expect(importResult.created).toBe(nodeNames.length);
      expect(importResult.failed).toBe(0);

      // Export and verify artifact matches source.
      const exportResult = await runExport({
        format: "json",
        out: outFile,
        apiUrl,
        apiKey: rtKey,
      });
      expect(exportResult.nodeCount).toBe(nodeNames.length);

      const artifact = JSON.parse(readFileSync(outFile, "utf8")) as {
        nodes: { name: string; type: string }[];
      };

      const exportedNames = artifact.nodes.map((n) => n.name).sort();
      expect(exportedNames).toEqual([...nodeNames].sort());

      for (const node of artifact.nodes) {
        expect(node.type).toBe("Component");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      // Clean up round-trip tenant.
      await sql`DELETE FROM nodes WHERE tenant_id = ${rtTenantId}`;
      await sql`DELETE FROM api_keys WHERE tenant_id = ${rtTenantId}`;
      await sql`DELETE FROM audit_log WHERE tenant_id = ${rtTenantId}`;
    }
  });
});
