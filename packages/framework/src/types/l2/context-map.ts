import { z } from "zod";

// Context Map vocabulary for `context-integration` edges between
// BoundedContexts (kap. 4 § L2 + ADR A7). All three fields are
// closed enums — no freetext is permitted, so the edge can be
// statically validated and rendered consistently across tools.

export const CONTEXT_INTEGRATION_DIRECTIONS = [
  "SOURCE_UPSTREAM",
  "SOURCE_DOWNSTREAM",
  "SYMMETRIC",
] as const;
export const ContextIntegrationDirectionSchema = z.enum(CONTEXT_INTEGRATION_DIRECTIONS);
export type ContextIntegrationDirection = z.infer<typeof ContextIntegrationDirectionSchema>;

export const CONTEXT_INTEGRATION_PATTERNS = [
  "SHARED_KERNEL",
  "CUSTOMER_SUPPLIER",
  "CONFORMIST",
  "ACL",
  "OPEN_HOST_SERVICE",
  "PUBLISHED_LANGUAGE",
  "SEPARATE_WAYS",
  "PARTNERSHIP",
] as const;
export const ContextIntegrationPatternSchema = z.enum(CONTEXT_INTEGRATION_PATTERNS);
export type ContextIntegrationPattern = z.infer<typeof ContextIntegrationPatternSchema>;

export const ContextIntegrationAttributesSchema = z
  .object({
    direction: ContextIntegrationDirectionSchema,
    patternPrimary: ContextIntegrationPatternSchema,
    patternSecondary: z.array(ContextIntegrationPatternSchema).max(2).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.patternSecondary.includes(value.patternPrimary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "patternSecondary must not contain patternPrimary",
        path: ["patternSecondary"],
      });
    }
    const seen = new Set<string>();
    for (const [i, p] of value.patternSecondary.entries()) {
      if (seen.has(p)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "patternSecondary entries must be unique",
          path: ["patternSecondary", i],
        });
      }
      seen.add(p);
    }
  });
export type ContextIntegrationAttributes = z.infer<typeof ContextIntegrationAttributesSchema>;
