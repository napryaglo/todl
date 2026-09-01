# TODL Tests & Demos — Phase 3 Implementation Plan (graph view + docs export)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the two Phase-3 items from the design spec: (1) a **graph-diagram view** of the compiled typed graph, selectable alongside the JSON panel in the shared `ExampleRunnerVM`; and (2) a **`todl-demo docs [--out <dir>]`** command that emits the corpus to static markdown.

**Architecture:** Both features keep the established boundary — pure, framework-agnostic logic in `shared/` (unit-tested with `node:test`), thin consumers on top. The graph gets a pure deterministic layout (`shared/graph-layout.ts`: `TodlDocument` → positioned nodes/edges) plus a small Mural rendering factory in `app/` that builds a `Canvas` of `Border`+`TextBlock` nodes and `Line` edges imperatively; the `ExampleRunnerVM` exposes that `Canvas` as a DP and a view toggle, hosted via `ContentControl [ Content = $Graph ]` (ContentControl renders a `Visual` content directly — verified). The docs export gets a pure markdown generator (`shared/docs-markdown.ts`: corpus → `{path, content}[]`) driven off each example's **committed golden** (already canonical, so docs match the regression baseline), with `cli/src/commands/docs.ts` as file-writing plumbing (mirrors `examples/tools/update-goldens.mts`).

**Tech Stack:** todl compiler (`@pragmatic-tech-ai/todl`, `TodlDocument` = `{nodes:{id,tier,typeOf,attrs}[], edges:{kind,via,from,to}[]}`); Mural 0.45 `/basic` (`Canvas`, `Line`, `Border`, `TextBlock`) + `/visual-engine` (`Pen`, `SolidColorBrush`, `Color`); node `fs` for the CLI writer; Playwright + system Edge for UI verification.

**Spec:** `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md` (§ "Phasing" → Phase 3; § "Pages" → Playground "Phase 3 adds a `Diagram` view"; § "The CLI" → `todl-demo docs`).

## Global Constraints

- **`shared/` stays pure** — compiler + plain JS/TS only; no Mural, no DOM, no `fs`. `graph-layout.ts` and `docs-markdown.ts` live here and are node-testable. (Enforced since Phase 1.)
- **All Mural code stays in `app/`.** The graph *rendering* factory imports Mural; the graph *layout* does not.
- **Build order:** the app's `@pragmatic-tech-ai/todl` → `../dist` alias requires the repo root `npm run build` to have run. `npm run app:build` chains it.
- **Mural imperative-render recipe (spike-verified), do NOT deviate:**
  - Positioning: `Canvas` from `/basic`; `Canvas.SetLeft(child, x)` / `Canvas.SetTop(child, y)` (static setters). Attached-property *binding* through `ItemsControl`/`DataTemplate` item containers is **not** supported — build the graph visual tree imperatively in TS.
  - Edges: `Line` from `/basic` with `X1/Y1/X2/Y2` in **local** coords + `Stroke: Pen`; position the line's bounding origin on the canvas via `Canvas.SetLeft/Top`.
  - Node box: `Border` (`.Fill`, `.Stroke`, `.Width`, `.Height`, `.SetChild(textBlock)`) containing a `TextBlock` (`.Text`).
  - Hosting: `ContentControl [ Content = $Graph ]` where `$Graph` is a `Canvas` — ContentControl presents a `Visual` content as-is (`content-control.ts:146`).
- **`shared/` stays out of nothing new / `app/` stays out of the published package** — `files` array unchanged; no new root deps.
- **UI verification** reuses the committed harness: `vite build` → `vite preview --port 4319 --strictPort` → `node app/src/ui-verify/render-check.mjs http://localhost:4319/`, asserting SVG `<text>` content + no `pageerror`. System Edge via `channel:"msedge"`.
- **Determinism** — the layout must be a pure function of the document (stable node order, integer positions); no `Math.random`, no time. Docs markdown must be byte-stable across runs (drives a golden-style test).

## File Structure

