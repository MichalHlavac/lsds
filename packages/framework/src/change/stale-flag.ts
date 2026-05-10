// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { StaleSeveritySchema } from "./types.js";

// StaleFlag — emitted on a neighbour TKN when an APPLIED change event propagates
// to it (kap. 2.7). Persistence-agnostic: ids are caller-supplied (or generated
// via the deterministic default), `raisedAt` is an ISO-8601 string.
export const StaleFlagSchema = z
  .object({
    id: z.string().min(1),
    sourceChangeId: z.string().min(1),
    objectId: z.string().min(1),
    objectType: z.string().min(1),
    severity: StaleSeveritySchema,
    raisedAt: z.string().datetime(),
    message: z.string().min(1),
    viaRelationshipType: z.string().min(1),
    depth: z.number().int().positive(),
  })
  .strict();
export type StaleFlag = z.infer<typeof StaleFlagSchema>;
