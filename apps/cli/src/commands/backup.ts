// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { join } from "node:path";
import postgres from "postgres";
import { writeTarGz, type TarEntry } from "../tar.js";
import { sha256hex } from "../hash.js";

// Tables in FK-safe export order (parents before children).
const EXPORT_TABLES = [
  "nodes",
  "edges",
  "violations",
  "snapshots",
  "users",
  "teams",
  "team_members",
  "guardrails",
] as const;

export interface BackupManifest {
  version: "1";
  schemaVersion: string;
  timestamp: string;
  counts: Record<string, number>;
  hashes: {
    "dump.json": string;
  };
}

export interface BackupOptions {
  outDir: string;
  databaseUrl: string;
}

export async function runBackup(opts: BackupOptions): Promise<string> {
  // No camelCase transform — we need raw snake_case column names for round-trip fidelity.
  const sql = postgres(opts.databaseUrl, { max: 1, connect_timeout: 10 });

  try {
    const migrationRows = await sql<{ filename: string }[]>`
      SELECT filename FROM _migrations ORDER BY filename DESC LIMIT 1
    `;
    const schemaVersion = migrationRows[0]?.filename ?? "none";

    const dump: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    for (const table of EXPORT_TABLES) {
      const rows = await sql`SELECT * FROM ${sql(table)}`;
      // Serialize Date objects to ISO strings so JSON round-trips cleanly.
      dump[table] = JSON.parse(JSON.stringify(rows));
      counts[table] = rows.length;
    }

    const dumpJson = JSON.stringify(dump, null, 2);
    const dumpHash = `sha256:${sha256hex(dumpJson)}`;

    const timestamp = new Date().toISOString();
    const manifest: BackupManifest = {
      version: "1",
      schemaVersion,
      timestamp,
      counts,
      hashes: { "dump.json": dumpHash },
    };

    const ts = timestamp.replace(/[:.]/g, "-").slice(0, 19);
    const bundleName = `lsds-backup-${ts}.tar.gz`;
    const outputPath = join(opts.outDir, bundleName);

    const entries: TarEntry[] = [
      { name: "manifest.json", content: JSON.stringify(manifest, null, 2) },
      { name: "dump.json", content: dumpJson },
    ];

    await writeTarGz(outputPath, "lsds-backup", entries);
    return outputPath;
  } finally {
    await sql.end();
  }
}
