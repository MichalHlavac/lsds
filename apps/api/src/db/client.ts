// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import postgres from "postgres";
import { config } from "../config.js";

export const DB_POOL_MAX = config.dbPoolMax;
export const DB_POOL_MIN = config.dbPoolMin;

// Track live connection count via debug (new connId) + onclose (connId removed).
const knownConns = new Set<number>();
let _openConnections = 0;

export const poolStats = {
  get size() { return config.dbPoolMax; },
  get open() { return _openConnections; },
};

export const sql = postgres(config.databaseUrl, {
  max: config.dbPoolMax,
  idle_timeout: config.dbIdleTimeout,
  connect_timeout: config.dbAcquireTimeout,
  max_lifetime: config.dbMaxLifetime,
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
export type AnySql = Sql | postgres.TransactionSql<Record<string, unknown>>;
