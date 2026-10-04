import type { ExtractionReview, LensGraph, ReviewSystemDependency } from "./graph";
import { normalizeAssetName } from "./asset-identity";
import { sourceEvidence } from "./source-evidence";

const compact = (s: string) => s.normalize("NFKC").replace(/[\s「」『』]/g, "").toLowerCase();
const pair = (d: ReviewSystemDependency) => `${compact(d.system)}\0${compact(d.prerequisite)}`;
const uncertain = /未確認|不明|分から|未定|かもしれ|とは限|予定|検討|使わない|使いません|使っていない|使っていません|利用しない|利用しません|依存しない|依存しません|不要|必要ない|認証しない|unknown|unclear|planned|maydepend|coulddepend|doesnot|donot/;

// A narrow source check, not a general dependency parser. A co-mention or
// transfer alone cannot establish which system needs which prerequisite.
export function groundedDependency(d: ReviewSystemDependency, source: string) {
  const quote = sourceEvidence(source, d.evidence);
  if (!quote || !d.system.trim() || !d.prerequisite.trim() || pair(d).split("\0")[0] === pair(d).split("\0")[1]) return false;
  const sentences = new Map(source.split(/(?<=[。！？\n])/).filter(s => compact(s).includes(compact(quote))).map(s => [compact(s), s]));
  if (sentences.size !== 1) return false;
  const text = compact([...sentences.values()][0]), system = compact(d.system), prerequisite = compact(d.prerequisite);
  if (uncertain.test(text)) return false;
  const start = text.indexOf(system), end = text.indexOf(prerequisite);
  if (start < 0 || end <= start + system.length) return false;
  const between = text.slice(start + system.length, end), tail = text.slice(end + prerequisite.length);
  if (/[。！？\n]|から|へ送|へ渡|入力し|登録し|確認し|承認し/.test(between)) return false;
  if (/と一緒|とともに|併用|から|へ送|へ渡|受信|受け取|(?:ログ|記録|ファイル|一覧|結果)を(?:使|利用|確認|参照)/.test(tail)) return false;
  return (/(?:は|には|のログイン|の認証|の接続|の動作|の稼働|を動かす)/.test(between) &&
    /依存|使[いうっ]|利用|必要|認証(?:し|する)|接続(?:し|する)/.test(tail)) || /dependson|requires|authenticatesusing/.test(between);
}

export function validateSystemDependencies(review: ExtractionReview, source: string, allowHuman = true): ExtractionReview {
  const questions = [...review.questions], warnings = [...review.warnings];
  const dependencies = (review.systemDependencies ?? []).map(raw => {
    const d = allowHuman ? raw : { ...raw, origin: "ai" as const, rejected: undefined, humanEdits: undefined };
    if (d.origin === "human" || d.rejected || d.certainty === "unknown") return d;
    if (groundedDependency(d, source)) return { ...d, origin: "ai" as const };
    const question = `${d.system}が${d.prerequisite}を必要とする関係と、その理由を確認できますか？`;
    if (!questions.some(q => q.question === question)) questions.push({ question, reason: `入力の根拠から依存の向きを確認できません。候補の根拠：${d.evidence}`, target: "system" });
    warnings.push("原文で確認できないシステム依存は未確認に戻し、影響の集計に含めていません。");
    return { ...d, certainty: "unknown" as const, origin: "ai" as const };
  });
  return { ...review, systemDependencies: dependencies, questions, warnings: [...new Set(warnings)] };
}

