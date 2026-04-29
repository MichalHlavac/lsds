import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { PersonRefSchema, UuidSchema } from "../../shared/refs.js";

// ADR has its own status state machine (kap. 4 § L3 / ADR), distinct from
// TknBase.lifecycle. Lifecycle = node-level (ACTIVE/DEPRECATED/ARCHIVED/PURGE);
// ADR.status = decision-level (PROPOSED/ACCEPTED/DEPRECATED/SUPERSEDED).
export const ADR_STATUSES = ["PROPOSED", "ACCEPTED", "DEPRECATED", "SUPERSEDED"] as const;
export const AdrStatusSchema = z.enum(ADR_STATUSES);
export type AdrStatus = z.infer<typeof AdrStatusSchema>;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const AlternativeOptionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  reasonRejected: z.string().min(1, "AlternativeOption.reasonRejected is required"),
});
export type AlternativeOption = z.infer<typeof AlternativeOptionSchema>;

export const AdrSchema = TknBaseSchema.extend({
  type: z.literal("ADR"),
  layer: z.literal("L3"),
  adrNumber: z.number().int().positive("ADR.adrNumber must be a positive integer (sequential per ArchitectureSystem)"),
  status: AdrStatusSchema,
  context: z.string().min(30, "ADR.context must explain why the decision was needed (≥ 30 chars)"),
  decision: z.string().min(30, "ADR.decision must state what was decided (≥ 30 chars)"),
  rationale: z.string().min(30, "ADR.rationale must explain why this option was chosen (≥ 30 chars)"),
  consequences: z.string().min(30, "ADR.consequences must list positive and negative effects (≥ 30 chars)"),
  alternativesConsidered: z
    .array(AlternativeOptionSchema)
    .min(1, "ADR.alternativesConsidered must contain at least one option (kap. 4 invariant)"),
  author: PersonRefSchema,
  decisionDate: z.string().regex(ISO_DATE, "ADR.decisionDate must be ISO date (YYYY-MM-DD)"),
  supersededByAdrId: UuidSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.status === "SUPERSEDED" && !value.supersededByAdrId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "SUPERSEDED ADR must have supersededByAdrId pointing at the replacing ADR (kap. 4 invariant)",
      path: ["supersededByAdrId"],
    });
  }
  if (value.status !== "SUPERSEDED" && value.supersededByAdrId !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "supersededByAdrId is only valid when status === SUPERSEDED",
      path: ["supersededByAdrId"],
    });
  }
});
export type Adr = z.infer<typeof AdrSchema>;

export const ADR_TRAVERSAL_WEIGHT = "LAZY" as const;
