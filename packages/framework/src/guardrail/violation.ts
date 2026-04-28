import { z } from "zod";
import { RuleIdSchema, SeveritySchema } from "./types";

export const VIOLATION_STATUSES = [
  "DETECTED",
  "OPEN",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "RESOLVED",
  "SUPPRESSED",
] as const;
export const ViolationStatusSchema = z.enum(VIOLATION_STATUSES);
export type ViolationStatus = z.infer<typeof ViolationStatusSchema>;

export const SUPPRESSION_MAX_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const SuppressionSchema = z
  .object({
    rationale: z.string().min(20, "suppression rationale must be ≥ 20 chars"),
    suppressedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    suppressedBy: z.string().min(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    const start = Date.parse(s.suppressedAt);
    const end = Date.parse(s.expiresAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expiresAt must be after suppressedAt",
        path: ["expiresAt"],
      });
      return;
    }
    const days = (end - start) / MS_PER_DAY;
    if (days > SUPPRESSION_MAX_DAYS + 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `suppression window must be ≤ ${SUPPRESSION_MAX_DAYS} days`,
        path: ["expiresAt"],
      });
    }
  });
export type Suppression = z.infer<typeof SuppressionSchema>;

export const ViolationSchema = z
  .object({
    id: z.string().min(1),
    rule_id: RuleIdSchema,
    object_id: z.string().min(1),
    object_type: z.string().min(1),
    severity: SeveritySchema,
    status: ViolationStatusSchema,
    detectedAt: z.string().datetime(),
    message: z.string().min(1),
    suppression: SuppressionSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === "SUPPRESSED" && !v.suppression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SUPPRESSED violations must include suppression metadata",
        path: ["suppression"],
      });
    }
    if (v.status !== "SUPPRESSED" && v.suppression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "suppression metadata is only valid for SUPPRESSED status",
        path: ["status"],
      });
    }
  });
export type Violation = z.infer<typeof ViolationSchema>;

const ALLOWED_TRANSITIONS: Record<ViolationStatus, ReadonlyArray<ViolationStatus>> = {
  DETECTED: ["OPEN", "RESOLVED"],
  OPEN: ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "SUPPRESSED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "RESOLVED", "SUPPRESSED"],
  IN_PROGRESS: ["RESOLVED", "SUPPRESSED", "OPEN"],
  RESOLVED: [],
  SUPPRESSED: ["OPEN"],
};

export function canTransitionViolation(
  from: ViolationStatus,
  to: ViolationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isSuppressionExpired(
  suppression: Suppression,
  now: Date = new Date(),
): boolean {
  return Date.parse(suppression.expiresAt) <= now.getTime();
}
