import {
  processMatchesOwnership,
  getProcessExecutionMode,
  type OwnershipFilter,
  type LensGraph,
  type LensNode,
  type WorkflowScenario,
} from "./graph";
import { inputSystemDependencies } from "./system-dependencies";
import { describeHumanEdit } from "./review-workbench";
import { connectionKindLabel, connectionRoleLabel } from "./knowledge-guide";

export type KnowledgeScope = WorkflowScenario;
export function scenarioGraph(
  graph: LensGraph,
  scope: KnowledgeScope,
  workflowId = "",
): LensGraph {
  const workflows = graph.workflows.filter(
    (w) =>
      (w.scenario ?? "current") === scope &&
      (!workflowId || w.id === workflowId),
  );
  const ids = new Set(workflows.map((w) => w.id));
  const nodes = graph.nodes.filter(
    (n) => n.kind !== "process" || ids.has(n.workflowId!),
  );
  const nodeIds = new Set(nodes.map((n) => n.id));
  return {
    ...graph,
    workflows,
    nodes,
    edges: graph.edges
      .filter(
        (e) =>
          nodeIds.has(e.source) &&
          nodeIds.has(e.target) &&
          e.workflowIds.some((id) => ids.has(id)),
      )
      .map((e) => ({
        ...e,
        workflowIds: e.workflowIds.filter((id) => ids.has(id)),
      })),
    dataFlows: scopedDataFlows(graph, scope, workflowId),
  };
}
export function scopedDataFlows(
  graph: LensGraph,
  scope: KnowledgeScope,
  workflowId = "",
  ownership: OwnershipFilter = {},
) {
  const ids = new Set(
    graph.workflows
      .filter(
        (w) =>
          (w.scenario ?? "current") === scope &&
          (!workflowId || w.id === workflowId),
      )
      .map((w) => w.id),
  );
  const processes = new Map(
    graph.nodes
      .filter(
        (n) =>
          n.kind === "process" &&
          ids.has(n.workflowId!) &&
          processMatchesOwnership(n, ownership),
      )
      .map((n) => [n.id, n]),
  );
  return graph.dataFlows
    .filter(
      (f) =>
        f.workflowIds.some((id) => ids.has(id)) &&
        ((!ownership.department && !ownership.responsiblePerson) ||
          f.processIds.some((id) => processes.has(id))),
    )
    .map((f) => ({
      ...f,
      workflowIds: f.workflowIds.filter((id) => ids.has(id)),
      processIds: f.processIds.filter((id) => processes.has(id)),
    }));
}
export function aggregateDataFlows(flows: LensGraph["dataFlows"]) {
  const groups = new Map<
    string,
    { source: string; target: string; flowIds: string[]; manual: boolean }
  >();
  for (const f of flows) {
    const key = `${f.sourceSystemId}|${f.targetSystemId}`;
    const g = groups.get(key) ?? {
      source: f.sourceSystemId,
      target: f.targetSystemId,
      flowIds: [],
      manual: false,
    };
    g.flowIds.push(f.id);
    g.manual ||= f.automation === "manual" || f.transferType === "manual";
    groups.set(key, g);
  }
  return [...groups.entries()].map(([id, g]) => ({ id, ...g }));
}
export function knowledgeIndex(
  graph: LensGraph,
  scope: KnowledgeScope,
  query = "",
  department = "",
) {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const allWorkflows = graph.workflows.filter(
    (w) => (w.scenario ?? "current") === scope,
  );
  const allIds = new Set(allWorkflows.map((w) => w.id));
  const allProcesses = graph.nodes.filter(
    (n) => n.kind === "process" && allIds.has(n.workflowId!),
  );
  const edgesByProcess = new Map<string, typeof graph.edges>();
  for (const e of graph.edges)
    for (const id of [e.source, e.target]) {
      if (nodeById.get(id)?.kind !== "process") continue;
      const list = edgesByProcess.get(id) ?? [];
      list.push(e);
      edgesByProcess.set(id, list);
    }
  const processesByWorkflow = new Map<string, LensNode[]>();
  for (const n of allProcesses) {
    const list = processesByWorkflow.get(n.workflowId!) ?? [];
    list.push(n);
    processesByWorkflow.set(n.workflowId!, list);
  }
  const assetsFor = (processes: LensNode[]) =>
    [
      ...new Set(
        processes.flatMap((p) =>
          (edgesByProcess.get(p.id) ?? [])
            .filter(
              (e) =>
                e.relation !== "next" &&
                (!e.workflowIds.length ||
                  e.workflowIds.includes(p.workflowId!)),
            )
            .map((e) => (e.source === p.id ? e.target : e.source)),
        ),
      ),
    ]
      .map((id) => nodeById.get(id))
      .filter((n): n is LensNode => !!n && n.kind !== "process");
  const flowsByWorkflow = new Map<string, LensGraph["dataFlows"]>();
  for (const f of graph.dataFlows)
    for (const id of f.workflowIds) {
      const list = flowsByWorkflow.get(id) ?? [];
      list.push(f);
      flowsByWorkflow.set(id, list);
    }
  const assetEdgesByWorkflow = new Map<string, string[]>();
  for (const e of graph.edges)
    if (
      nodeById.get(e.source)?.kind !== "process" &&
      nodeById.get(e.target)?.kind !== "process"
    )
      for (const id of e.workflowIds) {
        const list = assetEdgesByWorkflow.get(id) ?? [];
        list.push(e.source, e.target);
        assetEdgesByWorkflow.set(id, list);
      }
  const assetsByProcess = new Map(
    allProcesses.map((p) => [p.id, assetsFor([p])]),
  );
  const q = query.trim().toLocaleLowerCase();
  const profiles = new Map(
    (graph.knowledge?.systems ?? []).map((s) => [s.systemId, s]),
  );
  const declarations = inputSystemDependencies(graph, allWorkflows.map(w => w.id));
  const declarationsByWorkflow = new Map<string, typeof declarations>();
  for (const d of declarations) {
    const list = declarationsByWorkflow.get(d.sourceWorkflowId) ?? [];
    list.push(d);
    declarationsByWorkflow.set(d.sourceWorkflowId, list);
    const existing = profiles.get(d.systemId) ?? { systemId: d.systemId, categoryId: "", purpose: "", owner: "", dependsOn: [] };
    if (existing.dependsOn.some(p => p.systemId === d.prerequisiteId)) continue;
    profiles.set(d.systemId, { ...existing, dependsOn: [...existing.dependsOn, { systemId: d.prerequisiteId, reason: d.reason, evidence: d.evidence, certainty: d.certainty, sourceWorkflowId: d.sourceWorkflowId, origin: d.origin }] });
  }
  const dependencyNames = new Map<string, string>();
  for (const system of graph.nodes.filter((n) => n.kind === "system")) {
    const seen = new Set<string>([system.id]);
    const queue = [system.id];
    while (queue.length) {
      const current = queue.pop()!;
      for (const d of profiles.get(current)?.dependsOn ?? [])
        if (!seen.has(d.systemId)) {
          seen.add(d.systemId);
          queue.push(d.systemId);
        }
    }
    dependencyNames.set(
      system.id,
      [...seen]
        .map((id) => {
          const n = nodeById.get(id);
          return `${n?.label ?? ""} ${(n?.aliases ?? []).join(" ")}`;
        })
        .join(" "),
    );
  }
  const rows = allWorkflows
    .map((workflow) => {
      const processes = (processesByWorkflow.get(workflow.id) ?? []).sort(
        (a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0),
      );
      const flows = flowsByWorkflow.get(workflow.id) ?? [];
      const explicitAssets = assetEdgesByWorkflow.get(workflow.id) ?? [];
      const assets = [
        ...new Map(
          [
            ...assetsFor(processes),
            ...[
              ...explicitAssets,
              ...flows.flatMap((f) => [
                f.sourceSystemId,
                f.targetSystemId,
                ...f.dataIds,
              ]),
            ]
              .map((id) => nodeById.get(id))
              .filter((n): n is LensNode => !!n),
          ].map((n) => [n.id, n]),
        ).values(),
      ];
      const capabilities =
        graph.knowledge?.activities.flatMap((a) =>
          a.capabilities
            .filter((c) => c.workflowIds.includes(workflow.id))
            .map((c) => ({ activity: a, capability: c })),
        ) ?? [];
      const departments = [
        ...new Set(
          processes.map((n) => n.department).filter((d): d is string => !!d),
        ),
      ];
      const systemDeclarations = declarationsByWorkflow.get(workflow.id) ?? [];
      return { workflow, processes, assets, flows, capabilities, departments, systemDeclarations };
    })
    .filter(
      (row) =>
        (!department || row.departments.includes(department)) &&
        (!q ||
          [
            row.workflow.name,
            row.workflow.description,
            row.workflow.landscape?.site,
            row.workflow.landscape?.productLabel,
            ...row.departments,
            ...row.processes.map((n) => `${n.label} ${n.action}`),
            ...row.assets.map(
              (n) => `${n.label} ${(n.aliases ?? []).join(" ")}`,
            ),
            ...row.systemDeclarations.map(d => `${nodeById.get(d.systemId)?.label} ${nodeById.get(d.prerequisiteId)?.label} ${d.reason}`),
            ...row.assets
              .filter((n) => n.kind === "system")
              .map((n) => dependencyNames.get(n.id)),
            ...row.capabilities.map(
              (c) => `${c.activity.name} ${c.capability.name}`,
            ),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(q)),
    );
  const activeIds = new Set(rows.map((r) => r.workflow.id));
  const activities = (graph.knowledge?.activities ?? [])
    .map((a) => ({
      ...a,
      capabilities: a.capabilities.map((c) => ({
        ...c,
        rows: rows.filter((r) => c.workflowIds.includes(r.workflow.id)),
      })),
    }))
    .map((a) => ({
      ...a,
      rows: rows.filter((r) =>
        a.capabilities.some((c) => c.workflowIds.includes(r.workflow.id)),
      ),
    }));
  const rowsByAsset = new Map<string, typeof rows>();
  for (const row of rows)
    for (const asset of row.assets) {
      const related = rowsByAsset.get(asset.id) ?? [];
      related.push(row);
      rowsByAsset.set(asset.id, related);
    }
  const calculateProfile = (id: string) => {
    const direct = rowsByAsset.get(id) ?? [];
    // Platform impact follows declared dependencies; it is kept separate from direct business use.
    const dependentIds = new Set<string>();
    let frontier = [id];
    while (frontier.length) {
      const next: string[] = [];
      for (const s of profiles.values())
        if (
          s.systemId !== id &&
          !dependentIds.has(s.systemId) &&
          s.dependsOn.some((d) => frontier.includes(d.systemId))
        ) {
          dependentIds.add(s.systemId);
          next.push(s.systemId);
        }
      frontier = next;
    }
    const indirect = rows.filter(
      (r) =>
        !direct.includes(r) && r.assets.some((n) => dependentIds.has(n.id)),
    );
    const processes = direct.flatMap((r) =>
      r.processes.filter((p) =>
        assetsByProcess.get(p.id)?.some((n) => n.id === id),
      ),
    );
    const flows = graph.dataFlows.filter(
      (f) =>
        (f.sourceSystemId === id ||
          f.targetSystemId === id ||
          f.dataIds.includes(id)) &&
        f.workflowIds.some((w) => activeIds.has(w)),
    );
    const stepUse = direct.filter((r) =>
      r.processes.some((p) =>
        assetsByProcess.get(p.id)?.some((n) => n.id === id),
      ),
    );
    const flowUse = direct.filter((r) =>
      r.flows.some((f) =>
        [f.sourceSystemId, f.targetSystemId, ...f.dataIds].includes(id),
      ),
    );
    return {
      direct,
      stepUse,
      flowUse,
      indirect,
      processes,
      flows,
      dependents: [...dependentIds]
        .map((s) => nodeById.get(s)!)
        .filter(Boolean),
      profile: profiles.get(id),
      declarations: declarations.filter(d => activeIds.has(d.sourceWorkflowId) && (d.systemId === id || d.prerequisiteId === id)),
    };
  };
  const profileCache = new Map<string, ReturnType<typeof calculateProfile>>();
  const systemProfile = (id: string) => {
    let profile = profileCache.get(id);
    if (!profile) {
      profile = calculateProfile(id);
      profileCache.set(id, profile);
    }
    return profile;
  };
  return {
    rows,
    activities,
    systemDeclarations: declarations.filter(d => activeIds.has(d.sourceWorkflowId)),
    assetsFor,
    nodeById,
    systemProfile,
    departments: [
      ...new Set(
        allProcesses.map((p) => p.department).filter((d): d is string => !!d),
      ),
    ].sort(),
  };
}

function comparisonRowsFor(graph: LensGraph) {
  return [
    ...new Set(graph.workflows.map((w) => w.scenario ?? "current")),
  ].flatMap((scope) => knowledgeIndex(graph, scope).rows);
}

function comparisonProcessKey(process: LensNode, workflowId: string) {
  const prefix = `process:${workflowId}:`;
  return process.canonicalKey.startsWith(prefix) ? process.canonicalKey.slice(prefix.length) : "";
}

function comparableProcess(graph: LensGraph, process: LensNode) {
  const resources = graph.edges.filter(e => ["uses", "executes", "reads", "writes"].includes(e.relation)
    && (e.source === process.id || e.target === process.id))
    .map(e => [e.relation, e.source === process.id ? e.target : e.source].join(":"))
    .sort();
  return { label: process.label, action: process.action, meaning: process.meaning,
    mode: process.executionMode, actor: process.actor, department: process.department,
    responsiblePerson: process.responsiblePerson, executionContext: process.executionContext, resources };
}

export function comparisonExecutor(graph: LensGraph, process: LensNode, edges = graph.edges) {
  const systems = edges.filter(e => e.relation === "executes" && e.target === process.id)
    .map(e => graph.nodes.find(n => n.id === e.source)?.label).filter(Boolean);
  const human = process.actor || "担当未確認";
  const mode = getProcessExecutionMode(graph, process);
  return mode === "automatic" ? systems.join(" / ") || "実行システム未確認"
    : mode === "mixed" ? `${human}${systems.length ? ` / ${systems.join(" / ")}` : " / 実行システム未確認"}` : human;
}

export const executionLabels = { manual: "人が行う", automatic: "システムが自動実行", mixed: "人と自動処理", unknown: "実行方法未確認" };
export const confidenceLabels = { confirmed: "確認済み", inferred: "推定", unknown: "未確認" };

export function comparisonResources(graph: LensGraph, process: LensNode, edges = graph.edges) {
  const labels = (relations: string[]) => [...new Set(edges
    .filter(e => relations.includes(e.relation) && (e.source === process.id || e.target === process.id))
    .map(e => graph.nodes.find(n => n.id === (e.source === process.id ? e.target : e.source))?.label)
    .filter((label): label is string => !!label))].sort().join(" / ") || "未登録";
  return { tools: labels(["uses", "executes"]), input: labels(["reads"]), output: labels(["writes"]) };
}

function comparisonEvidence(process: LensNode) {
  return [...new Set([process.meaning?.evidence, process.evidence].filter(Boolean))].join(" / ") || "未登録";
}

export function compareWorkflow(
  graph: LensGraph,
  workflowId: string,
  indexedRows?: ReturnType<typeof knowledgeIndex>["rows"],
) {
  const workflow = graph.workflows.find((w) => w.id === workflowId);
  if (!workflow) return [];
  const alternatives = graph.workflows.filter(
    (w) =>
      w.id !== workflowId &&
      (w.familyId ?? w.id) === (workflow.familyId ?? workflow.id),
  );
  if (!alternatives.length) return [];
  const rows = indexedRows ?? comparisonRowsFor(graph);
  const a = rows.find((r) => r.workflow.id === workflowId)!;
  return alternatives.map((w) => {
    const b = rows.find((r) => r.workflow.id === w.id)!;
    const matches = new Map<string, LensNode>();
    for (const process of a.processes) {
      const key = comparisonProcessKey(process, a.workflow.id);
      if (!key || a.processes.filter(n => comparisonProcessKey(n, a.workflow.id) === key).length !== 1) continue;
      const others = b.processes.filter(n => comparisonProcessKey(n, b.workflow.id) === key);
      if (others.length === 1) matches.set(process.id, others[0]);
    }
    const matchedAfter = new Set([...matches.values()].map(p => p.id));
    return {
      workflow: w,
      removed: a.processes.filter(p => !matches.has(p.id)),
      added: b.processes.filter(p => !matchedAfter.has(p.id)),
      correspondingSteps: a.processes.flatMap(p => matches.has(p.id) ? [{ before: p, after: matches.get(p.id)! }] : []),
      beforeManual: a.flows.filter((f) => f.automation === "manual").length,
      afterManual: b.flows.filter((f) => f.automation === "manual").length,
      beforeSystems: a.assets.filter((n) => n.kind === "system"),
      afterSystems: b.assets.filter((n) => n.kind === "system"),
      beforeOutcome: a.workflow.outcome,
      afterOutcome: b.workflow.outcome,
      resultChanges: a.processes.flatMap((p) => {
        const other = matches.get(p.id);
        return other && JSON.stringify(comparableProcess(graph, p)) !== JSON.stringify(comparableProcess(graph, other))
          ? [{ before: p, after: other }]
          : [];
      }),
    };
  });
}

export type KnowledgeReportSection = { id: string; title: string; body: string[] };
export type KnowledgeReportDocument = {
  title: string;
  introduction: string[];
  counts: { workflows: number; steps: number; tools: number; data: number };
  context: KnowledgeReportSection[];
  workflows: KnowledgeReportSection[];
};
const reportScopes = { current: "現在の仕事", future: "改善後の案", alternative: "別の案" };
const transferLabels = { api: "API連携", file: "ファイル", database: "データベース", message: "メッセージ",
  email: "メール", manual: "手で転記・受渡し", unknown: "受渡し方法は未確認" };
const reportQuote = (source?: string) => (source || "原文の根拠は未登録").split(/\r?\n/).map(line => `> ${line}`);

export function knowledgeReportDocument(
  graph: LensGraph,
  scope: KnowledgeScope,
  query: string,
  department: string,
  workflowIds?: string[],
  assetId?: string,
) {
  const view = knowledgeIndex(graph, scope, query, department);
  const rows = view.rows.filter(
    (r) => !workflowIds || workflowIds.includes(r.workflow.id),
  );
  const subject = assetId
    ? (view.nodeById.get(assetId)?.label ?? "資産")
    : "会社の活動";
  const assets = new Map(rows.flatMap(r => r.assets).map(n => [n.id, n]));
  for (const row of rows) for (const d of row.systemDeclarations) for (const id of [d.systemId, d.prerequisiteId]) {
    const node = view.nodeById.get(id); if (node) assets.set(id, node);
  }
  const selectedIds = new Set(rows.map(r => r.workflow.id));
  for (const node of graph.nodes) {
    if (node.kind !== "system" || assets.has(node.id)) continue;
    const impact = view.systemProfile(node.id);
    if (impact.indirect.some(r => selectedIds.has(r.workflow.id))) assets.set(node.id, node);
  }
  const counts = { workflows: rows.length, steps: rows.reduce((n, r) => n + r.processes.length, 0),
    tools: [...assets.values()].filter(n => n.kind === "system").length,
    data: [...assets.values()].filter(n => n.kind === "data").length };
  const activities = new Map<string, { name: string; workflows: Set<string> }>();
  for (const row of rows) for (const c of row.capabilities) {
    const activity = activities.get(c.activity.id) ?? { name: c.activity.name, workflows: new Set<string>() };
    activity.workflows.add(row.workflow.id); activities.set(c.activity.id, activity);
  }
  const introduction = [
    `対象: ${reportScopes[scope]} / 検索: ${query || "すべて"} / 部署: ${department || "すべて"} / 業務数: ${rows.length}`,
    "",
    graph.knowledge?.description ?? "",
    "",
    "件数は登録された関係に基づく。未登録は依存がないことを意味しない。",
    `概要: ${counts.workflows}業務 / ${counts.steps}手順 / 関係する道具${counts.tools}件 / 情報${counts.data}件。道具は手順・情報の受渡しと、その稼働を支える登録済みの基盤依存から数える。同じ道具は重複して数えない。`,
    "活動別の業務数。複数の活動に属する業務はそれぞれに数える。活動には入力からの整理案を含む。",
    ...[...activities.values()].map(a => `- ${a.name}: ${a.workflows.size}業務`),
    ...(rows.some(r => !r.capabilities.length) ? [`- 活動は未分類: ${rows.filter(r => !r.capabilities.length).length}業務`] : []),
    "",
  ];
  const context: KnowledgeReportSection[] = [], workflows: KnowledgeReportSection[] = [];
  const edgesByProcess = new Map<string, LensGraph["edges"]>();
  for (const edge of graph.edges) for (const id of [edge.source, edge.target]) if (view.nodeById.get(id)?.kind === "process") {
    const edges = edgesByProcess.get(id) ?? []; edges.push(edge); edgesByProcess.set(id, edges);
  }
  const resources = (p: LensNode) => comparisonResources(graph, p, edgesByProcess.get(p.id) ?? []);
  const executor = (p: LensNode) => comparisonExecutor(graph, p, edgesByProcess.get(p.id) ?? []);
  const flowDescription = (f: LensGraph["dataFlows"][number]) =>
    `- ${view.nodeById.get(f.sourceSystemId)?.label || "道具未確認"} ${f.direction === "bidirectional" ? "⇄" : "→"} ${view.nodeById.get(f.targetSystemId)?.label || "道具未確認"}: ${f.dataIds.map(d => view.nodeById.get(d)?.label).filter(Boolean).join(" / ") || "情報未確認"} / ${transferLabels[f.transferType]} / ${executionLabels[f.automation]} / ${ { push: "送り出す", pull: "取りに行く", bidirectional: "双方向", unknown: "取込みの方向は未確認" }[f.direction]} / 頻度: ${f.frequency || "未確認"} / 確かさ: ${confidenceLabels[f.status]} / 原文: ${f.evidence || "未登録"}`;
  if (assetId) {
    const impact = view.systemProfile(assetId);
    const ids = new Set(rows.map(r => r.workflow.id));
    const direct = impact.direct.filter(r => ids.has(r.workflow.id));
    const indirect = impact.indirect.filter(r => ids.has(r.workflow.id));
    const body = [
      `直接関連: ${direct.length}業務 / 基盤依存を介した間接影響: ${indirect.length}業務`,
      `直接関連の内訳: 手順で使う${impact.stepUse.filter(r => ids.has(r.workflow.id)).length}業務 / 受渡しで関わる${impact.flowUse.filter(r => ids.has(r.workflow.id)).length}業務。両方に含まれる業務は、直接関連の数では重複させない。`,
      "件数と受渡しは出力した業務の範囲。基盤依存の説明は、同じ表示状態の保存済み入力から読む。",
      "",
      `役割: ${impact.profile?.purpose || "未登録"}`,
      `管理部署: ${impact.profile?.owner || "未確認"}`,
      "",
      "### 稼働に必要な道具",
      ...(impact.profile?.dependsOn ?? []).map(
        (d) => `- ${view.nodeById.get(d.systemId)?.label}: ${d.reason}`,
      ),
      "",
      "### 依存を説明した入力",
      ...impact.declarations.map(d => `- ${view.nodeById.get(d.systemId)?.label} → ${view.nodeById.get(d.prerequisiteId)?.label}: ${d.reason} / 確かさ: ${confidenceLabels[d.certainty]} / 話: ${d.sourceWorkflowName} / 原文: ${d.evidence}`),
      "",
      "### 入出力・転記",
      ...impact.flows.filter(f => f.workflowIds.some(id => ids.has(id))).map(flowDescription),
      "",
      "### 基盤の依存を通じて影響する業務",
      ...indirect.map((r) => `- ${r.workflow.name}`),
      "",
    ];
    context.push({ id: assetId, title: `${subject}が支える仕事と依存`, body });
  }
  const comparisonRows = comparisonRowsFor(graph);
  for (const row of rows) {
    const comparisons = compareWorkflow(graph, row.workflow.id, comparisonRows);
    const body = [
      row.workflow.description ?? "",
      `活動: ${row.capabilities.map((c) => `${c.activity.name} → ${c.capability.name}`).join(" / ") || "未分類"}`,
      `部署: ${row.departments.join(" / ") || "未確認"}`,
      `担当: ${[...new Set(row.processes.map(p => p.actor).filter(Boolean))].join(" / ") || "未確認"}。部署とは分けて記録する。`,
      `始まるきっかけ: ${row.workflow.trigger || "未確認"}`,
      `完了する状態: ${row.workflow.outcome || "未確認"}`,
      `システム・道具: ${row.assets
        .filter((n) => n.kind === "system")
        .map((n) => n.label)
        .join(" / ") || "手順・受渡しの利用は未登録"}`,
      `情報: ${row.assets
        .filter((n) => n.kind === "data")
        .map((n) => n.label)
        .join(" / ") || "未登録"}`,
      `重要性: ${graph.knowledge?.criticalWorkflows.find((w) => w.workflowId === row.workflow.id)?.reason ?? "未評価"}`,
      "",
      ...row.systemDeclarations.map(d => `- 道具の依存: ${view.nodeById.get(d.systemId)?.label} → ${view.nodeById.get(d.prerequisiteId)?.label} / ${d.reason} / 確かさ: ${confidenceLabels[d.certainty]} / 原文: ${d.evidence}`),
      ...row.processes.flatMap((p, i) => [
        `### ${p.stepOrder ?? i + 1}. ${p.label}`, "",
        `- 担当・実行主体: ${executor(p)} / ${executionLabels[getProcessExecutionMode(graph, p)]}`,
        `- 部署: ${p.department || "未確認"}${p.responsiblePerson ? ` / 担当者: ${p.responsiblePerson}` : ""}`,
        `- 行うこと: ${p.action || p.description || "未確認"}`,
        `- 道具: ${resources(p).tools} / 受け取る情報: ${resources(p).input} / 残す情報: ${resources(p).output}`,
        `- 仕事の理由: ${p.meaning?.purpose || "未確認"}`,
        `- 判断の根拠: ${p.meaning?.basis || "未確認"}`,
        `- 結果: ${p.meaning?.result || "未確認"} / 次の仕事: ${p.meaning?.next || "未確認"}`,
        `- 条件: ${p.meaning?.condition || "未確認"}${p.meaning?.halt ? " / 停止・保留する" : ""}`,
        ...(p.executionContext ? [`- 実行のきっかけ: ${p.executionContext.trigger || "未確認"} / 判断・ルール: ${p.executionContext.rule || "未確認"} / 失敗・例外: ${p.executionContext.exception || "未確認"}`] : []),
        `- 手順の確かさ: ${confidenceLabels[p.status]} / 処理結果の確かさ: ${confidenceLabels[p.meaning?.certainty ?? "unknown"]}`,
        "原文:", ...reportQuote(p.evidence),
        ...(p.meaning?.evidence && p.meaning.evidence !== p.evidence ? ["結果の根拠:", ...reportQuote(p.meaning.evidence)] : []),
        ...(p.humanEdits ?? []).flatMap(edit => describeHumanEdit(edit).map(description => `- 人の訂正: ${description} / 根拠: ${edit.evidence || "未登録"}`)), "",
      ]),
      "",
      "### 条件と受渡し", "",
      ...graph.edges
        .filter(
          (e) =>
            e.relation === "next" && e.workflowIds.includes(row.workflow.id),
        )
        .map(
          (e) =>
            `- 接続: ${view.nodeById.get(e.source)?.label} → ${view.nodeById.get(e.target)?.label} / 条件: ${e.label || "順次"} / 確かさ: ${confidenceLabels[e.status ?? "unknown"]} / 根拠: ${e.evidence || "未登録"}`,
        ),
      ...row.flows.map(flowDescription),
      ...(graph.knowledge?.handoffs ?? [])
        .filter((h) => h.sourceWorkflowId === row.workflow.id)
        .map(
          (h) =>
            `${connectionRoleLabel(h)}: ${graph.workflows.find((w) => w.id === h.targetWorkflowId)?.name} / ${h.description} / ${connectionKindLabel(h)} / 確かさ: ${confidenceLabels[h.status ?? "unknown"]} / 原文: ${h.evidence || "未登録"}`,
        ),
      "",
      ...comparisons.map(
        (c) =>
          `比較: ${c.workflow.name} / 有効日: ${c.workflow.effectiveFrom ?? "未定"} / 登録された手動の受渡し ${c.beforeManual} → ${c.afterManual} / 除外する手順の候補: ${c.removed.map((p) => p.label).join("、") || "なし"} / 追加する手順の候補: ${c.added.map((p) => p.label).join("、") || "なし"}`,
      ),
      ...comparisons.flatMap((c) => [
        ...c.resultChanges.map(
          (x) =>
            `同じ手順の変更: ${x.before.label} → ${x.after.label} / 担当・実行主体: ${comparisonExecutor(graph, x.before)} → ${comparisonExecutor(graph, x.after)} / 実行方法: ${executionLabels[x.before.executionMode ?? "unknown"]} → ${executionLabels[x.after.executionMode ?? "unknown"]} / 結果: ${x.before.meaning?.result || "未確認"} → ${x.after.meaning?.result || "未確認"} / 次の仕事: ${x.before.meaning?.next || "未確認"} → ${x.after.meaning?.next || "未確認"} / 道具: ${comparisonResources(graph, x.before).tools} → ${comparisonResources(graph, x.after).tools} / 受け取る情報: ${comparisonResources(graph, x.before).input} → ${comparisonResources(graph, x.after).input} / 残す情報: ${comparisonResources(graph, x.before).output} → ${comparisonResources(graph, x.after).output} / 確かさ: ${confidenceLabels[x.before.meaning?.certainty ?? x.before.status]} → ${confidenceLabels[x.after.meaning?.certainty ?? x.after.status]} / 原文: ${comparisonEvidence(x.before)} → ${comparisonEvidence(x.after)} / 人の訂正: ${x.before.humanEdits?.length ?? 0}件 → ${x.after.humanEdits?.length ?? 0}件`,
        ),
        ...c.added.map(
          (p) =>
            `追加する処理の結果: ${p.label} / 理由: ${p.meaning?.purpose || "未確認"} / 根拠: ${p.meaning?.basis || "未確認"} / 結果: ${p.meaning?.result || "未確認"} / 次の仕事: ${p.meaning?.next || "未確認"} / 条件: ${p.meaning?.condition || "未確認"} / ${p.meaning?.halt ? "停止・保留" : ""} / 原文: ${p.meaning?.evidence || "未登録"}`,
        ),
        ...c.removed.map(
          (p) =>
            `除外する処理の結果: ${p.label} / 理由: ${p.meaning?.purpose || "未確認"} / 結果: ${p.meaning?.result || "未確認"} / 次の仕事: ${p.meaning?.next || "未確認"} / 原文: ${p.meaning?.evidence || "未登録"}`,
        ),
      ]),
      "",
      ...(comparisons.length ? ["比較は同じ業務から引き継いだ保存済み手順を対応づける。手動の受渡し件数は登録された道具間の線を数え、人の操作全体や未登録の受渡しを含まない。", ""] : []),
    ];
    workflows.push({ id: row.workflow.id, title: row.workflow.name, body });
  }
  return { title: `${graph.knowledge?.name ?? "BusinessFlowLens"} — ${subject}`, introduction, counts, context, workflows };
}

export function knowledgeReportText(document: KnowledgeReportDocument) {
  return [`# ${document.title}`, "", ...document.introduction,
    ...[...document.context, ...document.workflows].flatMap(section => [`## ${section.title}`, "", ...section.body, ""])].join("\n");
}

export function knowledgeReport(...args: Parameters<typeof knowledgeReportDocument>) {
  return knowledgeReportText(knowledgeReportDocument(...args));
}
