import type { Confidence, ExtractionReview, ExtractionReviewStep, ExtractionTransition } from "./graph";

export type ReviewStripConnection =
  | { kind: "next"; transition: ExtractionTransition }
  | { kind: "branches"; fork: ExtractionReviewStep; certainty: Confidence }
  | { kind: "unknown" };

// Numbered cards are a reading list. They do not imply that adjacent alternatives
// execute in sequence. Use recorded paths, never their display order or labels.
export function reviewStripConnection(
  review: ExtractionReview,
  leftKey: string,
  rightKey: string,
): ReviewStripConnection {
  const direct = review.transitions.find(t =>
    t.fromStepKey === leftKey && t.toStepKey === rightKey,
  );
  if (direct) return { kind: "next", transition: direct };

  const keys = new Set(review.steps.map(s => s.stepKey));
  const outgoing = new Map<string, ExtractionTransition[]>();
  for (const t of review.transitions) {
    if (!keys.has(t.fromStepKey) || !keys.has(t.toStepKey)) continue;
    outgoing.set(t.fromStepKey, [...(outgoing.get(t.fromStepKey) ?? []), t]);
  }
  const path = (start: string, end: string): ExtractionTransition[] | null => {
    const visited = new Set([start]);
    const queue: Array<{ key: string; edges: ExtractionTransition[] }> = [{ key: start, edges: [] }];
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      if (entry.key === end) return entry.edges;
      for (const t of outgoing.get(entry.key) ?? []) {
        if (visited.has(t.toStepKey)) continue;
        visited.add(t.toStepKey);
        queue.push({ key: t.toStepKey, edges: [...entry.edges, t] });
      }
    }
    return null;
  };
  // A sequential path, a return, or a cycle is not a pair of separate branches.
  if (path(leftKey, rightKey) || path(rightKey, leftKey)) return { kind: "unknown" };

  let nearest: { fork: ExtractionReviewStep; edges: ExtractionTransition[]; distance: number } | undefined;
  for (const fork of review.steps) {
    const alternatives = (outgoing.get(fork.stepKey) ?? []).filter(t => t.condition?.trim());
    for (const left of alternatives) {
      const leftPath = path(left.toStepKey, leftKey);
      if (!leftPath || path(left.toStepKey, rightKey)) continue;
      for (const right of alternatives) {
        if (left.toStepKey === right.toStepKey || left.condition === right.condition) continue;
        const rightPath = path(right.toStepKey, rightKey);
        if (!rightPath || path(right.toStepKey, leftKey)) continue;
        const edges = [left, ...leftPath, right, ...rightPath];
        if (edges.some(t => !t.certainty || t.certainty === "unknown")) continue;
        const downstream = nearest && path(nearest.fork.stepKey, fork.stepKey) && !path(fork.stepKey, nearest.fork.stepKey);
        const upstream = nearest && path(fork.stepKey, nearest.fork.stepKey);
        if (!nearest || downstream || (!upstream && edges.length < nearest.distance))
          nearest = { fork, edges, distance: edges.length };
      }
    }
  }
  return nearest ? {
    kind: "branches", fork: nearest.fork,
    certainty: nearest.edges.every(t => t.certainty === "confirmed") ? "confirmed" : "inferred",
  } : { kind: "unknown" };
}
