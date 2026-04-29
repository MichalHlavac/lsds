import { z } from "zod";
import { TknBaseSchema } from "../../shared/base";

export const InfluenceLevelSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type InfluenceLevel = z.infer<typeof InfluenceLevelSchema>;

export const StakeholderSchema = TknBaseSchema.extend({
  type: z.literal("Stakeholder"),
  layer: z.literal("L1"),
  role: z.string().min(1),
  interestDescription: z.string().min(1),
  influenceLevel: InfluenceLevelSchema,
});
export type Stakeholder = z.infer<typeof StakeholderSchema>;
