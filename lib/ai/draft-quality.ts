import type { ExtractionReview } from "../graph";
import { sourceEvidence } from "../source-evidence";

// This flags a narrow, source-backed contradiction for one model repair. It
// does not split work, choose a branch condition, or add a business fact.
export function preApprovalRepair(review: ExtractionReview, source: string) {
  const before = source.split(/[。\n]/).filter(clause => /承認(?:する|の)?前/.test(clause)).at(-1);
  if (!before || !/依頼|頼み|頼む|相談/.test(before) ||
    /前(?:ではない|ではなく|ではありません)|不明|分から|未確認/.test(before)) return null;
  const bothActions = /確認(?:し|して|した後|したら).{0,24}承認(?:する|します|し(?=[、。]))/;
  const combined = review.steps.filter(step => {
    if (!step || typeof step.action !== "string" || typeof step.evidence !== "string") return false;
    const quote = sourceEvidence(source, step.evidence);
    return bothActions.test(step.action) && quote && bothActions.test(quote) &&
      !/承認(?:しない|しません|しなかった|していない|していません)/.test(step.action);
  });
  return combined.length ? {
    stepKeys: combined.map(step => step.stepKey),
    checkAndApprovalEvidence: combined.map(step => step.evidence),
    beforeApprovalEvidence: before.trim(),
  } : null;
}

// Decomposition may rename a key even when the model keeps the literal source.
// Reuse identity only for one checking action grounded in the same sentence.
// This changes keys, never actions or business connections.
export function retainSplitCheckKeys<T extends ExtractionReview>(review: T, previous: ExtractionReview | null | undefined, source: string): T {
  if (!previous) return review;
  const clauses = source.split(/(?<=[。\n])/);
  const proposals = new Map<string, string[]>();
  for (const old of previous.steps) {
    if (review.steps.some(step => step.stepKey === old.stepKey) ||
      !/確認(?:し|して|した後|したら).{0,24}承認(?:する|します|し(?=[、。]))/.test(old.action)) continue;
    const candidates = review.steps.filter(step => /確認/.test(step.action) &&
      !/承認(?:する|します|し(?=[、。]))/.test(step.action) &&
      clauses.some(clause => sourceEvidence(clause, old.evidence) && sourceEvidence(clause, step.evidence)));
    if (candidates.length === 1) proposals.set(candidates[0].stepKey,
      [...(proposals.get(candidates[0].stepKey) ?? []), old.stepKey]);
  }
  const keys = new Map([...proposals].filter(([, values]) => values.length === 1).map(([from, values]) => [from, values[0]]));
  if (!keys.size) return review;
  const key = (value: string) => keys.get(value) ?? value;
  return { ...review,
    steps: review.steps.map(step => ({ ...step, stepKey: key(step.stepKey) })),
    transitions: review.transitions.map(t => ({ ...t, fromStepKey: key(t.fromStepKey), toStepKey: key(t.toStepKey) })),
    dataFlows: review.dataFlows.map(flow => ({ ...flow, relatedStepKeys: flow.relatedStepKeys.map(key) })),
    handoffs: review.handoffs?.map(h => ({ ...h, fromStepKey: key(h.fromStepKey) })),
    incomingHandoffs: review.incomingHandoffs?.map(h => ({ ...h, toStepKey: key(h.toStepKey) })),
  };
}