```
shared/
  graph-layout.ts                 # NEW pure: TodlDocument → GraphLayout (nodes+edges positioned)
  docs-markdown.ts                # NEW pure: corpus → DocFile[] (index + per-example markdown)
  tests/graph-layout.test.ts      # NEW
  tests/docs-markdown.test.ts     # NEW
app/
  src/components/example-runner/
    graph-view.ts                 # NEW: buildGraphCanvas(layout) → Canvas (Mural /basic)
    example-runner-vm.ts          # MODIFY: add Graph DP + OutputView toggle + rebuild on compile
    example-runner.mu             # MODIFY: view toggle + swap JSON panel ↔ graph ContentControl
  README.md                       # MODIFY: document the graph view
cli/
  src/commands/docs.ts            # NEW: write renderDocs(CORPUS) to --out
  src/main.ts                     # MODIFY: route `docs`; update usage
  src/tests/commands.test.ts      # MODIFY: add a `docs` test (writes to a temp dir)
docs/superpowers/specs/2026-09-01-todl-demos-app-design.md  # MODIFY: mark Phase 3 done
```

## Interfaces produced (referenced across tasks)

- `shared/graph-layout.ts`:
  ```ts
  export interface LaidOutNode { id: string; x: number; y: number; w: number; h: number; label: string; sub: string }
  export interface LaidOutEdge { from: string; to: string; label: string }
  export interface GraphLayout { nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number }
  export function layoutGraph(doc: TodlDocument): GraphLayout
  export function nodeLabel(node: JsonNode): string   // display label from attrs/typeOf/id
  ```
- `app/src/components/example-runner/graph-view.ts`:
  ```ts
  import { Canvas } from "@pragmatic-tech-ai/mural/basic";
  export function buildGraphCanvas(layout: GraphLayout): Canvas
  ```
- `shared/docs-markdown.ts`:
  ```ts
  export interface DocFile { path: string; content: string }   // path is out-dir-relative, POSIX
  export function renderDocs(corpus: readonly CorpusEntry[]): DocFile[]
  ```

---

## Task 1: `shared/graph-layout.ts` — pure deterministic layout

Turn a compiled `TodlDocument` into positioned nodes + edges. A layered (longest-path-rank) left-to-right layout: rank = longest path from any root (no-incoming node); nodes with no edges land in rank 0. Deterministic ordering by id within a rank. Pure — no Mural, no DOM.

**Files:**
- Create: `shared/graph-layout.ts`
- Test: `shared/tests/graph-layout.test.ts`

**Interfaces:**
- Consumes: `TodlDocument`, `JsonNode`, `JsonEdge` from `@pragmatic-tech-ai/todl`.
- Produces: `layoutGraph`, `nodeLabel`, `GraphLayout`, `LaidOutNode`, `LaidOutEdge` (see above).

- [ ] **Step 1: Write the failing test** `shared/tests/graph-layout.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGraph, nodeLabel } from "../graph-layout.js";
import type { TodlDocument } from "@pragmatic-tech-ai/todl";

const doc: TodlDocument = {
  nodes: [
    { id: 1, tier: "instance", typeOf: 10, attrs: { name: "a" } },
    { id: 2, tier: "instance", typeOf: 10, attrs: { name: "b" } },
    { id: 3, tier: "instance", typeOf: 10, attrs: {} },
  ],
  edges: [{ kind: "calls", via: null, from: 1, to: 2 }],
};

test("every node gets a position and a label", () => {
  const g = layoutGraph(doc);
  assert.equal(g.nodes.length, 3);
  for (const n of g.nodes) {
    assert.equal(typeof n.x, "number");
    assert.equal(typeof n.y, "number");
    assert.ok(n.w > 0 && n.h > 0);
    assert.ok(n.label.length > 0);
  }
  assert.equal(g.edges.length, 1);
});

test("an edge target ranks to the right of its source", () => {
  const g = layoutGraph(doc);
  const a = g.nodes.find((n) => n.id === "1")!;
  const b = g.nodes.find((n) => n.id === "2")!;
  assert.ok(b.x > a.x, "target should be in a later column than source");
});

test("layout is deterministic across runs", () => {
  assert.deepEqual(layoutGraph(doc), layoutGraph(doc));
});

test("overall size bounds all node boxes", () => {
  const g = layoutGraph(doc);
  for (const n of g.nodes) {
    assert.ok(n.x + n.w <= g.width);
    assert.ok(n.y + n.h <= g.height);
  }
});

test("empty document yields an empty, zero-ish layout", () => {
  const g = layoutGraph({ nodes: [], edges: [] });
  assert.equal(g.nodes.length, 0);
  assert.equal(g.edges.length, 0);
});

test("nodeLabel prefers a name/label attr, else falls back", () => {
  assert.equal(nodeLabel({ id: 5, tier: "instance", typeOf: 9, attrs: { name: "svc" } }), "svc");
  const fallback = nodeLabel({ id: 7, tier: "concept", typeOf: 0, attrs: {} });
  assert.ok(fallback.length > 0);
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx tsx --conditions=development --test "shared/tests/graph-layout.test.ts"`
Expected: FAIL ("Cannot find module '../graph-layout.js'").

