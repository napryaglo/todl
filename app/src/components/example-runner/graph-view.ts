import { Canvas, Border, TextBlock, Line, StackPanel, Path } from "@pragmatic-tech-ai/mural/basic";
import { Pen, SolidColorBrush, Color, Thickness, RotateTransform } from "@pragmatic-tech-ai/mural/visual-engine";
import { type GraphLayout, edgeGeometry } from "../../../../shared/graph-layout.js";

const NODE_FILL = new SolidColorBrush(new Color(238, 242, 248, 255));
const NODE_STROKE = new Pen(new SolidColorBrush(new Color(90, 110, 140, 255)), 1);
const EDGE_PEN = new Pen(new SolidColorBrush(new Color(120, 130, 145, 255)), 1.5);
const ARROW = "M 0 0 L -9 -4 L -9 4 Z";                 // tip at origin, body toward -X
const ARROW_FILL = new SolidColorBrush(new Color(120, 130, 145, 255));
const LABEL_FILL = new SolidColorBrush(new Color(90, 100, 115, 255));
const ARROW_INSET = 14;                                 // keep the tip off the target box

/** Build a Canvas of Border nodes + Line edges from a pure layout. Imperative
 *  by necessity: attached-property bindings do not flow through item containers,
 *  so we position each child with Canvas.SetLeft/Top directly. */
export function buildGraphCanvas(layout: GraphLayout): Canvas {
  const canvas = new Canvas();
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
