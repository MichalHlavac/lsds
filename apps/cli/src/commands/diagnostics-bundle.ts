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

type TopologyCounts = {
  total: number;
  byLayer: Record<string, number>;
  byType: Record<string, number>;
  byLifecycle: Record<string, number>;
};

type EdgeCounts = {
  total: number;
  byType: Record<string, number>;
  byLayerPair: Record<string, number>;
  byLifecycle: Record<string, number>;
};

type ViolationCounts = {
  total: number;
  open: number;
  resolved: number;
  bySeverity: Record<string, number>;
  byRule: Record<string, number>;
};

export type TopologyReport = {
  generatedAt: string;
  tablesPresent: { nodes: boolean; edges: boolean; violations: boolean; snapshots: boolean };
  tenantCount: number | null;
  nodes: TopologyCounts | null;
  edges: EdgeCounts | null;
  violations: ViolationCounts | null;
  snapshotCount: number | null;
};

function toCountMap(rows: { key: string | null; count: string | number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.key === null) continue;
    out[r.key] = Number(r.count);
  }
  return out;
}

async function dbInfo(
  databaseUrl: string
): Promise<{ version: string; schema: unknown; topology: TopologyReport }> {
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

    const topology = await topologyInfo(sql);

    return { version, schema: { tables, indexes }, topology };
  } finally {
    await sql.end();
  }
}

/**
 * Aggregate-only topology snapshot of the LSDS framework graph (kap. 2.2, 4).
 *
 * Returns counts by layer / type / lifecycle for nodes, by relationship type and
 * layer-pair for edges, and by severity / rule for violations. No node names,
 * tenant ids, or attribute values are emitted — this artifact is safe to ship
 * in a redacted support bundle.
 */
async function topologyInfo(
  sql: import("postgres").Sql<Record<string, never>>
): Promise<TopologyReport> {
  const tableRows = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('nodes', 'edges', 'violations', 'snapshots')
  `;
  const present = new Set(tableRows.map((r) => r.tablename));
  const tablesPresent = {
    nodes: present.has("nodes"),
    edges: present.has("edges"),
    violations: present.has("violations"),
    snapshots: present.has("snapshots"),
  };

  let tenantCount: number | null = null;
  let nodes: TopologyCounts | null = null;
  let edges: EdgeCounts | null = null;
  let violations: ViolationCounts | null = null;
  let snapshotCount: number | null = null;

  if (tablesPresent.nodes) {
    const [totalRow] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM nodes`;
    const byLayer = await sql<{ key: string; count: string }[]>`
      SELECT layer AS key, count(*)::text AS count FROM nodes GROUP BY layer ORDER BY layer
    `;
    const byType = await sql<{ key: string; count: string }[]>`
      SELECT type AS key, count(*)::text AS count FROM nodes GROUP BY type ORDER BY type
    `;
    const byLifecycle = await sql<{ key: string; count: string }[]>`
      SELECT lifecycle_status AS key, count(*)::text AS count
      FROM nodes GROUP BY lifecycle_status ORDER BY lifecycle_status
    `;
    const [tenantRow] = await sql<{ count: string }[]>`
      SELECT count(DISTINCT tenant_id)::text AS count FROM nodes
    `;
    tenantCount = Number(tenantRow.count);
    nodes = {
      total: Number(totalRow.count),
      byLayer: toCountMap(byLayer),
      byType: toCountMap(byType),
      byLifecycle: toCountMap(byLifecycle),
    };
  }

  if (tablesPresent.edges) {
    const [totalRow] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM edges`;
    const byType = await sql<{ key: string; count: string }[]>`
      SELECT type AS key, count(*)::text AS count FROM edges GROUP BY type ORDER BY type
    `;
    // layer-pair = source.layer -> target.layer
    const byLayerPair = await sql<{ key: string; count: string }[]>`
      SELECT (n_src.layer || '->' || n_tgt.layer) AS key, count(*)::text AS count
      FROM edges e
      JOIN nodes n_src ON n_src.id = e.source_id
      JOIN nodes n_tgt ON n_tgt.id = e.target_id
      GROUP BY n_src.layer, n_tgt.layer
      ORDER BY n_src.layer, n_tgt.layer
    `;
    const byLifecycle = await sql<{ key: string; count: string }[]>`
      SELECT lifecycle_status AS key, count(*)::text AS count
      FROM edges GROUP BY lifecycle_status ORDER BY lifecycle_status
    `;
    edges = {
      total: Number(totalRow.count),
      byType: toCountMap(byType),
      byLayerPair: toCountMap(byLayerPair),
      byLifecycle: toCountMap(byLifecycle),
    };
  }

  if (tablesPresent.violations) {
    const [totalRow] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM violations`;
    const [openRow] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM violations WHERE resolved = FALSE
    `;
    const [resolvedRow] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM violations WHERE resolved = TRUE
    `;
    const bySeverity = await sql<{ key: string; count: string }[]>`
      SELECT severity AS key, count(*)::text AS count FROM violations GROUP BY severity ORDER BY severity
    `;
    const byRule = await sql<{ key: string; count: string }[]>`
      SELECT rule_key AS key, count(*)::text AS count FROM violations GROUP BY rule_key ORDER BY rule_key
    `;
    violations = {
      total: Number(totalRow.count),
      open: Number(openRow.count),
      resolved: Number(resolvedRow.count),
      bySeverity: toCountMap(bySeverity),
      byRule: toCountMap(byRule),
    };
  }

  if (tablesPresent.snapshots) {
    const [row] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM snapshots`;
    snapshotCount = Number(row.count);
  }

  return {
    generatedAt: new Date().toISOString(),
    tablesPresent,
    tenantCount,
    nodes,
    edges,
    violations,
    snapshotCount,
  };
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

  // 3. Database info + schema snapshot + node/edge topology
  if (opts.databaseUrl) {
    try {
      const { version, schema, topology } = await dbInfo(opts.databaseUrl);
      entries.push({
        name: "db-version.txt",
        content: version,
      });
      entries.push({
        name: "schema-snapshot.json",
        content: JSON.stringify(schema, null, 2),
      });
      entries.push({
        name: "topology.json",
        content: JSON.stringify(topology, null, 2),
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
        "DATABASE_URL not set — database info, schema snapshot, and topology not collected.",
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
