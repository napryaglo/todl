# TODL Demos — Phase 5 Implementation Plan (graph view depth)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the typed-graph view legible and navigable: arrowheads + edge-kind labels, a click-to-select node inspector, and pan/zoom (`+`/`−`/`Fit` buttons + Ctrl+wheel + drag-pan).

**Architecture:** Pure geometry/data in `shared/graph-layout.ts` (node-tested); all Mural interaction in `app/.../graph-view.ts` + `ExampleRunnerVM` + `.mu`. `buildGraphCanvas` is replaced by `buildGraphView(layout, onSelect) → { view, zoomIn, zoomOut, fit }` returning a `ScrollViewer`-hosted interactive `GraphCanvas`. No new dependencies.

**Tech Stack (verified exports):** `/basic` — `Canvas`, `Border`, `TextBlock`, `Line`, `Path`, `StackPanel`; `/visual-engine` — `PointerEventArgs`, `PointerButton` (Primary=0), `WheelEventArgs` (`.DeltaY`), `ModifierKeys`, `hasModifier`, `ScaleTransform`, `RotateTransform`, `Pen`, `SolidColorBrush`, `Color`, `Thickness`, `Point`; `/framework` — `ScrollViewer` (`.HorizontalOffset`/`.VerticalOffset`). Element virtuals: `protected OnPointerDown/Move/Up(args: PointerEventArgs)`, `protected OnPreviewPointerWheel(args: WheelEventArgs)`. `Visual.LayoutTransform`, `Visual.RenderTransform`, `Visual.RenderTransformOrigin`.

**Spec:** `docs/superpowers/specs/2026-09-01-todl-demos-phase5-design.md`

## Global Constraints

- **`shared/` stays pure** — no Mural/DOM. `LaidOutNode` enrichment + `edgeGeometry` live here, node-tested.
- **Interaction is app-only.** Pointer/wheel handling via **subclassing + overriding virtuals** (there is NO `AddHandler` API for imperative visuals). `args.Handled = true` stops propagation.
- **Node click pre-empts background pan.** A node's `OnPointerDown` sets `Handled`, so the canvas-background pan handler (parent) doesn't fire on nodes (bubble = leaf-first).
- **Ctrl+wheel only for zoom.** Non-Ctrl wheel must fall through to the ScrollViewer (normal scroll) — only `Handled` when Ctrl is held.
- **Zoom via `LayoutTransform = ScaleTransform(z,z)`** on the content canvas; clamp z to [0.3, 3]. Rebuilt each compile (zoom resets — acceptable).
- **Determinism** — `edgeGeometry` and layout are pure functions; no time/random.
- **Reuse the harness** (`vite build` → `vite preview --port 4319 --strictPort` → `render-check.mjs [url] [--click "<label>"]`); `--click` is exact-match. `app/` stays out of the published package.

## File Structure

```
shared/
  graph-layout.ts            # MODIFY: LaidOutNode += attrs/typeOf; add edgeGeometry()
  tests/graph-layout.test.ts # MODIFY: attrs/typeOf carried; edgeGeometry angles/midpoint
app/
  src/components/example-runner/
    graph-view.ts            # REWRITE: arrowheads, edge labels, SelectableNodeBorder, GraphCanvas, buildGraphView
    example-runner-vm.ts     # MODIFY: SelectedNodeText DP; ZoomIn/ZoomOut/Fit commands; keep controller ref
    example-runner.mu        # MODIFY: Graph pane = zoom buttons + graph + inspector strip
  README.md                  # MODIFY: document graph depth
docs/superpowers/specs/2026-09-01-todl-demos-app-design.md  # MODIFY: note Phase 5
```

## Interfaces produced

- `shared/graph-layout.ts`:
  ```ts
  interface LaidOutNode { id; x; y; w; h; label; sub; typeOf: string; attrs: Record<string, Scalar> }  // + typeOf, attrs
  interface EdgeGeometry { x1; y1; x2; y2; midX; midY; angleDeg: number }
  function edgeGeometry(from: LaidOutNode, to: LaidOutNode): EdgeGeometry
  ```
- `app/.../graph-view.ts`:
  ```ts
  interface GraphController { view: Visual; zoomIn(): void; zoomOut(): void; fit(): void }
  function buildGraphView(layout: GraphLayout, onSelect: (n: LaidOutNode) => void): GraphController
  ```

---

## Task 1: `shared/graph-layout.ts` — enrich nodes + `edgeGeometry` (pure)

**Files:** Modify `shared/graph-layout.ts`; Modify `shared/tests/graph-layout.test.ts`.

