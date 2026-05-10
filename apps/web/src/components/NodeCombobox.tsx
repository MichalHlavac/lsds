// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useState, useEffect, useRef } from "react";
import { api, type NodeRow } from "../lib/api";

interface NodeComboboxProps {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}

export function NodeCombobox({
  value,
  onChange,
  placeholder = "Search nodes…",
  error,
  disabled = false,
}: NodeComboboxProps) {
  const [inputText, setInputText] = useState("");
  const [results, setResults] = useState<NodeRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last node ID we've already resolved to avoid redundant fetches
  const resolvedIdRef = useRef<string>("");

  useEffect(() => {
    if (!value || value === resolvedIdRef.current) return;
    api.nodes
      .get(value)
      .then(({ data }) => {
        resolvedIdRef.current = value;
        setInputText(`${data.name} (${data.layer})`);
      })
      .catch(() => {
        resolvedIdRef.current = value;
        setInputText(value);
      });
  }, [value]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setInputText(q);
    onChange("");
    resolvedIdRef.current = "";

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      api.nodes
        .list({ q, limit: 10 })
        .then(({ data }) => {
          setResults(data);
          setOpen(data.length > 0);
          setHighlighted(0);
        })
        .catch(() => {
          setResults([]);
          setOpen(false);
        })
        .finally(() => setLoading(false));
    }, 300);
  }

  function handleSelect(node: NodeRow) {
    onChange(node.id);
    resolvedIdRef.current = node.id;
    setInputText(`${node.name} (${node.layer})`);
    setOpen(false);
    setResults([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlighted]) handleSelect(results[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        value={inputText}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className={`w-full rounded border ${
          error ? "border-red-600" : "border-gray-700"
        } bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none disabled:opacity-50`}
      />
      {loading && (
        <span className="absolute right-3 top-2.5 text-xs text-gray-500">…</span>
      )}
      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-auto rounded border border-gray-700 bg-gray-900 shadow-lg max-h-48"
        >
          {results.map((node, i) => (
            <li
              key={node.id}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={() => handleSelect(node)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === highlighted
                  ? "bg-blue-900/60 text-white"
                  : "text-gray-300 hover:bg-gray-800"
              }`}
            >
              <span className="font-medium">{node.name}</span>
              <span className="ml-2 text-xs text-gray-500">{node.layer}</span>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-500">
          No nodes found
        </div>
      )}
      {value && (
        <p className="mt-1 truncate font-mono text-[11px] text-gray-500">{value}</p>
      )}
    </div>
  );
}
