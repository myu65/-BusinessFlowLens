import type { ExtractionQuestion, ExtractionReview, FollowUpAnswer, LensGraph, Workflow } from "./graph";
import { normalizeAssetName } from "./refinement";

export type QuestionReference = { workflow: Workflow; sourceNotes: string; score: number };

// A recorded connection and a shared topic find evidence to consult. They do
// not answer a question, remove it or confirm a field without review.
export function createQuestionReferenceFinder(graph: LensGraph, savedSources: Record<string, string>) {
  const workflows = new Map(graph.workflows.map((w, i) => [w.id, { workflow: w, index: i }]));
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const neighbors = new Map<string, Map<string, Set<string>>>();
  const connect = (id: string, peer: string, dataIds: string[]) => {
    if (id === peer) return;
    const peers = neighbors.get(id) ?? new Map<string, Set<string>>();
    const data = peers.get(peer) ?? new Set<string>();
    dataIds.forEach(dataId => { const name = nodes.get(dataId)?.label; if (name) data.add(name); });
    peers.set(peer, data);
    neighbors.set(id, peers);
  };
  for (const h of graph.knowledge?.handoffs ?? []) {
    connect(h.sourceWorkflowId, h.targetWorkflowId, h.dataIds);
    connect(h.targetWorkflowId, h.sourceWorkflowId, h.dataIds);
  }
  return (workflowId: string, question: ExtractionQuestion): QuestionReference[] => {
    const current = workflows.get(workflowId)?.workflow;
    if (!current) return [];
    const topic = normalizeAssetName(question.question);
    return [...(neighbors.get(workflowId) ?? [])].flatMap(([id, data]) => {
      const entry = workflows.get(id), sourceNotes = savedSources[id];
      if (!entry || !sourceNotes?.trim() ||
        (entry.workflow.scenario ?? "current") !== (current.scenario ?? "current")) return [];
      let score = [...data].filter(name => name.length > 1 && topic.includes(normalizeAssetName(name))).length * 50;
      if (entry.workflow.name.length > 1 && topic.includes(normalizeAssetName(entry.workflow.name))) score += 20;
      return score ? [{ ...entry, sourceNotes, score }] : [];
    }).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 3)
      .map(({ workflow, sourceNotes, score }) => ({ workflow, sourceNotes, score }));
  };
}

export function referenceAnswer(question: string, reference: QuestionReference): FollowUpAnswer {
  return { question, answer: reference.sourceNotes,
    reference: { workflowId: reference.workflow.id, workflowName: reference.workflow.name, usedAt: new Date().toISOString() } };
}

// Keep every snapshot in the stored history. Only the latest use of the same
// referenced story/question is evidence for re-reading after its source changes.
export function effectiveFollowUpAnswers(answers: FollowUpAnswer[]) {
  const superseded = new Set(answers.map(answer => answer.supersedes).filter(Boolean));
  const active = answers.filter(answer => answer.kind !== "deferred" && (!answer.id || !superseded.has(answer.id)));
  return active.filter((answer, i) => !answer.reference || !active.slice(i + 1).some(later =>
    later.question === answer.question && later.reference?.workflowId === answer.reference!.workflowId,
  ));
}

// This is an AI interpretation, not a replacement for the saved source. Keep
// only readings whose quotes occur literally in that source snapshot.
export function groundedReferenceReading(
  answer: FollowUpAnswer,
  reading: Partial<NonNullable<FollowUpAnswer["referenceReading"]>>,
): NonNullable<FollowUpAnswer["referenceReading"]> {
  const proposed = Array.isArray(reading.facts) ? reading.facts : [];
  const facts = proposed.filter(fact => typeof fact.text === "string" && fact.text.trim() && Array.isArray(fact.evidence) && fact.evidence.length &&
    fact.evidence.every(quote => typeof quote === "string" && quote.trim().length >= 4 && answer.answer.includes(quote.trim())) &&
    ["explicit", "inferred"].includes(fact.certainty));
  const rejected = facts.length !== proposed.length;
  return { version: reading.version, model: reading.model ?? "", completedAt: reading.completedAt ?? new Date().toISOString(), facts,
    unanswered: [...new Set([...(Array.isArray(reading.unanswered) ? reading.unanswered : []).filter(text => typeof text === "string" && text.trim()),
      ...(rejected ? ["原文の引用で支えられない補足の読取がありました。確認事項の回答は未確認です。"] : []),
      ...(!facts.length ? ["この確認事項への回答を、補足元の原文から確認できませんでした。"] : []),
    ])] };
}

