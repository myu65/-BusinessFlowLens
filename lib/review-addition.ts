import type { ExtractionReview, ExtractionTransition, HumanEdit } from "./graph";
import { inputStepName } from "./input-canvas";
import {withCurrentExplanation} from './current-understanding';

export type ReviewInsertion = {
  afterStepKey: string;
  transition?: ExtractionTransition;
};

export type ReviewAdditionContext = {
  before: { name: string; actor: string | null; result: string; data: Array<{ name: string; operation: string }> };
  after?: ReviewAdditionContext["before"];
};

export function reviewAdditionContext(review: ExtractionReview, insertion: ReviewInsertion): ReviewAdditionContext {
  const describe = (stepKey: string) => {
    const step = review.steps.find(s => s.stepKey === stepKey);
    if (!step) throw new Error("追加する場所の手順が変わりました。図で選び直してください。");
    return { name: inputStepName(step).slice(0, 240), actor: step.actor?.slice(0, 100) ?? null,
      result: (step.meaning?.result ?? "").slice(0, 240), data: step.data.slice(0, 4).map(d => ({ name: d.name.slice(0, 100), operation: d.operation })) };
  };
  return { before: describe(insertion.afterStepKey), ...(insertion.transition ? { after: describe(insertion.transition.toStepKey) } : {}) };
}

// The note is an additional source, not a rewrite of the earlier interview.
export function appendReviewSource(source: string, note: string) {
  if (!note.trim()) throw new Error("追加する話を入力してください。");
  return source + (source && !source.endsWith("\n") ? "\n" : "") + note.trim();
}