**Interfaces:** Consumes `Scalar` from `@pragmatic-tech-ai/todl`. Produces enriched `LaidOutNode` + `edgeGeometry`.

- [ ] **Step 1: Extend the tests** (append to `graph-layout.test.ts`):

```ts
import { layoutGraph, nodeLabel, edgeGeometry } from "../graph-layout.js";

test("laid-out nodes carry attrs and typeOf from the source", () => {
  const doc = { nodes: [{ id: 1, tier: "instance", typeOf: 10, attrs: { name: "a", n: 2 } }], edges: [] };
  const g = layoutGraph(doc);
  assert.equal(g.nodes[0].typeOf, "10");
  assert.equal(g.nodes[0].attrs.name, "a");
  assert.equal(g.nodes[0].attrs.n, 2);
});

test("edgeGeometry gives center-to-center endpoints, midpoint, and angle", () => {
  const from = { id: "1", x: 0, y: 0, w: 100, h: 40, label: "", sub: "", typeOf: "", attrs: {} };
  const to   = { id: "2", x: 200, y: 0, w: 100, h: 40, label: "", sub: "", typeOf: "", attrs: {} };
  const e = edgeGeometry(from, to);
  assert.equal(e.x1, 50); assert.equal(e.y1, 20);
  assert.equal(e.x2, 250); assert.equal(e.y2, 20);
  assert.equal(e.midX, 150); assert.equal(e.midY, 20);
  assert.equal(Math.round(e.angleDeg), 0);           // straight right → 0°
});

test("edgeGeometry angle is 90° for a downward edge", () => {
  const from = { id: "1", x: 0, y: 0, w: 40, h: 40, label: "", sub: "", typeOf: "", attrs: {} };
  const to   = { id: "2", x: 0, y: 200, w: 40, h: 40, label: "", sub: "", typeOf: "", attrs: {} };
  assert.equal(Math.round(edgeGeometry(from, to).angleDeg), 90);
});
```

- [ ] **Step 2: Run → FAIL** (`edgeGeometry` missing / `typeOf`,`attrs` absent).

- [ ] **Step 3: Implement.** In `graph-layout.ts`:
  - Import the scalar type: `import type { TodlDocument, JsonNode, Scalar } from "@pragmatic-tech-ai/todl";`
  - Extend the interface: `export interface LaidOutNode { id: string; x: number; y: number; w: number; h: number; label: string; sub: string; typeOf: string; attrs: Record<string, Scalar> }`
  - In `layoutGraph`, when building `labelOf`, also capture `typeOf`/`attrs`; set them on each pushed node:
    ```ts
    const metaOf = new Map(doc.nodes.map((n) => [String(n.id), { label: nodeLabel(n), sub: n.tier ?? "", typeOf: String(n.typeOf), attrs: n.attrs ?? {} }]));
    // …in the push: { id, label: m.label, sub: m.sub, typeOf: m.typeOf, attrs: m.attrs, w, h, x, y }
    ```
  - Append the helper:
    ```ts
    export interface EdgeGeometry { x1: number; y1: number; x2: number; y2: number; midX: number; midY: number; angleDeg: number }
    export function edgeGeometry(from: LaidOutNode, to: LaidOutNode): EdgeGeometry {
      const x1 = from.x + from.w / 2, y1 = from.y + from.h / 2;
      const x2 = to.x + to.w / 2, y2 = to.y + to.h / 2;
      return { x1, y1, x2, y2, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2, angleDeg: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI };
    }
    ```

- [ ] **Step 4: Run → PASS** (all graph-layout tests, old + new).

- [ ] **Step 5: Commit** `feat(demos): enrich graph layout with node attrs + edge geometry`.

---

## Task 2: Arrowheads + edge labels in `graph-view.ts`

Keep `buildGraphCanvas(layout)` returning a `Canvas` for now (selection/zoom come next). Draw, per edge: the line, a rotated arrowhead `Path` at the target, and the `kind` label at the midpoint.

**Files:** Modify `app/src/components/example-runner/graph-view.ts`.

- [ ] **Step 1: Add imports + arrowhead constant.**

```ts
import { Canvas, Border, TextBlock, Line, StackPanel, Path } from "@pragmatic-tech-ai/mural/basic";
import { Pen, SolidColorBrush, Color, Thickness, RotateTransform } from "@pragmatic-tech-ai/mural/visual-engine";
import { type GraphLayout, edgeGeometry } from "../../../../shared/graph-layout.js";

const ARROW = "M 0 0 L -9 -4 L -9 4 Z";                 // tip at origin, body toward −X
const ARROW_FILL = new SolidColorBrush(new Color(120, 130, 145, 255));
const LABEL_FILL = new SolidColorBrush(new Color(90, 100, 115, 255));
const ARROW_INSET = 14;                                 // keep the tip off the target box
```

