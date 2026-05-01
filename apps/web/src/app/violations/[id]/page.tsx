// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type ViolationRow } from "../../../lib/api";
import { SeverityBadge } from "../../../components/SeverityBadge";

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function ViolationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [violation, setViolation] = useState<ViolationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api.violations
      .get(id)
      .then((res) => {
        setViolation(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load violation");
        setLoading(false);
      });
  }, [id]);

  // Focus cancel button when dialog opens
  useEffect(() => {
    if (showDialog && cancelRef.current) {
      cancelRef.current.focus();
    }
  }, [showDialog]);

  // Escape key closes dialog
  useEffect(() => {
    if (!showDialog) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !resolving) {
        setShowDialog(false);
        setResolveError(null);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showDialog, resolving]);

  async function handleResolve() {
    setResolving(true);
    setResolveError(null);
    try {
      const res = await api.violations.resolve(id);
      setViolation(res.data);
      setShowDialog(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to resolve violation";
      setResolveError(msg);
    } finally {
      setResolving(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="text-gray-500">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3">
        <div role="alert" className="text-red-400 font-mono text-sm">
          {error}
        </div>
        <Link href="/violations" className="text-sm text-gray-500 hover:text-gray-300">
          ← Back to violations
        </Link>
      </div>
    );
  }
  if (!violation) return null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/violations" className="text-sm text-gray-500 hover:text-gray-300">
          ← Violations
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold font-mono">{violation.ruleKey}</h1>
        <SeverityBadge severity={violation.severity} />
        {violation.resolved ? (
          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-900/50 text-green-300 ring-1 ring-green-700">
            Resolved
          </span>
        ) : (
          <button
            ref={triggerRef}
            type="button"
            onClick={() => {
              setResolveError(null);
              setShowDialog(true);
            }}
            className="px-3 py-1.5 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-950"
          >
            Mark as Resolved
          </button>
        )}
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 divide-y divide-gray-800">
        <Field label="ID">
          <code className="text-xs">{violation.id}</code>
        </Field>
        <Field label="Tenant">
          <code className="text-xs">{violation.tenantId}</code>
        </Field>
        <Field label="Rule">
          <code className="text-xs">{violation.ruleKey}</code>
        </Field>
        <Field label="Severity">
          <SeverityBadge severity={violation.severity} />
        </Field>
        <Field label="Message">
          <span className="text-gray-100">{violation.message}</span>
        </Field>
        {violation.nodeId && (
          <Field label="Node">
            <Link
              href={`/nodes/${violation.nodeId}`}
              className="text-blue-400 hover:text-blue-300 font-mono text-xs"
            >
              {violation.nodeId}
            </Link>
          </Field>
        )}
        {violation.edgeId && (
          <Field label="Edge">
            <code className="text-xs text-gray-300">{violation.edgeId}</code>
          </Field>
        )}
        {violation.sourceNodeId && (
          <Field label="Source">
            <Link
              href={`/nodes/${violation.sourceNodeId}`}
              className="text-blue-400 hover:text-blue-300 font-mono text-xs"
            >
              {violation.sourceNodeId}
            </Link>
          </Field>
        )}
        {violation.targetNodeId && (
          <Field label="Target">
            <Link
              href={`/nodes/${violation.targetNodeId}`}
              className="text-blue-400 hover:text-blue-300 font-mono text-xs"
            >
              {violation.targetNodeId}
            </Link>
          </Field>
        )}
        <Field label="Status">
          {violation.resolved ? (
            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-900/50 text-green-300 ring-1 ring-green-700">
              Resolved
            </span>
          ) : (
            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400 ring-1 ring-gray-600">
              Open
            </span>
          )}
        </Field>
        {violation.resolvedAt && (
          <Field label="Resolved at">{fmt(violation.resolvedAt)}</Field>
        )}
        <Field label="Created">{fmt(violation.createdAt)}</Field>
        <Field label="Updated">{fmt(violation.updatedAt)}</Field>
      </div>

      <div className="mt-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Attributes
        </h2>
        <pre className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-300 overflow-x-auto">
          {JSON.stringify(violation.attributes, null, 2)}
        </pre>
      </div>

      {showDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget && !resolving) {
              setShowDialog(false);
              setResolveError(null);
              requestAnimationFrame(() => triggerRef.current?.focus());
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolve-dialog-title"
            className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl"
          >
            <h2
              id="resolve-dialog-title"
              className="text-base font-semibold text-gray-100 mb-1"
            >
              Mark as Resolved
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              <span className="font-mono text-gray-200">{violation.ruleKey}</span>
              {" · "}
              <span className="text-gray-400">Open → Resolved</span>
            </p>

            {resolveError && (
              <div
                role="alert"
                className="mb-4 rounded border border-yellow-700 bg-yellow-950/60 px-3 py-2 text-sm text-yellow-300"
              >
                {resolveError}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => {
                  setShowDialog(false);
                  setResolveError(null);
                  requestAnimationFrame(() => triggerRef.current?.focus());
                }}
                disabled={resolving}
                className="px-3 py-1.5 rounded text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResolve}
                disabled={resolving}
                aria-busy={resolving}
                className="px-3 py-1.5 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900"
              >
                {resolving ? "Resolving…" : "Mark as Resolved"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex px-4 py-3 gap-4">
      <span className="w-28 shrink-0 text-sm text-gray-400">{label}</span>
      <span className="text-sm text-gray-100">{children}</span>
    </div>
  );
}
