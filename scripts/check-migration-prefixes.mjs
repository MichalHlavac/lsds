#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Rejects migration files whose numeric prefix is shared by more than one file.
// Run: node scripts/check-migration-prefixes.mjs

import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../apps/api/migrations");

const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

/** @type {Map<string, string[]>} */
const byPrefix = new Map();
for (const f of files) {
  const match = f.match(/^(\d+)_/);
  if (!match) continue;
  const prefix = match[1];
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(f);
}

let failed = false;
for (const [prefix, names] of byPrefix) {
  if (names.length > 1) {
    console.error(`ERROR: duplicate migration prefix ${prefix}:`);
    for (const n of names) console.error(`  ${n}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nRenumber migration files so each numeric prefix is unique.");
  process.exit(1);
}

console.log(`OK: ${files.length} migration file(s), all prefixes unique.`);
