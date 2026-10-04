import type { ExtractionReview, ExtractionTransition, FollowUpAnswer, LensGraph, Workflow } from "./graph";
import { normalizeAssetName } from "./refinement";
import { sourceEvidence } from "./source-evidence";

// Cover a model omission only when one clause names the work, receipt/reference
// and Data, and one recorded output matches. This remains an inferred candidate.
export function suggestMissingSourceConnections<T extends ExtractionReview>(
  review: T, graph: LensGraph, workflow: Workflow, source: string,
): T {
  const incoming = [...(review.incomingHandoffs ?? [])];
  const questions = [...review.questions];
  const clauses = source.split(/[。\n]/).map(s => s.trim()).filter(Boolean);
  const literal = (text: string) => text.normalize("NFKC").replace(/[\s「」『』。]/g, "");
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const identities = new Map<string, Set<string>>();
  for (const node of graph.nodes.filter(n => n.kind === "data" && n.status !== "unknown"))
    for (const name of [node.label, ...(node.aliases ?? [])]) {
      const ids = identities.get(normalizeAssetName(name)) ?? new Set<string>();
      ids.add(node.id); identities.set(normalizeAssetName(name), ids);
    }
  const aliases = (name: string) => {
    const ids = identities.get(normalizeAssetName(name));
    const node = ids?.size === 1 ? nodes.get([...ids][0]) : undefined;
    return [...new Set([name, ...(node ? [node.label, ...(node.aliases ?? [])] : [])].map(normalizeAssetName))]
      .filter(alias => alias === normalizeAssetName(name) || identities.get(alias)?.size === 1);
  };
  const otherSources = [...graph.nodes.filter(n => n.kind === "system").flatMap(n => [n.label, ...(n.aliases ?? [])]),
    ...review.steps.flatMap(s => s.systems.map(t => t.name)), ...graph.workflows.map(w => w.name)]
    .filter(name => name.trim().length > 1).map(literal);
  const referenceInformation = (clause: string, workflowName: string) => {
    const text = literal(clause), name = literal(workflowName);
    const tail = text.slice(text.indexOf(name) + name.length);
    let end = tail.indexOf("を");
    if (end < 0) end = tail.length;
    // A named output joined with another system's information is not all from
    // that workflow: 'its label and MES's lot' has two different sources.
    for (const other of otherSources) {
      const boundary = tail.indexOf(`と${other}`);
      if (boundary >= 0) end = Math.min(end, boundary);
    }
    return normalizeAssetName(tail.slice(0, end));
  };
  const writers = new Map<string, Set<string>>();
  const creators = new Map<string, Set<string>>();
  const senders = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!["writes", "sends"].includes(edge.relation) || edge.status === "unknown") continue;
    const process = nodes.get(edge.source), data = nodes.get(edge.target);
    if (process?.kind !== "process" || !process.workflowId || process.status === "unknown" || data?.kind !== "data" || data.status === "unknown") continue;
    const outputs = writers.get(process.id) ?? new Set<string>();
    aliases(data.label).forEach(name => outputs.add(name));
    writers.set(process.id, outputs);
    if (edge.relation === "writes") {
      const written = creators.get(process.id) ?? new Set<string>();
      aliases(data.label).forEach(name => written.add(name));
      creators.set(process.id, written);
    }
    if (edge.relation === "sends") {
      const sent = senders.get(process.id) ?? new Set<string>();
      aliases(data.label).forEach(name => sent.add(name));
      senders.set(process.id, sent);
    }
  }
  const candidates = graph.workflows.filter(w => w.id !== workflow.id && w.name.trim().length > 1 &&
    (w.scenario ?? "current") === (workflow.scenario ?? "current"));
  for (const { step, datum } of review.steps.flatMap(step => step.data
    .filter(d => d.operation === "receive" || d.operation === "read")
    .map(datum => ({ step, datum })))) {
    if (incoming.some(h => h.toStepKey === step.stepKey && h.origin === "human")) continue;
    const isReceipt = datum.operation === "receive";
    const received = [datum.name];
    const stepEvidence = sourceEvidence(source, step.evidence) ?? step.evidence;
    const dataEvidence = sourceEvidence(source, datum.evidence);
    const fragments = [...step.evidence.matchAll(/[「『]([^」』]+)[」』]/g)].map(m => literal(m[1]));
    const quotedStep = fragments.length >= 2 && fragments.every(part => part.length >= 5) &&
      !step.evidence.replace(/[「『][^」』]+[」』]/g, "").replace(/[\s、,・/]/g, "");
    const belongsToStep = (clause: string) => {
      const text = literal(clause), evidence = literal(stepEvidence);
      if (text.includes(evidence) || evidence.includes(text)) return true;
      if (!quotedStep) return false;
      let after = 0;
      for (const part of fragments) {
        const at = text.indexOf(part, after);
        if (at < 0) return false;
        after = at + part.length;
      }
      return true;
    };
    if (incoming.some(h => h.toStepKey === step.stepKey && h.data.some(name => aliases(datum.name).includes(normalizeAssetName(name))))) continue;
    const verb = isReceipt ? /受け取|受領|受信/ : /読み込|読む|読ん|参照|確認/;
    const denied = isReceipt
      ? /受け取ら|受領しない|受信しない|受け取るか|受領するか|受信するか/
      : /読まな|読みません|読んでいな|読んでいません|読み込まな|読み込みません|読み込んでいな|読み込んでいません|(?:参照|確認)し(?:ない|ません|ていない|ていません|ておら)|(?:参照|確認)でき(?:ない|ません|ていない|ていません)|(?:読む|読み込む|参照する|参照できる|確認する|確認できる)か/;
    // A model can quote the start/end of a combined check separately and put
    // the actual read in this Data's own evidence. Keep that literal evidence
    // usable, but only inside the same grounded step clause.
    const groundedDataRead = dataEvidence && verb.test(dataEvidence) &&
      aliases(datum.name).some(name => normalizeAssetName(dataEvidence).includes(name));
    if (!received.length || (!verb.test(stepEvidence) && !groundedDataRead)) continue;
    const matches: Array<{ workflow: Workflow; processId: string; evidence: string }> = [];
    const named = new Map<string, string>();
    for (const candidate of candidates) {
      const evidence = clauses.find(clause =>
        clause.includes(candidate.name) && verb.test(clause) &&
        belongsToStep(clause) &&
        (verb.test(stepEvidence) || (groundedDataRead && literal(clause).includes(literal(dataEvidence!)))) &&
        !denied.test(clause) && !/後で説明|あとで説明|未確認|不明|分から/.test(clause) &&
        received.every(name => aliases(name).some(alias => referenceInformation(clause, candidate.name).includes(alias))),
      );
      if (!evidence) continue;
      named.set(candidate.id, candidate.name);
      for (const [processId, outputs] of isReceipt ? writers : creators) {
        if (nodes.get(processId)?.workflowId !== candidate.id ||
          !received.every(name => outputs.has(normalizeAssetName(name)))) continue;
        matches.push({ workflow: candidate, processId, evidence });
      }
    }
    if (!named.size) continue;
    // Receipt can identify a unique send even when an earlier step created the
    // same record. Two conditional sends remain ambiguous.
    const sentMatches = matches.filter(m => received.every(name => senders.get(m.processId)?.has(normalizeAssetName(name))));
    const preferred = isReceipt && sentMatches.length ? sentMatches : matches;
    if (preferred.length === 1 && named.size === 1) {
      const match = preferred[0];
      incoming.push({
        sourceWorkflowId: match.workflow.id,
        sourceStepKey: nodes.get(match.processId)!.canonicalKey.split(":").at(-1),
        toStepKey: step.stepKey, data: received, via: isReceipt ? "handoff" : "reference", origin: "ai",
        certainty: "inferred", evidence: match.evidence,
        description: isReceipt
          ? "原文の受取記述と、登録済み業務の出力を照らした接続候補です。作成元と送り出す手順を確認してください。"
          : "原文の参照記述と、登録済み業務で情報を作成・更新する手順を照らした参照候補です。作成元を確認してください。",
      });
    } else {
      questions.push({
        question: `${received.join("・")}は、${[...new Set(named.values())].join("／")}のどの手順${isReceipt ? "から受け取りますか" : "で作成・更新された情報を参照しますか"}？`,
        reason: `原文に${isReceipt ? "受取" : "参照"}元がありますが、対応する出力を一つに絞れません。名称だけで接続を確定していません。`,
        target: "handoff",
      });
    }
  }
  return { ...review, incomingHandoffs: incoming,
    questions: [...new Map(questions.map(q => [q.question, q])).values()] };
}

