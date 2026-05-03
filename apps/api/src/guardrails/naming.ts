// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { ViolationCandidate } from "./index.js";

export interface NamingCheckResult {
  valid: boolean;
  suggestions: string[];
}

function splitCamelCase(name: string): string[] {
  return name.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)/g) ?? [name];
}

// Past-tense suffixes: -ed (Created), -ied (Notified), -en (Given, Taken, Written)
function isPastTense(word: string): boolean {
  const lower = word.toLowerCase();
  return lower.endsWith("ed") || lower.endsWith("ied") || lower.endsWith("en");
}

type NamingChecker = (name: string) => string[];

const TYPE_NAMING_CHECKS: Map<string, NamingChecker> = new Map([
  [
    "DomainEvent",
    (name) => {
      const words = splitCamelCase(name);
      const lastWord = words[words.length - 1] ?? name;
      if (!isPastTense(lastWord)) {
        return [
          `DomainEvent names should be past tense (e.g., '${name}Created', '${name}Updated'). The last word '${lastWord}' does not appear to be past tense.`,
        ];
      }
      return [];
    },
  ],
]);

export function checkNaming(type: string, name: string): NamingCheckResult {
  const check = TYPE_NAMING_CHECKS.get(type);
  if (!check) return { valid: true, suggestions: [] };
  const suggestions = check(name);
  return { valid: suggestions.length === 0, suggestions };
}

export function getNamingGuidance(type: string, name: string): string[] {
  return checkNaming(type, name).suggestions;
}

export function getViolationSuggestion(violation: ViolationCandidate): string {
  switch (violation.ruleKey) {
    case "naming.node.min_length": {
      const match = violation.message.match(/minimum (\d+)/);
      const min = match?.[1] ?? "3";
      return `Use a node name at least ${min} characters long.`;
    }
    case "lifecycle.review_cycle":
      return "Update this node's version or attributes to reset the review cycle timer.";
    default:
      return violation.message;
  }
}
