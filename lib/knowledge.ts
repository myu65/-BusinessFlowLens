import {
  processMatchesOwnership,
  type OwnershipFilter,
  type LensGraph,
  type LensNode,
  type WorkflowScenario,
} from "./graph";

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
  const q = query.trim().toLocaleLowerCase();
  const profiles = new Map(
    (graph.knowledge?.systems ?? []).map((s) => [s.systemId, s]),
  );
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
      const flows = graph.dataFlows.filter((f) =>
        f.workflowIds.includes(workflow.id),
      );
      const explicitAssets = graph.edges
        .filter(
          (e) =>
            e.workflowIds.includes(workflow.id) &&
            nodeById.get(e.source)?.kind !== "process" &&
            nodeById.get(e.target)?.kind !== "process",
        )
        .flatMap((e) => [e.source, e.target]);
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
      return { workflow, processes, assets, flows, capabilities, departments };
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
  const systemProfile = (id: string) => {
    const direct = rows.filter((r) => r.assets.some((n) => n.id === id));
    // Platform impact follows declared dependencies; it is kept separate from direct business use.
    const dependentIds = new Set<string>();
    let frontier = [id];
    while (frontier.length) {
      const next: string[] = [];
      for (const s of graph.knowledge?.systems ?? [])
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
      r.processes.filter((p) => assetsFor([p]).some((n) => n.id === id)),
    );
    const flows = graph.dataFlows.filter(
      (f) =>
        (f.sourceSystemId === id ||
          f.targetSystemId === id ||
          f.dataIds.includes(id)) &&
        f.workflowIds.some((w) => activeIds.has(w)),
    );
    return {
      direct,
      indirect,
      processes,
      flows,
      dependents: [...dependentIds]
        .map((s) => nodeById.get(s)!)
        .filter(Boolean),
      profile: graph.knowledge?.systems.find((s) => s.systemId === id),
    };
  };
  return {
    rows,
    activities,
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

export function compareWorkflow(graph: LensGraph, workflowId: string) {
  const workflow = graph.workflows.find((w) => w.id === workflowId);
  if (!workflow) return [];
  return graph.workflows
    .filter(
      (w) =>
        w.id !== workflowId &&
        (w.familyId ?? w.id) === (workflow.familyId ?? workflow.id),
    )
    .map((w) => {
      const a = knowledgeIndex(graph, workflow.scenario ?? "current").rows.find(
        (r) => r.workflow.id === workflowId,
      )!;
      const b = knowledgeIndex(graph, w.scenario ?? "current").rows.find(
        (r) => r.workflow.id === w.id,
      )!;
      return {
        workflow: w,
        removed: a.processes.filter(
          (p) => !b.processes.some((n) => n.label === p.label),
        ),
        added: b.processes.filter(
          (p) => !a.processes.some((n) => n.label === p.label),
        ),
        beforeManual: a.flows.filter((f) => f.automation === "manual").length,
        afterManual: b.flows.filter((f) => f.automation === "manual").length,
        beforeSystems: a.assets.filter((n) => n.kind === "system"),
        afterSystems: b.assets.filter((n) => n.kind === "system"),
      };
    });
}

export function knowledgeReport(
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
  const title = assetId
    ? (view.nodeById.get(assetId)?.label ?? "資産")
    : "会社の活動";
  const lines = [
    `# ${graph.knowledge?.name ?? "BusinessFlowLens"} — ${title}`,
    "",
    `対象: ${scope} / 検索: ${query || "すべて"} / 部署: ${department || "すべて"} / 業務数: ${rows.length}`,
    "",
    graph.knowledge?.description ?? "",
    "",
    "件数は登録された関係に基づく。未登録は依存がないことを意味しない。",
    "",
  ];
  if (assetId) {
    const impact = view.systemProfile(assetId);
    lines.push(
      `直接関連: ${impact.direct.length}業務 / 基盤依存を介した間接影響: ${impact.indirect.length}業務`,
      "",
      `役割: ${impact.profile?.purpose ?? "未登録"}`,
      `管理部署: ${impact.profile?.owner ?? "未登録"}`,
      "",
      "## System依存",
      ...(impact.profile?.dependsOn ?? []).map(
        (d) => `- ${view.nodeById.get(d.systemId)?.label}: ${d.reason}`,
      ),
      "",
      "## 入出力・転記",
      ...impact.flows.map(
        (f) =>
          `- ${view.nodeById.get(f.sourceSystemId)?.label} → ${view.nodeById.get(f.targetSystemId)?.label}: ${f.dataIds.map((d) => view.nodeById.get(d)?.label).join(" / ")} (${f.transferType}, ${f.automation})`,
      ),
      "",
      "## 間接影響の業務",
      ...impact.indirect.map((r) => `- ${r.workflow.name}`),
      "",
    );
  }
  for (const row of rows) {
    lines.push(
      `## ${row.workflow.name}`,
      row.workflow.description ?? "",
      `活動: ${row.capabilities.map((c) => `${c.activity.name} → ${c.capability.name}`).join(" / ") || "未分類"}`,
      `部署: ${row.departments.join(" / ")}`,
      `System: ${row.assets
        .filter((n) => n.kind === "system")
        .map((n) => n.label)
        .join(" / ")}`,
      `Data: ${row.assets
        .filter((n) => n.kind === "data")
        .map((n) => n.label)
        .join(" / ")}`,
      `重要性: ${graph.knowledge?.criticalWorkflows.find((w) => w.workflowId === row.workflow.id)?.reason ?? "未評価"}`,
      "",
      ...row.processes.map(
        (p) =>
          `- ${p.stepOrder}. ${p.label} (${p.executionMode ?? "unknown"})${p.executionContext ? ` / 起点: ${p.executionContext.trigger} / 判断: ${p.executionContext.rule} / 例外: ${p.executionContext.exception}` : ""}`,
      ),
      "",
      "受渡し:",
      ...row.flows.map(
        (f) =>
          `- ${view.nodeById.get(f.sourceSystemId)?.label} → ${view.nodeById.get(f.targetSystemId)?.label}: ${f.dataIds.map((d) => view.nodeById.get(d)?.label).join(" / ")} (${f.transferType}, ${f.automation})`,
      ),
      ...(graph.knowledge?.handoffs ?? [])
        .filter((h) => h.sourceWorkflowId === row.workflow.id)
        .map(
          (h) =>
            `次の業務: ${graph.workflows.find((w) => w.id === h.targetWorkflowId)?.name} / ${h.description} / ${h.kind}`,
        ),
      "",
      ...compareWorkflow(graph, row.workflow.id).map(
        (c) =>
          `比較: ${c.workflow.name} / 有効日: ${c.workflow.effectiveFrom ?? "未定"} / 手動転送 ${c.beforeManual} → ${c.afterManual} / 削除: ${c.removed.map((p) => p.label).join("、")} / 追加: ${c.added.map((p) => p.label).join("、")}`,
      ),
      "",
    );
  }
  return lines.join("\n");
}
