// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect } from "vitest";
import { shouldRedact, redactValue, redactEnv, redactText } from "../src/redact.js";

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

describe("redactValue", () => {
  it("fully redacts sensitive keys", () => {
    expect(redactValue("API_KEY", "super-secret")).toBe("<REDACTED>");
    expect(redactValue("JWT_SECRET", "abc")).toBe("<REDACTED>");
    expect(redactValue("PASSWORD", "hunter2")).toBe("<REDACTED>");
  });

  it("strips password from _URL connection strings", () => {
    expect(redactValue("DATABASE_URL", "postgres://user:pass@localhost/db")).toBe(
      "postgres://user:<REDACTED>@localhost/db"
    );
    expect(redactValue("REDIS_URL", "redis://:secret@127.0.0.1:6379")).toBe(
      "redis://:<REDACTED>@127.0.0.1:6379"
    );
  });

  it("leaves _URL values without passwords unchanged", () => {
    expect(redactValue("DATABASE_URL", "postgres://localhost/db")).toBe(
      "postgres://localhost/db"
    );
    expect(redactValue("API_BASE_URL", "https://api.example.com")).toBe(
      "https://api.example.com"
    );
  });

  it("passes through non-sensitive, non-URL keys unchanged", () => {
    expect(redactValue("NODE_ENV", "production")).toBe("production");
    expect(redactValue("PORT", "3000")).toBe("3000");
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
    expect(result["DATABASE_URL"]).toBe("postgres://user:<REDACTED>@localhost/db");
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

  it("strips password from _URL= lines", () => {
    const text = "DATABASE_URL=postgres://user:hunter2@db.host/mydb\nNODE_ENV=production";
    const result = redactText(text);
    expect(result).toContain("DATABASE_URL=postgres://user:<REDACTED>@db.host/mydb");
    expect(result).not.toContain("hunter2");
    expect(result).toContain("NODE_ENV=production");
  });

  it("passes through non-key=value lines unchanged", () => {
    const text = "# comment line\njust a line\n";
    expect(redactText(text)).toBe(text);
  });
});