export function referencePromptAnswer(answer: FollowUpAnswer): FollowUpAnswer {
  if (!answer.reference || !answer.referenceReading) return answer;
  const reading = groundedReferenceReading(answer, answer.referenceReading);
  // Do not send the full neighboring narrative to the workflow extractor. The
  // snapshot remains in answer history and all quotes are checked against it.
  return { question: answer.question, reference: answer.reference,
    answer: JSON.stringify({ kind: "AI reading of another workflow for this question only; not original transcript", facts: reading.facts.map(f => ({ text: f.text, certainty: f.certainty })),
      unanswered: reading.unanswered }) };
}

export function referenceSourceClauses(source: string) {
  return source.split(/(?<=[。、\n])/).map(text => text.trim()).filter(Boolean);
}

// A reference explains the neighboring work. Its internal transfers do not
// become transfers of this workflow simply because the model read them.
export function scopeReferenceDataFlows<T extends ExtractionReview>(
  review: T, graph: LensGraph, workflowId: string, interview: string, answers: FollowUpAnswer[],
): T {
  const references = effectiveFollowUpAnswers(answers).filter(a => a.reference);
  if (!references.length) return review;
  const primary = normalizeAssetName([interview, ...effectiveFollowUpAnswers(answers).filter(a => !a.reference).map(a => a.answer)].join("\n"));
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const matchesName = (id: string, name: string) => [nodes.get(id)?.label, ...(nodes.get(id)?.aliases ?? [])]
    .some(label => label && normalizeAssetName(label) === normalizeAssetName(name));
  const matchesFlow = (flow: LensGraph["dataFlows"][number], proposed: T["dataFlows"][number]) =>
    matchesName(flow.sourceSystemId, proposed.sourceSystem) && matchesName(flow.targetSystemId, proposed.targetSystem) &&
    proposed.data.every(name => flow.dataIds.some(id => matchesName(id, name)));
  const warnings = [...review.warnings], questions = [...review.questions];
  const dataFlows = review.dataFlows.filter(flow => {
    // Keep a transfer already recorded in this workflow, or stated in its own
    // source. Merely mentioning one shared Data name is not transfer evidence.
    if (graph.dataFlows.some(saved => saved.workflowIds.includes(workflowId) && matchesFlow(saved, flow))) return true;
    const evidence = normalizeAssetName(flow.evidence);
    if (evidence && primary.includes(evidence) && evidence.includes(normalizeAssetName(flow.sourceSystem)) &&
      evidence.includes(normalizeAssetName(flow.targetSystem))) return true;
    const related = review.steps.filter(s => !flow.relatedStepKeys.length || flow.relatedStepKeys.includes(s.stepKey));
    const systems = new Set(related.flatMap(s => [s.executingSystem, ...s.systems.map(system => system.name)])
      .filter((name): name is string => !!name).map(normalizeAssetName));
    const data = new Set(related.flatMap(s => s.data.map(d => normalizeAssetName(d.name))));
    if (systems.has(normalizeAssetName(flow.sourceSystem)) && systems.has(normalizeAssetName(flow.targetSystem)) &&
      flow.data.every(name => data.has(normalizeAssetName(name)))) return true;
    const owners = references.filter(a => graph.dataFlows.some(saved =>
      saved.workflowIds.includes(a.reference!.workflowId) && matchesFlow(saved, flow)));
    const transfer = `${flow.sourceSystem} → ${flow.targetSystem}（${flow.data.join("・")}）`;
    if (owners.length) {
      warnings.push(`補足元「${[...new Set(owners.map(a => a.reference!.workflowName))].join("／") }」の${transfer}は、この業務の手順に対応しないため、内部のデータフローに含めませんでした。補足元の業務から確認できます。`);
    } else {
      warnings.push(`${transfer}を行う手順を、この業務の中に対応づけられませんでした。データフローを保留しています。`);
      questions.push({ question: `${transfer}の操作は、この業務のどの手順ですか。それとも補足元の別の業務ですか？`,
        reason: `補足元の処理を取り込んだ可能性があります。候補の根拠：${flow.evidence}`, target: "scope" });
    }
    return false;
  });
  return { ...review, dataFlows, warnings: [...new Set(warnings)],
    questions: [...new Map(questions.map(q => [q.question, q])).values()] };
}
