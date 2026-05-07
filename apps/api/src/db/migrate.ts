// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { sql } from "./client.js";
import { runMigrations } from "./run-migrations.js";

await runMigrations(sql);
await sql.end();