- [ ] **Step 3: Write `shared/graph-layout.ts`**

```ts
import type { TodlDocument, JsonNode } from "@pragmatic-tech-ai/todl";

export interface LaidOutNode { id: string; x: number; y: number; w: number; h: number; label: string; sub: string }
export interface LaidOutEdge { from: string; to: string; label: string }
export interface GraphLayout { nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number }

const NODE_W = 150, NODE_H = 48, H_GAP = 70, V_GAP = 26, PAD = 24;

/** A readable label for a node: a name-ish attribute, else the last segment of
 *  its tier, else the raw id. Kept deterministic for stable rendering + tests. */
export function nodeLabel(node: JsonNode): string {
  const a = node.attrs ?? {};
  for (const key of ["name", "label", "id", "title"]) {
    const v = a[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (node.tier) return `${node.tier}#${node.id}`;
  return String(node.id);
}

/** Longest-path rank from any root (no incoming edge). Cycles are broken by the
 *  visited guard (a back-edge simply doesn't raise the rank further). */
function ranks(ids: string[], adj: Map<string, string[]>, indeg: Map<string, number>): Map<string, number> {
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  // Kahn-style longest path: process in a stable queue, relax successors.
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0).sort();
  const seen = new Set<string>();
  while (queue.length) {
    const u = queue.shift()!;
    if (seen.has(u)) continue;
    seen.add(u);
    for (const v of adj.get(u) ?? []) {
      if (rank.get(v)! < rank.get(u)! + 1) rank.set(v, rank.get(u)! + 1);
      queue.push(v);
    }
    queue.sort((a, b) => rank.get(a)! - rank.get(b)! || a.localeCompare(b));
  }
  return rank;
}

export function layoutGraph(doc: TodlDocument): GraphLayout {
  const ids = doc.nodes.map((n) => String(n.id));
  const idSet = new Set(ids);
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const edges: LaidOutEdge[] = [];
  for (const e of doc.edges) {
    const from = String(e.from), to = String(e.to);
    if (!idSet.has(from) || !idSet.has(to)) continue; // skip dangling base refs
    adj.get(from)!.push(to);
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
    edges.push({ from, to, label: e.kind });
  }

  const rank = ranks(ids, adj, indeg);
  // Group by rank, order within a rank by id for stability.
  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const r = rank.get(id)!;
    (byRank.get(r) ?? byRank.set(r, []).get(r)!).push(id);
  }
  const labelOf = new Map(doc.nodes.map((n) => [String(n.id), { label: nodeLabel(n), sub: n.tier ?? "" }]));

  const nodes: LaidOutNode[] = [];
  let maxRow = 0;
  for (const [r, col] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    col.sort((a, b) => a.localeCompare(b));
    col.forEach((id, row) => {
      const meta = labelOf.get(id)!;
      nodes.push({
        id, label: meta.label, sub: meta.sub, w: NODE_W, h: NODE_H,
        x: PAD + r * (NODE_W + H_GAP),
        y: PAD + row * (NODE_H + V_GAP),
      });
      if (row > maxRow) maxRow = row;
    });
  }

  const cols = byRank.size;
  const width = nodes.length ? PAD * 2 + cols * NODE_W + Math.max(0, cols - 1) * H_GAP : 0;
  const height = nodes.length ? PAD * 2 + (maxRow + 1) * NODE_H + maxRow * V_GAP : 0;
  return { nodes, edges, width, height };
}
```

- [ ] **Step 4: Run → PASS.** `npx tsx --conditions=development --test "shared/tests/graph-layout.test.ts"` — all green.

- [ ] **Step 5: Commit**

```bash
git add shared/graph-layout.ts shared/tests/graph-layout.test.ts
git commit -m "feat(demos): pure deterministic graph layout for the typed graph view"
```

---

## Task 2: `graph-view.ts` — Mural rendering factory + `ExampleRunnerVM` graph tab

Render a `GraphLayout` into a Mural `Canvas` imperatively, expose it on `ExampleRunnerVM` as a `Graph` DP recomputed each compile, and add an output-view toggle (JSON ↔ Graph) in the runner `.mu`.

**Files:**
- Create: `app/src/components/example-runner/graph-view.ts`
- Modify: `app/src/components/example-runner/example-runner-vm.ts`
- Modify: `app/src/components/example-runner/example-runner.mu`

**Interfaces:**
- Consumes: `GraphLayout`, `layoutGraph` (Task 1); `DisplayResult.document` (`shared/compile-for-display`).
- Produces: `buildGraphCanvas(layout: GraphLayout): Canvas`; `ExampleRunnerVM` gains `Graph: Canvas`, `OutputView: string` ("json"|"graph"), `ShowJson`/`ShowGraph` commands, `ShowJsonPanel`/`ShowGraphPanel: boolean`.

- [ ] **Step 1: Write `graph-view.ts`**

```ts
import { Canvas, Border, TextBlock, Line, StackPanel } from "@pragmatic-tech-ai/mural/basic";
import { Pen, SolidColorBrush, Color } from "@pragmatic-tech-ai/mural/visual-engine";
import type { GraphLayout } from "../../../../shared/graph-layout.js";

