import {
  canonicalNodeId,
  getProcessAssetLinks,
  getWorkflowProcesses,
  type LensGraph,
  type LensNode,
  type ExtractionReview,
} from "./graph";

export type FlowAddition = {
  id: string;
  workflowId: string;
  afterStepId: string;
  note: string;
  nodes: LensNode[];
  edges: LensGraph["edges"];
  dataFlows: LensGraph["dataFlows"];
  stepIds: string[];
  warnings: string[];
};
const normalized = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase();
const escape = (value: string) => [...value].map(char => "\\^$.*+?()[]{}|".includes(char) ? "\\" + char : char).join("");

function insertionContext(graph: LensGraph, workflowId: string, afterStepId: string) {
  const steps = getWorkflowProcesses(graph, workflowId);
  const index = steps.findIndex(s => s.id === afterStepId);
  if (index < 0) throw new Error("接続先の業務・手順が見つかりません。");
  const outgoing = graph.edges.filter(e => e.relation === "next" && e.source === afterStepId && e.workflowIds.includes(workflowId));
  if (outgoing.length > 1) throw new Error("この手順は分岐しています。分岐後の手順で続きを追加してください。");
  const successor = steps[index + 1];
  if (outgoing[0] && outgoing[0].target !== successor?.id) throw new Error("この手順は別の手順へ分岐しています。接続先で続きを追加してください。");
  return {steps, index, successor, outgoing: outgoing[0]};
}

function mentions(text: string, graph: LensGraph) {
  const aliases: Record<string, string[]> = {
    "SAP S/4HANA": ["SAP"],
    "Microsoft Teams": ["Teams"],
    "Excel 部門計画表": ["Excel"],
    "Outlook / Mail / Calendar": ["Outlook", "Mail", "メール"],
    "Snowflake DWH": ["Snowflake"],
  };
  const found: Array<{ node: LensNode; name: string; position: number }> = [];
  for (const node of graph.nodes.filter((n) => n.kind === "system")) {
    const names = [
      node.label,
      ...(node.aliases ?? []),
      ...(aliases[node.label] ?? []),
    ].sort((a, b) => b.length - a.length);
    for (const name of names) {
      const match = new RegExp(
        `(?<![A-Za-z0-9])[「『]?${escape(name)}[」』]?(?=$|[\\s、。→はがでのへにかとを])`,
        "i",
      ).exec(text);
      if (match) {
        found.push({ node, name, position: match.index });
        break;
      }
    }
  }
  // An alias that resolves to multiple systems is not silently guessed.
  const specific = found.filter(f => !found.some(other => other.position === f.position && other.name.length > f.name.length));
  return specific
    .filter(
      (f) =>
        specific.filter(
          (other) =>
            other.position === f.position &&
            normalized(other.name) === normalized(f.name),
        ).length === 1,
    )
    .sort((a, b) => a.position - b.position);
}

