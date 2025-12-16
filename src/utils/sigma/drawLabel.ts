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

  context.font = `${weight} ${size}px ${font}`;
  // const width = context.measureText(label).width;

  context.fillStyle = settings.labelColor.color || "#000000"; // Handle undefined color to verify renderer usage

  // Draw label below the node
  context.textAlign = "center";
  context.textBaseline = "top";
  
  const x = data.x;
  const y = data.y + data.size + 3; // 3px padding below the node circle

  context.fillText(label, x, y);
}
