// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type NodeRow, type EdgeRow } from "../lib/api";

interface SearchResults {
  nodes: NodeRow[];
  edges: EdgeRow[];
}

type ResultItem =
  | { kind: "node"; item: NodeRow }
  | { kind: "edge"; item: EdgeRow };

function flattenResults(results: SearchResults): ResultItem[] {
  return [
    ...results.nodes.map((item): ResultItem => ({ kind: "node", item })),
    ...results.edges.map((item): ResultItem => ({ kind: "edge", item })),
  ];
}

function SkeletonRow() {
  return (
    <div className="px-3 py-2 flex items-center gap-2 animate-pulse">
      <div className="h-3 w-3 rounded-full bg-gray-700 shrink-0" />
      <div className="h-3 rounded bg-gray-700 flex-1" />
      <div className="h-3 w-10 rounded bg-gray-700 shrink-0" />
    </div>
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (term: string) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    setActiveIdx(-1);
    try {
      const [nodesRes, edgesRes] = await Promise.all([
        api.nodes.list({ q: term, limit: 5 }, { signal }),
        api.edges.list({ q: term, limit: 5 }, { signal }),
      ]);
      setResults({ nodes: nodesRes.data, edges: edgesRes.data });
      setOpen(true);
      setLoading(false);
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults(null);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const flat = results ? flattenResults(results) : [];
  const hasResults = flat.length > 0;
  const showEmpty = open && !loading && results !== null && !hasResults;
  const showDropdown = open && (loading || hasResults || showEmpty);

  function navigate(item: ResultItem) {
    const path = item.kind === "node" ? `/nodes/${item.item.id}` : `/edges/${item.item.id}`;
    setQuery("");
    setOpen(false);
    setResults(null);
    router.push(path);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown) return;

    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }

    if (e.key === "Enter" && activeIdx >= 0 && flat[activeIdx]) {
      e.preventDefault();
      navigate(flat[activeIdx]);
    }
  }

  const totalNodes = results?.nodes.length ?? 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results && flat.length > 0) setOpen(true); }}
          placeholder="Search…"
          aria-label="Global search"
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          aria-controls="global-search-results"
          aria-autocomplete="list"
          className="w-full bg-gray-900 border border-gray-700 rounded pl-8 pr-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
        {loading && (
          <svg
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
      </div>

      {showDropdown && (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50"
        >
          {loading && (
            <div className="py-1">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          )}

          {!loading && showEmpty && (
            <p className="px-3 py-3 text-xs text-gray-500">No results for &ldquo;{query}&rdquo;</p>
          )}

          {!loading && hasResults && (
            <>
              {totalNodes > 0 && (
                <section>
                  <p className="px-3 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Nodes
                  </p>
                  {results!.nodes.map((node, i) => {
                    const idx = i;
                    const active = activeIdx === idx;
                    return (
                      <button
                        key={node.id}
                        role="option"
                        aria-selected={active}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          navigate({ kind: "node", item: node });
                        }}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors ${
                          active ? "bg-gray-700" : "hover:bg-gray-800"
                        }`}
                      >
                        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span className="flex-1 truncate text-gray-100">{node.name}</span>
                        <span className="shrink-0 text-xs text-gray-500">{node.layer}</span>
                      </button>
                    );
                  })}
                </section>
              )}

              {results!.edges.length > 0 && (
                <section>
                  <p className="px-3 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Edges
                  </p>
                  {results!.edges.map((edge, i) => {
                    const idx = totalNodes + i;
                    const active = activeIdx === idx;
                    return (
                      <button
                        key={edge.id}
                        role="option"
                        aria-selected={active}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          navigate({ kind: "edge", item: edge });
                        }}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors ${
                          active ? "bg-gray-700" : "hover:bg-gray-800"
                        }`}
                      >
                        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-purple-400" />
                        <span className="flex-1 truncate text-gray-100">{edge.type}</span>
                        <span className="shrink-0 text-xs text-gray-500">{edge.layer}</span>
                      </button>
                    );
                  })}
                </section>
              )}

              <div className="h-1" />
            </>
          )}
        </div>
      )}
    </div>
  );
}
