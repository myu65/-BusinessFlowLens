import type { ExtractionReview, ExtractionReviewStep } from "./graph";

export const INPUT_CANVAS_PAGE_SIZE = 6;
const ROW_PITCH = 184;

// Layout only recorded connections. Order is a reading hint, never an inferred edge.
export function inputCanvasLayout(review: ExtractionReview, page = 0) {
  const steps = [...review.steps].sort((a, b) => a.order - b.order);
  const lastPage = Math.max(0, Math.ceil(steps.length / INPUT_CANVAS_PAGE_SIZE) - 1);
  const safePage = Number.isFinite(page) ? Math.max(0, Math.min(Math.floor(page), lastPage)) : 0;
  const core = steps.slice(safePage * INPUT_CANVAS_PAGE_SIZE, (safePage + 1) * INPUT_CANVAS_PAGE_SIZE);
  const coreKeys = new Set(core.map(s => s.stepKey));
  const visible = [...core];
  // Spare slots can keep the previous check and its alternative branch visible.
  // Only one-hop, registered neighbors are context; never synthesize an edge.
  const addContext = (key: string) => {
    const step = steps.find(s => s.stepKey === key);
    if (step && visible.length < INPUT_CANVAS_PAGE_SIZE && !visible.some(s => s.stepKey === key)) visible.push(step);
  };
  const incoming = review.transitions.filter(t => coreKeys.has(t.toStepKey) && !coreKeys.has(t.fromStepKey));
  for (const edge of incoming) addContext(edge.fromStepKey);
  const parents = new Set(incoming.map(t => t.fromStepKey));
  for (const edge of review.transitions.filter(t => parents.has(t.fromStepKey))) addContext(edge.toStepKey);
  for (const edge of review.transitions.filter(t => coreKeys.has(t.fromStepKey))) addContext(edge.toStepKey);
  const keys = new Set(visible.map(s => s.stepKey));
  const edges = review.transitions.filter(t => keys.has(t.fromStepKey) && keys.has(t.toStepKey));
  const order = new Map(steps.map((step, index) => [step.stepKey, index]));
  // Reading order breaks layout cycles only. Keep every recorded return and
  // retry in edges; neither add a connection nor change its meaning.
  const forward = edges.filter(edge => order.get(edge.fromStepKey)! < order.get(edge.toStepKey)!);
  const rank = new Map<string, number>();
  const pending = new Set(keys);
  // Returns must not move the initial check behind its own rework or exit.
  for (let pass = 0; pending.size && pass < visible.length; pass++) {
    for (const step of visible) {
      if (!pending.has(step.stepKey)) continue;
      const incoming = forward.filter(t => t.toStepKey === step.stepKey);
      if (incoming.some(t => !rank.has(t.fromStepKey))) continue;
      rank.set(step.stepKey, incoming.length ? Math.max(...incoming.map(t => rank.get(t.fromStepKey)!)) + 1 : 0);
      pending.delete(step.stepKey);
    }
  }
  for (const key of pending) rank.set(key, rank.size);
  const occupied = new Set<string>();
  const isolated = (step: ExtractionReviewStep) => !review.transitions.some(t => t.fromStepKey === step.stepKey || t.toStepKey === step.stepKey);
  const readingOrder = [...visible].sort((a, b) => Number(isolated(a)) - Number(isolated(b)) || (rank.get(a.stepKey) ?? 0) - (rank.get(b.stepKey) ?? 0) || a.order - b.order);
  const positions = new Map<string, { x: number; y: number; lane: number; column: number }>();
  let lastLane = 0;
  let islandLane: number | undefined;
  for (const step of readingOrder) {
    const depth = rank.get(step.stepKey) ?? 0;
    const band = Math.floor(depth / 3);
    const parents = forward.filter(e => e.toStepKey === step.stepKey).map(e => positions.get(e.fromStepKey)).filter(p => !!p);
    const branching = forward.some(e => e.toStepKey === step.stepKey && forward.filter(t => t.fromStepKey === e.fromStepKey).length > 1);
    const siblings = readingOrder.filter(s => !isolated(s) && rank.get(s.stepKey) === depth);
    let lane = Math.max(band, ...parents.map(p => p.lane + (branching ? 1 : 0)));
    let preferred = parents.length && !branching ? parents[0].lane === lane ? parents[0].column + 1 : 0 : depth % 3;
    if (branching && siblings.length > 1) preferred = siblings.length === 2 ? siblings.indexOf(step) * 2 : siblings.indexOf(step) % 3;
    if (preferred > 2) { preferred = 0; lane++; }
    if (isolated(step)) { islandLane ??= lastLane; lane = islandLane; preferred = 0; }
    let column = preferred;
    while (true) {
      const columns = [...new Set([preferred, 0, 1, 2])];
      const free = columns.find(c => !occupied.has(`${c}:${lane}`));
      if (free !== undefined) { column = free; break; }
      lane++;
    }
    occupied.add(`${column}:${lane}`);
    lastLane = Math.max(lastLane, lane);
    positions.set(step.stepKey, { x: 16 + column * 170, y: 24 + lane * ROW_PITCH, lane, column });
  }
  const nodes = visible.map(step => {
    return {
      step, ...positions.get(step.stepKey)!, isolated: isolated(step), context: !coreKeys.has(step.stepKey),
    };
  });
  return {
    nodes, edges, page: safePage, total: steps.length, coreCount: core.length,
    width: Math.max(540, 536 + edges.length * 3), height: Math.max(220, ...nodes.map(n => n.y + 180)),
    outside: review.transitions.filter(t => coreKeys.has(t.fromStepKey) !== coreKeys.has(t.toStepKey)),
  };
}

