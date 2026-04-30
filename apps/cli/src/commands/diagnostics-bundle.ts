// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { redactEnv } from "../redact.js";
import { writeTarGz, type TarEntry } from "../tar.js";

export interface BundleOptions {
  outDir: string;
  days: number;
  logDir: string;
  databaseUrl: string | undefined;
}

function systemInfo(): Record<string, string> {
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    nodeVersion: process.version,
    cpuCount: String(os.cpus().length),
    totalMemoryGb: (os.totalmem() / 1073741824).toFixed(2),
  };
}

async function dbInfo(
  databaseUrl: string
): Promise<{ version: string; schema: unknown }> {
  // Dynamic import so tests can run without a live DB
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    const [{ version }] = await sql<[{ version: string }]>`SELECT version()`;

    const tables = await sql`
      SELECT
        t.table_name,
        json_agg(
          json_build_object(
            'column', c.column_name,
            'type', c.data_type,
            'nullable', c.is_nullable
          ) ORDER BY c.ordinal_position
        ) AS columns
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON c.table_name = t.table_name AND c.table_schema = t.table_schema
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      GROUP BY t.table_name
      ORDER BY t.table_name
    `;

    const indexes = await sql`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `;

    return { version, schema: { tables, indexes } };
  } finally {
    await sql.end();
  }
}

function collectLogs(logDir: string, days: number): TarEntry[] {
  if (!existsSync(logDir)) return [];

  const cutoff = Date.now() - days * 86_400_000;
  const entries: TarEntry[] = [];

  for (const file of readdirSync(logDir)) {
    if (!file.endsWith(".log")) continue;
    const full = join(logDir, file);
    try {
      const stat = statSync(full);
      if (stat.mtimeMs < cutoff) continue;
      entries.push({ name: `logs/${file}`, content: readFileSync(full) });
    } catch {
      // skip unreadable files
    }
  }

  return entries;
}

function nodeVersion(): string {
  try {
    return execSync("node --version", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function runDiagnosticsBundle(opts: BundleOptions): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const bundleName = `lsds-diagnostics-${ts}.tar.gz`;
  const outputPath = join(opts.outDir, bundleName);

  const entries: TarEntry[] = [];

  // 1. System info
  const sysInfo = {
    ...systemInfo(),
    nodeVersionCheck: nodeVersion(),
    generatedAt: new Date().toISOString(),
  };
  entries.push({
    name: "system-info.json",
    content: JSON.stringify(sysInfo, null, 2),
  });

  // 2. Redacted config (current process env)
  entries.push({
    name: "config.json",
    content: JSON.stringify(
      { note: "env vars — secrets redacted", env: redactEnv(process.env) },
      null,
      2
    ),
  });

  // 3. Database info + schema snapshot
  if (opts.databaseUrl) {
    try {
      const { version, schema } = await dbInfo(opts.databaseUrl);
      entries.push({
        name: "db-version.txt",
        content: version,
      });
      entries.push({
        name: "schema-snapshot.json",
        content: JSON.stringify(schema, null, 2),
      });
    } catch (err) {
      entries.push({
        name: "db-error.txt",
        content: `Failed to connect to database: ${String(err)}`,
      });
    }
  } else {
    entries.push({
      name: "db-skipped.txt",
      content:
        "DATABASE_URL not set — database info and schema snapshot not collected.",
    });
  }

  // 4. App logs (last N days)
  const logEntries = collectLogs(opts.logDir, opts.days);
  entries.push(...logEntries);
  if (logEntries.length === 0) {
    entries.push({
      name: "logs/README.txt",
      content: existsSync(opts.logDir)
        ? `No log files (*.log) found in ${opts.logDir} within the last ${opts.days} day(s).`
        : `Log directory not found: ${opts.logDir}\nPass --log-dir <path> if logs are stored elsewhere.`,
    });
  }

  await writeTarGz(outputPath, "lsds-diagnostics", entries);
  return outputPath;
}
