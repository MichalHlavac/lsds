// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import postgres from "postgres";

const url =
  process.env.DATABASE_URL ??
  "postgres://lsds:lsds@localhost:5432/lsds";

export const sql = postgres(url, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: postgres.camel,
});

export type Sql = typeof sql;
