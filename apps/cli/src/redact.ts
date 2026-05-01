// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

const SENSITIVE_PATTERNS = [
  /_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /PASSWORD/i,
  /DSN/i,
];

const URL_VALUE_PATTERNS = [/_URL$/i];

export function shouldRedact(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

function redactUrlPassword(value: string): string {
  // Strips the password from connection strings like postgres://user:pass@host/db.
  // Assumes passwords do not contain unencoded @ (standard URL convention).
  // [^:@\s]* allows empty username (e.g. redis://:password@host)
  return value.replace(/^(\w[\w+\-.]*:\/\/[^:@\s]*):[^@\s]+@/, "$1:<REDACTED>@");
}

export function redactValue(key: string, value: string): string {
  if (shouldRedact(key)) return "<REDACTED>";
  if (URL_VALUE_PATTERNS.some((p) => p.test(key))) return redactUrlPassword(value);
  return value;
}

export function redactEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = redactValue(k, v ?? "");
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
      return `${key}=${redactValue(key, val)}`;
    })
    .join("\n");
}
