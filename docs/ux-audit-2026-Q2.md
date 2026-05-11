# LSDS GUI UX Audit — 2026 Q2

**Surfaces audited:** Home/Nav, Graph Canvas, Nodes (list/detail/new/edit), Edges (list/detail/new/edit), Layers (index/detail), Violations (list/detail), shared components (`LifecycleBadge`, `SeverityBadge`, `LifecycleControls`, `GlobalSearch`, `NodeForm`).

**Viewport:** 1440×900 desktop (primary). All routes verified at `http://localhost:3210` — all return HTTP 200. Code-depth review of all page and component source files.

**Stack:** Next.js 15 / React 19, Tailwind CSS (default palette, no theme extensions), dark theme (`bg-gray-950`).

---

## Improvement Themes

Eight themes emerged from the audit. Each finding below is filed under its theme with surface, lens, severity, and a concrete proposal referencing Tailwind tokens or component-level changes.

---

## Theme A — Navigation & Information Architecture

### A1 — "Layers" nav section header doubles as a link; sibling groups do not

**Surface:** `Sidebar.tsx:38-46` · **Viewport:** 1440×900

**Lens:** Jakob's Law (consistency with web conventions — section headers are non-interactive), Nielsen #4 (consistency and standards).

**Severity:** minor

**Finding:** The "Layers" section heading is rendered as `<Link href="/layers">`, while "Graph" and "Compliance" headings are `<p>` elements. A stranger scanning the nav will not expect a section label to be clickable. The element also serves as `aria-labelledby` for the `<ul>` beneath it — an anchor element as a listbox label is semantically fragile.

**Proposal:** Promote each section header to a consistent non-interactive `<p>` label. Add an explicit `<NavLink href="/layers">All layers</NavLink>` as the first item under the Layers group (parallel to "Canvas" under Graph). This preserves navigation to `/layers` with a clear affordance, and restores semantic consistency.

```tsx
// Before (Sidebar.tsx:38-45)
<Link id="nav-layers" href="/layers" className="px-3 mb-2 …">Layers</Link>
<ul aria-labelledby="nav-layers">…</ul>

// After
<p id="nav-layers" className="px-3 mb-2 …">Layers</p>
<ul aria-labelledby="nav-layers">
  <li><NavLink href="/layers">All layers</NavLink></li>
  {LAYERS.map(…)}
</ul>
```

---

### A2 — Sidebar has no app identity anchor

**Surface:** `Sidebar.tsx` · **Viewport:** 1440×900

**Lens:** Mental Models (users orient by product name/logo at top of nav — universal admin UI pattern), Gestalt Proximity.

**Severity:** minor

**Finding:** The sidebar starts with `GlobalSearch` and has no logo, wordmark, or home link at the top. On any sub-page, the user has no persistent visual anchor that says "you are in LSDS." The browser tab title is always "LSDS" (see A6) and offers no page context.

**Proposal:** Add a wordmark/home link above `GlobalSearch`:

```tsx
<Link href="/" className="block px-3 py-2 text-sm font-bold text-gray-100 hover:text-white">
  LSDS
</Link>
```

This costs ~28px vertical space and fixes the identity anchor for all pages.

---

### A3 — Browser tab title is always "LSDS" — no per-page context

**Surface:** `layout.tsx:8-11`, all pages · **Viewport:** all

