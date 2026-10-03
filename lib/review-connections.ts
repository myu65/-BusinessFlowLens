import type { ExtractionReview, LensGraph, Workflow } from "./graph";

// A stop is not a retry. A model-generated self-loop needs a literal source
// clause saying to repeat that action; otherwise its destination stays unknown.
// Run this on the model draft before preserving human corrections.
export function validateAITransitions<T extends ExtractionReview>(
  review: T,
  source: string,
): T {
  const compact = (text: string) =>
    text.normalize("NFKC").replace(/[\s「」『』]/g, "");
  const original = compact(source);
  const warnings = [...review.warnings],
    questions = [...review.questions];
  const repeat = /再試行|再実行|再確認|やり直|繰り返|もう一度|retry|repeat/i;
  const transitions = review.transitions.filter((t) => {
    if (t.fromStepKey !== t.toStepKey) return true;
    const evidence = compact(t.evidence);
    if (evidence && repeat.test(evidence) && original.includes(evidence))
      return true;
    const step = review.steps.find((s) => s.stepKey === t.fromStepKey);
    warnings.push(
      `${step?.name ?? "手順"}：原文で再実行を確認できないため、同じ手順へ戻る線を保留しました。手順や原文は残っています。`,
    );
    questions.push({
      question: `${t.condition || "この場合"}の後は、どの手順へ進む、戻る、または保留しますか？`,
      reason: `AIの再開先は未確認です。接続候補の根拠：${t.evidence}`,
      target: "exception",
    });
    return false;
  });
  return {
    ...review,
    transitions,
    warnings: [...new Set(warnings)],
    questions: [...new Map(questions.map((q) => [q.question, q])).values()],
  };
}

// A model can suggest a connection, but cannot authorize an invented catalog ID
// or cross the current/future boundary. Keep every rejected claim reviewable.
export function validateReviewConnections(
  review: ExtractionReview,
  graph: LensGraph,
  workflow: Workflow,
): ExtractionReview {
  const warnings = [...review.warnings],
    questions = [...review.questions];
  const workflows = new Map(
    graph.workflows
      .filter(
        (w) =>
          w.id !== workflow.id &&
          (w.scenario ?? "current") === (workflow.scenario ?? "current"),
      )
      .map((w) => [w.id, w]),
  );
  const stepExists = (id: string, key: string) =>
    graph.nodes.some(
      (n) =>
        n.kind === "process" &&
        n.workflowId === id &&
        n.canonicalKey.split(":").at(-1) === key,
    );
  const reject = (direction: string) => {
    warnings.push(
      `${direction}の業務を、表示中の状態の既存業務に対応づけられませんでした。接続は保存しません。`,
    );
    questions.push({
      question: `${direction}は、どの登録済み業務ですか？`,
      reason: "接続候補の業務IDや状態が一致しない",
      target: "handoff",
    });
  };
  return {
    ...review,
    handoffs: review.handoffs?.flatMap((h) => {
      if (!workflows.has(h.targetWorkflowId)) {
        reject("受渡し先");
        return [];
      }
      if (h.targetStepKey && !stepExists(h.targetWorkflowId, h.targetStepKey)) {
        warnings.push(
          "受渡し先の手順を対応づけられませんでした。業務への接続を残し、受取手順は未確認にしました。",
        );
        return [
          { ...h, targetStepKey: undefined, certainty: "unknown" as const },
        ];
      }
      return [h];
    }),
    incomingHandoffs: review.incomingHandoffs?.flatMap((h) => {
      if (!workflows.has(h.sourceWorkflowId)) {
        reject("受取元");
        return [];
      }
      if (h.sourceStepKey && !stepExists(h.sourceWorkflowId, h.sourceStepKey)) {
        warnings.push(
          "受取元の手順を対応づけられませんでした。業務への接続を残し、送出手順は未確認にしました。",
        );
        return [
          { ...h, sourceStepKey: undefined, certainty: "unknown" as const },
        ];
      }
      return [h];
    }),
    warnings: [...new Set(warnings)],
    questions: [...new Map(questions.map((q) => [q.question, q])).values()],
  };
}