export function inputCanvasEdge(
  from: { x: number; y: number }, to: { x: number; y: number },
  nodes: Array<{ x: number; y: number }>, index: number,
) {
  const sameRow = from.y === to.y, right = to.x > from.x;
  if (sameRow && from.x === to.x) {
    // A self-loop used to run straight through its own card and disappear.
    const rail = from.x + 156, bottom = from.y + 150, top = from.y - 12;
    return { path: `M${from.x + 98},${from.y + 128} V${bottom} H${rail} V${top} H${from.x + 98} V${from.y}`,
      x: rail, y: bottom, labelX: from.x + 70, labelY: from.y + 174 };
  }
  if (to.y < from.y || sameRow && !right) {
    const bottom = from.y + 150;
    if (from.x === to.x) {
      const rail = from.x + 156;
      return { path: `M${from.x + 140},${from.y + 84} H${rail} V${to.y + 84} H${to.x + 140}`,
        x: rail, y: (from.y + to.y) / 2 + 84, labelX: from.x + 70, labelY: from.y + 150 };
    }
    if (sameRow) return { path: `M${from.x + 70},${from.y + 128} V${bottom} H${to.x + 70} V${to.y + 128}`,
      x: (from.x + to.x) / 2 + 70, y: bottom, labelY: from.y + 174 };
    const rail = 524 + index * 3;
    return { path: `M${from.x + 70},${from.y + 128} V${bottom} H${rail} V${to.y - 12} H${to.x + 70} V${to.y}`,
      x: rail, y: bottom, labelX: from.x + 70, labelY: from.y + 174 };
  }
  const sx = sameRow ? from.x + (right ? 140 : 0) : from.x + 70;
  const sy = sameRow ? from.y + 64 : from.y + 128;
  const tx = sameRow ? to.x + (right ? 0 : 140) : to.x + 70;
  const ty = sameRow ? to.y + 64 : to.y;
  const blocked = nodes.some(n => n !== from && n !== to && n.x < Math.max(sx, tx) && n.x + 140 > Math.min(sx, tx) && n.y <= sy && n.y + 128 >= sy);
  if (sameRow && !blocked) return { path: `M${sx},${sy} L${tx},${ty}`, x: (sx + tx) / 2, y: sy, labelY: from.y + 146 };
  // Split immediately below the common task, rather than circling past its other branch.
  if (to.y - from.y === ROW_PITCH) {
    const mid = (sy + ty) / 2;
    return { path: `M${sx},${sy} V${mid} H${tx} V${ty}`, x: (sx + tx) / 2, y: mid };
  }
  if (sameRow) {
    const bottom = from.y + 150;
    return { path: `M${from.x + 70},${from.y + 128} V${bottom} H${to.x + 70} V${to.y + 128}`, x: (from.x + to.x) / 2 + 70, y: bottom };
  }
  const rail = 512 + index * 3;
  return { path: `M${from.x + 70},${from.y + 128} V${from.y + 146} H${rail} V${to.y - 12} H${to.x + 70} V${to.y}`,
    x: rail, y: (from.y + 146 + to.y - 12) / 2 };
}

export function inputConnectionDirection(from: ExtractionReviewStep, to: ExtractionReviewStep) {
  return from.stepKey === to.stepKey ? "repeat" : to.order < from.order ? "return" : "forward";
}

export function inputConnectionCaption(edge: ExtractionReview["transitions"][number], from: ExtractionReviewStep, to: ExtractionReviewStep) {
  const direction = inputConnectionDirection(from, to);
  return [direction === "repeat" ? "同じ手順を繰り返す" : direction === "return" ? `手順${to.order}へ戻る` : "",
    edge.sourceVariant ? "記載差 · 採用版は未確認" : edge.holdEffect === "response" ? "停止中の対応" : edge.holdEffect === "resume" ? "再開" : "",
    edge.condition].filter(Boolean).join(" · ");
}

export function inputStepMode(step: ExtractionReviewStep) {
  return step.executionMode === "automatic" ? "システム自動"
    : step.executionMode === "manual" ? "人の作業"
      : step.executionMode === "mixed" ? "人とシステム" : "実行方法は未確認";
}

function withoutRecordedSubject(title: string, step: ExtractionReviewStep) {
  const subjects = [step.actor, step.executingSystem, ...(step.humanEdits ?? [])
    .filter(e => e.field === "actor" || e.field === "executingSystem")
    .map(e => typeof e.before === "string" ? e.before : null)];
  for (const actor of subjects)
    if (actor && (title.startsWith(`${actor}が`) || title.startsWith(`${actor}は`)))
      return title.slice(actor.length + 1).trim() || title;
  return title;
}

export function inputStepName(step: ExtractionReviewStep) {
  return withoutRecordedSubject(step.name, step);
}

// At this scale, show the recorded result when it is grounded. The full task
// name and its evidence remain in the selected step; never invent a summary.
export function inputCanvasLabel(step: ExtractionReviewStep) {
  const title = step.meaning?.certainty === "confirmed" && step.meaning.result.trim()
    ? step.meaning.result.trim() : step.name;
  return withoutRecordedSubject(title, step);
}
