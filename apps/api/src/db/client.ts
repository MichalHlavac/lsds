// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import postgres from "postgres";

// Pool configuration — all tunable via environment variables.
// DB_POOL_MAX:        upper connection limit (default 20)
// DB_POOL_MIN:        target minimum live connections; warm-up on startup (default 2)
// DB_IDLE_TIMEOUT:    seconds before an idle connection is closed (default 30)
// DB_ACQUIRE_TIMEOUT: seconds before a connection attempt times out (default 10)
// DB_MAX_LIFETIME:    seconds before a connection is recycled regardless of use (default 1800)
export const DB_POOL_MAX = Number(process.env["DB_POOL_MAX"] ?? 20);
export const DB_POOL_MIN = Number(process.env["DB_POOL_MIN"] ?? 2);
export const DB_IDLE_TIMEOUT = Number(process.env["DB_IDLE_TIMEOUT"] ?? 30);
export const DB_ACQUIRE_TIMEOUT = Number(process.env["DB_ACQUIRE_TIMEOUT"] ?? 10);
export const DB_MAX_LIFETIME = Number(process.env["DB_MAX_LIFETIME"] ?? 1800);

const url =
  process.env.DATABASE_URL ??
  "postgres://lsds:lsds@localhost:5432/lsds";

// Track live connection count via debug (new connId) + onclose (connId removed).
const knownConns = new Set<number>();
let _openConnections = 0;

export const poolStats = {
  get size() { return DB_POOL_MAX; },
  get open() { return _openConnections; },
};

export const sql = postgres(url, {
  max: DB_POOL_MAX,
  idle_timeout: DB_IDLE_TIMEOUT,
  connect_timeout: DB_ACQUIRE_TIMEOUT,
  max_lifetime: DB_MAX_LIFETIME,
  transform: postgres.camel,
  connection: { application_name: "lsds-api" },
  debug: (connId: number) => {
    if (!knownConns.has(connId)) {
      knownConns.add(connId);
      _openConnections++;
    }
  },
  onclose: (connId: number) => {
    if (knownConns.delete(connId)) {
      _openConnections = Math.max(0, _openConnections - 1);
    }
  },
});

export type Sql = typeof sql;