const NODE_FILL = new SolidColorBrush(new Color(238, 242, 248, 255));
const NODE_STROKE = new Pen(new SolidColorBrush(new Color(90, 110, 140, 255)), 1);
const EDGE_PEN = new Pen(new SolidColorBrush(new Color(120, 130, 145, 255)), 1.5);

/** Build a Canvas of Border nodes + Line edges from a pure layout. Imperative
 *  by necessity: attached-property bindings do not flow through item containers,
 *  so we position each child with Canvas.SetLeft/Top directly. */
export function buildGraphCanvas(layout: GraphLayout): Canvas {
  const canvas = new Canvas();
  canvas.Width = Math.max(layout.width, 1);
  canvas.Height = Math.max(layout.height, 1);
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));

  // Edges first (drawn under the node boxes). Center-to-center straight lines.
  for (const e of layout.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + a.w / 2, y1 = a.y + a.h / 2;
    const x2 = b.x + b.w / 2, y2 = b.y + b.h / 2;
    const line = new Line();
    line.X1 = 0; line.Y1 = 0; line.X2 = x2 - x1; line.Y2 = y2 - y1;
    line.Stroke = EDGE_PEN;
    Canvas.SetLeft(line, x1);
    Canvas.SetTop(line, y1);
    canvas.AddChild(line);
  }

  for (const n of layout.nodes) {
    const box = new Border();
    box.Width = n.w; box.Height = n.h;
    box.Fill = NODE_FILL; box.Stroke = NODE_STROKE;
    const stack = new StackPanel();
    const label = new TextBlock();
    label.Text = n.label; label.FontSize = 13;
    stack.AddChild(label);
    if (n.sub) { const sub = new TextBlock(); sub.Text = n.sub; sub.FontSize = 10; stack.AddChild(sub); }
    box.SetChild(stack);
    Canvas.SetLeft(box, n.x);
    Canvas.SetTop(box, n.y);
    canvas.AddChild(box);
  }
  return canvas;
}
```
> Note: node label centering/margins are best-effort; if `StackPanel` alignment needs tuning, set `label.Margin`/`stack` alignment in Step 4 after eyeballing. Keep the edge `Line` drawn before the boxes so node fills cover the line stubs. Arrowheads are deliberately omitted from the MVP (direction is conveyed by left-to-right rank); add later only if trivial.

- [ ] **Step 2: Extend `ExampleRunnerVM`** — add the graph DP, the view toggle, and rebuild the canvas each compile.

Add these registrations + accessors alongside the existing ones:

```ts
import { Canvas } from "@pragmatic-tech-ai/mural/basic";
import { RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import { layoutGraph } from "../../../../shared/graph-layout.js";
import { buildGraphCanvas } from "./graph-view.js";

// inside the class:
static GraphKey = MuralBase.RegisterProperty<Canvas | undefined>(ExampleRunnerVM, "Graph", undefined, MetaData.None);
static OutputViewKey = MuralBase.RegisterProperty<string>(ExampleRunnerVM, "OutputView", "json", MetaData.None);
static ShowJsonPanelKey = MuralBase.RegisterProperty<boolean>(ExampleRunnerVM, "ShowJsonPanel", true, MetaData.None);
static ShowGraphPanelKey = MuralBase.RegisterProperty<boolean>(ExampleRunnerVM, "ShowGraphPanel", false, MetaData.None);
static ShowJsonKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowJson", undefined, MetaData.None);
static ShowGraphKey = MuralBase.RegisterProperty<ICommand | undefined>(ExampleRunnerVM, "ShowGraph", undefined, MetaData.None);

get Graph(): Canvas | undefined { return this.get_property_value(ExampleRunnerVM.GraphKey); }
get OutputView(): string { return this.get_property_value(ExampleRunnerVM.OutputViewKey); }
get ShowJsonPanel(): boolean { return this.get_property_value(ExampleRunnerVM.ShowJsonPanelKey); }
get ShowGraphPanel(): boolean { return this.get_property_value(ExampleRunnerVM.ShowGraphPanelKey); }
get ShowJson(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowJsonKey); }
get ShowGraph(): ICommand | undefined { return this.get_property_value(ExampleRunnerVM.ShowGraphKey); }

