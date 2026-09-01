import { Canvas, Border, TextBlock, Line, StackPanel, Path } from "@pragmatic-tech-ai/mural/basic";
import { Pen, SolidColorBrush, Color, Thickness, RotateTransform, PointerEventArgs, PointerButton, WheelEventArgs, ModifierKeys, hasModifier, ScaleTransform } from "@pragmatic-tech-ai/mural/visual-engine";
import { ScrollViewer } from "@pragmatic-tech-ai/mural/framework";
import { type GraphLayout, type LaidOutNode, edgeGeometry } from "../../../../shared/graph-layout.js";

const NODE_FILL = new SolidColorBrush(new Color(238, 242, 248, 255));
const NODE_STROKE = new Pen(new SolidColorBrush(new Color(90, 110, 140, 255)), 1);
const SELECTED_STROKE = new Pen(new SolidColorBrush(new Color(40, 90, 200, 255)), 2);
const EDGE_PEN = new Pen(new SolidColorBrush(new Color(120, 130, 145, 255)), 1.5);
const ARROW = "M 0 0 L -9 -4 L -9 4 Z";                 // tip at origin, body toward -X
const ARROW_FILL = new SolidColorBrush(new Color(120, 130, 145, 255));
const LABEL_FILL = new SolidColorBrush(new Color(90, 100, 115, 255));
const ARROW_INSET = 14;                                 // keep the tip off the target box
const MIN_Z = 0.3, MAX_Z = 3;

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
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));

  // Edges first (drawn under the node boxes): line + arrowhead at the target + a
  // midpoint kind-label.
  for (const e of layout.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const g = edgeGeometry(a, b);
    const line = new Line();
    line.X1 = 0; line.Y1 = 0; line.X2 = g.x2 - g.x1; line.Y2 = g.y2 - g.y1;
    line.Stroke = EDGE_PEN;
    Canvas.SetLeft(line, g.x1);
    Canvas.SetTop(line, g.y1);
    canvas.AddChild(line);

    const rad = g.angleDeg * Math.PI / 180;
    const tipX = g.x2 - Math.cos(rad) * ARROW_INSET, tipY = g.y2 - Math.sin(rad) * ARROW_INSET;
    const head = new Path();
    head.Data = ARROW; head.Fill = ARROW_FILL;
    head.RenderTransform = new RotateTransform(g.angleDeg);
    Canvas.SetLeft(head, tipX);
    Canvas.SetTop(head, tipY);
    canvas.AddChild(head);

    if (e.label) {
      const lbl = new TextBlock();
      lbl.Text = e.label; lbl.FontSize = 10; lbl.Foreground = LABEL_FILL;
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
    box.Fill = NODE_FILL; box.Stroke = NODE_STROKE;
    box.onPick = (node, b) => {
      if (selected) selected.Stroke = NODE_STROKE;   // clear the previous highlight
      b.Stroke = SELECTED_STROKE; selected = b;
      onSelect(node);
    };
    const stack = new StackPanel();
    stack.Margin = new Thickness(8, 6, 8, 6);
    const label = new TextBlock();
    label.Text = n.label; label.FontSize = 13;
    stack.AddChild(label);
    if (n.sub) { const sub = new TextBlock(); sub.Text = n.sub; sub.FontSize = 10; stack.AddChild(sub); }
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
