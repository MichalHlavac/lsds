import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";

export const EntityAttributeSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().default(true),
  description: z.string().optional(),
});
export type EntityAttribute = z.infer<typeof EntityAttributeSchema>;

export const DomainEntitySchema = TknBaseSchema.extend({
  type: z.literal("DomainEntity"),
  layer: z.literal("L2"),
  description: z.string().min(1),
  attributes: z.array(EntityAttributeSchema).min(1, "DomainEntity.attributes must contain at least one attribute"),
  identityAttribute: z.string().min(1),
  lifecycleStates: z.array(z.string().min(1)).default([]),
  invariants: z
    .array(z.string().min(1))
    .min(1, "DomainEntity.invariants must contain at least one business invariant"),
}).superRefine((value, ctx) => {
  if (!value.attributes.some((a) => a.name === value.identityAttribute)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `identityAttribute (${value.identityAttribute}) must reference an attribute name`,
      path: ["identityAttribute"],
    });
  }
});
export type DomainEntity = z.infer<typeof DomainEntitySchema>;
