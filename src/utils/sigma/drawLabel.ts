import type { Settings } from "sigma/settings";
import type { NodeDisplayData, PartialButFor } from "sigma/types";

export default function drawLabel(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, "x" | "y" | "size" | "label" | "color">,
  settings: Settings,
): void {
  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;
  const label = data.label || ""; // Handle null/undefined label
  const isNoteNode = (data as Record<string, unknown>).isNote === true;
  const noteMaxWidth =
    typeof (data as Record<string, unknown>).noteMaxWidth === "number"
      ? ((data as Record<string, unknown>).noteMaxWidth as number)
      : null;

  context.font = `${weight} ${size}px ${font}`;

  context.fillStyle = settings.labelColor.color || "#000000"; // Handle undefined color to verify renderer usage

  // Draw label below the node
  context.textAlign = "center";
  context.textBaseline = "top";
  
  const x = data.x;
  const y = data.y + data.size + 3; // 3px padding below the node circle

  // Note wrap rule: respect explicit "\n", then wrap per-character to fit max width.
  const wrapLines = (text: string, maxWidth: number): string[] => {
    const lines: string[] = [];
    const paragraphs = text.split("\n");
    paragraphs.forEach((paragraph, index) => {
      if (paragraph.length === 0) {
        lines.push("");
        return;
      }
      let current = "";
      for (const char of paragraph) {
        const next = current + char;
        if (context.measureText(next).width <= maxWidth || current.length === 0) {
          current = next;
          continue;
        }
        lines.push(current);
        current = char;
      }
      if (current.length > 0) lines.push(current);
      if (index < paragraphs.length - 1) lines.push("");
    });
    return lines;
  };

  if (isNoteNode && noteMaxWidth && noteMaxWidth > 0) {
    const lines = wrapLines(label, noteMaxWidth);
    const lineHeight = size + 4;
    lines.forEach((line, index) => {
      context.fillText(line, x, y + index * lineHeight);
    });
    return;
  }

  context.fillText(label, x, y);
}
