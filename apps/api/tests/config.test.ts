// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SAFE_BASE_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://lsds:lsds@localhost:5432/lsds",
  LOG_LEVEL: "info",
};

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(overrides)) {
      saved[k] = process.env[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  };
}

describe("config — startup validation", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it(
    "calls process.exit(1) when EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is absent",
    withEnv(
      {
        ...SAFE_BASE_ENV,
        EMBEDDING_PROVIDER: "openai",
        OPENAI_API_KEY: undefined,
      },
      async () => {
        vi.resetModules();
        await import("../src/config.js");
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
    ),
  );

  it(
    "calls process.exit(1) when LOG_LEVEL is not a valid pino level",
    withEnv(
      {
        ...SAFE_BASE_ENV,
        LOG_LEVEL: "verbose",
      },
      async () => {
        vi.resetModules();
        await import("../src/config.js");
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
    ),
  );

  it(
    "does NOT call process.exit when configuration is valid",
    withEnv(
      {
        ...SAFE_BASE_ENV,
        EMBEDDING_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test-key",
      },
      async () => {
        vi.resetModules();
        await import("../src/config.js");
        expect(exitSpy).not.toHaveBeenCalled();
      },
    ),
  );
});

describe("config — lifecycleRetentionDays getter", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it(
    "returns the parsed default (30) when LIFECYCLE_RETENTION_DAYS is unset",
    withEnv(
      {
        ...SAFE_BASE_ENV,
        LIFECYCLE_RETENTION_DAYS: undefined,
      },
      async () => {
        vi.resetModules();
        const { config } = await import("../src/config.js");
        expect(exitSpy).not.toHaveBeenCalled();
        expect(config.lifecycleRetentionDays).toBe(30);
      },
    ),
  );

  it(
    "reflects a live env override via the getter",
    withEnv(
      {
        ...SAFE_BASE_ENV,
        LIFECYCLE_RETENTION_DAYS: "365",
      },
      async () => {
        vi.resetModules();
        const { config } = await import("../src/config.js");
        expect(exitSpy).not.toHaveBeenCalled();
        expect(config.lifecycleRetentionDays).toBe(365);

        // Simulate a live override after module load
        process.env["LIFECYCLE_RETENTION_DAYS"] = "730";
        expect(config.lifecycleRetentionDays).toBe(730);
      },
    ),
  );

  it(
    "falls back to the parsed default when env override is non-numeric",
    withEnv(
      {
        ...SAFE_BASE_ENV,
        LIFECYCLE_RETENTION_DAYS: "365",
      },
      async () => {
        vi.resetModules();
        const { config } = await import("../src/config.js");
        expect(exitSpy).not.toHaveBeenCalled();

        // A non-numeric override should fall back to the parsed value
        process.env["LIFECYCLE_RETENTION_DAYS"] = "not-a-number";
        expect(config.lifecycleRetentionDays).toBe(365);
      },
    ),
  );
});

describe("config — DB_STATEMENT_TIMEOUT_MS", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it(
    "defaults to 25000 when DB_STATEMENT_TIMEOUT_MS is unset",
    withEnv(
      { ...SAFE_BASE_ENV, DB_STATEMENT_TIMEOUT_MS: undefined },
      async () => {
        vi.resetModules();
        const { config } = await import("../src/config.js");
        expect(exitSpy).not.toHaveBeenCalled();
        expect(config.dbStatementTimeoutMs).toBe(25000);
      },
    ),
  );

  it(
    "accepts 25000 and exposes the correct value",
    withEnv(
      { ...SAFE_BASE_ENV, DB_STATEMENT_TIMEOUT_MS: "25000" },
      async () => {
        vi.resetModules();
        const { config } = await import("../src/config.js");
        expect(exitSpy).not.toHaveBeenCalled();
        expect(config.dbStatementTimeoutMs).toBe(25000);
      },
    ),
  );

  it(
    "accepts 0 (escape hatch — disables the limit)",
    withEnv(
      { ...SAFE_BASE_ENV, DB_STATEMENT_TIMEOUT_MS: "0" },
      async () => {
        vi.resetModules();
        const { config } = await import("../src/config.js");
        expect(exitSpy).not.toHaveBeenCalled();
        expect(config.dbStatementTimeoutMs).toBe(0);
      },
    ),
  );

  it(
    "calls process.exit(1) for negative value (-1)",
    withEnv(
      { ...SAFE_BASE_ENV, DB_STATEMENT_TIMEOUT_MS: "-1" },
      async () => {
        vi.resetModules();
        await import("../src/config.js");
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
    ),
  );

  it(
    "coerces non-numeric value to NaN and calls process.exit(1)",
    withEnv(
      { ...SAFE_BASE_ENV, DB_STATEMENT_TIMEOUT_MS: "abc" },
      async () => {
        vi.resetModules();
        await import("../src/config.js");
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
    ),
  );
});