private setView(view: "json" | "graph"): void {
  this.set_property_value(ExampleRunnerVM.OutputViewKey, view);
  this.set_property_value(ExampleRunnerVM.ShowJsonPanelKey, view === "json");
  this.set_property_value(ExampleRunnerVM.ShowGraphPanelKey, view === "graph");
}
```

In the constructor, after the existing `Run` wiring:

```ts
this.set_property_value(ExampleRunnerVM.ShowJsonKey, new RelayCommand(() => this.setView("json")));
this.set_property_value(ExampleRunnerVM.ShowGraphKey, new RelayCommand(() => this.setView("graph")));
```

In `compile()`, after setting `Json`/`Status`, rebuild the graph from the freshly compiled document:

```ts
this.set_property_value(ExampleRunnerVM.GraphKey, buildGraphCanvas(layoutGraph(r.document)));
```
> `r` is the `DisplayResult` from `compileForDisplay`. A brand-new `Canvas` each compile avoids stale-child accumulation and re-triggers ContentControl presentation.

- [ ] **Step 3: Update `example-runner.mu`** — add a small toggle and swap the JSON `ScrollViewer` for a JSON-or-graph pair gated by the boolean DPs.

Replace the existing JSON `ScrollViewer` block in the output `DockPanel` with:

```
StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,6) ] {
    Button [ Command = $ShowJson,  Margin = (0,0,4,0) ] { TextBlock [ Text = "JSON" ] }
    Button [ Command = $ShowGraph ]                     { TextBlock [ Text = "Graph" ] }
}
ScrollViewer [ Visibility = {{ $ShowJsonPanel ? Visible : Collapsed }} ] {
    TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $Json ]
}
ScrollViewer [ Visibility = {{ $ShowGraphPanel ? Visible : Collapsed }} ] {
    ContentControl [ Content = $Graph ]
}
```
> If the `{{ … ? Visible : Collapsed }}` conditional-binding form is not accepted by the `.mu` compiler, fall back to two `bool→Visibility`-typed DPs on the VM (`JsonVisibility`/`GraphVisibility` of type `Visibility`) set in `setView`, and bind `Visibility = $JsonVisibility`. Decide by compiling in Step 4; the boolean DPs are already there to derive from. Keep both panels inside the existing output `DockPanel` region.

- [ ] **Step 4: Build + verify render + toggle.** From `app/`: `npx vite build` then `npx vite preview --port 4319 --strictPort &`, then `node src/ui-verify/render-check.mjs http://localhost:4319/`. Expect no `errors` and the JSON panel visible by default. Extend the harness once to click the "Graph" button and assert the SVG `<text>` now includes a node label from the seeded example (e.g. an entity/name string that `nodeLabel` would surface), proving the imperative Canvas mounts through `ContentControl`. Screenshot-confirm boxes + connecting lines render without overlap for at least one multi-node example. Kill the preview.
> If the graph is visually cramped or labels clip, adjust the `NODE_W/H_GAP/V_GAP` constants in `graph-layout.ts` (Task 1) — they are the single source of spacing — and rebuild. Do not hand-place in the renderer.

- [ ] **Step 5: Commit**

```bash
git add app/src/components shared/graph-layout.ts
git commit -m "feat(demos): typed-graph view in the example runner (Canvas+Line, JSON/Graph toggle)"
```

---

## Task 3: `shared/docs-markdown.ts` — pure corpus → markdown

