import { z } from "zod";
import { TknBaseSchema } from "../../shared/base";

// DomainService captures domain logic that does not naturally belong on
// any single Entity or ValueObject — typically multi-aggregate
// coordination expressed as a stateless operation. Operations are named
// in the ubiquitous language so consumers can reason about them without
// looking at the implementation.

export const DomainServiceOperationSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});
export type DomainServiceOperation = z.infer<typeof DomainServiceOperationSchema>;

export const DomainServiceSchema = TknBaseSchema.extend({
  type: z.literal("DomainService"),
  layer: z.literal("L2"),
  description: z.string().min(1),
  operations: z
    .array(DomainServiceOperationSchema)
    .min(1, "DomainService.operations must contain at least one operation"),
  stateless: z.literal(true).default(true),
});
export type DomainService = z.infer<typeof DomainServiceSchema>;
