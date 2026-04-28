import { z } from "zod";
import { TknBaseSchema } from "../../shared/base";
import { TeamRefSchema } from "../../shared/refs";

export const TimeHorizonSchema = z.enum(["SHORT", "MEDIUM", "LONG"]);
export type TimeHorizon = z.infer<typeof TimeHorizonSchema>;

export const BusinessGoalStatusSchema = z.enum(["ACTIVE", "ACHIEVED", "ABANDONED"]);
export type BusinessGoalStatus = z.infer<typeof BusinessGoalStatusSchema>;

export const BusinessGoalPrioritySchema = z.enum(["P1", "P2", "P3"]);
export type BusinessGoalPriority = z.infer<typeof BusinessGoalPrioritySchema>;

export const BusinessGoalSchema = TknBaseSchema.extend({
  type: z.literal("BusinessGoal"),
  layer: z.literal("L1"),
  name: z.string().min(1).max(100),
  description: z.string().min(50),
  owner: TeamRefSchema,
  timeHorizon: TimeHorizonSchema,
  successMetrics: z.array(z.string().min(1)).min(1, "BusinessGoal.successMetrics must contain at least one metric"),
  status: BusinessGoalStatusSchema,
  priority: BusinessGoalPrioritySchema.optional(),
  isLeaf: z.boolean().default(false),
});
export type BusinessGoal = z.infer<typeof BusinessGoalSchema>;