Emit the corpus as static markdown: one `index.md` (TOC grouped by `manifest.group`, ordered by `order`, linking to per-example files) plus one file per example (`<group-slug>/<id>.md`) with narrative + fenced source + compiled-output summary. Driven off each example's **committed golden** so the docs equal the asserted baseline. Pure — returns file contents, writes nothing.

**Files:**
- Create: `shared/docs-markdown.ts`
- Test: `shared/tests/docs-markdown.test.ts`

**Interfaces:**
- Consumes: `CorpusEntry`, `Golden` (`shared/corpus-types`); `byGroup` (`shared/corpus-access`).
- Produces: `renderDocs(corpus): DocFile[]`; `DocFile { path: string; content: string }`.

- [ ] **Step 1: Write the failing test** `shared/tests/docs-markdown.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDocs } from "../docs-markdown.js";
import { CORPUS } from "../../examples/corpus.generated.js";

test("emits an index plus one file per example", () => {
  const files = renderDocs(CORPUS);
  assert.ok(files.some((f) => f.path === "index.md"));
  assert.equal(files.filter((f) => f.path !== "index.md").length, CORPUS.length);
});

test("index links to every example file", () => {
  const files = renderDocs(CORPUS);
  const index = files.find((f) => f.path === "index.md")!;
  for (const f of files) {
    if (f.path === "index.md") continue;
    assert.ok(index.content.includes(f.path), `index should link ${f.path}`);
  }
});

test("an example doc carries title, narrative, a fenced todl source, and node/edge counts", () => {
  const files = renderDocs(CORPUS);
  const first = CORPUS[0];
  const doc = files.find((f) => f.path.endsWith(`${first.manifest.id}.md`))!;
  assert.ok(doc.content.includes(first.manifest.title));
  assert.ok(doc.content.includes("```todl"));
  assert.ok(doc.content.includes(first.sources[0].text.trim().split("\n")[0]));
  assert.match(doc.content, /node\(s\)|edge\(s\)/);
});

test("an intentional-error example renders its diagnostics", () => {
  const files = renderDocs(CORPUS);
  const errored = CORPUS.find((e) => e.golden.diagnostics.some((d) => d.severity === "error"));
  if (!errored) return; // corpus always has one, but stay defensive
  const doc = files.find((f) => f.path.endsWith(`${errored.manifest.id}.md`))!;
  assert.ok(doc.content.toLowerCase().includes("diagnostic"));
  assert.ok(doc.content.includes(errored.golden.diagnostics[0].code));
});

