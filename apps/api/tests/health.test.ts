import { describe, expect, it } from "vitest";
import { app } from "../src/app";

describe("GET /health", () => {
  it("returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("returns { status: 'ok' }", async () => {
    const res = await app.request("/health");
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
  });

  it("returns JSON content-type", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("unknown routes", () => {
  it("returns 404", async () => {
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
  });
});
