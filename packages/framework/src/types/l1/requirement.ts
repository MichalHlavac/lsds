import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { SloRefSchema, TeamRefSchema, TestRefSchema, TknRefSchema } from "../../shared/refs.js";

export const RequirementTypeSchema = z.enum(["FUNCTIONAL", "NON_FUNCTIONAL", "CONSTRAINT"]);
export type RequirementType = z.infer<typeof RequirementTypeSchema>;

export const RequirementPrioritySchema = z.enum(["MUST", "SHOULD", "COULD"]);
export type RequirementPriority = z.infer<typeof RequirementPrioritySchema>;

export const RequirementStatusSchema = z.enum([
  "PROPOSED",
  "APPROVED",
  "IN_PROGRESS",
  "IMPLEMENTED",
  "OBSOLETE",
]);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

export const AcceptanceCriterionTypeSchema = z.enum(["FUNCTIONAL", "NON_FUNCTIONAL"]);
export const AcceptanceCriterionStatusSchema = z.enum(["PENDING", "MET", "NOT_MET"]);

export const AcceptanceCriterionSchema = z.object({
  id: z.string().regex(/^AC-\d+$/, "AcceptanceCriterion.id must match AC-<number>"),
  description: z.string().min(1),
  type: AcceptanceCriterionTypeSchema,
  status: AcceptanceCriterionStatusSchema,
  validatedBy: z.union([TestRefSchema, SloRefSchema]).optional(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const ImpactChangeTypeSchema = z.enum(["CREATE", "MODIFY", "EXTEND", "DEPRECATE"]);
export type ImpactChangeType = z.infer<typeof ImpactChangeTypeSchema>;

export const ImpactSchema = z
  .object({
    target: TknRefSchema.nullable(),
    changeType: ImpactChangeTypeSchema,
    description: z.string().min(1),
  })
  .superRefine((impact, ctx) => {
    if (impact.target === null && impact.changeType !== "CREATE") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Impact.target may only be null when changeType is CREATE (declares a new object)",
        path: ["target"],
      });
    }
  });
export type Impact = z.infer<typeof ImpactSchema>;

export const RequirementSchema = TknBaseSchema.extend({
  type: z.literal("Requirement"),
  layer: z.literal("L1"),
  description: z.string().min(1),
  motivation: z.string().min(1, "Requirement.motivation is required (kap. 4 § Requirement)"),
  requirementType: RequirementTypeSchema,
  priority: RequirementPrioritySchema,
  source: z.string().min(1),
  status: RequirementStatusSchema,
  owner: TeamRefSchema,
  acceptanceCriteria: z
    .array(AcceptanceCriterionSchema)
    .min(1, "Requirement.acceptanceCriteria must contain at least one criterion"),
  impacts: z.array(ImpactSchema).optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const REQUIREMENT_TRAVERSAL_WEIGHT = "LAZY" as const;