// Supplement only named, literal dependencies that the model omitted. Never
// infer one from a product's usual architecture or from a co-mention.
export function supplementSourceDependencies<T extends ExtractionReview>(review: T, source: string, knownNames: string[] = []): T {
  const labels = [...review.steps.flatMap(s => [...s.systems.map(t => t.name), s.executingSystem ?? ""]),
    ...(review.systemProfiles ?? []).map(p => p.name),
    ...(review.systemDependencies ?? []).flatMap(d => [d.system, d.prerequisite]), ...knownNames];
  const names = [...new Map(labels.filter(n => n.trim()).map(n => [compact(n), n])).values()];
  const dependencies = [...(review.systemDependencies ?? [])], warnings = [...review.warnings];
  for (const sentence of source.split(/(?<=[。！？\n])/).map(s => s.trim()).filter(Boolean)) {
    const text = compact(sentence);
    // Do not split a named product into a shorter catalog name that happens
    // to be contained in it (for example SAP inside SAP S/4HANA).
    const mentions = names.filter(n => text.includes(compact(n))).filter(n =>
      !names.some(long => compact(long) !== compact(n) && compact(long).includes(compact(n)) && text.includes(compact(long))));
    for (const system of mentions) for (const prerequisite of mentions) {
      const candidate: ReviewSystemDependency = { system, prerequisite, evidence: sentence,
        reason: sentence, certainty: "confirmed", origin: "ai" };
      if (!groundedDependency(candidate, source)) continue;
      const existing = dependencies.findIndex(d => pair(d) === pair(candidate));
      if (existing >= 0) {
        const prior = dependencies[existing];
        if (prior.origin === "human" || prior.rejected || prior.certainty !== "unknown") continue;
        // A literal, unambiguous source statement can resolve the model's
        // uncertainty, but never override a human's excluded/corrected pair.
        dependencies[existing] = candidate;
      } else dependencies.push(candidate);
      warnings.push(`${system} → ${prerequisite}：原文に明示された道具の依存関係を補いました。`);
    }
  }
  return { ...review, systemDependencies: dependencies, warnings: [...new Set(warnings)] };
}

export function preserveSystemDependencies(next: ExtractionReview, previous: ExtractionReview) {
  const dependencies = [...(next.systemDependencies ?? [])];
  for (const human of previous.systemDependencies ?? []) {
    if (human.origin !== "human") continue;
    const index = dependencies.findIndex(d => pair(d) === pair(human));
    if (index >= 0) dependencies[index] = human;
    else dependencies.push(human);
  }
  return dependencies;
}

export function editSystemDependency(previous: ReviewSystemDependency, patch: Partial<ReviewSystemDependency>) {
  const changes = Object.entries(patch).filter(([field, after]) =>
    field === "rejected"
      ? Boolean(previous.rejected) !== Boolean(after)
      : JSON.stringify(previous[field as keyof ReviewSystemDependency]) !== JSON.stringify(after));
  return { ...previous, ...patch, origin: "human" as const, humanEdits: [...(previous.humanEdits ?? []), ...changes.map(([field, after]) => ({ field, before: previous[field as keyof ReviewSystemDependency], after, evidence: "利用者がシステム依存を訂正" }))] };
}

// Select declarations by scenario, rather than the department being explored.
// A recorded company platform may support another department's work.
export function inputSystemDependencies(graph: LensGraph, workflowIds: readonly string[]) {
  const scope = new Set(workflowIds);
  const identities = new Map<string, Set<string>>(), nodes = new Map(graph.nodes.map(n => [n.id, n]));
  for (const n of graph.nodes) if (n.kind === "system") for (const label of [n.label, ...(n.aliases ?? [])]) {
    const key = normalizeAssetName(label), ids = identities.get(key) ?? new Set<string>();
    ids.add(n.id); identities.set(key, ids);
  }
  const resolve = (name: string) => {
    const ids = identities.get(normalizeAssetName(name));
    return ids?.size === 1 ? nodes.get([...ids][0]) : undefined;
  };
  return graph.workflows.filter(w => scope.has(w.id)).flatMap(w =>
    (w.reviewContext?.systemDependencies ?? []).flatMap(d => {
      if (d.rejected || d.certainty === "unknown") return [];
      const system = resolve(d.system), prerequisite = resolve(d.prerequisite);
      if (!system || !prerequisite || system.id === prerequisite.id || system.status === "unknown" || prerequisite.status === "unknown") return [];
      return [{ systemId: system.id, prerequisiteId: prerequisite.id, reason: d.reason, evidence: d.evidence, certainty: d.certainty, sourceWorkflowId: w.id, sourceWorkflowName: w.name, origin: d.origin }];
    }));
}
