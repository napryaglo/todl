import { Canvas, Border, TextBlock, Line, StackPanel, Path } from "@pragmatic-tech-ai/mural/basic";
import { Pen, SolidColorBrush, Color, Thickness, RotateTransform, PointerEventArgs, PointerButton, WheelEventArgs, ModifierKeys, hasModifier, ScaleTransform } from "@pragmatic-tech-ai/mural/visual-engine";
import { ScrollViewer } from "@pragmatic-tech-ai/mural/framework";
import { Application } from "@pragmatic-tech-ai/mural/runtime";
import { type GraphLayout, type LaidOutNode, edgeGeometry } from "../../../../shared/graph-layout.js";

const ARROW = "M 0 0 L -9 -4 L -9 4 Z";                 // tip at origin, body toward -X
const ARROW_INSET = 14;                                 // keep the tip off the target box
const MIN_Z = 0.3, MAX_Z = 3;

/** Resolve an active-scheme brush by its `@token` name (e.g. "OnSurface"),
 *  falling back to the MaterialDark value so the graph stays theme-dark even if
 *  a lookup misses. */
function themeBrush(key: string, r: number, g: number, b: number): SolidColorBrush {
  const found = Application.ResolveDefaultResource(key);
  return found instanceof SolidColorBrush ? found : new SolidColorBrush(new Color(r, g, b, 255));
}

/** The theme brushes/pens the graph paints with, read from the active scheme.
 *  Built per-render (not as module constants) because those would evaluate
 *  before the theme is activated in main.ts. Fallbacks are the MaterialDark
 *  token values. */
interface GraphPalette {
  nodeFill: SolidColorBrush; nodeStroke: Pen; selectedStroke: Pen;
  edgePen: Pen; arrowFill: SolidColorBrush; labelFill: SolidColorBrush;
  textFill: SolidColorBrush; subFill: SolidColorBrush;
}
function graphPalette(): GraphPalette {
  const outline = themeBrush("Outline", 147, 143, 153);
  const onSurfaceVariant = themeBrush("OnSurfaceVariant", 202, 196, 208);
  return {
    nodeFill: themeBrush("SurfaceContainerHigh", 43, 41, 48),   // elevated card vs the darker canvas
    nodeStroke: new Pen(themeBrush("OutlineVariant", 73, 69, 79), 1),
    selectedStroke: new Pen(themeBrush("Primary", 208, 188, 255), 2),
    edgePen: new Pen(outline, 1.5),
    arrowFill: outline,
    labelFill: onSurfaceVariant,
    textFill: themeBrush("OnSurface", 230, 225, 229),
    subFill: onSurfaceVariant,
  };
}

/** A node box that reports primary-button clicks. Subclassing + overriding the
 *  pointer virtual is the only way to handle input on an imperative visual. */
class SelectableNodeBorder extends Border {
  node!: LaidOutNode;
  onPick?: (n: LaidOutNode, box: SelectableNodeBorder) => void;
  protected override OnPointerDown(args: PointerEventArgs): void {
    if (args.Button === PointerButton.Primary) { this.onPick?.(this.node, this); args.Handled = true; }
  }
}

/** The content canvas with Ctrl+wheel zoom and background drag-pan. A node's
 *  OnPointerDown sets Handled, so background-pan never fires on a node. */
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
    if (!hasModifier(args.Modifiers, ModifierKeys.Control)) return;   // let the ScrollViewer scroll
    this.applyZoom(args.DeltaY < 0 ? 1.1 : 1 / 1.1);
    args.Handled = true;
  }
  protected override OnPointerDown(args: PointerEventArgs): void {
    if (args.Button === PointerButton.Primary) { this.panning = true; this.lastX = args.HostX; this.lastY = args.HostY; args.Handled = true; }
  }
  protected override OnPointerMove(args: PointerEventArgs): void {
    if (!this.panning || !this.host) return;
    this.host.HorizontalOffset -= args.HostX - this.lastX;
    this.host.VerticalOffset -= args.HostY - this.lastY;
    this.lastX = args.HostX; this.lastY = args.HostY;
  }
  protected override OnPointerUp(_args: PointerEventArgs): void { this.panning = false; }
}

