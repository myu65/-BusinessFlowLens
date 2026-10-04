import type { ExtractionReview } from "./graph";
import { sourceEvidence } from "./source-evidence";

// This narrow guard handles a missing fact, not an action with an unknown actor.
// Keep its literal source in the question; never bridge the removed step.
function missingFactOnly(source: string, evidence: string): string | null {
  const grounded = sourceEvidence(source, evidence);
  if (!grounded) return null;
  const clauses = grounded.split(/[。！？\n]/).map(s => s.trim()).filter(Boolean);
  if (!clauses.length || !clauses.every(clause => {
    const fact = clause.normalize("NFKC").replace(/[\s「」『』、,]/g, "")
      .replace(/^.*(?:場合|とき)(?:の|には|に|は|、)*/, "");
    // A stated confirmation, inquiry or other action must remain a task.
    if (/(?:いつ.{1,60}か|時期|期限|日時|日程|タイミング)(?:は|が)(?:まだ|現時点では|今は)?(?:決まっていません|決まっていない|分かりません|分からない|不明|未確認|未定)(?:です|でした)?$/.test(fact)) return true;
    if (/する|した|して|します|され|しました|尋ね|聞い|問い合|照会し/.test(fact)) return false;
    return /(?:担当者?|責任者|引継ぎ先|引き継ぎ先|受渡し先|受け渡し先|再開先|接続先|基準|条件|方法|手順|時期|期限)(?:は|が)(?:まだ|現時点では|今は)?(?:分かりません|分からない|わかりません|わからない|不明|未確認|未定)(?:です|でした)?$/.test(fact);
  })) return null;
  return grounded;
}

export function separateMissingFacts<T extends ExtractionReview>(review: T, source: string): T {
  const removed = new Map<string, string>();
  for (const step of review.steps) {
    if (step.humanEdits?.length) continue;
    const evidence = missingFactOnly(source, step.evidence);
    if (evidence) removed.set(step.stepKey, evidence);
  }
  if (!removed.size) return review;
  const questions = [...review.questions];
  const warnings = [...review.warnings];
  for (const [key, evidence] of removed) {
    const step = review.steps.find(s => s.stepKey === key)!;
    questions.push({ question: `未確認の内容を補足できますか？（${evidence}）`,
      reason: "原文は不足情報を述べています。確認する作業や接続先を実施済みの手順として扱っていません。",
      target: /担当|責任者/.test(evidence) ? "owner" : "exception" });
    warnings.push(`${step.name}：作業の記述がないため、原文の根拠を残して確認事項へ移しました。`);
  }
  return { ...review,
    steps: review.steps.filter(s => !removed.has(s.stepKey)),
    transitions: review.transitions.filter(t => !removed.has(t.fromStepKey) && !removed.has(t.toStepKey)),
    incomingHandoffs: review.incomingHandoffs?.filter(h => !removed.has(h.toStepKey)),
    handoffs: review.handoffs?.filter(h => !removed.has(h.fromStepKey)),
    dataFlows: review.dataFlows.filter(f => !f.relatedStepKeys.length || f.relatedStepKeys.some(k => !removed.has(k)))
      .map(f => ({ ...f, relatedStepKeys: f.relatedStepKeys.filter(k => !removed.has(k)) })),
    questions: [...new Map(questions.map(q => [q.question, q])).values()], warnings,
  };
}
