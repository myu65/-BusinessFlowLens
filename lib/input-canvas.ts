import type { ExtractionReview, ExtractionReviewStep } from "./graph";

export const INPUT_CANVAS_PAGE_SIZE = 6;

// Layout only recorded connections. Order is a reading hint, never an inferred edge.
export function inputCanvasLayout(review: ExtractionReview, page = 0) {
  const steps = [...review.steps].sort((a, b) => a.order - b.order);
  const safePage = Math.max(0, Math.min(page, Math.ceil(steps.length / INPUT_CANVAS_PAGE_SIZE) - 1));
  const visible = steps.slice(safePage * INPUT_CANVAS_PAGE_SIZE, (safePage + 1) * INPUT_CANVAS_PAGE_SIZE);
  const keys = new Set(visible.map(s => s.stepKey));
  const edges = review.transitions.filter(t => keys.has(t.fromStepKey) && keys.has(t.toStepKey));
  const rank = new Map<string, number>();
  const pending = new Set(keys);
  // Bounded topological pass; feedback loops retain their explicit edge and use a fallback position.
  for (let pass = 0; pending.size && pass < visible.length; pass++) {
    for (const step of visible) {
      if (!pending.has(step.stepKey)) continue;
      const incoming = edges.filter(t => t.toStepKey === step.stepKey);
      if (incoming.some(t => !rank.has(t.fromStepKey))) continue;
      rank.set(step.stepKey, incoming.length ? Math.max(...incoming.map(t => rank.get(t.fromStepKey)!)) + 1 : 0);
      pending.delete(step.stepKey);
    }
  }
  for (const key of pending) rank.set(key, rank.size);
  const occupied = new Set<string>();
  const isolated = (step: ExtractionReviewStep) => !review.transitions.some(t => t.fromStepKey === step.stepKey || t.toStepKey === step.stepKey);
  const readingOrder = [...visible].sort((a, b) => Number(isolated(a)) - Number(isolated(b)) || (rank.get(a.stepKey) ?? 0) - (rank.get(b.stepKey) ?? 0) || a.order - b.order);
  const positions = new Map<string, { x: number; y: number }>();
  let lastLane = 0;
  for (const step of readingOrder) {
    const depth = rank.get(step.stepKey) ?? 0;
    const band = Math.floor(depth / 3);
    const preferred = band % 2 ? 2 - depth % 3 : depth % 3;
    let lane = isolated(step) ? lastLane : band;
    let column = preferred;
    while (true) {
      const columns = [...new Set([preferred, ...(lane % 2 ? [2, 1, 0] : [0, 1, 2])])];
      const free = columns.find(c => !occupied.has(`${c}:${lane}`));
      if (free !== undefined) { column = free; break; }
      lane++;
    }
    occupied.add(`${column}:${lane}`);
    lastLane = Math.max(lastLane, lane);
    positions.set(step.stepKey, { x: 16 + column * 170, y: 24 + lane * 174 });
  }
  const nodes = visible.map(step => {
    return {
      step, ...positions.get(step.stepKey)!, isolated: isolated(step),
    };
  });
  return {
    nodes, edges, page: safePage, total: steps.length,
    width: Math.max(540, 518 + edges.length * 3), height: Math.max(220, ...nodes.map(n => n.y + 158)),
    outside: review.transitions.filter(t => keys.has(t.fromStepKey) !== keys.has(t.toStepKey)),
  };
}

export function inputStepMode(step: ExtractionReviewStep) {
  return step.executionMode === "automatic" ? "システム自動"
    : step.executionMode === "manual" ? "人の作業"
      : step.executionMode === "mixed" ? "人とシステム" : "実行方法は未確認";
}
