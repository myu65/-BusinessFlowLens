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

// Only flag a literal denied-approval hold that the draft puts after a
// source-backed combined check/approval. The model still decides the repair.
export function approvalDenialRepair(review: ExtractionReview, source: string) {
  if (!Array.isArray(review.transitions)) return null;
  const bothActions = /確認(?:し|して|した後|したら).{0,24}承認(?:する|します|し(?=[、。]))/;
  const denied = /承認(?:され)?(?:ない|なければ|なかった)/;
  const held = /保留(?:する|します|し(?=[て、。]))|(?:配信|送付|処理)を(?:止める|止めます|止め[て、])/;
  const clauses = source.split(/(?<=[。\n])/);
  const flagged: Array<{ stepKey: string; check: string; denial: string }> = [];
  for (const step of review.steps) {
    if (typeof step.action !== "string" || typeof step.evidence !== "string"
      || !bothActions.test(step.action) || !bothActions.test(sourceEvidence(source, step.evidence) ?? "")
      || /承認(?:しない|しません|しなかった|していない|していません)/.test(step.action)) continue;
    for (const edge of review.transitions) {
      if (edge.fromStepKey !== step.stepKey || edge.toStepKey === step.stepKey || typeof edge.evidence !== "string") continue;
      const clause = clauses.filter(c => sourceEvidence(c, edge.evidence)).at(-1);
      if (!clause || !denied.test(clause) || !held.test(clause)
        || /不明|分から|未確認|未定|(?:保留|止め)(?:しない|しません|ない|ません)/.test(clause)) continue;
      const target = review.steps.find(s => s.stepKey === edge.toStepKey);
      if (!target || typeof target.evidence !== "string" || !sourceEvidence(clause, target.evidence)) continue;
      flagged.push({ stepKey: step.stepKey, check: step.evidence, denial: clause.trim() });
      break;
    }
  }
  return flagged.length ? { stepKeys: flagged.map(f => f.stepKey),
    checkAndApprovalEvidence: flagged.map(f => f.check), denialEvidence: flagged.map(f => f.denial) } : null;
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
