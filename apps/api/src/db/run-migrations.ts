// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./client.js";
import { logger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDir = join(__dirname, "../../migrations");

// Maps current filenames → the old filename recorded in _migrations on
// databases that ran migrations before the 004/011/012 duplicate-prefix fix.
const LEGACY_FILENAMES: Record<string, string> = {
  "005_migration_drafts.sql": "004_migration_drafts.sql",
  "006_migration_drafts_idempotency.sql": "005_migration_drafts_idempotency.sql",
  "007_violations_edge_endpoints.sql": "006_violations_edge_endpoints.sql",
  "008_nodes_upsert_key.sql": "007_nodes_upsert_key.sql",
  "009_pgvector.sql": "008_pgvector.sql",
  "010_api_keys.sql": "009_api_keys.sql",
  "011_node_embeddings.sql": "010_node_embeddings.sql",
  "012_nodes_owner.sql": "011_nodes_owner.sql",
  "013_tenants.sql": "011_tenants.sql",
  "014_api_keys_expiry.sql": "012_api_keys_expiry.sql",
  "015_history_clock_timestamp.sql": "012_history_clock_timestamp.sql",
  "016_tenant_slug.sql": "012_tenant_slug.sql",
  "017_audit_log.sql": "013_audit_log.sql",
  "018_rate_limit.sql": "014_rate_limit.sql",
  "019_webhooks.sql": "015_webhooks.sql",
  "020_reactivate.sql": "016_reactivate.sql",
  "021_stale_flags.sql": "017_stale_flags.sql",
};

/**
 * Apply pending SQL migrations from `dir` against `db`.
 * Returns the list of filenames that were applied in this call.
 * Throws if any migration fails — the caller is responsible for exit(1).
 */
export async function runMigrations(db: Sql, dir = defaultMigrationsDir): Promise<string[]> {
  await db`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await db`SELECT filename FROM _migrations`).map((r) => r.filename as string),
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const appliedNow: string[] = [];
  for (const file of files) {
    const legacyName = LEGACY_FILENAMES[file];
    if (applied.has(file) || (legacyName !== undefined && applied.has(legacyName))) continue;
    const body = readFileSync(join(dir, file), "utf8");
    await db.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO _migrations (filename) VALUES (${file})`;
    });
    logger.info({ file }, "applied migration");
    appliedNow.push(file);
  }

  if (appliedNow.length === 0) {
    logger.info({}, "Migrations up to date");
  }

  return appliedNow;
}
