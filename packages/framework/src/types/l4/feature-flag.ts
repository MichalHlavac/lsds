// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema } from "../../shared/refs.js";

export const FEATURE_FLAG_KINDS = ["RELEASE", "EXPERIMENT", "OPS", "PERMISSION"] as const;
export const FeatureFlagKindSchema = z.enum(FEATURE_FLAG_KINDS);
export type FeatureFlagKind = z.infer<typeof FeatureFlagKindSchema>;

export const FEATURE_FLAG_LIFECYCLE_PLANS = ["TEMPORARY", "PERMANENT"] as const;
export const FeatureFlagLifecyclePlanSchema = z.enum(FEATURE_FLAG_LIFECYCLE_PLANS);
export type FeatureFlagLifecyclePlan = z.infer<typeof FeatureFlagLifecyclePlanSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const FEATURE_FLAG_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;

export const FeatureFlagDefaultValueSchema = z.union([
  z.boolean(),
  z.string(),
  z.number(),
]);
export type FeatureFlagDefaultValue = z.infer<typeof FeatureFlagDefaultValueSchema>;

export const FeatureFlagSchema = TknBaseSchema.extend({
  type: z.literal("FeatureFlag"),
  layer: z.literal("L4"),
  // `key` is the runtime identifier the SDK reads. Lower-snake with optional
  // dotted namespaces — keeps SDK calls and dashboard search predictable.
  key: z
    .string()
    .regex(
      FEATURE_FLAG_KEY_PATTERN,
      "FeatureFlag.key must be lower_snake_case with optional dotted namespaces (e.g. 'billing.new_invoice_view')",
    ),
  description: z.string().min(1),
  kind: FeatureFlagKindSchema,
  defaultValue: FeatureFlagDefaultValueSchema,
  owner: TeamRefSchema,
  lifecyclePlan: FeatureFlagLifecyclePlanSchema,
  expiresAt: z.string().regex(ISO_DATE, "expiresAt must be ISO date (YYYY-MM-DD)").optional(),
}).superRefine((value, ctx) => {
  // TEMPORARY flags must declare an expiry so they don't rot into
  // forever-flags; PERMANENT flags must not declare one.
  if (value.lifecyclePlan === "TEMPORARY" && !value.expiresAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "FeatureFlag.expiresAt is required when lifecyclePlan=TEMPORARY (kap. 4 invariant)",
      path: ["expiresAt"],
    });
  }
  if (value.lifecyclePlan === "PERMANENT" && value.expiresAt !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "FeatureFlag.expiresAt is only valid when lifecyclePlan=TEMPORARY",
      path: ["expiresAt"],
    });
  }
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const FEATURE_FLAG_TRAVERSAL_WEIGHT = "LAZY" as const;
