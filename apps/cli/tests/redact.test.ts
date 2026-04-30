// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect } from "vitest";
import { shouldRedact, redactEnv, redactText } from "../src/redact.js";

describe("shouldRedact", () => {
  it.each([
    "API_KEY",
    "STRIPE_SECRET",
    "AUTH_TOKEN",
    "PASSWORD",
    "DB_PASSWORD",
    "DSN",
    "DATABASE_DSN",
    "MY_API_KEY",
    "github_token",
    "aws_secret",
  ])("redacts %s", (key) => {
    expect(shouldRedact(key)).toBe(true);
  });

  it.each([
    "DATABASE_URL",
    "NODE_ENV",
    "PORT",
    "LOG_LEVEL",
    "APP_NAME",
    "TENANT_ID",
  ])("does not redact %s", (key) => {
    expect(shouldRedact(key)).toBe(false);
  });
});

describe("redactEnv", () => {
  it("replaces sensitive values with <REDACTED>", () => {
    const env = {
      API_KEY: "super-secret-key",
      DATABASE_URL: "postgres://user:pass@localhost/db",
      NODE_ENV: "production",
      JWT_SECRET: "my-jwt-secret",
      PASSWORD: "hunter2",
    };

    const result = redactEnv(env);

    expect(result["API_KEY"]).toBe("<REDACTED>");
    expect(result["JWT_SECRET"]).toBe("<REDACTED>");
    expect(result["PASSWORD"]).toBe("<REDACTED>");
    expect(result["DATABASE_URL"]).toBe("postgres://user:pass@localhost/db");
    expect(result["NODE_ENV"]).toBe("production");
  });

  it("handles undefined values as empty string", () => {
    const result = redactEnv({ SOME_VAR: undefined });
    expect(result["SOME_VAR"]).toBe("");
  });
});

describe("redactText", () => {
  it("redacts KEY= lines in .env-style text", () => {
    const text = [
      "API_KEY=abc123",
      "DATABASE_URL=postgres://localhost/db",
      "JWT_TOKEN=secret-jwt",
    ].join("\n");

    const result = redactText(text);

    expect(result).toContain("API_KEY=<REDACTED>");
    expect(result).toContain("DATABASE_URL=postgres://localhost/db");
    expect(result).toContain("JWT_TOKEN=<REDACTED>");
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("secret-jwt");
  });

  it("passes through non-key=value lines unchanged", () => {
    const text = "# comment line\njust a line\n";
    expect(redactText(text)).toBe(text);
  });
});