- [ ] **Step 2: Rewrite the edge loop** in `buildGraphCanvas`:

```ts
for (const e of layout.edges) {
  const a = pos.get(e.from), b = pos.get(e.to);
  if (!a || !b) continue;
  const g = edgeGeometry(a, b);
  const line = new Line();
  line.X1 = 0; line.Y1 = 0; line.X2 = g.x2 - g.x1; line.Y2 = g.y2 - g.y1;
  line.Stroke = EDGE_PEN;
  Canvas.SetLeft(line, g.x1); Canvas.SetTop(line, g.y1);
  canvas.AddChild(line);

  // Arrowhead: inset from the target center along the edge, rotated to the edge angle.
  const rad = g.angleDeg * Math.PI / 180;
  const tipX = g.x2 - Math.cos(rad) * ARROW_INSET, tipY = g.y2 - Math.sin(rad) * ARROW_INSET;
  const head = new Path();
  head.Data = ARROW; head.Fill = ARROW_FILL;
  head.RenderTransform = new RotateTransform(g.angleDeg);
  Canvas.SetLeft(head, tipX); Canvas.SetTop(head, tipY);
  canvas.AddChild(head);

  // Edge-kind label at the midpoint.
  if (e.label) {
    const lbl = new TextBlock();
    lbl.Text = e.label; lbl.FontSize = 10; lbl.Foreground = LABEL_FILL;
    Canvas.SetLeft(lbl, g.midX + 3); Canvas.SetTop(lbl, g.midY - 14);
    canvas.AddChild(lbl);
  }
}
```
> The arrowhead `RenderTransform` rotates about the Path's local origin (the tip at `M 0 0`), so no `RenderTransformOrigin` is needed. Label offset (`+3,−14`) keeps it off the line; tune in Step 4.

- [ ] **Step 3: Build.** `cd app && npx vite build` → succeeds.

- [ ] **Step 4: Verify render.** Preview; `render-check.mjs --click "Graph"`; assert (a) `#app svg path` count ≥ number of in-view edges (arrowheads present), (b) an edge-kind label string appears in SVG `<text>` (e.g. `HasField` for the default example). Screenshot-confirm arrows point at targets and labels sit near midpoints. Adjust `ARROW_INSET`/label offsets if overlapping.

- [ ] **Step 5: Commit** `feat(demos): arrowheads + edge-kind labels on the graph`.

---

## Task 3: Click-node inspector

Add node selection: a `SelectableNodeBorder` that calls back on click; `ExampleRunnerVM` formats the selected node into `SelectedNodeText`; the Graph tab shows an inspector strip.

**Files:** Modify `graph-view.ts`, `example-runner-vm.ts`, `example-runner.mu`.

- [ ] **Step 1: `SelectableNodeBorder` + `onSelect` param.** In `graph-view.ts`:

```ts
import { PointerEventArgs, PointerButton } from "@pragmatic-tech-ai/mural/visual-engine";
import type { LaidOutNode } from "../../../../shared/graph-layout.js";

const SELECTED_STROKE = new Pen(new SolidColorBrush(new Color(40, 90, 200, 255)), 2);

class SelectableNodeBorder extends Border {
  node!: LaidOutNode;
  onPick?: (n: LaidOutNode) => void;
  protected override OnPointerDown(args: PointerEventArgs): void {
    if (args.Button === PointerButton.Primary) { this.onPick?.(this.node); args.Handled = true; }
  }
}
```
Change the node loop to build `SelectableNodeBorder` (instead of `Border`), set `box.node = n; box.onPick = onSelect;`. Change the exported function signature to `buildGraphCanvas(layout: GraphLayout, onSelect: (n: LaidOutNode) => void)`. (Task 4 renames it to `buildGraphView`; keep `buildGraphCanvas` here and update the VM call site.)

- [ ] **Step 2: VM wiring.** In `example-runner-vm.ts`:
  - Register `SelectedNodeTextKey: string` (default `"Click a node to inspect it."`) + getter.
  - In `compile()`, pass an `onSelect` to the graph builder that formats the node:
    ```ts
    const onSelect = (n: LaidOutNode) => this.set_property_value(ExampleRunnerVM.SelectedNodeTextKey,
      [`${n.id} · ${n.sub} · typeOf ${n.typeOf}`, ...Object.entries(n.attrs).map(([k, v]) => `${k} = ${JSON.stringify(v)}`)].join("\n"));
    this.set_property_value(ExampleRunnerVM.GraphKey, buildGraphCanvas(layoutGraph(s.document), onSelect));
    ```
    (Import `LaidOutNode` type.)

