// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./client.js";
import { logger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDir = join(__dirname, "../../migrations");

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
    if (applied.has(file)) continue;
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
