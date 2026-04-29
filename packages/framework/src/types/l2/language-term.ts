// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { UuidSchema } from "../../shared/refs.js";

// LanguageTerm is part of a BoundedContext's ubiquitous language.
// Traversal weight is LAZY (kap. 4 § L2): glossary is loaded on demand,
// not pulled into every traversal context package.

export const BoundedContextRefSchema = z.object({
  kind: z.literal("bounded-context"),
  id: UuidSchema,
});
export type BoundedContextRef = z.infer<typeof BoundedContextRefSchema>;

export const LanguageTermSchema = TknBaseSchema.extend({
  type: z.literal("LanguageTerm"),
  layer: z.literal("L2"),
  term: z.string().min(1),
  definition: z.string().min(30, "LanguageTerm.definition must be at least 30 characters"),
  examples: z.array(z.string().min(1)).default([]),
  antiPatterns: z.array(z.string().min(1)).default([]),
  context: BoundedContextRefSchema,
});
export type LanguageTerm = z.infer<typeof LanguageTermSchema>;