export function reviewFlowNote(
  note: string,
  graph: LensGraph,
  workflowId: string,
): ExtractionReview {
  const review: ExtractionReview = {
    summary: "追加メモ",
    trigger: null,
    outcome: null,
    steps: [],
    transitions: [],
    dataFlows: [],
    questions: [],
    warnings: [],
  };
  const sentences = note
    .split(/[。\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length > 8)
    throw new Error(
      "一度に8文まで追加できます。少しずつ追加して確認してください。",
    );
  const knownData = new Set(
    getWorkflowProcesses(graph, workflowId).flatMap((p) =>
      getProcessAssetLinks(graph, p.id)
        .filter((l) => l.asset.kind === "data")
        .map((l) => l.asset.id),
    ),
  );
  for (const [i, text] of sentences.entries()) {
    const found = mentions(text, graph);
    const dataNames = [...text.matchAll(/[「『]([^」』]+)[」』]/g)]
      .filter(m => !/^(?:から|へ|で|が|は)/.test(text.slice((m.index ?? 0) + m[0].length)))
      .map((m) => m[1])
      .filter(
        (name) =>
          !found.some(
            (f) =>
              normalized(f.name) === normalized(name) ||
              normalized(f.node.label) === normalized(name),
          ),
      );
    if (!found.length && /から|へ/.test(text)) review.warnings.push("道具名が未登録・複数候補の場合は、原文だけを残し、接続先を推測していません。");
    const department =
      [...new Set(graph.nodes.map((n) => n.department).filter(Boolean))].find(
        (d) => text.includes(d!),
      ) ?? null;
    const actor =
      text.match(/^(.{1,30}?(?:担当者|担当|責任者))が/)?.[1] ?? null;
    const automaticSystem = found.find((f) =>
      new RegExp(`${escape(f.name)}[」』]?(?:が|は)自動`).test(text),
    );
    const manual = /手動|人が|担当(?:者)?が/.test(text);
    const mode =
      automaticSystem && manual
        ? "mixed"
        : automaticSystem
          ? "automatic"
          : manual
            ? "manual"
            : "unknown";
    const pair =
      found.length >= 2 &&
      text
        .slice(found[0].position + found[0].name.length, found[1].position)
        .match(/から|(?:が|は)自動/) &&
      /(?:に|へ)/.test(text.slice(found[1].position + found[1].name.length)) &&
      /送|渡|出力|転記|連携|取り込|コピー/.test(text);
    const stepKey = `note-${i}`;
    const resolveDataName = (name: string) => {
      const exact = graph.nodes.filter(
        (n) =>
          n.kind === "data" &&
          [n.label, ...(n.aliases ?? [])].some(
            (a) => normalized(a) === normalized(name),
          ),
      );
      if (exact.length === 1) return exact[0].label;
      const contextual = graph.nodes.filter(
        (n) =>
          n.kind === "data" && knownData.has(n.id) && n.label.endsWith(name),
      );
      return contextual.length === 1 ? contextual[0].label : name;
    };
    const names = [...new Set(dataNames.map(resolveDataName))];
    review.steps.push({
      stepKey,
      name: text,
      order: i + 1,
      actor,
      department,
      responsiblePerson: null,
      executionMode: mode,
      executingSystem: automaticSystem?.node.label ?? null,
      action: text,
      certainty: "inferred",
      evidence: text,
      systems: found.map((f) => ({
        name: f.node.label,
        interaction: "other",
        evidence: text,
      })),
      data: names.flatMap<ExtractionReview["steps"][number]["data"][number]>(
        (name) =>
          pair
            ? [
                { name, operation: "read" as const, evidence: text },
                { name, operation: "send" as const, evidence: text },
              ]
            : [
                {
                  name,
                  operation: (/作成|登録|更新|記録/.test(text)
                    ? "update"
                    : "read") as "update" | "read",
                  evidence: text,
                },
              ],
      ),
      detailSteps: [],
      technicalDetails: [],
    });
    if (pair && names.length)
      review.dataFlows.push({
        sourceSystem: found[0].node.label,
        targetSystem: found[1].node.label,
        data: names,
        transferType: /メール|Outlook|Mail/i.test(found[1].node.label)
          ? "email"
          : /API/i.test(text)
            ? "api"
            : mode === "manual" && /手動|転記|出力|コピー/.test(text)
              ? "manual"
              : "unknown",
        direction: "push",
        automation: mode,
        frequency: null,
        evidence: text,
        certainty: "inferred",
        relatedStepKeys: [stepKey],
      });
    if (!names.length)
      review.warnings.push(
        "名前が明示されていない情報は作っていません。情報名を「 」で囲むと接続できます。",
      );
    if (mode === "unknown")
      review.warnings.push("人の作業か自動処理かが未確認の手順があります。");
  }
  review.warnings = [...new Set(review.warnings)];
  return review;
}

export function planFlowAddition(
  graph: LensGraph,
  workflowId: string,
  afterStepId: string,
  note: string,
  id: string,
  review: ExtractionReview,
): FlowAddition {
  if (!graph.workflows.some(w => w.id === workflowId)) throw new Error("接続先の業務・手順が見つかりません。");
  insertionContext(graph, workflowId, afterStepId);
  if (review.steps.length > 16) throw new Error("追加する手順が多すぎます。メモを分けて追加してください。");
  const orderedKeys = review.steps.map(s => s.stepKey);
  if (new Set(orderedKeys).size !== orderedKeys.length) throw new Error("追加する手順を識別できませんでした。メモを分けて追加してください。");
  if (review.transitions.some(t => review.transitions.filter(other => other.fromStepKey === t.fromStepKey).length > 1 || orderedKeys.indexOf(t.fromStepKey) < 0 || orderedKeys.indexOf(t.toStepKey) !== orderedKeys.indexOf(t.fromStepKey) + 1)) throw new Error("分岐を含むメモは、業務入力で確認して追加してください。");
  const plan: FlowAddition = {
    id,
    workflowId,
    afterStepId,
    note,
    nodes: [],
    edges: [],
    dataFlows: [],
    stepIds: [],
    warnings: [...review.warnings],
  };
  const dataInWorkflow = new Set(
    getWorkflowProcesses(graph, workflowId).flatMap((p) =>
      getProcessAssetLinks(graph, p.id)
        .filter((l) => l.asset.kind === "data")
        .map((l) => l.asset.id),
    ),
  );
  const asset = (kind: "system" | "data", name: string) => {
    const matches = [...graph.nodes, ...plan.nodes].filter(
      (n) =>
        n.kind === kind &&
        [n.label, ...(n.aliases ?? [])].some(
          (a) => normalized(a) === normalized(name),
        ),
    );
    const contextual = matches.filter(
      (n) => kind === "system" || dataInWorkflow.has(n.id),
    );
    const existing =
      matches.length === 1
        ? matches[0]
        : contextual.length === 1
          ? contextual[0]
          : undefined;
    if (existing) return existing;
    if (matches.length > 1) {
      plan.warnings.push(
        `「${name}」は複数候補があるため、このメモの情報として分けています。`,
      );
    }
    const key = `${kind}:flow-note:${workflowId}:${normalized(name)}`;
    const node: LensNode = {
      id: canonicalNodeId(key),
      canonicalKey: key,
      kind,
      label: name,
      description: note,
      status: "inferred",
    };
    if (!plan.nodes.some((n) => n.id === node.id)) plan.nodes.push(node);
    return node;
  };
  const addEdge = (
    source: string,
    target: string,
    relation: LensGraph["edges"][number]["relation"],
  ) => {
    const key = `note-edge:${id}:${source}:${relation}:${target}`;
    if (!plan.edges.some((e) => e.id === key))
      plan.edges.push({
        id: key,
        source,
        target,
        relation,
        workflowIds: [workflowId],
        label: "追加メモに記載",
      });
  };
  const stepKeys = new Map<string, string>();
  for (const [i, step] of review.steps.entries()) {
    const key = `process:${workflowId}:addition:${id}:${i}`;
    const node: LensNode = {
      id: canonicalNodeId(key),
      canonicalKey: key,
      kind: "process",
      workflowId,
      label: step.name,
      description: step.action,
      action: step.action,
      status: "inferred",
      actor: step.actor ?? undefined,
      department: step.department ?? undefined,
      responsiblePerson: step.responsiblePerson ?? undefined,
      executionMode: step.executionMode,
      evidence: step.evidence,
      detailSteps: step.detailSteps,
      technicalDetails: step.technicalDetails,
      executionContext: step.executionContext,
    };
    plan.nodes.push(node);
    plan.stepIds.push(node.id);
    stepKeys.set(step.stepKey, node.id);
    for (const system of step.systems)
      addEdge(node.id, asset("system", system.name).id, "uses");
    if (step.executingSystem)
      addEdge(asset("system", step.executingSystem).id, node.id, "executes");
    for (const data of step.data)
      addEdge(
        node.id,
        asset("data", data.name).id,
        ["create", "update"].includes(data.operation)
          ? "writes"
          : data.operation === "send"
            ? "sends"
            : "reads",
      );
  }
  for (const [i, f] of review.dataFlows.entries()) {
    const processIds = f.relatedStepKeys
      .map((k) => stepKeys.get(k))
      .filter((k): k is string => !!k);
    if (!processIds.length) {
      plan.warnings.push("担当手順が未確認の受渡しは追加していません。");
      continue;
    }
    const source = asset("system", f.sourceSystem),
      target = asset("system", f.targetSystem);
    if (source.id === target.id) continue;
    plan.dataFlows.push({
      id: `note-flow:${id}:${i}`,
      sourceSystemId: source.id,
      targetSystemId: target.id,
      dataIds: f.data.map((name) => asset("data", name).id),
      workflowIds: [workflowId],
      processIds,
      transferType: f.transferType,
      automation: f.automation,
      direction: f.direction,
      frequency: f.frequency ?? undefined,
      evidence: f.evidence,
      status: "inferred",
    });
  }
  for (const transition of review.transitions) {
    const source = stepKeys.get(transition.fromStepKey)!, target = stepKeys.get(transition.toStepKey)!;
    addEdge(source, target, "next");
    const edge = plan.edges.find(e => e.source === source && e.target === target && e.relation === "next")!;
    edge.label = transition.condition ?? undefined;
  }
  if (!plan.stepIds.length)
    throw new Error("追加できる手順が見つかりませんでした。");
  return plan;
}

export function applyFlowAddition(
  graph: LensGraph,
  plan: FlowAddition,
): LensGraph {
  if (plan.stepIds.every((id) => graph.nodes.some((n) => n.id === id)))
    return graph;
  const {steps, index, successor: displaced, outgoing} = insertionContext(graph, plan.workflowId, plan.afterStepId);
  const ids = [
    ...steps.slice(0, index + 1).map((s) => s.id),
    ...plan.stepIds,
    ...steps.slice(index + 1).map((s) => s.id),
  ];
  const nodes = [
    ...graph.nodes,
    ...plan.nodes.filter((n) => !graph.nodes.some((g) => g.id === n.id)),
  ].map((n) =>
    n.kind === "process" && n.workflowId === plan.workflowId
      ? { ...n, stepOrder: ids.indexOf(n.id) + 1 }
      : n,
  );
  const edges = graph.edges.flatMap(e => {
    if (e.id !== outgoing?.id) return [e];
    const workflowIds = e.workflowIds.filter(w => w !== plan.workflowId);
    return workflowIds.length ? [{...e, workflowIds}] : [];
  });
  edges.push(...plan.edges);
  const chain = [
    plan.afterStepId,
    ...plan.stepIds,
    ...(displaced ? [displaced.id] : []),
  ];
  for (let i = 1; i < chain.length; i++) {
    if (edges.some(e => e.relation === "next" && e.source === chain[i-1] && e.target === chain[i] && e.workflowIds.includes(plan.workflowId))) continue;
    edges.push({
      id: `note-next:${plan.id}:${i}`,
      source: chain[i - 1],
      target: chain[i],
      relation: "next",
      workflowIds: [plan.workflowId],
      ...(i === 1 && outgoing?.label ? {label: outgoing.label} : {}),
    });
  }
  return {
    ...graph,
    nodes,
    edges,
    dataFlows: [...graph.dataFlows, ...plan.dataFlows],
  };
}