// A stop is not a retry. A model-generated self-loop needs a literal source
// clause saying to repeat that action; otherwise its destination stays unknown.
// Run this on the model draft before preserving human corrections.
export function validateAITransitions<T extends ExtractionReview>(
  review: T,
  source: string,
  answers: FollowUpAnswer[] = [],
): T {
  const compact = (text: string) =>
    text.normalize("NFKC").replace(/[\s「」『』]/g, "");
  const original = compact(source);
  const warnings = [...review.warnings],
    questions = [...review.questions];
  const repeat = /再試行|再実行|再確認|やり直|繰り返|もう一度|retry|repeat/i;
  const repair = (text: string) => {
    // Uncertainty about a later restart does not make the preceding repair
    // unknown. Only scope this specific "after repair, restart is unknown" form.
    const after = text.match(/(?:直した|修正した|調べた|調査した|切り分けた)後(?:に|、|は)/);
    const later = after ? text.slice(after.index! + after[0].length) : "";
    const scoped = after && /再開|再実行|再試行|再処理/.test(later) && /不明|分から|分かりません|未確認|未定/.test(later)
      ? text.slice(0, after.index! + after[0].length) : text;
    return /原因.{0,16}(?:調べ|調査|直|修正)|障害.{0,16}(?:調べ|調査|切り分け)/.test(scoped) &&
      !/(?:調べ|調査|修正)(?:ない|しない|ません|しません|しなかった)|直(?:さない|さず|さなかった|しません)|不明|分から|分かりません|未確認|未定/.test(scoped);
  };
  const heldSteps = review.steps.filter(s => s.meaning?.halt && s.meaning.condition);
  const directAnswers = answers.filter((a, i) => !a.reference && !a.referenceReading &&
    !answers.slice(i + 1).some(later => !later.reference && later.question === a.question));
  const responseWork = (text: string) => repair(text) ||
    (/条項.{0,16}調整/.test(text) && !/調整(?:しない|しません|していない|していません|せず|しなかった)|不明|分から|未確認|未定/.test(text));
  const completion = /確定|承認|完了|公開|納品|出荷|反映|再開|再実行|再試行|解除|配信/;
  const transitions = review.transitions.map<ExtractionTransition>(t => ({ ...t, holdEffect: undefined, evidence: sourceEvidence(source, t.evidence) ?? t.evidence })).filter((t) => {
    const step = review.steps.find((s) => s.stepKey === t.fromStepKey);
    const evidence = compact(t.evidence);
    const restart = evidence && original.includes(evidence) &&
      (repeat.test(evidence) || /解除|再開|戻す|戻る|resume|restart/i.test(evidence)) &&
      !/不明|分から|分かりません|未確認|unknown/i.test(evidence);
    const target = review.steps.find(s => s.stepKey === t.toStepKey);
    const statedContinuation = evidence && original.includes(evidence) &&
      /(?:回答|承認|許可|確認|修正|解消|完了).{0,10}(?:されたら|された後|を受け|後に|後、)/.test(evidence) &&
      !/不可|不許可|不承認|否認|不合格|不一致|失敗|未完了|不明|分から|未確認/.test(evidence);
    const continuedHold = target?.meaning?.halt && evidence && original.includes(evidence) &&
      /保留|停止/.test(evidence) && !/不明|分から|未確認/.test(evidence);
    const isHandoff = (text: string) =>
      /通知|連絡|依頼|渡す|引き継|照会|問い?合わせ|知らせ|報告|inform|request|handoff/i.test(text) &&
      !/(?:通知|連絡|依頼|照会|報告)(?:は|を)?しない|知らせない|渡さない|引き継がない|問い?合わせない/.test(text);
    const handover = evidence && original.includes(evidence) &&
      isHandoff(evidence) && isHandoff(target?.action ?? "");
    const targetEvidence = target && sourceEvidence(source, target.evidence);
    const preApprovalEvidence = sourceEvidence(source, t.evidence) ?? targetEvidence;
    const approves = !step?.meaning?.halt &&
      !/承認(?:しない|しません|しなかった|していない|していません)/.test(step?.action ?? "") &&
      /承認(?:する|します)[。]?\s*$|確認(?:し|して|した後|したら).{0,24}承認(?:し|する)/.test(step?.action ?? "");
    if (approves && preApprovalEvidence && /承認(?:する|の)?前/.test(preApprovalEvidence) &&
      !/前(?:ではない|ではなく|ではありません)|不明|分から|未確認/.test(preApprovalEvidence)) {
      warnings.push(`${step!.name}：承認前の作業が承認の後につながるため、この線を保留しました。確認と承認を分けて確かめられます。`);
      questions.push({ question: `${step!.name}の確認と承認を分け、承認前の作業をどこから始めますか？`,
        reason: `原文で承認前と説明されています。接続候補の根拠：${preApprovalEvidence}`, target: "rule" });
      return false;
    }
    // A direct answer may omit the question's "after approval is held" prefix.
    // Use that scope only for the sole grounded hold and the answer's first
    // stated response. The question is not a fact; retain an inferred edge
    // with literal endpoint quotes, never a fabricated combined quotation.
    const scopedResponse = step && target && heldSteps.length === 1 && heldSteps[0] === step &&
      sourceEvidence(source, step.evidence) && targetEvidence && responseWork(target.action) &&
      !completion.test(target.action) && directAnswers.some(a => {
        const question = compact(a.question);
        const topic = question.match(/([\p{Script=Han}\p{Script=Katakana}A-Za-z0-9ー]{2,})(?:を|が|は)(?:保留|停止|止め)/u)?.[1];
        const first = a.answer.split(/(?<=[。！？\n])/)[0].trim();
        return topic && /(?:保留|停止|止め)(?:した後|た後|中|している間)/.test(question) &&
          ["を保留", "を停止", "を止め", "が停止", "は停止"].some(verb => compact(step.evidence).includes(topic + verb)) &&
          !!sourceEvidence(first, target.evidence) && responseWork(compact(first)) &&
          !/別の|他の|不明|分から|未確認|未定|解除|再開|再実行|再試行|承認/.test(first);
      });
    // Two quoted clauses can support an inferred response after a stop, even
    // when joining those clauses would not be a literal source quotation.
    // Require a quote for each endpoint, in adjacent source sentences.
    const quotes = [...t.evidence.matchAll(/[「『]([^」』]+)[」』]/g)].map(m => compact(m[1]));
    const sourceStepEvidence = step && sourceEvidence(source, step.evidence);
    const sourceAt = sourceStepEvidence ? original.indexOf(compact(sourceStepEvidence)) : -1;
    const targetAt = targetEvidence ? original.indexOf(compact(targetEvidence)) : -1;
    const explicitWhileHeld = evidence && original.includes(evidence) && repair(evidence) &&
      /停止中|保留中|止まっている間/.test(evidence) && targetEvidence && compact(targetEvidence).includes(evidence) &&
      sourceStepEvidence && /保留|停止|止め|使用不可|隔離/.test(compact(sourceStepEvidence)) &&
      review.steps.filter(s => s.meaning?.halt && s.meaning.condition).length === 1;
    const sameHeldEpisode = sourceStepEvidence && targetEvidence &&
      /保留|停止|止め|使用不可|隔離/.test(compact(sourceStepEvidence)) &&
      sourceAt >= 0 && targetAt >= sourceAt &&
      (original.slice(sourceAt + compact(sourceStepEvidence).length, targetAt).match(/[。！？]/g)?.length ?? 0)
        <= (/[。！？]$/.test(compact(sourceStepEvidence)) ? 0 : 1);
    const quotedResponse = quotes.length === 2 &&
      !t.evidence.replace(/[「『][^」』]+[」』]/g, "").replace(/[\s、,・/]/g, "") &&
      quotes.every(q => q.length >= 5 && original.includes(q)) &&
      sourceStepEvidence && compact(sourceStepEvidence).includes(quotes[0]) &&
      targetEvidence && compact(targetEvidence).includes(quotes[1]) && repair(quotes[1]) &&
      original.indexOf(quotes[0]) < original.indexOf(quotes[1]) &&
      (original.slice(original.indexOf(quotes[0]) + quotes[0].length, original.indexOf(quotes[1])).match(/[。！？]/g)?.length ?? 0) <= 1;
    const exceptionResponse = (sameHeldEpisode && ((evidence && original.includes(evidence) && repair(evidence)) || quotedResponse) || explicitWhileHeld) &&
      targetEvidence && repair(compact(targetEvidence)) && repair(target?.action ?? "") &&
      !completion.test(target?.action ?? "");
    // A conditional check may have a normal path and a hold inside it. A step
    // executed only on the hold condition needs an explicit release to proceed.
    if (step?.meaning?.halt && step.meaning.condition && !restart && !statedContinuation && !continuedHold && !handover && !exceptionResponse && !scopedResponse) {
      warnings.push(`${step.name}：停止・保留の解除を原文で確認できないため、その先へ進む線を保留しました。`);
      questions.push({
        question: `${step.name}の後は、どの条件・判断で再開し、どの手順へ進みますか？`,
        reason: `AIの再開先は未確認です。接続候補の根拠：${t.evidence}`,
        target: "exception",
      });
      return false;
    }
    if (step?.meaning?.halt && step.meaning.condition) {
      t.holdEffect = scopedResponse ? "response" : restart || statedContinuation ? "resume" : continuedHold || handover || exceptionResponse ? "response" : undefined;
      if (scopedResponse) t.evidence = `「${sourceEvidence(source, step.evidence)}」「${targetEvidence}」`;
      if (scopedResponse || ((quotedResponse || explicitWhileHeld) && exceptionResponse)) t.certainty = "inferred";
    } else if (restart && sourceStepEvidence && targetEvidence && /再開|resume|restart/i.test(evidence)) {
      // The release may occur after response work, rather than directly at
      // the stopped step. Label an existing, source-grounded restart edge.
      t.holdEffect = "resume";
    }
    if (t.fromStepKey !== t.toStepKey) return true;
    if (evidence && repeat.test(evidence) && original.includes(evidence))
      return true;
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
  const handoffs = review.handoffs?.filter(h => {
    if (!h.data.length) return true;
    const step = review.steps.find(s => s.stepKey === h.fromStepKey);
    const outputs = new Set(step?.data
      .filter(d => ["create", "update", "send"].includes(d.operation))
      .map(d => normalizeAssetName(d.name)));
    if (h.data.every(name => outputs.has(normalizeAssetName(name)))) return true;
    warnings.push(`${step?.name ?? "手順"}：受渡し候補の情報が、この手順の出力と一致しないため接続を保留しました。`);
    questions.push({
      question: `${h.data.join("・")}を次の業務へ渡すのは、どの手順ですか？`,
      reason: `AIが選んだ送り出す手順は未確認です。候補の根拠：${h.evidence}`,
      target: "handoff",
    });
    return false;
  });
  return {
    ...review,
    transitions,
    handoffs,
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
  source?: string,
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
  const compact = (text: string) => text.normalize("NFKC").replace(/[\s「」『』]/g, "");
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const received = new Map<string, Set<string>>();
  if (source !== undefined) for (const edge of graph.edges) {
    if (edge.relation !== "reads" || edge.status === "unknown") continue;
    const process = nodes.get(edge.source), data = nodes.get(edge.target);
    if (process?.kind !== "process" || !workflows.has(process.workflowId ?? "") ||
        process.status === "unknown" || data?.kind !== "data" || data.status === "unknown") continue;
    const names = received.get(process.id) ?? new Set<string>();
    for (const name of [data.label, ...(data.aliases ?? [])]) names.add(normalizeAssetName(name));
    received.set(process.id, names);
  }
  const groundedTarget = (h: NonNullable<ExtractionReview["handoffs"]>[number]) => {
    if (source === undefined || h.origin === "human") return { certainty: h.certainty };
    const evidence = sourceEvidence(source, h.evidence);
    if (!evidence) return null;
    const text = compact(evidence);
    if (/未確認|特定でき|分から|分かりません|不明|渡さない|渡しません|渡していない|送らない|送りません|送っていない|引き継がない|依頼しない|依頼しません|通知しない|連絡しない/.test(text)) return null;
    const named = [...workflows.values()].filter(w => w.name.trim().length > 1 && text.includes(compact(w.name)));
    if (named.length) return named.length === 1 && named[0].id === h.targetWorkflowId
      ? { certainty: h.certainty } : null;
    if (!h.data.length || !h.data.every(name => normalizeAssetName(text).includes(normalizeAssetName(name)))) return null;
    const matching = new Set<string>();
    for (const [processId, names] of received) {
      const process = nodes.get(processId)!;
      const actor = compact(process.actor ?? "").replace(/担当(?:者)?$/, "");
      if (!actor || !h.data.every(name => names.has(normalizeAssetName(name)))) continue;
      const escaped = actor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match the recipient, not a sender elsewhere in the quote.
      if (new RegExp(`${escaped}(?:担当者?)?(?:へ|に)`).test(text)) matching.add(process.workflowId!);
    }
    return matching.size === 1 && matching.has(h.targetWorkflowId) ? { certainty: "inferred" as const } : null;
  };
  return {
    ...review,
    handoffs: review.handoffs?.flatMap((h) => {
      if (!workflows.has(h.targetWorkflowId)) {
        reject("受渡し先");
        return [];
      }
      const grounded = groundedTarget(h);
      if (!grounded) {
        const target = workflows.get(h.targetWorkflowId)!;
        warnings.push(`「${target.name}」を受渡し先とする根拠が一致しないため、接続を保留しました。送出の作業と情報は残っています。`);
        questions.push({ question: `${h.data.join("・") || "この仕事の結果"}は、どの登録済み業務の誰が受け取りますか？`,
          reason: `原文の名指し、または受取人と情報に対応する仕事を一つに特定できません。候補の根拠：${h.evidence}`,
          target: "handoff" });
        return [];
      }
      const targetProcess = h.targetStepKey && graph.nodes.find(n => n.kind === "process" &&
        n.workflowId === h.targetWorkflowId && n.canonicalKey.split(":").at(-1) === h.targetStepKey);
      const inputMatches = source === undefined || h.origin === "human" || !h.data.length ||
        (targetProcess && h.data.every(name => received.get(targetProcess.id)?.has(normalizeAssetName(name))));
      if (h.targetStepKey && (!stepExists(h.targetWorkflowId, h.targetStepKey) || !inputMatches)) {
        warnings.push(
          "受渡し先の手順と入力情報を対応づけられませんでした。業務への接続を残し、受取手順は未確認にしました。",
        );
        return [
          { ...h, targetStepKey: undefined, certainty: "unknown" as const },
        ];
      }
      return [{ ...h, certainty: grounded.certainty }];
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
