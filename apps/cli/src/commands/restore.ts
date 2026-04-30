// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { sha256hex } from "../hash.js";
import type { BackupManifest } from "./backup.js";

// Tables in FK-safe insert order (parents before children).
const INSERT_ORDER = [
  "nodes",
  "edges",
  "violations",
  "snapshots",
  "users",
  "teams",
  "team_members",
  "guardrails",
] as const;

export interface RestoreOptions {
  bundlePath: string;
  databaseUrl: string;
}

export async function runRestore(opts: RestoreOptions): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "lsds-restore-"));

  try {
    // Extract bundle using system tar (available on every supported platform).
    const result = spawnSync("tar", ["xzf", opts.bundlePath, "-C", tmpDir]);
    if (result.status !== 0) {
      throw new Error(
        `Failed to extract bundle: ${result.stderr?.toString() ?? "unknown error"}`
      );
    }

    // The bundle always contains exactly one top-level directory.
    const dirs = readdirSync(tmpDir);
    if (dirs.length === 0) throw new Error("Bundle appears to be empty.");
    const bundleDir = join(tmpDir, dirs[0]!);

    // Read and parse manifest.
    const manifestRaw = readFileSync(join(bundleDir, "manifest.json"), "utf8");
    const manifest: BackupManifest = JSON.parse(manifestRaw);

    // Verify dump.json integrity.
    const dumpRaw = readFileSync(join(bundleDir, "dump.json"), "utf8");
    const computedHash = `sha256:${sha256hex(dumpRaw)}`;
    const expectedHash = manifest.hashes["dump.json"];
    if (computedHash !== expectedHash) {
      throw new Error(
        `Integrity check failed for dump.json.\n  Expected: ${expectedHash}\n  Got:      ${computedHash}`
      );
    }

    // Check schema version against the target database.
    const sql = postgres(opts.databaseUrl, { max: 1, connect_timeout: 10 });
    try {
      const migrationRows = await sql<{ filename: string }[]>`
        SELECT filename FROM _migrations ORDER BY filename DESC LIMIT 1
      `;
      const currentVersion = migrationRows[0]?.filename ?? "none";

      if (currentVersion !== manifest.schemaVersion) {
        throw new Error(
          `Schema version mismatch — cannot restore.\n` +
            `  Bundle schema: "${manifest.schemaVersion}"\n` +
            `  Target schema: "${currentVersion}"\n` +
            `Run migrations on the target install before restoring.`
        );
      }

      const dump = JSON.parse(dumpRaw) as Record<string, Record<string, unknown>[]>;

      await sql.begin(async (tx) => {
        // Truncate in reverse-FK order so restore is idempotent on a non-empty database.
        for (const table of [...INSERT_ORDER].reverse()) {
          await tx`TRUNCATE TABLE ${tx(table)} RESTART IDENTITY CASCADE`;
        }
        for (const table of INSERT_ORDER) {
          const rows = dump[table] ?? [];
          if (rows.length === 0) continue;
          await tx`INSERT INTO ${tx(table)} ${tx(rows)}`;
        }
      });

      const totalRows = INSERT_ORDER.reduce(
        (acc, t) => acc + (dump[t]?.length ?? 0),
        0
      );
      console.log(
        `Restored ${totalRows} rows across ${INSERT_ORDER.length} tables from schema "${manifest.schemaVersion}" (backed up ${manifest.timestamp}).`
      );
    } finally {
      await sql.end();
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
