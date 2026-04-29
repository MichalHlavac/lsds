import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema } from "../../shared/refs.js";

export const DOMAIN_TYPES = ["CORE", "SUPPORTING", "GENERIC"] as const;
export const DomainTypeSchema = z.enum(DOMAIN_TYPES);
export type DomainType = z.infer<typeof DomainTypeSchema>;

export const CONTEXT_MATURITIES = ["EXPLORED", "DEFINED", "STABILIZED"] as const;
export const ContextMaturitySchema = z.enum(CONTEXT_MATURITIES);
export type ContextMaturity = z.infer<typeof ContextMaturitySchema>;

// Embedded LanguageTerm summary on the BoundedContext aggregate. The
// authoritative LanguageTerm node lives elsewhere (LanguageTermSchema)
// and is referenced via `context`; this inline summary exists so a
// BoundedContext can be validated standalone (≥3 ubiquitous terms,
// term uniqueness) without forcing a graph lookup.
export const UbiquitousLanguageTermSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(30, "ubiquitousLanguage[].definition must be at least 30 characters"),
});
export type UbiquitousLanguageTerm = z.infer<typeof UbiquitousLanguageTermSchema>;

export const BoundedContextSchema = TknBaseSchema.extend({
  type: z.literal("BoundedContext"),
  layer: z.literal("L2"),
  description: z.string().min(1),
  ubiquitousLanguage: z
    .array(UbiquitousLanguageTermSchema)
    .min(3, "BoundedContext.ubiquitousLanguage must contain at least 3 terms"),
  owner: TeamRefSchema,
  domainType: DomainTypeSchema,
  maturity: ContextMaturitySchema,
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [i, t] of value.ubiquitousLanguage.entries()) {
    const key = t.term.toLowerCase();
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ubiquitousLanguage terms must be unique (case-insensitive); duplicate: ${t.term}`,
        path: ["ubiquitousLanguage", i, "term"],
      });
    }
    seen.add(key);
  }
});
export type BoundedContext = z.infer<typeof BoundedContextSchema>;
