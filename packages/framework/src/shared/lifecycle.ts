import { z } from "zod";

export const LIFECYCLE_STATUSES = ["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"] as const;
export const LifecycleStatusSchema = z.enum(LIFECYCLE_STATUSES);
export type LifecycleStatus = z.infer<typeof LifecycleStatusSchema>;
