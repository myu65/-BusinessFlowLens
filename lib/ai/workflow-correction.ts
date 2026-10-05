import type { ExtractionReview } from "../graph";
export type WorkflowCorrection = { text: string; stepKey?: string };
export const CORRECTION_FIELDS = ["name","action","actor","department","responsiblePerson","executionMode","executingSystem","systems","data","meaning.purpose","meaning.basis","meaning.result","meaning.next","meaning.condition","meaning.halt","boundary.scope","boundary.party","boundary.visibility","boundary.incoming","boundary.outgoing","boundary.unknowns"] as const;
export type CorrectionField = { stepKey: string; field: string };
/** A reread must not disguise unrelated wording changes as the user's correction. */
export function correctionCandidate(previous: ExtractionReview | null | undefined, proposed: ExtractionReview, correction: WorkflowCorrection | undefined, fields: CorrectionField[] = []): ExtractionReview {
  if (!previous || !correction?.text.trim()) return proposed;
  const oldSteps = new Map(previous.steps.map(step => [step.stepKey, step]));
  const proposals = new Map(proposed.steps.map(step => [step.stepKey, step]));
  const steps = (correction.stepKey ? previous.steps : proposed.steps).map(candidate => {
    const before = oldSteps.get(candidate.stepKey), after = proposals.get(candidate.stepKey);
    if (!before || !after) return candidate;
    if (correction.stepKey && candidate.stepKey !== correction.stepKey) return before;
    const next = structuredClone(before);
    for (const change of Array.isArray(fields) ? fields : []) {
      if (!change || change.stepKey !== candidate.stepKey || !(CORRECTION_FIELDS as readonly string[]).includes(change.field)) continue;
      const parts = change.field.split('.');
      const value = parts.reduce<unknown>((item, part) => item && typeof item === 'object' ? (item as Record<string, unknown>)[part] : undefined, after);
      if (value === undefined) continue;
      let target = next as unknown as Record<string, unknown>;
      for (const part of parts.slice(0, -1)) {
        if (!target[part] || typeof target[part] !== 'object') target[part] = {};
        target = target[part] as Record<string, unknown>;
      }
      target[parts.at(-1)!] = structuredClone(value);
    }
    // A whole-flow correction may insert a new action between existing ones.
    if (!correction.stepKey) next.order = after.order;
    return next;
  });
  const transitions = correction.stepKey ? previous.transitions : proposed.transitions.map(edge =>
    previous.transitions.find(old => old.fromStepKey === edge.fromStepKey && old.toStepKey === edge.toStepKey && (old.condition ?? '') === (edge.condition ?? '')) ?? edge);
  const changesAssets = (Array.isArray(fields) ? fields : []).some(change => change && change.stepKey === correction.stepKey && ['data','systems','executingSystem'].includes(change.field));
  return { ...proposed, steps, transitions,
    dataFlows: correction.stepKey && !changesAssets ? previous.dataFlows : proposed.dataFlows,
    systemProfiles: correction.stepKey && !changesAssets ? previous.systemProfiles : proposed.systemProfiles,
    organization: correction.stepKey ? previous.organization : proposed.organization,
    handoffs: correction.stepKey ? previous.handoffs : proposed.handoffs,
    incomingHandoffs: correction.stepKey ? previous.incomingHandoffs : proposed.incomingHandoffs,
    systemDependencies: correction.stepKey ? previous.systemDependencies : proposed.systemDependencies };
}
/** Only the explicitly proposed correction fields supersede earlier human edits. Unrelated edits remain protected. */
export function correctionPrior(previous: ExtractionReview | null | undefined, proposed: ExtractionReview, correction: WorkflowCorrection | undefined, fields: CorrectionField[] = []): ExtractionReview | null | undefined {
  if (!previous || !correction?.text.trim()) return previous;
  return { ...previous, steps: previous.steps.map(step => {
    const after = proposed.steps.find(s => s.stepKey === step.stepKey);
    if (!after || (correction.stepKey && step.stepKey !== correction.stepKey)) return step;
    const edits = (Array.isArray(fields)?fields:[]).filter(f => f && f.stepKey === step.stepKey && (CORRECTION_FIELDS as readonly string[]).includes(f.field)).flatMap(({field}) => {
      const value = (target: typeof step): unknown => field.split(".").reduce<unknown>((item, part) => item && typeof item === "object" ? (item as Record<string,unknown>)[part] : undefined, target);
      const before = value(step), next = value(after);
      const facts = (item: unknown): unknown => Array.isArray(item) ? item.map(facts) : item && typeof item === "object"
        ? Object.fromEntries(Object.entries(item).filter(([name])=>!["evidence","certainty","sourceRefs"].includes(name)).map(([name,value])=>[name,facts(value)])) : item;
      if (next === undefined || JSON.stringify(facts(before)) === JSON.stringify(facts(next))) return [];
      return [{ field, before, after: next, evidence: `利用者の補足・訂正：${correction.text.trim()}` }];
    });
    return edits.length ? { ...step, humanEdits: [...(step.humanEdits ?? []), ...edits] } : step;
  }) };
}
