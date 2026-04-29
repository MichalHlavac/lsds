import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { BoundedContextRefSchema } from "./language-term.js";

// `payloadSchema` is a freeform JSON Schema document. We accept any
// JSON-typed object so callers can hand in OpenAPI/JSONSchema fragments;
// validating that the embedded schema is itself a valid JSON Schema is
// out of scope for the framework (descriptive guardrail, not structural).
export const PayloadSchemaSchema = z.record(z.unknown());
export type PayloadSchema = z.infer<typeof PayloadSchemaSchema>;

// Past-tense check is best-effort: name should end in "ed" or use a
// past-tense suffix recognised by domain conventions. The semantic
// guardrail catalog (kap. 5) carries the strict check; this schema-level
// rule rejects obvious imperative names like "Create…" / "Update…".
const IMPERATIVE_PREFIXES = /^(Create|Update|Delete|Add|Remove|Send|Post|Get|Fetch)([A-Z]|$)/;

export const DomainEventSchema = TknBaseSchema.extend({
  type: z.literal("DomainEvent"),
  layer: z.literal("L2"),
  description: z.string().min(1),
  payloadSchema: PayloadSchemaSchema,
  produces: BoundedContextRefSchema,
  consumes: z.array(BoundedContextRefSchema).default([]),
}).superRefine((value, ctx) => {
  if (IMPERATIVE_PREFIXES.test(value.name)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "DomainEvent.name should be past-tense (an event is something that already happened); imperative verbs belong on commands",
      path: ["name"],
    });
  }
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;
