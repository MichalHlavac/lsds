// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useState } from "react";
import {
  api,
  type LifecycleStatus,
  type LifecycleTransition,
  type NodeRow,
  type EdgeRow,
  type LifecycleErrorBody,
} from "../lib/api";

type Entity = NodeRow | EdgeRow;

const NEXT_TRANSITION: Partial<Record<LifecycleStatus, LifecycleTransition>> = {
  ACTIVE: "deprecate",
  DEPRECATED: "archive",
  ARCHIVED: "purge",
};

const TRANSITION_LABEL: Record<LifecycleTransition, string> = {
  deprecate: "Deprecate",
  archive: "Archive",
  purge: "Purge",
};

const TARGET_STATUS: Record<LifecycleTransition, LifecycleStatus> = {
  deprecate: "DEPRECATED",
  archive: "ARCHIVED",
  purge: "PURGE",
};

interface Props {
  entityId: string;
  entityType: "node" | "edge";
  entityName: string;
  currentStatus: LifecycleStatus;
  onSuccess: (updated: Entity) => void;
}

export function LifecycleControls({
  entityId,
  entityType,
  entityName,
  currentStatus,
  onSuccess,
}: Props) {
  const [showDialog, setShowDialog] = useState(false);
  const [pending, setPending] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const transition = NEXT_TRANSITION[currentStatus];
  if (!transition) return null;

  const label = TRANSITION_LABEL[transition];
  const targetStatus = TARGET_STATUS[transition];
  const isPurge = transition === "purge";

  function openDialog() {
    setInlineError(null);
    setShowDialog(true);
  }

  function closeDialog() {
    if (pending) return;
    setShowDialog(false);
    setInlineError(null);
  }

  async function handleConfirm() {
    setPending(true);
    setInlineError(null);
    try {
      // transition is always defined here — early return above guards the null case
      const t = transition as LifecycleTransition;
      const res =
        entityType === "node"
          ? await api.nodes.lifecycle(entityId, t)
          : await api.edges.lifecycle(entityId, t);
      setShowDialog(false);
      onSuccess(res.data);
    } catch (err: unknown) {
      const e = err as { status?: number; body?: LifecycleErrorBody };
      if (e.status === 422 && e.body?.allowed) {
        setInlineError(
          `Transition not allowed. Valid transitions: ${e.body.allowed.join(", ")}`,
        );
      } else {
        setShowDialog(false);
        const msg = err instanceof Error ? err.message : "Unexpected error";
        setToast(msg);
        setTimeout(() => setToast(null), 4000);
      }
    } finally {
      setPending(false);
    }
  }

  const buttonBase =
    "px-3 py-1.5 rounded text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950";
  const actionButtonClass = isPurge
    ? `${buttonBase} bg-red-700 hover:bg-red-600 text-white focus:ring-red-600`
    : `${buttonBase} bg-gray-700 hover:bg-gray-600 text-white focus:ring-gray-500`;

  return (
    <>
      <button type="button" onClick={openDialog} className={actionButtonClass}>
        {label}
      </button>

      {showDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-100 mb-1">
              Confirm: {label} {entityType}
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              <span className="font-mono text-gray-200">{entityName}</span>
              {" · "}
              <span className="text-gray-400">
                {currentStatus} → {targetStatus}
              </span>
            </p>

            {isPurge && (
              <div className="mb-4 rounded border border-red-700 bg-red-950/60 px-3 py-2 text-sm text-red-300">
                This action cannot be undone.
              </div>
            )}

            {inlineError && (
              <div className="mb-4 rounded border border-yellow-700 bg-yellow-950/60 px-3 py-2 text-sm text-yellow-300">
                {inlineError}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                className="px-3 py-1.5 rounded text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending}
                className={`${actionButtonClass} disabled:opacity-60`}
              >
                {pending ? `${label}ing…` : label}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-red-700 bg-red-950 px-4 py-3 text-sm text-red-300 shadow-xl">
          {toast}
        </div>
      )}
    </>
  );
}
