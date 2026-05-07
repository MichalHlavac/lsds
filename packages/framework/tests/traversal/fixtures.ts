// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Test-only fixtures for traversal/persistence tests. The graph repository
// itself ships from `@lsds/framework`; only the lightweight node/edge factory
// helpers stay here so they cannot leak into the public bundle.

import type { LayerId } from "../../src/layer/index.js";
import type { Lifecycle } from "../../src/lifecycle.js";
import type {
  RelationshipEdge,
  RelationshipType,
} from "../../src/relationship/types.js";
import type { TknBase } from "../../src/shared/base.js";
import type { TeamRef } from "../../src/shared/refs.js";

let counter = 0;
const id = (prefix: string) => `${prefix}-${++counter}`;

const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

const FIXTURE_TEAM: TeamRef = { kind: "team", id: "team-test", name: "Test Team" };

export interface NodeOpts {
  id?: string;
  type: string;
  layer: LayerId;
  name: string;
  lifecycle?: Lifecycle;
}

export function makeNode(opts: NodeOpts): TknBase {
  return {
    id: opts.id ?? id("n"),
    type: opts.type,
    layer: opts.layer,
    name: opts.name,
    version: "1.0.0",
    lifecycle: opts.lifecycle ?? "ACTIVE",
    owner: FIXTURE_TEAM,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  };
}

export function makeEdge(
  source: TknBase,
  target: TknBase,
  type: RelationshipType,
): RelationshipEdge {
  return {
    type,
    sourceLayer: source.layer,
    targetLayer: target.layer,
    sourceTknId: source.id,
    targetTknId: target.id,
  };
}

export function resetCounter(): void {
  counter = 0;
}
