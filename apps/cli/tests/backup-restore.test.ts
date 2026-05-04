// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Round-trip test: backup a live install → restore into a clean install →
// verify graph state (nodes, edges, lifecycle states) equals the source.
// Uses testcontainers so each leg runs on an isolated Postgres instance.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runBackup } from "../src/commands/backup.js";
import { runRestore } from "../src/commands/restore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "../../api/migrations");

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
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO _migrations (filename) VALUES (${file}) ON CONFLICT DO NOTHING`;
    });
  }
}

// ── State ──────────────────────────────────────────────────────────────────────

let sourceContainer: StartedPostgreSqlContainer;
let targetContainer: StartedPostgreSqlContainer;
let sourceSql: Sql;
let targetSql: Sql;
let outDir: string;

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeAll(
  async () => {
    [sourceContainer, targetContainer] = await Promise.all([
      new PostgreSqlContainer("pgvector/pgvector:pg16").start(),
      new PostgreSqlContainer("pgvector/pgvector:pg16").start(),
    ]);

    sourceSql = postgres(sourceContainer.getConnectionUri(), { max: 1 });
    targetSql = postgres(targetContainer.getConnectionUri(), { max: 1 });

    await Promise.all([
      applyMigrations(sourceSql),
      applyMigrations(targetSql),
    ]);

    outDir = mkdtempSync(join(tmpdir(), "lsds-backup-test-"));
  },
  120_000
);

afterAll(async () => {
  await sourceSql?.end();
  await targetSql?.end();
  await Promise.all([
    sourceContainer?.stop(),
    targetContainer?.stop(),
  ]);
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = randomUUID();

async function seedGraph(sql: Sql): Promise<{ nodeIds: string[]; edgeId: string }> {
  const [n1] = await sql<[{ id: string }]>`
    INSERT INTO nodes (tenant_id, type, layer, name, lifecycle_status)
    VALUES (${TENANT}, 'Service', 'L4', 'svc-alpha', 'ACTIVE')
    RETURNING id
  `;
  const [n2] = await sql<[{ id: string }]>`
    INSERT INTO nodes (tenant_id, type, layer, name, lifecycle_status)
    VALUES (${TENANT}, 'Service', 'L4', 'svc-beta', 'DEPRECATED')
    RETURNING id
  `;
  const [e1] = await sql<[{ id: string }]>`
    INSERT INTO edges (tenant_id, source_id, target_id, type, layer)
    VALUES (${TENANT}, ${n1!.id}, ${n2!.id}, 'depends_on', 'L4')
    RETURNING id
  `;
  return { nodeIds: [n1!.id, n2!.id], edgeId: e1!.id };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("backup/restore round-trip", () => {
  let nodeIds: string[];
  let edgeId: string;
  let bundlePath: string;

  it("seeds the source graph and takes a backup", async () => {
    ({ nodeIds, edgeId } = await seedGraph(sourceSql));

    bundlePath = await runBackup({
      outDir,
      databaseUrl: sourceContainer.getConnectionUri(),
    });

    expect(bundlePath).toMatch(/lsds-backup.*\.tar\.gz$/);
  });

  it("manifest includes correct schema version and node/edge counts", async () => {
    // Parse manifest from bundle
    const { execSync } = await import("node:child_process");
    const tmpExtract = mkdtempSync(join(tmpdir(), "lsds-manifest-check-"));
    try {
      execSync(`tar xzf ${JSON.stringify(bundlePath)} -C ${JSON.stringify(tmpExtract)}`);
      const dirs = readdirSync(tmpExtract);
      const manifestRaw = readFileSync(
        join(tmpExtract, dirs[0]!, "manifest.json"),
        "utf8"
      );
      const manifest = JSON.parse(manifestRaw);

      expect(manifest.version).toBe("1");
      expect(manifest.schemaVersion).toMatch(/\.sql$/);
      expect(manifest.schemaVersion).not.toBe("none");
      expect(manifest.counts.nodes).toBeGreaterThanOrEqual(2);
      expect(manifest.counts.edges).toBeGreaterThanOrEqual(1);
      expect(manifest.hashes["dump.json"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      rmSync(tmpExtract, { recursive: true, force: true });
    }
  });

  it("restores into a clean install successfully", async () => {
    await runRestore({
      bundlePath,
      databaseUrl: targetContainer.getConnectionUri(),
    });

    // Verify nodes were restored with correct lifecycle states.
    const nodes = await targetSql<{ id: string; name: string; lifecycle_status: string }[]>`
      SELECT id, name, lifecycle_status FROM nodes WHERE tenant_id = ${TENANT} ORDER BY name
    `;
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.name).toBe("svc-alpha");
    expect(nodes[0]!.lifecycle_status).toBe("ACTIVE");
    expect(nodes[1]!.name).toBe("svc-beta");
    expect(nodes[1]!.lifecycle_status).toBe("DEPRECATED");

    // Verify edge was restored.
    const edges = await targetSql<{ id: string }[]>`
      SELECT id FROM edges WHERE tenant_id = ${TENANT}
    `;
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe(edgeId);
  });

  it("truncates existing data before restore (idempotent)", async () => {
    // targetContainer has data from the previous restore.
    // Seed an extra node under a different tenant to verify TRUNCATE removes it.
    const OTHER_TENANT = randomUUID();
    await targetSql`
      INSERT INTO nodes (tenant_id, type, layer, name, lifecycle_status)
      VALUES (${OTHER_TENANT}, 'Service', 'L4', 'extra-svc', 'ACTIVE')
    `;

    await runRestore({
      bundlePath,
      databaseUrl: targetContainer.getConnectionUri(),
    });

    // After restore, only the original backup data should be present.
    const allNodes = await targetSql<{ id: string }[]>`SELECT id FROM nodes`;
    expect(allNodes).toHaveLength(2);

    const otherNodes = await targetSql<{ id: string }[]>`
      SELECT id FROM nodes WHERE tenant_id = ${OTHER_TENANT}
    `;
    expect(otherNodes).toHaveLength(0);
  });

  it("aborts restore on schema version mismatch", async () => {
    // Pretend the bundle was created on an older schema by tampering with the manifest.
    const { execSync } = await import("node:child_process");
    const tmpMismatch = mkdtempSync(join(tmpdir(), "lsds-mismatch-"));
    try {
      execSync(`tar xzf ${JSON.stringify(bundlePath)} -C ${JSON.stringify(tmpMismatch)}`);
      const dirs = readdirSync(tmpMismatch);
      const bundleDir = join(tmpMismatch, dirs[0]!);
      const manifestPath = join(bundleDir, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.schemaVersion = "000_nonexistent.sql";
      const { writeFileSync } = await import("node:fs");
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      // Re-pack the tampered bundle.
      const tamperedBundle = join(outDir, "lsds-backup-tampered.tar.gz");
      execSync(
        `tar czf ${JSON.stringify(tamperedBundle)} -C ${JSON.stringify(tmpMismatch)} ${JSON.stringify(dirs[0]!)}`
      );

      await expect(
        runRestore({
          bundlePath: tamperedBundle,
          databaseUrl: targetContainer.getConnectionUri(),
        })
      ).rejects.toThrow(/Schema version mismatch/);
    } finally {
      rmSync(tmpMismatch, { recursive: true, force: true });
    }
  });

  it("aborts restore on corrupted dump (hash mismatch)", async () => {
    const { execSync } = await import("node:child_process");
    const tmpCorrupt = mkdtempSync(join(tmpdir(), "lsds-corrupt-"));
    try {
      execSync(`tar xzf ${JSON.stringify(bundlePath)} -C ${JSON.stringify(tmpCorrupt)}`);
      const dirs = readdirSync(tmpCorrupt);
      const bundleDir = join(tmpCorrupt, dirs[0]!);
      const dumpPath = join(bundleDir, "dump.json");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(dumpPath, "CORRUPTED");

      const corruptBundle = join(outDir, "lsds-backup-corrupt.tar.gz");
      execSync(
        `tar czf ${JSON.stringify(corruptBundle)} -C ${JSON.stringify(tmpCorrupt)} ${JSON.stringify(dirs[0]!)}`
      );

      await expect(
        runRestore({
          bundlePath: corruptBundle,
          databaseUrl: targetContainer.getConnectionUri(),
        })
      ).rejects.toThrow(/Integrity check failed/);
    } finally {
      rmSync(tmpCorrupt, { recursive: true, force: true });
    }
  });
});
