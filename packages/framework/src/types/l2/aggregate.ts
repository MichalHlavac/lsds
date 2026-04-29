import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { UuidSchema } from "../../shared/refs.js";

export const DomainEntityRefSchema = z.object({
  kind: z.literal("domain-entity"),
  id: UuidSchema,
});
export type DomainEntityRef = z.infer<typeof DomainEntityRefSchema>;

export const AggregateSchema = TknBaseSchema.extend({
  type: z.literal("Aggregate"),
  layer: z.literal("L2"),
  description: z.string().min(1),
  rootEntity: DomainEntityRefSchema,
  invariants: z
    .array(z.string().min(1))
    .min(1, "Aggregate.invariants must contain at least one invariant"),
  transactionBoundary: z
    .string()
    .min(1, "Aggregate.transactionBoundary must describe what is committed atomically"),
});
export type Aggregate = z.infer<typeof AggregateSchema>;