- [ ] **Step 3: Inspector strip.** In `example-runner.mu`, change the Graph pane to a `DockPanel` with a bottom inspector:

```
DockPanel [ Visibility = $GraphVisibility ] {
    Border [ DockPanel.Dock = Bottom, Fill = @SurfaceVariant, Margin = (0,6,0,0) ] {
        TextBlock [ Margin = (6,4,6,4), FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 11, TextWrapping = NoWrap, Text = $SelectedNodeText ]
    }
    ScrollViewer { ContentControl [ Content = $Graph ] }
}
```
> Replaces the `ScrollViewer [ Visibility = $GraphVisibility ] { ContentControl … }` pane. The pane still lives in the overlay `Grid` from Phase 4.

- [ ] **Step 4: Verify.** Build; preview; via a script: click "Graph", then click a node label (e.g. `label`) with force, and assert `SelectedNodeText` content (an attr like `name = "label"` or the `id ·` header) appears in SVG `<text>`. No `errors`.

- [ ] **Step 5: Commit** `feat(demos): click-to-select node inspector on the graph`.

---

## Task 4: Pan/zoom (`GraphCanvas` + controller + buttons)

Wrap the content canvas in a `ScrollViewer`; add Ctrl+wheel zoom + drag-pan on a `GraphCanvas` subclass; expose `zoomIn/zoomOut/fit`; add zoom buttons.

**Files:** Modify `graph-view.ts`, `example-runner-vm.ts`, `example-runner.mu`.

- [ ] **Step 1: `GraphCanvas` + `buildGraphView`.** In `graph-view.ts`:

```ts
import { WheelEventArgs, ModifierKeys, hasModifier, ScaleTransform } from "@pragmatic-tech-ai/mural/visual-engine";
import { ScrollViewer } from "@pragmatic-tech-ai/mural/framework";

const MIN_Z = 0.3, MAX_Z = 3;

class GraphCanvas extends Canvas {
  host?: ScrollViewer;
  private z = 1;
  private panning = false;
  private lastX = 0; private lastY = 0;

  applyZoom(factor: number): void {
    this.z = Math.min(MAX_Z, Math.max(MIN_Z, this.z * factor));
    this.LayoutTransform = new ScaleTransform(this.z, this.z);
  }
  reset(): void { this.z = 1; this.LayoutTransform = new ScaleTransform(1, 1); }

  protected override OnPreviewPointerWheel(args: WheelEventArgs): void {
    if (!hasModifier(args.Modifiers, ModifierKeys.Control)) return; // let the ScrollViewer scroll
    this.applyZoom(args.DeltaY < 0 ? 1.1 : 1 / 1.1);
    args.Handled = true;
  }
  protected override OnPointerDown(args: PointerEventArgs): void {
    // Background drag only — a node consumes its own OnPointerDown (Handled) first.
    if (args.Button === PointerButton.Primary) { this.panning = true; this.lastX = args.HostX; this.lastY = args.HostY; args.Handled = true; }
  }
  protected override OnPointerMove(args: PointerEventArgs): void {
    if (!this.panning || !this.host) return;
    this.host.HorizontalOffset -= args.HostX - this.lastX;
    this.host.VerticalOffset   -= args.HostY - this.lastY;
    this.lastX = args.HostX; this.lastY = args.HostY;
  }
  protected override OnPointerUp(_args: PointerEventArgs): void { this.panning = false; }
}

export interface GraphController { view: ScrollViewer; zoomIn(): void; zoomOut(): void; fit(): void }

export function buildGraphView(layout: GraphLayout, onSelect: (n: LaidOutNode) => void): GraphController {
  const canvas = new GraphCanvas();
  populateGraph(canvas, layout, onSelect);          // the node/edge/arrow/label loops, extracted from buildGraphCanvas
  const view = new ScrollViewer();
  view.Content = canvas;
  canvas.host = view;
  return { view, zoomIn: () => canvas.applyZoom(1.2), zoomOut: () => canvas.applyZoom(1 / 1.2), fit: () => canvas.reset() };
}
```
> Extract the current node/edge/arrow/label building from `buildGraphCanvas` into `populateGraph(canvas, layout, onSelect)` (takes any `Canvas`), and have both `buildGraphCanvas` (kept, for any direct use/tests) and `buildGraphView` call it. Node boxes use `SelectableNodeBorder` from Task 3.

