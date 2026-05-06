// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "./client.js";

// Pre-establish `count` connections so the pool is hot from the first request.
// Fires `count` parallel no-op queries; postgres-js opens distinct connections for each.
export async function warmPool(sql: Sql, count: number): Promise<void> {
  if (count <= 0) return;
  await Promise.all(
    Array.from({ length: count }, () => sql`SELECT 1`)
  );
}
