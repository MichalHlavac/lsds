// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Minimum fraction of migration files that must appear in _migrations after
// setup. If DATABASE_URL drifts to the wrong port, migrations silently no-op
// (duplicate-object errors) and the count stays near zero — this guard catches
// that before tests produce silent empty-result failures.
const MIGRATION_COVERAGE_FLOOR = 0.8;

/**
 * Asserts that the connected DB has at least `minimum` applied migrations.
 * Exported as a pure function so it can be unit-tested without a live DB.
 */
export function assertMigrationCount(
  count: number,
  minimum: number,
  totalFiles: number,
  url: string,
): void {
  if (count < minimum) {
    throw new Error(
      `[test setup] Startup assertion failed: _migrations has ${count} row(s) but expected >= ${minimum} (out of ${totalFiles} migration files).\n` +
      `The connected database appears unpopulated or is the wrong Postgres instance.\n` +
      `DATABASE_URL=${url}\n` +
      `Check DB_PORT or the port in DATABASE_URL (e.g. pgvector port 5455 vs standard port 5432).`,
    );
  }
}

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

  // Startup assertion: verify the connected DB is properly populated.
  // If DATABASE_URL pointed to the wrong postgres port, migrations above will
  // have silently no-op'd (all objects already exist → duplicate-object skip)
  // and _migrations will have fewer rows than expected.
  const [row] = await sql`SELECT COUNT(*)::int AS count FROM _migrations`;
  const migrationCount = row.count as number;
  const minimumMigrations = Math.ceil(files.length * MIGRATION_COVERAGE_FLOOR);
  assertMigrationCount(migrationCount, minimumMigrations, files.length, url);
  console.log(`[test setup] DB assertion passed: ${migrationCount}/${files.length} migrations in _migrations`);

  await sql.end();
}

export async function teardown(): Promise<void> {}