- [ ] **Step 2: VM — controller ref + zoom commands.** In `example-runner-vm.ts`:
  - Register `ZoomInKey`/`ZoomOutKey`/`FitKey: ICommand` + getters; keep a `private graph?: GraphController`.
  - In `compile()`, build via `buildGraphView`: `const gc = buildGraphView(layoutGraph(s.document), onSelect); this.graph = gc; this.set_property_value(ExampleRunnerVM.GraphKey, gc.view);`
  - Wire commands in the constructor: `new RelayCommand(() => this.graph?.zoomIn())`, etc.
  - `Graph` DP type becomes `ScrollViewer | undefined` (still a `Visual`; ContentControl hosts it).

- [ ] **Step 3: Zoom buttons.** In `example-runner.mu`, add a top strip to the Graph `DockPanel`:

```
StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,6) ] {
    Button [ Command = $ZoomOut, Margin = (0,0,4,0) ] { TextBlock [ Text = "−" ] }
    Button [ Command = $ZoomIn,  Margin = (0,0,4,0) ] { TextBlock [ Text = "+" ] }
    Button [ Command = $Fit ]                         { TextBlock [ Text = "Fit" ] }
}
```
(Keep the bottom inspector strip and the `ScrollViewer { ContentControl [ Content = $Graph ] }` — wait: `$Graph` now IS a ScrollViewer, so drop the wrapping `ScrollViewer` and use `ContentControl [ Content = $Graph ]` directly as the fill child.)

- [ ] **Step 4: Verify.** Build; preview; on the Graph tab: (a) assert `+`/`−`/`Fit` render; (b) click a node, capture a node label's bounding-box width; click `+`; assert the width grew (zoom applied); (c) smoke Ctrl+wheel (`page.mouse.wheel` with Ctrl) and a background drag (`mouse.down/move/up`) → no `pageerror`. (Selection + arrowheads + labels from Tasks 2–3 still render.)

- [ ] **Step 5: Commit** `feat(demos): pan + zoom (buttons, Ctrl+wheel, drag) on the graph`.

---

## Task 5: Docs, spec status & full green pass

**Files:** Modify `app/README.md`, `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md`.

- [ ] **Step 1: `app/README.md`** — note the graph tab now has arrowheads + edge labels, a click-node inspector, and pan/zoom (buttons / Ctrl+wheel / drag).
- [ ] **Step 2: Parent spec** — append a Phase 5 line under "Phasing" marked DONE with the three features.
- [ ] **Step 3: Full green** — `npm run test:corpus`, `npm test`, `npm run app:build` all clean.
- [ ] **Step 4: Commit** `docs(demos): document graph depth; note Phase 5`.

---

## Self-Review

**Spec coverage:** arrowheads+labels → Task 2; inspector → Task 3; pan/zoom (buttons+wheel+drag) → Task 4; pure enrichment/geometry → Task 1. ✓
**Placeholder scan:** every code step is concrete; the one extraction (`populateGraph`) is spelled out. No TBD.
**Type consistency:** `LaidOutNode` (+attrs/typeOf), `EdgeGeometry`/`edgeGeometry` (Task 1) consumed by Task 2/3/4; `GraphController`/`buildGraphView` (Task 4) consumed by the VM; `SelectableNodeBorder`/`onSelect` (Task 3) reused by `populateGraph` (Task 4). `Graph` DP widens `Canvas → ScrollViewer` (both `Visual`; ContentControl hosts a `Visual` as-is — Phase-3 verified).

**Open risks (verify during execution):**
1. **`OnPointerMove` fires only while a pointer is captured?** If drag-pan drops moves outside the canvas, capture may be needed; if Mural auto-captures on down, no action. Verify in Task 4 Step 4; if janky, gate pan on `panning` (already) and accept minor slip — buttons are the primary zoom path.
2. **`args.HostX/HostY`** are host-space; offsets are content-space. For a first cut, 1:1 delta is fine at zoom 1; at high zoom the pan speed differs — acceptable for a demo, note it.
3. **Node click vs pan** — the node's `Handled` must stop the canvas `OnPointerDown`; confirm a node click selects WITHOUT starting a pan (Task 3/4 verify).
4. **Arrowhead rotation origin** — `RotateTransform` about the Path's `M 0 0` tip; if it rotates about a box corner instead, set `head.RenderTransformOrigin = new Point(0,0)` (flagged).
