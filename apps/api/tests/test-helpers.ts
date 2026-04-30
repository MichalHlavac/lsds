// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { LsdsCache } from "../src/cache/index";
import type { Sql } from "../src/db/client";
import type { NodeRow, EdgeRow, ViolationRow, UserRow, TeamRow } from "../src/db/types";

export const T = "test-tenant";
export const ID1 = "00000000-0000-0000-0000-000000000001";
export const ID2 = "00000000-0000-0000-0000-000000000002";
export const ID3 = "00000000-0000-0000-0000-000000000003";

/** Returns configured rows for every SQL template call (including fragments). */
export function makeSql(rows: unknown[] = []): Sql {
  const fn = Object.assign(
    (strs: unknown) => {
      if (Array.isArray(strs) && Object.hasOwn(strs as object, "raw")) {
        return Promise.resolve(rows);
      }
      return { __fragment: true };
    },
    { json: (v: unknown) => v }
  );
  return fn as unknown as Sql;
}

/** Pops a different response for each top-level SQL call. */
export function makeSeqSql(...responses: unknown[][]): Sql {
  const queue = [...responses];
  const fn = Object.assign(
    (strs: unknown) => {
      if (Array.isArray(strs) && Object.hasOwn(strs as object, "raw")) {
        return Promise.resolve(queue.shift() ?? []);
      }
      return { __fragment: true };
    },
    { json: (v: unknown) => v }
  );
  return fn as unknown as Sql;
}

export function makeCache(): LsdsCache {
  return new LsdsCache(60_000);
}

export function withErrorHandler(app: Hono): Hono {
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof ZodError) return c.json({ error: "validation error", issues: err.issues }, 400);
    return c.json({ error: "internal server error" }, 500);
  });
  return app;
}

export const h = (tenant = T) => ({
  "content-type": "application/json",
  "x-tenant-id": tenant,
});

export const fakeNode = (): NodeRow => ({
  id: ID1,
  tenantId: T,
  type: "Service",
  layer: "L4",
  name: "auth-service",
  version: "1.0.0",
  lifecycleStatus: "ACTIVE",
  attributes: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  deprecatedAt: null,
  archivedAt: null,
  purgeAfter: null,
});

export const fakeEdge = (): EdgeRow => ({
  id: ID1,
  tenantId: T,
  sourceId: ID2,
  targetId: ID3,
  type: "DEPENDS_ON",
  layer: "L4",
  traversalWeight: 1.0,
  attributes: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

export const fakeViolation = (): ViolationRow => ({
  id: ID1,
  tenantId: T,
  nodeId: ID2,
  edgeId: null,
  ruleKey: "naming.min_length",
  severity: "WARN",
  message: "Name too short",
  attributes: {},
  resolved: false,
  resolvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

export const fakeUser = (): UserRow => ({
  id: ID1,
  tenantId: T,
  externalId: "ext-001",
  displayName: "Alice",
  email: "alice@example.com",
  role: "editor",
  attributes: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

export const fakeTeam = (): TeamRow => ({
  id: ID1,
  tenantId: T,
  name: "platform",
  attributes: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});
