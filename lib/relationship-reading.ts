import type { OverviewNode, OverviewRelation } from "./relationship-overview";

export const overviewRelationLabels = { handoff: "受渡し・参照", transfer: "情報の受渡し", dependency: "稼働の依存" };

// A short caption explains a recorded relation; it does not add a data flow or
// interpret a dependency as the next business operation.
export function overviewRelationCaption(edge: OverviewRelation, dataNames: ReadonlyMap<string, string>) {
  const knownReferences = edge.references.filter(r => r.kind === "handoff");
  const onlyReferences = knownReferences.length > 0 && knownReferences.length === edge.references.length
    && knownReferences.every(r => r.via === "reference");
  const onlyHandoffs = knownReferences.length > 0 && knownReferences.length === edge.references.length
    && knownReferences.every(r => r.via === "handoff");
  const type = edge.kind !== "handoff" ? overviewRelationLabels[edge.kind]
    : onlyReferences ? "情報の参照" : onlyHandoffs ? "仕事の受渡し" : overviewRelationLabels.handoff;
  if (edge.kind === "dependency") return { text: "稼働に必要", type, information: "" };
  const ids = [...new Set(edge.references.flatMap(r => r.dataIds))];
  const names = ids.map(id => dataNames.get(id)?.trim()).filter((name): name is string => !!name);
  const shortType = edge.kind === "transfer" || onlyHandoffs ? "受渡し" : onlyReferences ? "参照" : "接続";
  if (!names.length) return { text: `${shortType} ${edge.references.length}件`, type,
    information: ids.length ? "情報名は未登録" : "" };
  const suffix = ids.length > 1 ? "ほか" : "";
  const budget = 11 - [...shortType].length - 1 - [...suffix].length;
  // Some recorded names differ only in a qualifier, e.g. "製品A 販売予測".
  // Use that shared literal ending as an example. "ほか" keeps other types
  // outside this example; data IDs and complete names remain separate.
  const ending = names[0].split(/\s+/).at(-1)!;
  const sharedEnding = names.length === ids.length && new Set(names).size > 1 && [...ending].length >= 3
    && names.some(name => name !== names[0] && name.endsWith(` ${ending}`));
  const representative = sharedEnding ? ending : names[0];
  const first = [...representative];
  const shortName = first.length <= budget ? representative : `${first.slice(0, budget - 1).join("")}…`;
  const remaining = ids.length - Math.min(2, names.length);
  return { text: `${shortType} ${shortName}${suffix}`, type,
    information: `${names.slice(0, 2).join(" / ")}${remaining ? ` / ほか${remaining}情報` : ""}${ids.length > names.length ? " / 情報名が未登録のものもあります" : ""}` };
}

// Retain all node positions across relation pages. Crop unused outer space, so
// a one- or two-group view leaves room for the selected group's work below it.
export function overviewDiagramLayout(nodes: readonly OverviewNode[], edges: readonly OverviewRelation[], selectedId?: string) {
  const selected = nodes.some(n => n.id === selectedId);
  const degree = (id: string) => new Set(edges.filter(e => e.source === id || e.target === id).flatMap(e => [e.source, e.target])).size;
  const hub = selected ? nodes.find(n => n.id === selectedId) : [...nodes].sort((a, b) => degree(b.id) - degree(a.id))[0];
  const positions = new Map<string, { x: number; y: number }>();
  const available = [{ x: 130, y: 180 }, { x: 790, y: 180 }, { x: 460, y: 55 }, { x: 460, y: 305 },
    { x: 130, y: 55 }, { x: 790, y: 55 }, { x: 130, y: 305 }, { x: 790, y: 305 }];
  if (hub) positions.set(hub.id, { x: 460, y: 180 });
  const neighbors = nodes.filter(n => n.id !== hub?.id).sort((a, b) =>
    Number(edges.some(e => (e.source === hub?.id && e.target === b.id) || (e.target === hub?.id && e.source === b.id))) -
    Number(edges.some(e => (e.source === hub?.id && e.target === a.id) || (e.target === hub?.id && e.source === a.id))));
  for (const node of neighbors) {
    const incoming = edges.some(e => e.source === node.id && e.target === hub?.id);
    const outgoing = edges.some(e => e.target === node.id && e.source === hub?.id);
    const slot = incoming ? available.findIndex(p => p.x === 130) : outgoing ? available.findIndex(p => p.x === 790)
      : available.findIndex(p => p.x === 460);
    positions.set(node.id, available.splice(slot < 0 ? 0 : slot, 1)[0]);
  }
  const points = [...positions.values()];
  if (!points.length) return { positions, width: 420, height: 180 };
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const width = Math.max(420, maxX - minX + 240), height = Math.max(180, maxY - minY + 128);
  const dx = (minX + maxX - width) / 2, dy = (minY + maxY - height) / 2;
  for (const [id, p] of positions) positions.set(id, { x: p.x - dx, y: p.y - dy });
  return { positions, width, height };
}

export function overviewEdgeGeometry(positions: ReadonlyMap<string, { x: number; y: number }>, edges: readonly OverviewRelation[], dataNames: ReadonlyMap<string, string>) {
  const geometry = new Map<string, { path: string; lx: number; ly: number; labelWidth: number; caption: ReturnType<typeof overviewRelationCaption> }>();
  type Box = { x: number; y: number; width: number; height: number };
  const labels: Box[] = [], nodeBoxes = [...positions.values()].map(p => ({ x: p.x - 97, y: p.y - 72, width: 194, height: 144 }));
  const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  // Use every relation in the node window, including other relation pages.
  // A caption's position therefore remains stable when the reader pages ahead.
  for (const edge of edges) {
    const s = positions.get(edge.source), t = positions.get(edge.target);
    if (!s || !t || edge.source === edge.target) continue;
    const dx = t.x - s.x, dy = t.y - s.y, length = Math.hypot(dx, dy);
    const trim = Math.min(104 / Math.max(Math.abs(dx), 1), 58 / Math.max(Math.abs(dy), 1));
    const offset = edges.some(e => e.id !== edge.id && ((e.source === edge.target && e.target === edge.source) ||
      (e.source === edge.source && e.target === edge.target))) ? (edge.kind === "dependency" ? 62 : 35) : 0;
    const cx = (s.x + t.x) / 2 - dy / length * offset, cy = (s.y + t.y) / 2 + dx / length * offset;
    const sx = s.x + dx * trim, sy = s.y + dy * trim, tx = t.x - dx * trim, ty = t.y - dy * trim;
    const path = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
    const caption = overviewRelationCaption(edge, dataNames), labelWidth = Math.min(132, Math.max(74, [...caption.text].length * 11 + 10));
    const candidates = [.5, .33, .67, .25, .75].map(p => {
      const x = (1 - p) ** 2 * sx + 2 * (1 - p) * p * cx + p ** 2 * tx;
      const y = (1 - p) ** 2 * sy + 2 * (1 - p) * p * cy + p ** 2 * ty;
      const box = { x: x - labelWidth / 2, y: y - 11, width: labelWidth, height: 22 };
      const score = labels.reduce((sum, other) => sum + overlap(box, other), 0)
        + nodeBoxes.reduce((sum, other) => sum + overlap(box, other) * 4, 0);
      return { x, y, box, score };
    });
    const anchor = candidates.reduce((best, p) => p.score < best.score ? p : best);
    labels.push(anchor.box);
    geometry.set(edge.id, { path, lx: anchor.x, ly: anchor.y, labelWidth, caption });
  }
  return geometry;
}
