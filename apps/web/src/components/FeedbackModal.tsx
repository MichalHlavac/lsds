// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useState, useRef, useEffect } from "react";
import { z } from "zod";
import { api, type FeedbackType } from "../lib/api";

const FeedbackFormSchema = z.object({
  type: z.enum(["bug", "feature", "general"]).default("general"),
  message: z
    .string()
    .min(1, "Message is required")
    .max(5000, "Message must be 5000 characters or fewer"),
  steps: z.string().optional(),
});

type FormErrors = Partial<Record<"type" | "message" | "steps", string>>;

export function FeedbackModal() {
  const [showDialog, setShowDialog] = useState(false);
  const [pending, setPending] = useState(false);
  const [type, setType] = useState<FeedbackType>("general");
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [toast, setToast] = useState<{
    text: string;
    variant: "success" | "error";
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showDialog && messageRef.current) {
      messageRef.current.focus();
    }
  }, [showDialog]);

  useEffect(() => {
    if (!showDialog) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) closeDialog();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showDialog, pending]);

  function openDialog() {
    setType("general");
    setMessage("");
    setSteps("");
    setErrors({});
    setShowDialog(true);
  }

  function closeDialog() {
    if (pending) return;
    setShowDialog(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const result = FeedbackFormSchema.safeParse({
      type,
      message,
      steps: steps || undefined,
    });
    if (!result.success) {
      const fieldErrors: FormErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof FormErrors;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setPending(true);
    setErrors({});
    try {
      const metadata = result.data.steps
        ? { steps: result.data.steps }
        : undefined;
      await api.feedback.submit({
        type: result.data.type,
        message: result.data.message,
        metadata,
      });
      setShowDialog(false);
      setToast({ text: "Feedback sent — thank you!", variant: "success" });
      setTimeout(() => setToast(null), 4000);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (err: unknown) {
      const e = err as { body?: { error?: string; issues?: string[] } };
      const text =
        e.body?.issues?.[0] ??
        e.body?.error ??
        (err instanceof Error ? err.message : "Failed to send feedback");
      setToast({ text, variant: "error" });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        className="w-full text-left px-3 py-1.5 rounded text-sm text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
      >
        Send Feedback
      </button>

      {showDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-dialog-title"
            className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl"
          >
            <h2
              id="feedback-dialog-title"
              className="text-base font-semibold text-gray-100 mb-4"
            >
              Send Feedback
            </h2>

            <form onSubmit={handleSubmit} noValidate>
              <div className="mb-4">
                <label
                  htmlFor="feedback-type"
                  className="block text-sm text-gray-300 mb-1"
                >
                  Category
                </label>
                <select
                  id="feedback-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as FeedbackType)}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="bug">Bug</option>
                  <option value="feature">Feature Request</option>
                  <option value="general">General</option>
                </select>
              </div>

              <div className="mb-4">
                <label
                  htmlFor="feedback-message"
                  className="block text-sm text-gray-300 mb-1"
                >
                  Message{" "}
                  <span aria-hidden="true" className="text-red-400">
                    *
                  </span>
                </label>
                <textarea
                  ref={messageRef}
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  maxLength={5000}
                  aria-required="true"
                  aria-describedby={
                    errors.message ? "feedback-message-error" : undefined
                  }
                  className={`w-full rounded border px-3 py-2 text-sm bg-gray-800 text-gray-100 focus:outline-none focus:border-blue-500 resize-none ${
                    errors.message ? "border-red-600" : "border-gray-700"
                  }`}
                  placeholder="Describe your feedback…"
                />
                {errors.message && (
                  <p
                    id="feedback-message-error"
                    className="mt-1 text-xs text-red-400"
                  >
                    {errors.message}
                  </p>
                )}
              </div>

              <div className="mb-6">
                <label
                  htmlFor="feedback-steps"
                  className="block text-sm text-gray-300 mb-1"
                >
                  Reproduction steps{" "}
                  <span className="text-gray-500">(optional)</span>
                </label>
                <textarea
                  id="feedback-steps"
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Steps to reproduce…"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={pending}
                  className="px-3 py-1.5 rounded text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  aria-busy={pending}
                  className="px-3 py-1.5 rounded text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 transition-colors"
                >
                  {pending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="alert"
          aria-live="assertive"
          className={`fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-3 text-sm shadow-xl ${
            toast.variant === "success"
              ? "border-green-700 bg-green-950 text-green-300"
              : "border-red-700 bg-red-950 text-red-300"
          }`}
        >
          {toast.text}
        </div>
      )}
    </>
  );
}
