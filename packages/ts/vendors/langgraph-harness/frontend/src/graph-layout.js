/**
 * graph-layout.js — pure layered layout for the topology viewer (unit-tested
 * under node:test; no DOM). Longest-path layering from the entry, then
 * per-layer ordering; returns positioned nodes and routed edges for SVG.
 */

export const NODE_W = 168;
export const NODE_H = 44;
const GAP_X = 56;
const GAP_Y = 34;
const PAD = 24;

/**
 * @param {{entry: string, nodes: Array<{id: string}>, edges: Array<{from: string, to: string}>}} topology
 * @returns {{nodes: Array, edges: Array, width: number, height: number}}
 */
export function layoutTopology(topology) {
  const ids = topology.nodes.map((n) => n.id);
  const known = new Set([...ids, "START", "END"]);
  const adjacency = new Map([...known].map((id) => [id, []]));
  for (const edge of topology.edges) {
    if (known.has(edge.from) && known.has(edge.to)) adjacency.get(edge.from).push(edge.to);
  }

  // longest-path layering via BFS from START (cycles cut by visited-depth)
  const layerOf = new Map([["START", 0]]);
  const queue = [["START", 0]];
  let guard = 0;
  while (queue.length > 0 && guard++ < 10000) {
    const [current, depth] = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      const existing = layerOf.get(next);
      if (existing === undefined || (depth + 1 > existing && depth + 1 < known.size)) {
        if (existing === undefined) {
          layerOf.set(next, depth + 1);
          queue.push([next, depth + 1]);
        }
      }
    }
  }
  // anything unreached (data fixtures, orphans) goes to layer 1
  for (const id of known) if (!layerOf.has(id)) layerOf.set(id, 1);
  // END sinks to the last layer
  const maxLayer = Math.max(...[...layerOf.values()]);
  if (layerOf.has("END")) layerOf.set("END", maxLayer === layerOf.get("END") ? maxLayer : maxLayer);

  // group by layer, stable order: topology order, START/END pinned
  const layers = [];
  const orderIndex = new Map(["START", ...ids, "END"].map((id, i) => [id, i]));
  for (const id of known) {
    const layer = layerOf.get(id);
    (layers[layer] ??= []).push(id);
  }
  for (const layer of layers) if (layer) layer.sort((a, b) => orderIndex.get(a) - orderIndex.get(b));

  const positions = new Map();
  const laidOutLayers = layers.filter(Boolean);
  const maxRows = Math.max(...laidOutLayers.map((l) => l.length));
  laidOutLayers.forEach((layer, layerIdx) => {
    const layerHeight = layer.length * NODE_H + (layer.length - 1) * GAP_Y;
    const totalHeight = maxRows * NODE_H + (maxRows - 1) * GAP_Y;
    const yStart = PAD + (totalHeight - layerHeight) / 2;
    layer.forEach((id, rowIdx) => {
      positions.set(id, {
        x: PAD + layerIdx * (NODE_W + GAP_X),
        y: yStart + rowIdx * (NODE_H + GAP_Y),
      });
    });
  });

  const byId = new Map(topology.nodes.map((n) => [n.id, n]));
  const nodes = [...known]
    .filter((id) => positions.has(id))
    .map((id) => ({
      id,
      x: positions.get(id).x,
      y: positions.get(id).y,
      w: NODE_W,
      h: NODE_H,
      kind: id === "START" || id === "END" ? "terminal" : byId.get(id)?.synthetic ? "synthetic" : "node",
      category: byId.get(id)?.category ?? (id === "START" || id === "END" ? "terminal" : "node"),
      uses: byId.get(id)?.uses ?? "",
    }));

  const edges = topology.edges
    .filter((e) => positions.has(e.from) && positions.has(e.to))
    .map((e) => {
      const from = positions.get(e.from);
      const to = positions.get(e.to);
      const backward = to.x <= from.x && e.from !== "START";
      return {
        ...e,
        x1: from.x + NODE_W,
        y1: from.y + NODE_H / 2,
        x2: to.x,
        y2: to.y + NODE_H / 2,
        backward,
      };
    });

  const width = PAD * 2 + laidOutLayers.length * NODE_W + (laidOutLayers.length - 1) * GAP_X;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y;
  return { nodes, edges, width, height };
}
