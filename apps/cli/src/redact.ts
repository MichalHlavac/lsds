// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

const SENSITIVE_PATTERNS = [
  /_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /PASSWORD/i,
  /DSN/i,
];

export function shouldRedact(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

export function redactEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = shouldRedact(k) ? "<REDACTED>" : (v ?? "");
  }
  return result;
}

export function redactText(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const eq = line.indexOf("=");
      if (eq === -1) return line;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1);
      return shouldRedact(key) ? `${key}=<REDACTED>` : `${key}=${val}`;
    })
    .join("\n");
}