**Lens:** Recognition over Recall (Nielsen #6), Cognitive Load (multiple tabs open → users can't distinguish).

**Severity:** minor

**Finding:** The root `metadata.title` is `"LSDS"` and no page overrides it. With multiple LSDS tabs open (e.g. Nodes list + a node detail), all tabs read "LSDS."

**Proposal:** Add per-page metadata or a title template. For server components this is `generateMetadata`; for client-only pages, Next.js 15 supports `<title>` in `<head>` via the `metadata` export on the nearest server ancestor.

```tsx
// apps/web/src/app/nodes/page.tsx (server-render outer)
export const metadata = { title: "Nodes — LSDS" };

// Detail pages: generate dynamically
export async function generateMetadata({ params }) {
  return { title: `${node.name} — LSDS` };
}
```

---

## Theme B — Density & Filter Inconsistencies Across List Pages

### B1 — Violations: severity filter is applied client-side after API fetch

**Surface:** `apps/web/src/app/violations/page.tsx:53-58` · **Viewport:** 1440×900

**Lens:** Tesler's Law (complexity must live somewhere — server-side is the right home for filter logic), Postel's Law, Data Integrity.

**Severity:** major

**Finding:**
```ts
const rows = severity
  ? res.data.filter((v) => v.severity === severity)
  : res.data;
```
The API is called without the `severity` parameter, and the filter is applied post-fetch. This breaks pagination: if 50 violations are fetched and 30 match the severity filter, `offset + violations.length` reports 30, but there may be additional severity-filtered matches on the next page. "0 results" can appear on page 2 while matches exist on page 3.

**Proposal:** Pass `severity` to the API call:
```ts
api.violations.list({
  ruleKey: ruleKey || undefined,
  severity: severity || undefined,   // add this
  resolved: resolved === "" ? undefined : resolved === "true",
  limit: LIMIT,
  offset,
})
```
Confirm the API supports `severity` as a query param (it likely does given the filter exists on the model). Remove the client-side `.filter()`.

---

### B2 — Edges list: source/target ID filters require raw UUID input

**Surface:** `apps/web/src/app/edges/page.tsx` (sourceId/targetId inputs) · **Viewport:** 1440×900

**Lens:** Recognition over Recall (Nielsen #6), Hick's Law (entering UUIDs is a high-effort task), Fitts's Law.

**Severity:** major

**Finding:** The edges filter toolbar has two `<input type="text">` fields for `sourceId` and `targetId` that require the user to enter full node UUIDs. This is unusable without copy-paste from another surface. Nodes filter uses a freetext name search; edges should follow the same pattern or use `NodeCombobox`.

**Proposal:** Replace the source/target UUID inputs with `NodeCombobox` components (already exists in `src/components/NodeCombobox.tsx`). If the edges API accepts node names as `sourceName`/`targetName` filters, wire those; otherwise keep UUID under the hood but show the node name to the user.

---

### B3 — Violations pagination missing total count

**Surface:** `apps/web/src/app/violations/page.tsx:384-386` · **Viewport:** 1440×900

**Lens:** Goal-Gradient (users need to know how far they are from done), Mental Models.

**Severity:** minor

**Finding:** Violations pagination shows `${offset + 1}–${offset + violations.length}` with no total. Nodes and edges show `of ${total}`. The violations API response likely includes a `total` field (nodes and edges both do).

**Proposal:** Add `total` to violations state and display it. See nodes pattern at `nodes/page.tsx:522-525`:
```tsx
<span className="text-sm text-gray-500" aria-live="polite">
  {violations.length > 0
    ? `${offset + 1}–${offset + violations.length}${total !== null ? ` of ${total}` : ""}`
    : "0 results"}
</span>
```

---

### B4 — Violation message truncated with no tooltip

**Surface:** `apps/web/src/app/violations/page.tsx:339` · **Viewport:** 1440×900

**Lens:** Information Scent (users can't assess violation relevance without message), Progressive Disclosure.

**Severity:** minor

**Finding:** `<td className="px-4 py-2.5 text-gray-300 max-w-xs truncate">{v.message}</td>` — messages clip at `max-w-xs` (20rem) with no way to see the full text except navigating to the detail page.

**Proposal:** Add `title={v.message}` to the `<td>` for native tooltip on hover. This is a one-token change with no layout impact:
```tsx
<td className="px-4 py-2.5 text-gray-300 max-w-xs truncate" title={v.message}>
  {v.message}
</td>
```

---

## Theme C — Empty / Loading / Error State Coverage

### C1 — List loading state: text-only with no structural skeleton

**Surface:** `nodes/page.tsx:428-438`, `violations/page.tsx:274-285`, `edges/page.tsx` (same pattern) · **Viewport:** 1440×900

**Lens:** Perceived Performance (Doherty Threshold <400ms), Nielsen #1 (system status visibility).

**Severity:** minor

**Finding:** All list pages show a single `<span className="inline-block animate-pulse">Loading…</span>` inside a full-width `<td>`. The table structure collapses to a single centered text node during load, causing a noticeable layout reflow when data arrives.

**Proposal:** Replace with skeleton rows that preserve table structure:
```tsx
{loading && Array.from({ length: 5 }).map((_, i) => (
  <tr key={i} className="border-b border-gray-800">
    <td className="px-4 py-2.5 w-10">
      <div className="h-4 w-4 rounded bg-gray-800 animate-pulse" />
    </td>
    <td className="px-4 py-2.5">
      <div className="h-3 rounded bg-gray-800 animate-pulse w-36" />
    </td>
    {/* … one cell per column */}
  </tr>
))}
```
This is already the pattern used in `GlobalSearch.tsx` (`SkeletonRow`) — promote it to a shared `TableSkeletonRow` component.

---

### C2 — Node change history error silently swallowed

**Surface:** `apps/web/src/app/nodes/[id]/page.tsx:53` · **Viewport:** 1440×900

**Lens:** Nielsen #9 (help users recognize, diagnose, and recover from errors), Forgiveness.

**Severity:** major

**Finding:**
```ts
api.nodes.history(id, { limit: 20 })
  .then((res) => setHistory(res.data))
  .catch(() => {})   // ← silently ignores error
  .finally(() => setHistoryLoading(false));
```
If history fails to load (network error, 500, 403), the user sees nothing — no error message, no retry. They may conclude the node has no history when it does.

**Proposal:** Add a `historyError` state and render an inline error with retry:
```tsx
const [historyError, setHistoryError] = useState<string | null>(null);
// in catch:
.catch((err: unknown) => setHistoryError(err instanceof Error ? err.message : "Failed to load history"))

// in render:
{!historyLoading && historyError && (
  <p className="text-red-400 text-sm text-xs">
    {historyError}{" "}
    <button onClick={() => { setHistoryError(null); /* re-fetch */ }} className="underline">
      Retry
    </button>
  </p>
)}
```

---

### C3 — Graph canvas: initial-load error has no retry

**Surface:** `apps/web/src/app/graph/page.tsx:164-170` · **Viewport:** 1440×900

**Lens:** Nielsen #9 (error recovery), Forgiveness. Inconsistency: all other surfaces show a retry link.

**Severity:** minor

**Finding:** `if (error && initialLoad)` renders a bare `<p className="text-red-400">{error}</p>` with no action. Every other surface (nodes, edges, violations) pairs error messages with a "Retry" control.

**Proposal:**
```tsx
if (error && initialLoad) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-red-400">{error}</p>
      <button
        onClick={() => { setInitialLoad(true); loadBatch(0, 0); }}
        className="text-sm text-gray-400 hover:text-gray-100 underline"
      >
        Retry
      </button>
    </div>
  );
}
```

---

### C4 — Layers page: error state has no retry

**Surface:** `apps/web/src/app/layers/page.tsx:49-54` · **Viewport:** 1440×900

**Lens:** Nielsen #9, Forgiveness. Same gap as C3.

**Severity:** minor

**Finding:** The error state renders `<td colSpan={2} className="… text-red-400 font-mono text-xs">{error}</td>` with no retry button. No `retryCount` state exists on this page.

**Proposal:** Add `retryCount`/`setRetryCount` (same pattern as nodes/violations) and add a Retry button below the error text.

---

## Theme D — Graph Canvas UX

### D1 — Node click navigates immediately — no hover/selected state

**Surface:** `apps/web/src/app/graph/page.tsx:147-150` · **Viewport:** 1440×900

**Lens:** Fitts's Law (precise clicks on small nodes), Norman's Feedback principle (action should produce observable state change before navigation), Doherty Threshold.

**Severity:** major

**Finding:** `onNodeClick` calls `router.push()` immediately on click with no visual feedback. Accidental clicks on nearby nodes navigate away without warning. There is no hover tooltip, no selected highlight ring, no "click again to navigate" pattern.

**Proposal (two-step click):** Add a `selectedNodeId` state. First click selects and shows a tooltip/info panel; second click (or explicit "Open" button in the panel) navigates. Alternatively, show a hover tooltip with node name + layer on `onNodeMouseEnter`.

At minimum: add a CSS `cursor-pointer` and a hover ring on the `LsdsNode` div, and use `onNodeDoubleClick` for navigation:
```tsx
// LsdsNode: add hover ring
className="… hover:ring-2 hover:ring-white/30"

// GraphPage: use double-click for navigation
onNodeDoubleClick={onNodeClick}
```

---

### D2 — No keyboard navigation on the graph canvas

**Surface:** `apps/web/src/app/graph/page.tsx` · **Viewport:** 1440×900

**Lens:** WCAG 2.1.1 (Keyboard), WCAG 2.1.2 (No Keyboard Trap), Inclusive Design.

**Severity:** major

**Finding:** The XYFlow canvas is entirely mouse-dependent for node inspection. `nodesDraggable={false}` and `nodesConnectable={false}` remove interactive canvas behaviors, but there is no keyboard shortcut to select a node, arrow through the node set, or navigate to a node detail page. Power-user operators (the target persona) expect keyboard-driven flows.

**Proposal:** XYFlow exposes `onKeyDown` and `focusedNodeId` controls. For a pragmatic first pass:
1. Add a `<ul>` node list beside or above the canvas (collapsible) that keyboard users can Tab through.
2. Each list item is a link to `/nodes/:id`.
3. Label it "Node list (accessible)" / `aria-label`.

This satisfies WCAG without requiring a full XYFlow keyboard integration.

---

### D3 — LAYER_COLORS uses hardcoded hex values — disconnected from design system

**Surface:** `apps/web/src/app/graph/page.tsx:33-40` · **Viewport:** 1440×900

**Lens:** Design System coherence (Tailwind tokens vs. magic numbers).

**Severity:** minor

**Finding:** Layer colors are duplicated between the graph canvas (hardcoded hex: `#3b82f6`, `#22c55e`, etc.) and the LifecycleBadge/SeverityBadge palette (Tailwind classes). If the color system changes, the graph canvas will diverge.

**Proposal:** Extract to a shared `layerColors` token map in `src/lib/layerColors.ts` using Tailwind's `resolveConfig` or inline the same Tailwind color values as a single source of truth imported by both the graph page and any layer color UI.

```ts
// src/lib/layerColors.ts
export const LAYER_COLORS = {
  L1: { border: "#3b82f6", bg: "#1e3a5f", text: "#93c5fd" },  // blue-500, blue-900, blue-300
  // …
} as const;
```

---

## Theme E — Modal Focus Management (Accessibility)

### E1 — Bulk modals on nodes/violations pages have no focus management

**Surface:** `apps/web/src/app/nodes/page.tsx:538-618`, `violations/page.tsx:401-464` · **Viewport:** 1440×900

**Lens:** WCAG 2.4.3 (Focus Order), WCAG 2.1.1 (Keyboard), Nielsen #4 (consistency — `LifecycleControls` modal does manage focus, these do not).

**Severity:** major

**Finding:** Both bulk confirmation modals inline on the list pages have no `useEffect` for initial focus, no `role="dialog"`, no `aria-modal`, and no focus trap. Keyboard users can Tab past the modal into the background content (where actions still respond). `LifecycleControls.tsx` and `ViolationDetailPage.tsx` both implement focus management correctly — the bulk modals were added later without the same treatment.

**Proposal:** Apply the same pattern already used in `LifecycleControls.tsx`:
1. `role="dialog" aria-modal="true" aria-labelledby="dialog-title"` on the dialog div.
2. `cancelRef` with `useEffect(() => { if (showBulkModal) cancelRef.current?.focus(); }, [showBulkModal])`.
3. Escape key handler via `document.addEventListener('keydown', …)` when modal is open.

Consider extracting a shared `<ConfirmModal>` component to avoid repeating this pattern across 4+ locations.

---

### E2 — Focus trap incomplete — Tab escapes modals to background

**Surface:** `LifecycleControls.tsx`, `violations/[id]/page.tsx`, both bulk modals · **Viewport:** 1440×900

**Lens:** WCAG 2.1.2 (No Keyboard Trap — note: "trap" here means failing to contain focus within the dialog when it should be contained), WCAG 2.4.3.

**Severity:** major

**Finding:** Even the modals that do manage initial focus (LifecycleControls, ViolationDetail) do not implement a focus trap. A user pressing Tab from the last focusable element in the dialog will exit to background content. This violates the expected modal interaction contract.

**Proposal:** Implement a minimal focus trap by intercepting `keydown` inside the dialog:

```tsx
function trapFocus(e: KeyboardEvent, dialogEl: HTMLElement) {
  const focusable = dialogEl.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.key === "Tab") {
    if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
}
```

Or use `@radix-ui/react-dialog` which handles focus trap, Escape, and `aria-modal` correctly and is already in spirit with how these modals work.

---

## Theme F — Forms

### F1 — NodeForm: `<label>` elements lack `htmlFor` — fragile association

**Surface:** `apps/web/src/components/NodeForm.tsx:116,128,141,159,170` · **Viewport:** 1440×900

**Lens:** WCAG 1.3.1 (Info and Relationships), Nielsen #5 (error prevention — clicking label text won't focus input).

**Severity:** major

**Finding:** All five labels in `NodeForm` are `<label className="block …">Text</label>` without `htmlFor`. They visually wrap the input in some cases but the association is implicit. Screen readers that don't walk the DOM tree may not announce the label. Clicking the label text won't focus the input for sighted keyboard users.

**Proposal:** Add `htmlFor` and `id` to each label/input pair:
```tsx
<label htmlFor="node-name" className="block text-sm text-gray-400 mb-1">Name</label>
<input id="node-name" value={name} … />
```
Same pattern for type, layer, version, attributes fields.

---

### F2 — NodeForm: read-only info box appears after the Attributes textarea

**Surface:** `apps/web/src/components/NodeForm.tsx:180-189` · **Viewport:** 1440×900

**Lens:** Information Architecture (proximity — related information should be adjacent), Mental Models (immutable fields belong with the field context, not at the bottom as a footnote).

**Severity:** minor

**Finding:** In edit mode, the read-only "Type" and "Layer" info box renders after the Attributes JSON textarea. Users filling in the form encounter the immutable-field context only after they've passed the main inputs. This inverts the information flow — context about what can't change should appear first.

**Proposal:** Move the `readOnlyInfo` panel to immediately after the Name field and before the Version field:
```tsx
<Field name="Name" … />
{readOnlyInfo && <ReadOnlyInfoPanel … />}  {/* ← moved up */}
<Field name="Version" … />
<Field name="Attributes" … />
```

---

### F3 — Version field: state default "0.1.0" makes placeholder invisible

**Surface:** `apps/web/src/components/NodeForm.tsx:48`, `164` · **Viewport:** 1440×900

**Lens:** Norman's Signifiers (placeholder communicates "this field is optional/default" — defeating it by pre-filling the state misleads).

**Severity:** polish

**Finding:** `useState(defaultValues?.version ?? "0.1.0")` pre-fills "0.1.0" as the actual value, but `placeholder="0.1.0"` is also on the input. The placeholder is never visible. Users can't tell the difference between "default was applied" and "I typed this." If the intent is to show a default, the placeholder approach is cleaner: leave the state empty and validate/fallback on submit.

**Proposal:**
```tsx
const [version, setVersion] = useState(defaultValues?.version ?? "");
// In submit: version: version || "0.1.0"
// In input: placeholder="0.1.0 (default)"
```
Or keep the prefill but remove the placeholder to avoid the confusion.

---

## Theme G — Dark-Theme Contrast

### G1 — `text-gray-600` used for visible content text — below WCAG AA

**Surface:** Multiple · **Viewport:** 1440×900

**Lens:** WCAG 1.4.3 (Contrast Minimum — 4.5:1 for normal text, 3:1 for large text), Accessibility (color-independence).

**Severity:** major

**Finding:** `text-gray-600` = `#4b5563`. On `bg-gray-900` (`#111827`), this is approximately 3.05:1 — below the 4.5:1 WCAG AA threshold for normal text. Affected instances:

| Location | Content |
|---|---|
| `nodes/page.tsx:656` | Inactive sort indicator `↕` |
| `violations/page.tsx:349` | Em-dash for missing node `—` |
| `nodes/page.tsx:458-459` | "Create your first node →" link |
| Bulk modal partial-failure list | `(current: …, allowed: …)` context text |

**Proposal:** Promote to `text-gray-500` (`#6b7280` — ~4.48:1 on gray-950, borderline) or `text-gray-400` for interactive/content text. Reserve `text-gray-600` for truly decorative/non-content elements only. Add a comment to the Tailwind config:

```ts
// tailwind.config.ts — design system note (to be expanded)
// text-gray-600 = decorative only; text-gray-500 = minimum for readable muted text
```

---

### G2 — ARCHIVED lifecycle badge: contrast below WCAG AA for small text

**Surface:** `apps/web/src/components/LifecycleBadge.tsx:9` · **Viewport:** 1440×900

**Lens:** WCAG 1.4.3 (4.5:1 for `text-xs` normal weight), Color Independence.

**Severity:** major

**Finding:** `ARCHIVED: "bg-gray-800 text-gray-400 ring-1 ring-gray-600"` — `text-gray-400` (`#9ca3af`) on `bg-gray-800` (`#1f2937`) = approximately 3.4:1. WCAG AA requires 4.5:1 for text smaller than 18pt / 14pt bold.

**Proposal:** Use `text-gray-300` (`#d1d5db`) on `bg-gray-800` — approximately 6.7:1. Update the ARCHIVED style:
```ts
ARCHIVED: "bg-gray-800 text-gray-300 ring-1 ring-gray-600",
```

---

### G3 — SeverityBadge uses `bg-orange-900` / `bg-red-900` (solid) while LifecycleBadge uses `bg-*/50` opacity

**Surface:** `SeverityBadge.tsx:7-9`, `LifecycleBadge.tsx:6-11` · **Viewport:** 1440×900

**Lens:** Gestalt Similarity (badges should follow a consistent visual language), Design System coherence.

**Severity:** polish

**Finding:** `SeverityBadge` uses solid `bg-red-900`, `bg-orange-900`, `bg-blue-900` with `border border-*-700`. `LifecycleBadge` uses `bg-*-900/50` with `ring-1 ring-*-700`. The visual weight and style differ. In views showing both badge types side by side (violation detail page), they look like they belong to different design systems.

**Proposal:** Align both badge components on the same token pattern. Recommended: `bg-*/50` with `ring-1` (LifecycleBadge's approach) since it reads lighter and more refined on a dark ground. Update SeverityBadge:
```ts
ERROR: "bg-red-900/50 text-red-300 ring-1 ring-red-700",
WARN:  "bg-orange-900/50 text-orange-300 ring-1 ring-orange-700",
INFO:  "bg-blue-900/50 text-blue-300 ring-1 ring-blue-700",
```

---

## Theme H — Copy Inconsistencies and Minor IA

### H1 — Sort indicator arrows not `aria-hidden` — screen readers announce symbols

**Surface:** `apps/web/src/app/nodes/page.tsx:656-657` · **Viewport:** 1440×900

**Lens:** WCAG 1.3.3 (Sensory Characteristics — info not conveyed by shape/icon alone), Screen Reader UX.

**Severity:** minor

**Finding:** The sort indicator `<span>↕</span>` / `<span>↑</span>` / `<span>↓</span>` has no `aria-hidden="true"`. Screen readers will announce "Name ↕ button" for unsorted columns. The `aria-sort` on the `<th>` already conveys the correct semantic; the visual characters are redundant for AT.

**Proposal:**
```tsx
<span aria-hidden="true" className={`text-xs select-none ${active ? "text-blue-400" : "text-gray-600"}`}>
  {active ? (order === "asc" ? "↑" : "↓") : "↕"}
</span>
```

---

### H2 — "Mark as Resolved" vs "Resolve selected" — verb inconsistency

**Surface:** `violations/[id]/page.tsx:125`, `violations/page.tsx:223` · **Viewport:** 1440×900

**Lens:** Nielsen #4 (Consistency and Standards), Plain Language.

**Severity:** polish

**Finding:** The violation detail page button reads "Mark as Resolved"; the list page bulk action reads "Resolve selected (N)". These are the same action described differently.

**Proposal:** Standardize on "Resolve" as the verb (shorter, more direct). Update detail page:
```tsx
// violations/[id]/page.tsx:125
<button …>Resolve</button>
// Dialog confirm: "Resolve" (instead of "Mark as Resolved")
```

---

### H3 — History audit badge style inconsistency vs LifecycleBadge

**Surface:** `apps/web/src/app/nodes/[id]/page.tsx:19-21` · **Viewport:** 1440×900

**Lens:** Gestalt Similarity, Design System coherence.

**Severity:** polish

**Finding:** Change history op badges use `bg-green-900 text-green-300` (solid bg), while `LifecycleBadge` uses `bg-green-900/50`. Both appear on the node detail page.

**Proposal:** Extract history op badges to a shared `OpBadge` component using the same `bg-*/50 ring-1` pattern as LifecycleBadge:
```ts
const OP_STYLES: Record<HistoryOp, string> = {
  CREATE: "bg-green-900/50 text-green-300 ring-1 ring-green-700",
  UPDATE: "bg-blue-900/50 text-blue-300 ring-1 ring-blue-700",
  LIFECYCLE_TRANSITION: "bg-yellow-900/50 text-yellow-300 ring-1 ring-yellow-700",
};
```

---

### H4 — Home page: 5-card grid leaves Violations orphaned in a single column

**Surface:** `apps/web/src/app/page.tsx:56` · **Viewport:** 1440×900

**Lens:** Gestalt Prägnanz (layouts should resolve to a clean visual form), Visual Hierarchy.

**Severity:** polish

**Finding:** `grid-cols-1 sm:grid-cols-2` with 5 cards = 2×2 + 1 orphan. The Violations card sits alone on the last row, which looks unfinished.

**Proposal (option A):** Switch to 3-column at `lg`: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — gives 3+2 layout, still clean.

**Proposal (option B):** Make Violations span 2 columns when it is last: `col-span-1 sm:col-span-2`. This works naturally with the existing 2-col grid and the red accent makes it a strong anchor at the bottom.

---

## Summary by Severity

| # | Theme | Severity | Surface |
|---|---|---|---|
| B1 | Violations: severity filter is client-side | **major** | `violations/page.tsx:53` |
| B2 | Edges: source/target UUID inputs | **major** | `edges/page.tsx` |
| C2 | History error silently swallowed | **major** | `nodes/[id]/page.tsx:53` |
| D1 | Graph canvas: immediate navigation on click | **major** | `graph/page.tsx:147` |
| D2 | Graph canvas: no keyboard navigation | **major** | `graph/page.tsx` |
| E1 | Bulk modals: no focus management | **major** | `nodes/page.tsx`, `violations/page.tsx` |
| E2 | Focus trap incomplete on all modals | **major** | `LifecycleControls.tsx`, modals |
| F1 | NodeForm: labels missing `htmlFor` | **major** | `NodeForm.tsx:116,128,141,159,170` |
| G1 | `text-gray-600` content text below WCAG AA | **major** | multiple |
| G2 | ARCHIVED badge contrast below WCAG AA | **major** | `LifecycleBadge.tsx:9` |
| A1 | "Layers" section header is a link; siblings aren't | minor | `Sidebar.tsx:38` |
| A2 | Sidebar: no app identity anchor | minor | `Sidebar.tsx` |
| A3 | Browser tab title always "LSDS" | minor | `layout.tsx` |
| B3 | Violations: no total count in pagination | minor | `violations/page.tsx:384` |
| B4 | Violation message truncated, no tooltip | minor | `violations/page.tsx:339` |
| C1 | List loading: text-only, no skeleton | minor | all list pages |
| C3 | Graph canvas: initial error has no retry | minor | `graph/page.tsx:164` |
| C4 | Layers: error state has no retry | minor | `layers/page.tsx:49` |
| D3 | LAYER_COLORS hardcoded hex — not design-system-linked | minor | `graph/page.tsx:33` |
| F2 | NodeForm: read-only info box below attributes | minor | `NodeForm.tsx:180` |
| H1 | Sort arrows not `aria-hidden` | minor | `nodes/page.tsx:656` |
| H2 | "Mark as Resolved" vs "Resolve selected" — verb inconsistency | polish | `violations/[id]/page.tsx:125` |
| F3 | Version field: pre-filled default masks placeholder | polish | `NodeForm.tsx:48` |
| G3 | SeverityBadge vs LifecycleBadge style divergence | polish | `SeverityBadge.tsx`, `LifecycleBadge.tsx` |
| H3 | History badge style diverges from LifecycleBadge | polish | `nodes/[id]/page.tsx:19` |
| H4 | Home page: Violations card orphaned in 2-col grid | polish | `page.tsx:56` |

---

## Proposed Prototype Themes

Based on this audit, the following themes are recommended for prototype-phase scoping (subject to CEO sign-off):

1. **Accessibility hardening** — Focus management (E1/E2), form labels (F1), keyboard canvas navigation (D2), contrast fixes (G1/G2). These are non-negotiable before any public/wider rollout.
2. **Loading/error state system** — Shared `TableSkeletonRow`, `<ConfirmModal>`, standardized error+retry pattern. One pass through all surfaces with a shared component.
3. **Filter & pagination correctness** — B1 (severity server-side), B2 (NodeCombobox for edges), B3 (violation total). These are correctness bugs wearing a UX coat.
4. **Graph canvas experience** — Two-step click (D1), accessible node list (D2), layer color tokens (D3). The canvas is the product's flagship surface and currently the lowest-polish one.
5. **Design system foundation** — Unify badge tokens (G3/H3), extract `<ConfirmModal>`, establish `text-gray-600`=decorative rule in Tailwind config comments. Low effort, high coherence gain.
