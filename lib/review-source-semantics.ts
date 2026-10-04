import type { ExtractionReview, ExtractionReviewStep, ReviewSystemDependency } from "./graph";
import { groundedDependency } from "./system-dependencies";
import { sourceEvidence } from "./source-evidence";

const compact = (s: string) => s.normalize("NFKC").replace(/[\s「」『』。！？、,]/g, "").toLowerCase();

function pureDependencyEvidence(evidence: string, review: ExtractionReview, source: string): ReviewSystemDependency | undefined {
  const quote = sourceEvidence(source, evidence);
  if (!quote) return;
  return review.systemDependencies?.find(d => !d.rejected && d.certainty !== "unknown" &&
    groundedDependency(d, source) && compact(d.evidence) === compact(quote) &&
    compact(quote).startsWith(compact(d.system)) &&
    !/(?:確認|承認|登録|入力|テスト|試験|通知|送信|報告|依頼|判断|採番|生成|作成|ログイン)(?:し|する|します|した|して)|送[りるっ]|渡[しす]/.test(quote));
}

function descriptionDependency(step: ExtractionReviewStep, review: ExtractionReview, source: string): ReviewSystemDependency | undefined {
  // An actual narrated action (including automatic work), or a human
  // correction, stays a task. This guard handles an ownerless specification.
  if (step.humanEdits?.length || step.actor || step.responsiblePerson || step.executingSystem || step.executionMode !== "unknown") return;
  return pureDependencyEvidence(step.evidence, review, source);
}

export function separateDependencyDescriptions<T extends ExtractionReview>(review: T, source: string): T {
  const removed = new Map(review.steps.flatMap(s => {
    const dependency = descriptionDependency(s, review, source);
    return dependency ? [[s.stepKey, dependency] as const] : [];
  }));
  const dataFlows = review.dataFlows.filter(f => !pureDependencyEvidence(f.evidence, review, source));
  if (!removed.size && dataFlows.length === review.dataFlows.length) return review;
  const warnings = [...review.warnings], questions = [...review.questions];
  if (dataFlows.length !== review.dataFlows.length)
    warnings.push("認証・接続の仕組みの説明だけから作られたデータ転送は外し、道具の依存関係として原文を残しました。");
  for (const [key, d] of removed) {
    const step = review.steps.find(s => s.stepKey === key)!;
    warnings.push(`${step.name}：作業の順序ではなく、${d.system}が${d.prerequisite}を必要とする仕組みとして原文を残しました。`);
  }
  const steps = review.steps.filter(s => !removed.has(s.stepKey)).map(s => {
    const outgoing = review.transitions.filter(t => t.fromStepKey === s.stepKey);
    if (!outgoing.length || !outgoing.every(t => removed.has(t.toStepKey))) return s;
    questions.push({ question: `「${s.name}」の後は、どの作業に進みますか？`, target: "handoff",
      reason: "仕組みの説明を作業の順序から外しました。前後の作業を自動でつなぎ直していません。" });
    // The next label belonged to the removed AI sequence. Human field edits
    // are protected later by preserveRefinements, rather than overwritten.
    if (!s.meaning?.next || s.humanEdits?.some(e => e.field === "meaning.next")) return s;
    return { ...s, meaning: { ...s.meaning, next: "" } };
  });
  return { ...review, steps,
    transitions: review.transitions.filter(t => !removed.has(t.fromStepKey) && !removed.has(t.toStepKey)),
    incomingHandoffs: review.incomingHandoffs?.filter(h => !removed.has(h.toStepKey)),
    handoffs: review.handoffs?.filter(h => !removed.has(h.fromStepKey)),
    dataFlows: dataFlows.filter(f => !f.relatedStepKeys.length || f.relatedStepKeys.some(k => !removed.has(k)))
      .map(f => ({ ...f, relatedStepKeys: f.relatedStepKeys.filter(k => !removed.has(k)) })),
    questions: [...new Map(questions.map(q => [q.question, q])).values()], warnings,
  };
}

// Registering an identifier/person uses that value; it does not generate a
// number or create a person. Do not invent an unstated registration record.
export function distinguishRegistrationInputs<T extends ExtractionReview>(review: T, source: string): T {
  const warnings = [...review.warnings];
  const steps = review.steps.map(step => {
    if (step.humanEdits?.some(e => e.field === "data" || e.field.startsWith("data."))) return step;
    let changed = false;
    const data = step.data.map(d => {
      const quote = sourceEvidence(source, d.evidence);
      if (!quote) return d;
      // A short quotation can be valid, but its enclosing sentence may say
      // "planned", "not done" or "generated first". Keep those qualifiers.
      const sentences = new Map(source.split(/(?<=[。！？\n])/).filter(s => compact(s).includes(compact(quote)))
        .map(s => [compact(s), s]));
      if (sentences.size !== 1) return d;
      const sentence = [...sentences.values()][0];
      if (!/(?:登録|入力)(?:し|する|します|した|して)/.test(sentence) ||
        /採番|生成|作成|作る|発行|未確認|不明|未定|予定|検討|しない|しません|していない|していません/.test(sentence)) return d;
      if (["create", "update"].includes(d.operation) && /登録(?:情報|記録|台帳)/.test(d.name) && !compact(sentence).includes(compact(d.name))) {
        changed = true;
        warnings.push(`${step.name}：${d.name}の名前と記録操作は、登録の説明からの推定です。原文に明示された記録名とは扱っていません。`);
        return d;
      }
      if (d.operation !== "create" || !/(?:番号|コード|氏名|利用者|利用者名|使用者|担当者)$/.test(d.name) || !compact(quote).includes(compact(d.name))) return d;
      changed = true;
      warnings.push(`${step.name}：${d.name}は登録に使う値として整理しました。値や人を新しく作ったとは扱っていません。`);
      return { ...d, operation: "read" as const };
    });
    return changed ? { ...step, data, certainty: "inferred" as const } : step;
  });
  return { ...review, steps, warnings: [...new Set(warnings)] };
}
