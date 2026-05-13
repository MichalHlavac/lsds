// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Runs once in the main Vitest process before any workers start.
// Ensures the database schema is up to date so integration tests can run
// against a real Postgres instance.
export async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "postgres://lsds:lsds@localhost:5432/lsds";
  const sql = postgres(url, { max: 1 });

  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql`SELECT filename FROM _migrations`).map((r) => r.filename as string)
  );

  // process.cwd() is apps/api when running `pnpm test` from that package
  const migrationsDir = join(process.cwd(), "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(migrationsDir, file), "utf8");
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO _migrations (filename) VALUES (${file})`;
      });
      console.log(`[test setup] applied migration: ${file}`);
    } catch (err: unknown) {
      // Skip migrations that require optional extensions (e.g. pgvector) not
      // installed in the local dev postgres. Embedding-dependent tests will
      // simply fail with a "table doesn't exist" error instead of crashing
      // the entire test suite.
      const pg = err as { code?: string };
      if (
        pg.code === "42704" || pg.code === "42883" || // undefined object / function
        pg.code === "0A000" ||                        // feature not supported (pgvector)
        pg.code === "42P07" ||                        // duplicate table / index
        pg.code === "42701" ||                        // duplicate column
        pg.code === "42710"                           // duplicate object (constraint, sequence)
      ) {
        console.warn(`[test setup] skipped migration ${file}: schema object already exists or extension unavailable`);
      } else {
        throw err;
      }
    }
  }

  await sql.end();
}

export async function teardown(): Promise<void> {}
