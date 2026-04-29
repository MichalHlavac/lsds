import { z } from "zod";
import { LayerIdSchema } from "../layer/index";
import { LifecycleStatusSchema } from "./lifecycle";
import { SemverSchema, UuidSchema } from "./refs";

export const TknBaseSchema = z.object({
  id: UuidSchema,
  type: z.string().min(1),
  layer: LayerIdSchema,
  name: z.string().min(1),
  version: SemverSchema,
  lifecycle: LifecycleStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TknBase = z.infer<typeof TknBaseSchema>;
