// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Status = "loading" | "ok" | "error";

interface HealthState {
  status: Status;
  timestamp?: string;
  error?: string;
}

function apiHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").host;
  } catch {
    return "unknown";
  }
}

export default function HealthPage() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    api
      .health()
      .then((res) =>
        setHealth({
          status: "ok",
          timestamp: res.timestamp ?? new Date().toISOString(),
        }),
      )
      .catch((err: unknown) =>
        setHealth({
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        }),
      );
  }, []);

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">System Health</h1>
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 space-y-4">
        <Row label="API status">
          {health.status === "loading" && (
            <span className="text-gray-500 text-sm">checking…</span>
          )}
          {health.status === "ok" && (
            <StatusBadge color="green" label="ok" />
          )}
          {health.status === "error" && (
            <StatusBadge color="red" label="error" />
          )}
        </Row>
        {health.timestamp && (
          <Row label="Timestamp">
            <span className="text-gray-300 text-sm font-mono">{health.timestamp}</span>
          </Row>
        )}
        {health.error && (
          <Row label="Detail">
            <span className="text-red-300 text-sm font-mono">{health.error}</span>
          </Row>
        )}
        <Row label="API host">
          <span className="text-gray-300 text-sm font-mono">{apiHost()}</span>
        </Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-400 text-sm w-24 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function StatusBadge({ color, label }: { color: "green" | "red"; label: string }) {
  const dot = color === "green" ? "bg-green-400" : "bg-red-400";
  const text = color === "green" ? "text-green-400" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${text}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
