import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { ISO_DATE, PersonRefSchema, TeamRefSchema } from "../../shared/refs.js";

export const EXTERNAL_SYSTEM_CRITICALITIES = ["CRITICAL", "HIGH", "MEDIUM"] as const;
export const ExternalSystemCriticalitySchema = z.enum(EXTERNAL_SYSTEM_CRITICALITIES);
export type ExternalSystemCriticality = z.infer<typeof ExternalSystemCriticalitySchema>;

export const ExternalSystemSchema = TknBaseSchema.extend({
  type: z.literal("ExternalSystem"),
  layer: z.literal("L3"),
  description: z.string().min(1),
  vendor: z.string().min(1, "ExternalSystem.vendor is required"),
  criticality: ExternalSystemCriticalitySchema,
  slaReference: z.string().optional(),
  fallbackStrategy: z.string().optional(),
  contractOwner: PersonRefSchema,
  documentationUrl: z.string().url("ExternalSystem.documentationUrl must be a valid URL"),
  lastReviewDate: z.string().regex(ISO_DATE, "lastReviewDate must be ISO date (YYYY-MM-DD)").optional(),
  owner: TeamRefSchema,
}).superRefine((value, ctx) => {
  // kap. 4 invariants: SLA + fallback obligations scale with criticality.
  if (value.criticality === "CRITICAL" || value.criticality === "HIGH") {
    if (!value.slaReference || value.slaReference.length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `ExternalSystem.slaReference is required for criticality=${value.criticality} (≥ 10 chars)`,
        path: ["slaReference"],
      });
    }
  }
  if (value.criticality === "CRITICAL") {
    if (!value.fallbackStrategy || value.fallbackStrategy.length < 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "ExternalSystem.fallbackStrategy is required for criticality=CRITICAL (≥ 20 chars)",
        path: ["fallbackStrategy"],
      });
    }
  }
});
export type ExternalSystem = z.infer<typeof ExternalSystemSchema>;

export const EXTERNAL_SYSTEM_TRAVERSAL_WEIGHT = "EAGER" as const;