export function addReviewNote(
  before: ExtractionReview,
  addition: ExtractionReview,
  insertion: ReviewInsertion,
  note: string,
  id: string,
): { review: ExtractionReview; addedKeys: string[] } {
  const anchor = before.steps.find(s => s.stepKey === insertion.afterStepKey);
  if (!anchor || !note.trim() || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
    throw new Error("追加する場所と話を確認してください。");
  const transitionIndex = insertion.transition ? before.transitions.findIndex(t =>
    JSON.stringify(t) === JSON.stringify(insertion.transition)) : -1;
  if (insertion.transition && (transitionIndex < 0 || insertion.transition.fromStepKey !== anchor.stepKey))
    throw new Error("追加先の接続が変わりました。図で場所を選び直してください。");
  if (addition.steps.length > 16) throw new Error("話を分けて追加してください。一度に追加できるのは16手順までです。");
  const keyMap = new Map(addition.steps.map(s => [s.stepKey, `addition-${id}-${s.stepKey}`]));
  if (keyMap.size !== addition.steps.length || [...keyMap.values()].some(k => before.steps.some(s => s.stepKey === k)))
    throw new Error("追加する手順を識別できませんでした。もう一度お試しください。");
  const key = (k: string) => keyMap.get(k)!;
  const addedKeys = [...keyMap.values()];
  const placement: HumanEdit = {
    field: "placement",
    before: insertion.transition ? {
      fromStepKey: insertion.transition.fromStepKey, toStepKey: insertion.transition.toStepKey,
      condition: insertion.transition.condition, evidence: insertion.transition.evidence,
    } : null,
    after: { afterStepKey: anchor.stepKey, addedStepKeys: addedKeys, beforeStepKey: insertion.transition?.toStepKey ?? null },
    evidence: note.trim(),
  };
  const inserted = [...addition.steps].sort((a, b) => a.order - b.order).map(s => ({
    ...s, stepKey: key(s.stepKey), humanEdits: [...(s.humanEdits ?? []), placement],
  }));
  const transitions = addition.transitions
    .filter(t => keyMap.has(t.fromStepKey) && keyMap.has(t.toStepKey))
    .map(t => ({ ...t, fromStepKey: key(t.fromStepKey), toStepKey: key(t.toStepKey) }));
  const entries = inserted.filter(s => !transitions.some(t => t.toStepKey === s.stepKey));
  const exits = inserted.filter(s => !transitions.some(t => t.fromStepKey === s.stepKey));
  const questions = [...before.questions, ...addition.questions];
  const warnings = [...before.warnings, ...addition.warnings];
  const existing = [...before.transitions];
  // The user selects one existing arrow. Its condition stays on that branch;
  // other branches and the existing tasks never pass through the model again.
  if (entries.length === 1) {
    if (transitionIndex >= 0) existing.splice(transitionIndex, 1);
    const original = insertion.transition;
    transitions.unshift({
      ...original,
      fromStepKey: anchor.stepKey, toStepKey: entries[0].stepKey,
      condition: original?.condition ?? null,
      evidence: original?.evidence ?? note.trim(),
      certainty: original ? original.certainty ?? "unknown" : "confirmed",
      humanEdits: [...(original?.humanEdits ?? []), placement],
    });
    if (original) {
      if (exits.length === 1 && !exits[0].meaning?.halt) transitions.push({
        fromStepKey: exits[0].stepKey, toStepKey: original.toStepKey,
        condition: null, evidence: note.trim(), certainty: "confirmed", humanEdits: [placement],
      });
      else questions.push({
        question: `追加した作業の後、どの条件で「${before.steps.find(s => s.stepKey === original.toStepKey)?.name ?? "次の手順"}」へ進みますか？`,
        reason: "追加した話に分岐や保留があり、次の手順への接続はまだ確認できていません。", target: "handoff",
      });
    }
  } else if (inserted.length) {
    questions.push({ question: `「${anchor.name}」の後、追加したどの作業から始まりますか？`,
      reason: "追加した作業の開始点が一つに決まりません。元の矢印は保ち、追加候補の前後は未確認にしています。", target: "handoff" });
  }
  const ordered = [...before.steps].sort((a, b) => a.order - b.order);
  const anchorIndex = ordered.findIndex(s => s.stepKey === anchor.stepKey);
  const targetIndex = ordered.findIndex(s => s.stepKey === insertion.transition?.toStepKey);
  // Place new work beside its chosen destination. Inserting before every
  // branch would swap an existing normal/exception reading order.
  const offset = targetIndex > anchorIndex ? targetIndex : anchorIndex + 1;
  ordered.splice(offset, 0, ...inserted);
  const unique = <T,>(items: T[], identity: (item: T) => string) => {
    const seen = new Set<string>();
    return items.filter(item => { const identityKey = identity(item); if (seen.has(identityKey)) return false; seen.add(identityKey); return true; });
  };
  return { addedKeys, review: withCurrentExplanation({
    ...before,
    extraction: addition.extraction ?? before.extraction,
    steps: ordered.map((s, i) => s.order === i + 1 ? s : { ...s, order: i + 1 }),
    transitions: [...existing, ...transitions],
    dataFlows: [...before.dataFlows, ...addition.dataFlows.map(f => ({ ...f, relatedStepKeys: f.relatedStepKeys.map(key).filter(Boolean) }))],
    handoffs: [...(before.handoffs ?? []), ...(addition.handoffs ?? []).filter(h => keyMap.has(h.fromStepKey)).map(h => ({ ...h, fromStepKey: key(h.fromStepKey) }))],
    incomingHandoffs: [...(before.incomingHandoffs ?? []), ...(addition.incomingHandoffs ?? []).filter(h => keyMap.has(h.toStepKey)).map(h => ({ ...h, toStepKey: key(h.toStepKey) }))],
    systemProfiles: unique([...(before.systemProfiles ?? []), ...(addition.systemProfiles ?? [])], p => p.name),
    systemDependencies: unique([...(before.systemDependencies ?? []), ...(addition.systemDependencies ?? [])], d => `${d.system}\0${d.prerequisite}`),
    questions: unique(questions, q => q.question), warnings: [...new Set(warnings)],
  },before,'話から途中の作業を追加',note.trim()) };
}