/** Populate a Canvas with edges (line + arrowhead + kind-label) and selectable
 *  node boxes. Imperative because attached-property bindings don't flow through
 *  item containers. `onSelect` fires when a node is clicked. */
function populateGraph(canvas: Canvas, layout: GraphLayout, onSelect: (n: LaidOutNode) => void): void {
  canvas.Width = Math.max(layout.width, 1);
  canvas.Height = Math.max(layout.height, 1);
  const pal = graphPalette();
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));

  // Edges first (drawn under the node boxes): line + arrowhead at the target + a
  // midpoint kind-label.
  for (const e of layout.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const g = edgeGeometry(a, b);
    const line = new Line();
    line.X1 = 0; line.Y1 = 0; line.X2 = g.x2 - g.x1; line.Y2 = g.y2 - g.y1;
    line.Stroke = pal.edgePen;
    Canvas.SetLeft(line, g.x1);
    Canvas.SetTop(line, g.y1);
    canvas.AddChild(line);

    const rad = g.angleDeg * Math.PI / 180;
    const tipX = g.x2 - Math.cos(rad) * ARROW_INSET, tipY = g.y2 - Math.sin(rad) * ARROW_INSET;
    const head = new Path();
    head.Data = ARROW; head.Fill = pal.arrowFill;
    head.RenderTransform = new RotateTransform(g.angleDeg);
    Canvas.SetLeft(head, tipX);
    Canvas.SetTop(head, tipY);
    canvas.AddChild(head);

    if (e.label) {
      const lbl = new TextBlock();
      lbl.Text = e.label; lbl.FontSize = 10; lbl.Foreground = pal.labelFill;
      Canvas.SetLeft(lbl, g.midX + 3);
      Canvas.SetTop(lbl, g.midY - 14);
      canvas.AddChild(lbl);
    }
  }

  let selected: SelectableNodeBorder | undefined;
  for (const n of layout.nodes) {
    const box = new SelectableNodeBorder();
    box.node = n;
    box.Width = n.w; box.Height = n.h;
    box.Fill = pal.nodeFill; box.Stroke = pal.nodeStroke;
    box.onPick = (node, b) => {
      if (selected) selected.Stroke = pal.nodeStroke;   // clear the previous highlight
      b.Stroke = pal.selectedStroke; selected = b;
      onSelect(node);
    };
    const stack = new StackPanel();
    stack.Margin = new Thickness(8, 6, 8, 6);
    const label = new TextBlock();
    label.Text = n.label; label.FontSize = 13; label.Foreground = pal.textFill;
    stack.AddChild(label);
    if (n.sub) { const sub = new TextBlock(); sub.Text = n.sub; sub.FontSize = 10; sub.Foreground = pal.subFill; stack.AddChild(sub); }
    box.SetChild(stack);
    Canvas.SetLeft(box, n.x);
    Canvas.SetTop(box, n.y);
    canvas.AddChild(box);
  }
}

/** A plain (non-interactive) Canvas of the graph — used where no pan/zoom host
 *  is available. */
export function buildGraphCanvas(layout: GraphLayout, onSelect: (n: LaidOutNode) => void): Canvas {
  const canvas = new Canvas();
  populateGraph(canvas, layout, onSelect);
  return canvas;
}

export interface GraphController { view: ScrollViewer; zoomIn(): void; zoomOut(): void; fit(): void }

/** The interactive graph: a GraphCanvas (Ctrl+wheel zoom, drag-pan) inside a
 *  ScrollViewer, plus zoom handles for the toolbar buttons. */
export function buildGraphView(layout: GraphLayout, onSelect: (n: LaidOutNode) => void): GraphController {
  const canvas = new GraphCanvas();
  populateGraph(canvas, layout, onSelect);
  const view = new ScrollViewer();
  view.Content = canvas;
  canvas.host = view;
  return { view, zoomIn: () => canvas.applyZoom(1.2), zoomOut: () => canvas.applyZoom(1 / 1.2), fit: () => canvas.reset() };
}
