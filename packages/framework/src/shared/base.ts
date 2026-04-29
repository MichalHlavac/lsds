// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { LayerIdSchema } from "../layer/index.js";
import { LifecycleSchema } from "../lifecycle.js";
import { SemverSchema, UuidSchema } from "./refs.js";

export const TknBaseSchema = z.object({
  id: UuidSchema,
  type: z.string().min(1),
  layer: LayerIdSchema,
  name: z.string().min(1),
  version: SemverSchema,
  lifecycle: LifecycleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TknBase = z.infer<typeof TknBaseSchema>;
