import { z } from "zod";

export const LIFECYCLES = ["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"] as const;
export const LifecycleSchema = z.enum(LIFECYCLES);
export type Lifecycle = z.infer<typeof LifecycleSchema>;

const ALLOWED_LIFECYCLE_TRANSITIONS: Record<Lifecycle, ReadonlyArray<Lifecycle>> = {
  ACTIVE: ["DEPRECATED", "ARCHIVED"],
  DEPRECATED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: ["PURGE"],
  PURGE: [],
};

export function canTransitionLifecycle(from: Lifecycle, to: Lifecycle): boolean {
  return ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export class LifecycleTransitionError extends Error {
  readonly from: Lifecycle;
  readonly to: Lifecycle;
  constructor(from: Lifecycle, to: Lifecycle) {
    super(`Illegal lifecycle transition: ${from} → ${to}`);
    this.name = "LifecycleTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function assertLifecycleTransition(from: Lifecycle, to: Lifecycle): void {
  if (!canTransitionLifecycle(from, to)) {
    throw new LifecycleTransitionError(from, to);
  }
}

export function lifecycleSuccessors(from: Lifecycle): ReadonlyArray<Lifecycle> {
  return ALLOWED_LIFECYCLE_TRANSITIONS[from];
}

export function isTerminalLifecycle(state: Lifecycle): boolean {
  return ALLOWED_LIFECYCLE_TRANSITIONS[state].length === 0;
}
