import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { EntityAttributeSchema } from "./domain-entity.js";

// ValueObject is identity-less: equality is by value, not by an `id`
// attribute. We share `EntityAttributeSchema` because the attribute
// shape is the same; the schema-level distinction is the absence of an
// `identityAttribute` and the immutability contract documented here.

export const ValueObjectSchema = TknBaseSchema.extend({
  type: z.literal("ValueObject"),
  layer: z.literal("L2"),
  description: z.string().min(1),
  attributes: z
    .array(EntityAttributeSchema)
    .min(1, "ValueObject.attributes must contain at least one attribute"),
  immutable: z.literal(true).default(true),
});
export type ValueObject = z.infer<typeof ValueObjectSchema>;
