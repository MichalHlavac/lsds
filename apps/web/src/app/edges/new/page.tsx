// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { EdgeForm, type EdgeFormValues } from "../../../components/EdgeForm";

function CreateEdgeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSourceId = searchParams.get("sourceId") ?? "";
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const cancelHref = initialSourceId ? `/nodes/${initialSourceId}` : "/edges";

  async function handleSubmit(data: EdgeFormValues) {
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await api.edges.create(data);
      router.push(`/edges/${res.data.id}`);
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
        <Link href={cancelHref} className="text-sm text-gray-500 hover:text-gray-300">
          ← {initialSourceId ? "Node" : "Edges"}
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">Create Edge</h1>
      <EdgeForm
        defaultValues={{ sourceId: initialSourceId }}
        onSubmit={handleSubmit}
        isLoading={submitting}
        cancelHref={cancelHref}
        submitLabel="Create edge"
        loadingLabel="Creating…"
        serverError={serverError}
      />
    </div>
  );
}

export default function CreateEdgePage() {
  return (
    <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
      <CreateEdgeInner />
    </Suspense>
  );
}
