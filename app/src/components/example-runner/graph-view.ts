import { Canvas, Border, TextBlock, Line, StackPanel } from "@pragmatic-tech-ai/mural/basic";
import { Pen, SolidColorBrush, Color, Thickness } from "@pragmatic-tech-ai/mural/visual-engine";
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
  return canvas;
}