test("output is deterministic", () => {
  assert.deepEqual(renderDocs(CORPUS), renderDocs(CORPUS));
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx tsx --conditions=development --test "shared/tests/docs-markdown.test.ts"`
Expected: FAIL ("Cannot find module '../docs-markdown.js'").

- [ ] **Step 3: Write `shared/docs-markdown.ts`**

```ts
import type { CorpusEntry, Golden } from "./corpus-types.js";
import { byGroup } from "./corpus-access.js";

export interface DocFile { path: string; content: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const fileFor = (e: CorpusEntry) => `${slug(e.manifest.group)}/${e.manifest.id}.md`;

function outputSection(golden: Golden): string {
  const nodes = golden.document.nodes.length, edges = golden.document.edges.length;
  const lines = [`**Compiled:** ${nodes} node(s), ${edges} edge(s).`, ""];
  if (golden.diagnostics.length) {
    lines.push("### Diagnostics", "");
    for (const d of golden.diagnostics) lines.push(`- \`${d.severity}\` \`${d.code}\` — ${d.message}`);
    lines.push("");
  }
  lines.push("```json", JSON.stringify(golden.document, null, 2), "```", "");
  return lines.join("\n");
}

function exampleDoc(e: CorpusEntry): string {
  const parts = [`# ${e.manifest.title}`, "", e.manifest.narrative.trim(), ""];
  if (e.manifest.tags.length) parts.push(`*Tags: ${e.manifest.tags.join(", ")}*`, "");
  for (const s of e.sources) {
    if (e.sources.length > 1) parts.push(`**\`${s.name}\`**`, "");
    parts.push("```todl", s.text.trim(), "```", "");
  }
  parts.push(outputSection(e.golden));
  parts.push("---", "", "[← back to index](../index.md)", "");
  return parts.join("\n");
}

function indexDoc(corpus: readonly CorpusEntry[]): string {
  const parts = ["# TODL examples", "", "Generated from the example corpus — every snippet below is a verified golden-snapshot test.", ""];
  for (const [group, entries] of byGroup(corpus)) {
    parts.push(`## ${group}`, "");
    for (const e of entries) parts.push(`- [${e.manifest.title}](${fileFor(e)}) — ${e.manifest.narrative.trim().split("\n")[0]}`);
    parts.push("");
  }
  return parts.join("\n");
}

/** Corpus → static markdown files (index + one per example). Pure: caller writes them. */
export function renderDocs(corpus: readonly CorpusEntry[]): DocFile[] {
  const files: DocFile[] = [{ path: "index.md", content: indexDoc(corpus) }];
  for (const [, entries] of byGroup(corpus)) {
    for (const e of entries) files.push({ path: fileFor(e), content: exampleDoc(e) });
  }
  return files;
}
```

- [ ] **Step 4: Run → PASS.** `npx tsx --conditions=development --test "shared/tests/docs-markdown.test.ts"` — all green.

- [ ] **Step 5: Commit**

```bash
git add shared/docs-markdown.ts shared/tests/docs-markdown.test.ts
git commit -m "feat(demos): pure corpus-to-markdown docs generator"
```

---

## Task 4: `todl-demo docs [--out <dir>]` command

Thin CLI plumbing over `renderDocs`: write each `DocFile` under `--out` (default `docs/showcase`), creating subdirs, and print a summary. Mirrors the `update-goldens.mts` write idiom.

**Files:**
- Create: `cli/src/commands/docs.ts`
- Modify: `cli/src/main.ts` (route `docs`; update usage)
- Modify: `cli/src/tests/commands.test.ts` (add a `docs` test writing to a temp dir)

**Interfaces:**
- Consumes: `renderDocs` (Task 3); `CORPUS` (`examples/corpus.generated`).
- Produces: `docs(args: string[]): number`.

- [ ] **Step 1: Write `cli/src/commands/docs.ts`**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CORPUS } from "../../../examples/corpus.generated.js";
import { renderDocs } from "../../../shared/docs-markdown.js";
import { header, green } from "../format.js";

/** `todl-demo docs [--out <dir>]` — emit the corpus as static markdown. */
export function docs(args: string[]): number {
  const i = args.indexOf("--out");
  const outDir = i >= 0 && args[i + 1] ? args[i + 1] : "docs/showcase";
  const files = renderDocs(CORPUS);
  for (const f of files) {
    const dest = join(outDir, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content, "utf8");
  }
  process.stdout.write(header("docs") + "\n");
  process.stdout.write(green(`  wrote ${files.length} file(s) to ${outDir}\n`));
  return 0;
}
```

- [ ] **Step 2: Route it in `cli/src/main.ts`** — add the case and extend usage:

```ts
import { docs } from "./commands/docs.js";
// …
case "docs": return docs(rest);
// …
process.stdout.write("usage: todl-demo <list|run <id>|test [--update]|docs [--out <dir>]>\n");
```

- [ ] **Step 3: Add a CLI test** to `cli/src/tests/commands.test.ts` (writes to the OS temp dir, then asserts index content):

```ts
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("docs --out writes an index and example files", () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-docs-"));
  const { code } = capture(() => runCommand(["docs", "--out", dir]));
  assert.equal(code, 0);
  assert.ok(existsSync(join(dir, "index.md")));
  assert.match(readFileSync(join(dir, "index.md"), "utf8"), /TODL examples/);
});
```

- [ ] **Step 4: Run the CLI suite → PASS.**

Run: `npx tsx --conditions=development --test "cli/**/*.test.ts"`
Expected: existing tests + the new `docs` test pass. Also smoke it: `npm run cli -- docs --out ` a temp path and eyeball one generated file.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/docs.ts cli/src/main.ts cli/src/tests/commands.test.ts
git commit -m "feat(demos): todl-demo docs — static-markdown corpus export"
```

---

## Task 5: Docs, spec status & full green pass

Wire nothing new at the root (the `cli` script already routes subcommands); update docs and the spec, and prove the whole suite is green.

**Files:**
- Modify: `app/README.md` (document the graph view)
- Modify: `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md` (mark Phase 3 complete)

- [ ] **Step 1: Update `app/README.md`** — under the Playground/Docs description, add that the example runner's output panel now toggles **JSON ↔ Graph**, the graph being an imperatively-built `Canvas` of `Border` nodes + `Line` edges laid out by the pure `shared/graph-layout.ts`. Note the CLI gained `todl-demo docs [--out <dir>]`.

- [ ] **Step 2: Update the design spec** — change the Phase 3 line under "Phasing" to done, e.g. append `— DONE 2026-09-01 (graph view in ExampleRunnerVM; todl-demo docs export)`.

- [ ] **Step 3: Full green pass.** Run all suites and the app build:

```bash
npm run test:corpus     # Phase 1-3 shared/examples/cli tests (incl. graph-layout, docs-markdown, docs cmd)
npm test                # existing src/** compiler tests
npm run app:build       # repo build + app build (proves graph-view.ts + .mu compile)
```
Expected: all green; app builds. Optionally `npm run app:verify` against a running preview.

- [ ] **Step 4: Commit**

```bash
git add app/README.md docs/superpowers/specs/2026-09-01-todl-demos-app-design.md
git commit -m "docs(demos): document the graph view + docs export; mark Phase 3 done"
```

---

## Self-Review

**Spec coverage** (Phase 3 = "Graph view + docs export"):
- Playground "Phase 3 adds a `Diagram` view of the typed graph as a selectable tab" → Task 2 (JSON/Graph toggle in the shared `ExampleRunnerVM`, so it appears in Playground **and** Docs). ✓ (Deviation from spec wording: a lightweight imperative `Canvas`+`Line` view, not the heavy interactive `Diagram` editor — justified by YAGNI for a read-only demo of tiny graphs; noted.)
- `todl-demo docs [--out <dir>]` static-markdown emit → Tasks 3 (pure generator) + 4 (CLI command). ✓
- One corpus, one compile path → the graph renders `compileForDisplay`'s document (same normalize path as tests); docs render the committed golden (the asserted baseline). No new compile path. ✓
- Purity boundary → `graph-layout.ts` + `docs-markdown.ts` in `shared/` (node-tested); Mural only in `app/graph-view.ts`. ✓
- Package boundary → no `files` change, no new root deps; unaffected. ✓

**Placeholder scan:** No `TBD`/vague steps. Every code step carries real content. Two execution-time risks are called out with concrete fallbacks (below), not deferred as placeholders.

**Type consistency:** `GraphLayout`/`LaidOutNode`/`LaidOutEdge`/`layoutGraph`/`nodeLabel` (Task 1) are consumed by `buildGraphCanvas` (Task 2) with the same names. `DocFile`/`renderDocs` (Task 3) are consumed by `docs()` (Task 4). `ExampleRunnerVM` DP names (`Graph`, `OutputView`, `ShowJsonPanel`, `ShowGraphPanel`, `ShowJson`, `ShowGraph`) are defined and bound consistently across VM (Task 2 Step 2) and `.mu` (Task 2 Step 3). `TodlDocument`/`JsonNode`/`JsonEdge` match the compiler's `emit/json` shape (`{id,tier,typeOf,attrs}` / `{kind,via,from,to}`).

**Open risks (verify during execution, not assumed):**
1. **`.mu` conditional visibility binding** (`{{ $ShowJsonPanel ? Visible : Collapsed }}`): if the compiler rejects the ternary form, add `Visibility`-typed DPs on the VM set in `setView()` and bind `Visibility = $JsonVisibility` (flagged in Task 2 Step 3). The boolean DPs are already present to drive either path.
2. **Hosting an imperative `Canvas` via `ContentControl [ Content = $Graph ]`**: verified at the code level (`content-control.ts:146` returns a `Visual` content as-is), but confirm on-screen in Task 2 Step 4 (assert a node label appears in SVG `<text>`). Fallback if presentation misbehaves: wrap the canvas in a `Border` DP instead, or set the ContentControl's content imperatively from a mounted hook.
3. **`StackPanel`/label layout inside a fixed-size `Border`**: labels may need `Margin`/alignment or truncation; tune constants in `graph-layout.ts` (single source of spacing) after eyeballing (Task 2 Step 4). Node text uses the Phase-2 ellipsis capability if it overflows.
4. **`nodeLabel` attr availability**: corpus nodes may lack a `name`/`label` attr; the `tier#id` fallback guarantees a non-empty label (covered by a Task 1 test). Graph readability for attr-less examples is acceptable for a demo.
