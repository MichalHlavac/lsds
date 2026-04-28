import { z } from "zod";
import { TknBaseSchema } from "../../shared/base";
import { TeamRefSchema } from "../../shared/refs";

export const CapabilityMaturitySchema = z.enum([
  "INITIAL",
  "DEVELOPING",
  "DEFINED",
  "MANAGED",
  "OPTIMIZING",
]);
export type CapabilityMaturity = z.infer<typeof CapabilityMaturitySchema>;

export const BusinessValueSchema = z.enum(["CORE", "SUPPORTING", "GENERIC"]);
export type BusinessValue = z.infer<typeof BusinessValueSchema>;

export const BusinessCapabilitySchema = TknBaseSchema.extend({
  type: z.literal("BusinessCapability"),
  layer: z.literal("L1"),
  description: z.string().min(1),
  owner: TeamRefSchema,
  maturity: CapabilityMaturitySchema,
  businessValue: BusinessValueSchema,
});
export type BusinessCapability = z.infer<typeof BusinessCapabilitySchema>;
