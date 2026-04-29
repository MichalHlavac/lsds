import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema, UuidSchema } from "../../shared/refs.js";

// Alert (kap. 4 § L6). The structural invariant the framework enforces
// at schema level: every Alert MUST point at a Runbook via
// `runbookReference`. The graph-level guardrail (catalog GR-XL-007 +
// follow-on) enforces the runbook actually exists; here we enforce only
// that the field is present and well-formed.

export const ALERT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const AlertSeveritySchema = z.enum(ALERT_SEVERITIES);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const RunbookRefSchema = z.object({
  kind: z.literal("runbook"),
  id: UuidSchema,
});
export type RunbookRef = z.infer<typeof RunbookRefSchema>;

export const AlertSchema = TknBaseSchema.extend({
  type: z.literal("Alert"),
  layer: z.literal("L6"),
  condition: z
    .string()
    .min(1, "Alert.condition must describe the metric/threshold that fires the alert"),
  severity: AlertSeveritySchema,
  runbookReference: RunbookRefSchema,
  owner: TeamRefSchema,
});
export type Alert = z.infer<typeof AlertSchema>;
