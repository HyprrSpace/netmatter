// Categorical colours for nodes, validated (CVD + contrast) on the dark
// surface. Assigned by the node's position in the full, sorted node list so a
// node keeps its colour whatever is filtered. Past eight nodes colour stops
// carrying identity and the legend/tooltip names do the work.
const NODE_COLORS = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
];
const OVERFLOW = "#8a8a8a";

export function nodeColor(allNodes: string[], node: string): string {
  const i = allNodes.indexOf(node);
  return i >= 0 && i < NODE_COLORS.length ? NODE_COLORS[i] : OVERFLOW;
}
