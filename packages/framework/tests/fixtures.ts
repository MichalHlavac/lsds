// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import type { TknBase } from "../src/shared/base.js";
import type { TeamRef } from "../src/shared/refs.js";

export const sampleTeam: TeamRef = {
  kind: "team",
  id: "team-platform",
  name: "Platform",
};

export function tknBase(overrides: Partial<TknBase> & Pick<TknBase, "type" | "layer" | "name">): TknBase {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    version: "1.0.0",
    lifecycle: "ACTIVE",
    owner: sampleTeam,
    createdAt: "2026-04-28T12:00:00.000Z",
    updatedAt: "2026-04-28T12:00:00.000Z",
    ...overrides,
  };
}

export function expectIssue(result: z.SafeParseReturnType<unknown, unknown>, fragment: string | RegExp): void {
  if (result.success) {
    throw new Error(`expected validation failure, got success`);
  }
  const message = result.error.issues.map((i) => i.message).join(" | ");
  if (typeof fragment === "string") {
    if (!message.includes(fragment)) {
      throw new Error(`expected issue to include ${JSON.stringify(fragment)}, got: ${message}`);
    }
  } else if (!fragment.test(message)) {
    throw new Error(`expected issue to match ${fragment}, got: ${message}`);
  }
}
