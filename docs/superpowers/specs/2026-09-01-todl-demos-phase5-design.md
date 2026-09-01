# TODL Demos — Phase 5 Design: Graph view depth

**Date:** 2026-09-01
**Status:** Approved design, ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-09-01-todl-demos-app-design.md` (Phase-5 extension; Phases 1–4 DONE and pushed)
**Scope:** Enrich the Phase-3 typed-graph view with directionality, labels, node inspection, and navigation — arrowheads + edge-kind labels, a click-to-select node inspector, and pan/zoom (zoom buttons + Ctrl+wheel + drag-pan).

## Goal

The Phase-3 graph is a static `Canvas` of `Border` nodes + straight `Line` edges. Phase 5 makes it legible and navigable:

1. **Arrowheads + edge labels** — each edge shows a rotated arrowhead at its target and its `kind` (e.g. `HasField`, `calls`) at the midpoint, so direction and relationship type are explicit.
2. **Click-node inspector** — clicking a node selects it and shows its full data (id · tier · typeOf · attrs) in an inspector strip.
3. **Pan/zoom** — `+`/`−`/`Fit` buttons scale the canvas; Ctrl+wheel zooms at the cursor; drag pans.

## Feasibility (verified against Mural src)

All imperative, exported symbols, no `.mu`:
- **Pointer/click:** subclass `Border`, override `protected OnPointerDown(args: PointerEventArgs)`; `args.Button === PointerButton.Primary`, set `args.Handled = true`. (`ClickableBorder` is the precedent; `PointerEventArgs`/`PointerButton` from `/visual-engine`.) Routed events dispatch to imperatively-built visuals automatically (leaf bubbles first, so a node consumes the click before the canvas's pan handler).
- **Zoom:** `canvas.LayoutTransform = new ScaleTransform(z, z)` (`/visual-engine`); a scaled `LayoutTransform` grows the host `ScrollViewer`'s extent, so scrollbars/pan follow.
- **Wheel:** override `protected OnPreviewPointerWheel(args: WheelEventArgs)` (tunnel phase); `hasModifier(args.Modifiers, ModifierKeys.Control)`, use `args.DeltaY`, set `args.Handled = true` to pre-empt the ScrollViewer's scroll.
- **Pan:** `ScrollViewer.HorizontalOffset`/`VerticalOffset` are read/write; drag adjusts them.
- **Arrowhead:** `Path` (`/basic`) with SVG `Data` (`"M 0 0 L -8 -4 L -8 4 Z"`), `RenderTransform = new RotateTransform(angleDeg)` (`/visual-engine`), positioned at the target via `Canvas.SetLeft/Top`.
- **Edge label:** a `TextBlock` at the edge midpoint via `Canvas.SetLeft/Top`.

## Boundaries (unchanged discipline)

Pure geometry + data in `shared/` (node-tested); all Mural/interaction code in `app/`. No new dependencies.

| Concern | Pure (`shared/graph-layout.ts`) | App (`app/.../graph-view.ts`, VM, `.mu`) |
|---|---|---|
| Node data for inspector | `LaidOutNode` gains `attrs` + `typeOf` | inspector strip shows them |
| Edge geometry | `edgeGeometry(from, to)` → endpoints + midpoint + angle | line, arrowhead, label placement |
| Interaction | — | `SelectableNodeBorder`, `GraphCanvas` (wheel/drag), zoom controls |

## Feature 1 — Arrowheads + edge labels

- Extend `shared/graph-layout.ts` with a pure helper:
  ```ts
  export interface EdgeGeometry { x1: number; y1: number; x2: number; y2: number; midX: number; midY: number; angleDeg: number }
  export function edgeGeometry(from: LaidOutNode, to: LaidOutNode): EdgeGeometry
  ```
  Center-to-center; `angleDeg = atan2(y2-y1, x2-x1) * 180/π`. Unit-tested (horizontal edge → 0°, downward → 90°, midpoint correct).
- `graph-view.ts` per edge: draw the `Line` (as today), an arrowhead `Path` at `(x2,y2)` rotated `angleDeg` (tip at origin, body toward −X so it points along the edge), and a `TextBlock` (the edge `kind`) centered at `(midX,midY)`. Arrowhead inset a few px from the node so it isn't hidden under the box.

## Feature 2 — Click-node inspector

- Enrich `LaidOutNode` (pure) with `attrs: Record<string, Scalar>` and `typeOf: string`, copied from the source `JsonNode` in `layoutGraph`. (Deterministic; additive — existing layout tests still hold.)
- `graph-view.ts`: `class SelectableNodeBorder extends Border` overrides `OnPointerDown` → invokes an `onSelect(node: LaidOutNode)` callback and marks `args.Handled`. `buildGraphView` takes `onSelect`.
- Selection visibly marks the node (thicker/colored stroke) and surfaces its data. `ExampleRunnerVM` gains `SelectedNodeText: string`; the wire formats the selected node as:
  ```
  #n1 · Ontology · typeOf #r1
  name = "label"
  cardinality = 0
  type = "string"
  ```
- The Graph tab shows the graph + a bottom inspector strip bound to `$SelectedNodeText` (empty until a node is clicked → prompt "click a node").

## Feature 3 — Pan/zoom

- `graph-view.ts`: `buildGraphView(layout, onSelect)` returns a small controller: `{ view: Visual, zoomIn(), zoomOut(), fit() }`, where `view` is a `ScrollViewer` hosting a `GraphCanvas` (the content).
  - **Zoom state** lives on the controller; `zoomIn/Out` multiply the scale (`ScaleTransform` on the content canvas, clamped ~0.3–3×); `fit` resets to 1 (MVP; fit-to-pane if trivial).
  - **`GraphCanvas extends Canvas`** overrides `OnPreviewPointerWheel`: Ctrl+wheel adjusts scale toward the cursor; sets `Handled`. Non-Ctrl wheel falls through to the ScrollViewer (normal scroll).
  - **Drag-pan:** `GraphCanvas` tracks pointer down/move/up on empty background (a node's `Handled` pre-empts it) and adjusts the host `ScrollViewer`'s offsets. The canvas holds a back-ref to its ScrollViewer, set by `buildGraphView`.
- `ExampleRunnerVM`: the `Graph` DP holds the controller's `view`; the VM keeps the controller to route `ZoomIn`/`ZoomOut`/`Fit` commands (rebuilt each compile — zoom resets on recompile, acceptable). Zoom buttons sit in the Graph tab header.

## App wiring — the Graph tab

Replace the Graph pane (`ScrollViewer { ContentControl [ Content = $Graph ] }`) with:
```
DockPanel [ Visibility = $GraphVisibility ] {
    StackPanel [ Dock = Top, Horizontal ] { Button "−" $ZoomOut · Button "+" $ZoomIn · Button "Fit" $Fit }
    Border     [ Dock = Bottom ] { TextBlock Text = $SelectedNodeText }   // inspector strip
    ContentControl [ Content = $Graph ]                                    // the GraphView (own ScrollViewer)
}
```
(`$Graph` now includes its own scrolling, so no outer ScrollViewer.)

## Testing

- **`shared/tests/graph-layout.test.ts`** (extend): `LaidOutNode` carries `attrs`/`typeOf` matching the source nodes; `edgeGeometry` — horizontal edge angle 0°, vertical 90°, midpoint = average, endpoints center-to-center; deterministic.
- **App** (committed harness, extended): arrowhead `Path` elements render (SVG `<path>` count grows with edges); an edge-kind label (`HasField`) appears; clicking a node populates the inspector (an attr string like `name = "label"` appears); a zoom `+` click enlarges a node's bounding box (assert bbox width grows); Ctrl+wheel and drag are smoke-checked (no `pageerror`).
- **Green gates:** `test:corpus`, `test`, `app:build`.

## Phasing within Phase 5

1. `shared/graph-layout.ts`: enrich `LaidOutNode` (attrs/typeOf) + `edgeGeometry` helper (pure, TDD).
2. Arrowheads + edge labels in `graph-view.ts` (verify render).
3. Click-node inspector: `SelectableNodeBorder` + `onSelect` + `SelectedNodeText` DP + inspector strip (verify click).
4. Pan/zoom: `GraphCanvas` (Ctrl+wheel + drag) + `buildGraphView` controller + zoom buttons (verify buttons scale; smoke wheel/drag).
5. Docs (`app/README.md`) + spec status + full green pass.

## Open risks / notes

- **Zoom resets on recompile** — a fresh graph is built each compile, so the scale returns to 1×. Acceptable (compiles are user-initiated edits); documented.
- **Drag-pan vs node-drag** — nodes are not draggable in this phase; a node click selects, canvas-background drag pans. A node consuming `OnPointerDown` (Handled) keeps background-pan from firing on nodes.
- **Ctrl+wheel headless verification** — asserting a transform via SVG is indirect; the zoom **buttons** carry the deterministic bbox-growth assertion, Ctrl+wheel/drag are smoke-only (no error).
- **Arrowhead under the node** — inset the arrowhead a few px from the target box edge so it stays visible; exact inset tuned during verification.
- **Fresco layout** — explicitly out of scope (YAGNI for small graphs); the longest-path layout stands.
