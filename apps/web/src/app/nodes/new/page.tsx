// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { NodeForm, type NodeFormValues } from "../../../components/NodeForm";

export default function CreateNodePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleSubmit(data: NodeFormValues) {
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await api.nodes.create(data);
      router.push(`/nodes/${res.data.id}`);
    } catch (err: unknown) {
      const e = err as { status?: number; body?: { error?: string; issues?: string[] } };
      if (e.status === 422 && e.body) {
        setServerError(e.body.issues?.join("; ") ?? e.body.error ?? "Validation error");
      } else {
        setServerError(err instanceof Error ? err.message : "Unexpected error");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/nodes" className="text-sm text-gray-500 hover:text-gray-300">
          ← Nodes
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">Create Node</h1>
      <NodeForm
        onSubmit={handleSubmit}
        isLoading={submitting}
        cancelHref="/nodes"
        submitLabel="Create node"
        loadingLabel="Creating…"
        serverError={serverError}
      />
    </div>
  );
}
