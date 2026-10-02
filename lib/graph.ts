export type NodeKind = "process" | "system" | "data";
export type Confidence = "confirmed" | "inferred" | "unknown";
export type Relation = "next" | "uses" | "reads" | "writes" | "sends";

export type Workflow = {
  id: string;
  name: string;
  description?: string;
};

export type LensNode = {
  id: string;
  canonicalKey: string;
  kind: NodeKind;
  label: string;
  description: string;
  status: Confidence;
  workflowId?: string;
  actor?: string;
  department?: string;
  responsiblePerson?: string;
  evidence?: string;
  stepOrder?: number;
  action?: string;
};

export type LensEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  relation: Relation;
  workflowIds: string[];
};

export type DataFlowTransferType =
  | "api"
  | "file"
  | "database"
  | "message"
  | "email"
  | "manual"
  | "unknown";

export type DataFlowDirection =
  | "push"
  | "pull"
  | "bidirectional"
  | "unknown";

export type DataFlowAutomation =
  | "automatic"
  | "manual"
  | "mixed"
  | "unknown";

export type SystemDataFlow = {
  id: string;
  sourceSystemId: string;
  targetSystemId: string;
  dataIds: string[];
  transferType: DataFlowTransferType;
  direction: DataFlowDirection;
  automation: DataFlowAutomation;
  frequency?: string;
  evidence?: string;
  status: Confidence;
  workflowIds: string[];
  processIds: string[];
};

export type LensGraph = {
  workflows: Workflow[];
  nodes: LensNode[];
  edges: LensEdge[];
  dataFlows: SystemDataFlow[];
};

export type GraphPatchNode = {
  canonicalKey: string;
  kind: NodeKind;
  label: string;
  description: string;
  status: Confidence;
  actor?: string | null;
  department?: string | null;
  responsiblePerson?: string | null;
  evidence?: string | null;
  stepOrder?: number | null;
  action?: string | null;
};

export type GraphPatchEdge = {
  sourceKey: string;
  targetKey: string;
  relation: Relation;
  label?: string | null;
};

export type GraphPatchDataFlow = {
  sourceSystemKey: string;
  targetSystemKey: string;
  dataKeys: string[];
  transferType: DataFlowTransferType;
  direction: DataFlowDirection;
  automation: DataFlowAutomation;
  frequency?: string | null;
  evidence?: string | null;
  status: Confidence;
  relatedStepKeys: string[];
};

export type ExtractionQuestion = {
  question: string;
  reason: string;
  target:
    | "system"
    | "data"
    | "handoff"
    | "rule"
    | "owner"
    | "exception"
    | "scope";
};

export type ExtractionReviewStep = {
  stepKey: string;
  name: string;
  order: number;
  actor: string | null;
  department: string | null;
  responsiblePerson: string | null;
  action: string;
  certainty: "explicit" | "inferred";
  evidence: string;
  systems: Array<{
    name: string;
    interaction:
      | "view"
      | "search"
      | "input"
      | "approve"
      | "send"
      | "receive"
      | "other";
    evidence: string;
  }>;
  data: Array<{
    name: string;
    operation: "read" | "create" | "update" | "send" | "receive";
    evidence: string;
  }>;
};

export type ExtractionDataFlow = {
  sourceSystem: string;
  targetSystem: string;
  data: string[];
  transferType: DataFlowTransferType;
  direction: DataFlowDirection;
  automation: DataFlowAutomation;
  frequency: string | null;
  evidence: string;
  certainty: "explicit" | "inferred";
  relatedStepKeys: string[];
};

export type ExtractionTransition = {
  fromStepKey: string;
  toStepKey: string;
  condition: string | null;
  evidence: string;
};

export type ExtractionReview = {
  summary: string;
  trigger: string | null;
  outcome: string | null;
  steps: ExtractionReviewStep[];
  transitions: ExtractionTransition[];
  dataFlows: ExtractionDataFlow[];
  questions: ExtractionQuestion[];
  warnings: string[];
};

export type GraphPatch = {
  nodes: GraphPatchNode[];
  edges: GraphPatchEdge[];
  dataFlows: GraphPatchDataFlow[];
  questions: string[];
};

export type ExtractionResult = {
  patch: GraphPatch;
  review: ExtractionReview;
};

export const SAMPLE_WORKFLOWS = [
  {
    id: "order",
    name: "受注業務",
    description: "注文書を受け取って出荷手配へつなぐ業務",
    transcript: `営業がメールで注文書を受け取ります。
内容を確認したあと、まずExcelの受注管理表に入力して、その後ERPにも同じ内容を登録しています。
ERPで受注登録したあと在庫を確認します。在庫が足りなければ生産管理に連絡します。
在庫があれば出荷手配に進みます。`,
  },
  {
    id: "return",
    name: "返品対応",
    description: "返品依頼を受けて元受注を確認し、返品受付を行う業務",
    transcript: `カスタマーサポートがメールで返品依頼を受け付けます。
ERPで元の受注データを検索して、対象の顧客と商品を確認します。
返品可能ならERPに返品受付を登録し、倉庫へ受け入れを依頼します。
倉庫では在庫情報を更新します。`,
  },
] as const;

export const lanePositions = {
  process: { y: 110, x: [210, 510, 810, 1110, 1410] },
  system: { y: 365, x: [210, 480, 750, 1020, 1290] },
  data: { y: 620, x: [250, 600, 950, 1300] },
} as const;

function nodeId(canonicalKey: string) {
  return canonicalKey.replace(/[^a-zA-Z0-9:_-]+/g, "-");
}

function edgeId(source: string, target: string, relation: Relation) {
  return `${source}--${relation}--${target}`;
}

function betterStatus(a: Confidence, b: Confidence): Confidence {
  const score: Record<Confidence, number> = {
    unknown: 0,
    inferred: 1,
    confirmed: 2,
  };
  return score[b] > score[a] ? b : a;
}

export function emptyGraph(): LensGraph {
  return {
    workflows: SAMPLE_WORKFLOWS.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    nodes: [],
    edges: [],
    dataFlows: [],
  };
}

export function replaceWorkflowGraph(
  graph: LensGraph,
  workflow: Workflow,
  patch: GraphPatch,
): LensGraph {
  const existingWorkflow = graph.workflows.some((item) => item.id === workflow.id);
  const workflows = existingWorkflow
    ? graph.workflows.map((item) => (item.id === workflow.id ? workflow : item))
    : [...graph.workflows, workflow];

  // Remove this workflow's previous process nodes and edge memberships while
  // preserving System/Data entities still used by other workflows.
  const priorProcessIds = new Set(
    graph.nodes
      .filter((node) => node.kind === "process" && node.workflowId === workflow.id)
      .map((node) => node.id),
  );

  const retainedEdges = graph.edges
    .filter(
      (edge) =>
        !priorProcessIds.has(edge.source) && !priorProcessIds.has(edge.target),
    )
    .map((edge) => ({
      ...edge,
      workflowIds: edge.workflowIds.filter((id) => id !== workflow.id),
    }))
    .filter((edge) => edge.workflowIds.length > 0);

  const nodes = graph.nodes
    .filter((node) => !priorProcessIds.has(node.id))
    .map((node) => ({ ...node }));

  const byKey = new Map(nodes.map((node) => [node.canonicalKey, node]));

  for (const patchNode of patch.nodes) {
    const canonicalKey =
      patchNode.kind === "process" &&
      !patchNode.canonicalKey.startsWith(`process:${workflow.id}:`)
        ? `process:${workflow.id}:${patchNode.canonicalKey.replace(/^process:/, "")}`
        : patchNode.canonicalKey;

    const existing = byKey.get(canonicalKey);

    if (existing) {
      existing.label = patchNode.label || existing.label;
      existing.description = patchNode.description || existing.description;
      existing.status = betterStatus(existing.status, patchNode.status);
      existing.actor = patchNode.actor ?? existing.actor;
      existing.department = patchNode.department ?? existing.department;
      existing.responsiblePerson =
        patchNode.responsiblePerson ?? existing.responsiblePerson;
      existing.evidence = patchNode.evidence ?? existing.evidence;
      existing.stepOrder = patchNode.stepOrder ?? existing.stepOrder;
      existing.action = patchNode.action ?? existing.action;
      continue;
    }

    const created: LensNode = {
      id: nodeId(canonicalKey),
      canonicalKey,
      kind: patchNode.kind,
      label: patchNode.label,
      description: patchNode.description,
      status: patchNode.status,
      workflowId: patchNode.kind === "process" ? workflow.id : undefined,
      actor: patchNode.actor ?? undefined,
      department: patchNode.department ?? undefined,
      responsiblePerson: patchNode.responsiblePerson ?? undefined,
      evidence: patchNode.evidence ?? undefined,
      stepOrder: patchNode.stepOrder ?? undefined,
      action: patchNode.action ?? undefined,
    };
    nodes.push(created);
    byKey.set(canonicalKey, created);
  }

  const edges = [...retainedEdges];

  for (const patchEdge of patch.edges) {
    const normalizeEndpoint = (key: string) => {
      if (byKey.has(key)) return key;
      const scoped = `process:${workflow.id}:${key.replace(/^process:/, "")}`;
      return byKey.has(scoped) ? scoped : key;
    };

    const sourceKey = normalizeEndpoint(patchEdge.sourceKey);
    const targetKey = normalizeEndpoint(patchEdge.targetKey);
    const source = byKey.get(sourceKey);
    const target = byKey.get(targetKey);

    if (!source || !target) continue;

    const id = edgeId(source.id, target.id, patchEdge.relation);
    const existing = edges.find((edge) => edge.id === id);
    if (existing) {
      if (!existing.workflowIds.includes(workflow.id)) {
        existing.workflowIds = [...existing.workflowIds, workflow.id];
      }
      if (patchEdge.label) existing.label = patchEdge.label;
      continue;
    }

    edges.push({
      id,
      source: source.id,
      target: target.id,
      relation: patchEdge.relation,
      label: patchEdge.label ?? undefined,
      workflowIds: [workflow.id],
    });
  }

  const usedNodeIds = new Set(
    edges.flatMap((edge) => [edge.source, edge.target]),
  );

  const retainedDataFlows = (graph.dataFlows ?? [])
    .map((flow) => ({
      ...flow,
      workflowIds: flow.workflowIds.filter((id) => id !== workflow.id),
      processIds: flow.processIds.filter((id) => !priorProcessIds.has(id)),
    }))
    .filter((flow) => flow.workflowIds.length > 0);

  const dataFlows = [...retainedDataFlows];

  for (const patchFlow of patch.dataFlows ?? []) {
    const source = byKey.get(patchFlow.sourceSystemKey);
    const target = byKey.get(patchFlow.targetSystemKey);
    if (!source || !target || source.kind !== "system" || target.kind !== "system") {
      continue;
    }

    const dataIds = patchFlow.dataKeys
      .map((key) => byKey.get(key))
      .filter((node): node is LensNode => Boolean(node && node.kind === "data"))
      .map((node) => node.id);

    const processIds = patchFlow.relatedStepKeys
      .map((key) => {
        const scopedKey = key.startsWith(`process:${workflow.id}:`)
          ? key
          : `process:${workflow.id}:${key.replace(/^process:/, "")}`;
        return byKey.get(scopedKey)?.id;
      })
      .filter((id): id is string => Boolean(id));

    const id = [
      source.id,
      target.id,
      patchFlow.transferType,
      [...dataIds].sort().join(","),
    ].join("--");

    const existing = dataFlows.find((flow) => flow.id === id);
    if (existing) {
      if (!existing.workflowIds.includes(workflow.id)) {
        existing.workflowIds = [...existing.workflowIds, workflow.id];
      }
      existing.processIds = [...new Set([...existing.processIds, ...processIds])];
      continue;
    }

    dataFlows.push({
      id,
      sourceSystemId: source.id,
      targetSystemId: target.id,
      dataIds,
      transferType: patchFlow.transferType,
      direction: patchFlow.direction,
      automation: patchFlow.automation,
      frequency: patchFlow.frequency ?? undefined,
      evidence: patchFlow.evidence ?? undefined,
      status: patchFlow.status,
      workflowIds: [workflow.id],
      processIds,
    });
  }

  const dataFlowNodeIds = new Set(
    dataFlows.flatMap((flow) => [
      flow.sourceSystemId,
      flow.targetSystemId,
      ...flow.dataIds,
    ]),
  );

  return {
    workflows,
    nodes: nodes.filter(
      (node) =>
        node.kind === "process" ||
        usedNodeIds.has(node.id) ||
        dataFlowNodeIds.has(node.id),
    ),
    edges,
    dataFlows,
  };
}

export function getNodeWorkflowIds(
  graph: LensGraph,
  node: LensNode,
): string[] {
  if (node.kind === "process" && node.workflowId) return [node.workflowId];

  const ids = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === node.id || edge.target === node.id) {
      for (const workflowId of edge.workflowIds) ids.add(workflowId);
    }
  }
  for (const flow of graph.dataFlows ?? []) {
    if (
      flow.sourceSystemId === node.id ||
      flow.targetSystemId === node.id ||
      flow.dataIds.includes(node.id)
    ) {
      for (const workflowId of flow.workflowIds) ids.add(workflowId);
    }
  }
  return [...ids];
}

export function sharedNodeIds(graph: LensGraph): Set<string> {
  return new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind !== "process" && getNodeWorkflowIds(graph, node).length > 1,
      )
      .map((node) => node.id),
  );
}

function localNode(
  canonicalKey: string,
  kind: NodeKind,
  label: string,
  description: string,
  status: Confidence,
  evidence: string,
  actor?: string,
): GraphPatchNode {
  return {
    canonicalKey,
    kind,
    label,
    description,
    status,
    evidence,
    actor,
  };
}

export function extractInterviewLocal(
  text: string,
  workflowId: string,
): GraphPatch {
  const normalized = text.replace(/\s+/g, " ");
  const has = (pattern: RegExp) => pattern.test(normalized);
  const nodes: GraphPatchNode[] = [];
  const edges: GraphPatchEdge[] = [];
  const dataFlows: GraphPatchDataFlow[] = [];
  const questions: string[] = [];

  const addNode = (node: GraphPatchNode) => {
    if (!nodes.some((item) => item.canonicalKey === node.canonicalKey)) {
      nodes.push(node);
    }
  };
  const addEdge = (edge: GraphPatchEdge) => {
    const key = `${edge.sourceKey}|${edge.relation}|${edge.targetKey}`;
    if (
      !edges.some(
        (item) =>
          `${item.sourceKey}|${item.relation}|${item.targetKey}` === key,
      )
    ) {
      edges.push(edge);
    }
  };

  const p = (slug: string) => `process:${workflowId}:${slug}`;

  if (has(/注文書|受注/) && workflowId !== "return") {
    addNode(
      localNode(
        p("receive-order"),
        "process",
        "注文書受領",
        "注文書を受け取り、受注処理を開始する。",
        "confirmed",
        "注文書または受注への明示的な言及",
        "営業",
      ),
    );
    addNode(
      localNode(
        "data:order-document",
        "data",
        "注文書",
        "顧客から受領する注文情報の原本。",
        "confirmed",
        "注文書への明示的な言及",
      ),
    );
    addEdge({
      sourceKey: "data:order-document",
      targetKey: p("receive-order"),
      relation: "sends",
      label: "受領",
    });
  }

  if (has(/返品/)) {
    addNode(
      localNode(
        p("receive-return"),
        "process",
        "返品依頼受付",
        "顧客からの返品依頼を受け付ける。",
        "confirmed",
        "返品依頼を受け付けるとの説明",
        "カスタマーサポート",
      ),
    );
  }

  if (has(/メール|email/i)) {
    addNode(
      localNode(
        "system:email",
        "system",
        "メール",
        "顧客や社内との連絡に使う共通チャネル。",
        "confirmed",
        "メールへの明示的な言及",
      ),
    );
    const target = has(/返品/) ? p("receive-return") : p("receive-order");
    if (nodes.some((node) => node.canonicalKey === target)) {
      addEdge({
        sourceKey: target,
        targetKey: "system:email",
        relation: "uses",
        label: "利用",
      });
    }
  }

  if (has(/内容.*確認|確認したあと/) && workflowId !== "return") {
    addNode(
      localNode(
        p("check-order"),
        "process",
        "内容確認",
        "注文内容に不足や誤りがないか確認する。",
        "confirmed",
        "内容確認が明示されている",
        "営業",
      ),
    );
    addEdge({
      sourceKey: p("receive-order"),
      targetKey: p("check-order"),
      relation: "next",
      label: "次へ",
    });
  }

  if (has(/Excel/i)) {
    addNode(
      localNode(
        "system:excel-order-sheet",
        "system",
        "Excel 受注管理表",
        "営業が受注内容を記録する表計算ファイル。",
        "confirmed",
        "Excelの受注管理表への入力が明示されている",
      ),
    );
    addNode(
      localNode(
        "data:order",
        "data",
        "受注データ",
        "注文内容を構造化した受注情報。",
        "inferred",
        "ExcelとERPへ同内容を入力する説明から推定",
      ),
    );
    const source = nodes.some((node) => node.canonicalKey === p("check-order"))
      ? p("check-order")
      : p("receive-order");
    addEdge({
      sourceKey: source,
      targetKey: "system:excel-order-sheet",
      relation: "uses",
      label: "手入力",
    });
    addEdge({
      sourceKey: "system:excel-order-sheet",
      targetKey: "data:order",
      relation: "writes",
      label: "記録",
    });
  }

  if (has(/ERP|SAP/i)) {
    const systemName = has(/SAP/i) ? "SAP" : "ERP";
    addNode(
      localNode(
        "system:erp",
        "system",
        systemName,
        "受注や返品など複数業務で利用する基幹システム。",
        "confirmed",
        `${systemName}への明示的な言及`,
      ),
    );
    addNode(
      localNode(
        "data:order",
        "data",
        "受注データ",
        "受注番号、顧客、商品、数量などの受注情報。",
        "confirmed",
        "ERP上の受注データへの言及",
      ),
    );

    if (has(/返品/)) {
      addNode(
        localNode(
          p("lookup-order"),
          "process",
          "元受注確認",
          "ERPで返品対象となる元の受注を検索して確認する。",
          "confirmed",
          "ERPで元の受注データを検索すると明示",
          "カスタマーサポート",
        ),
      );
      addEdge({
        sourceKey: p("receive-return"),
        targetKey: p("lookup-order"),
        relation: "next",
        label: "受付後",
      });
      addEdge({
        sourceKey: p("lookup-order"),
        targetKey: "system:erp",
        relation: "uses",
        label: "検索",
      });
      addEdge({
        sourceKey: "data:order",
        targetKey: p("lookup-order"),
        relation: "reads",
        label: "参照",
      });

      addNode(
        localNode(
          p("register-return"),
          "process",
          "返品受付登録",
          "返品可否を判断しERPへ返品受付を登録する。",
          "confirmed",
          "ERPへの返品受付登録が明示",
          "カスタマーサポート",
        ),
      );
      addEdge({
        sourceKey: p("lookup-order"),
        targetKey: p("register-return"),
        relation: "next",
        label: "返品可能",
      });
      addEdge({
        sourceKey: p("register-return"),
        targetKey: "system:erp",
        relation: "uses",
        label: "登録",
      });
    } else {
      const source = nodes.some(
        (node) => node.canonicalKey === "system:excel-order-sheet",
      )
        ? "system:excel-order-sheet"
        : nodes.some((node) => node.canonicalKey === p("check-order"))
          ? p("check-order")
          : p("receive-order");

      addEdge({
        sourceKey: source,
        targetKey: "system:erp",
        relation: "uses",
        label:
          source === "system:excel-order-sheet" ? "二重入力" : "受注登録",
      });
      addEdge({
        sourceKey: "system:erp",
        targetKey: "data:order",
        relation: "writes",
        label: "登録",
      });
    }
  }

  if (has(/顧客/)) {
    addNode(
      localNode(
        "data:customer",
        "data",
        "顧客データ",
        "顧客を特定するためのマスタ情報。",
        "inferred",
        "顧客確認の説明からデータの存在を推定",
      ),
    );
    if (nodes.some((node) => node.canonicalKey === "system:erp")) {
      addEdge({
        sourceKey: "system:erp",
        targetKey: "data:customer",
        relation: "reads",
        label: "参照",
      });
    }
  }

  if (has(/在庫/)) {
    addNode(
      localNode(
        "data:inventory",
        "data",
        "在庫データ",
        "商品の現在庫や引当状況を表す情報。",
        "inferred",
        "在庫確認・更新の説明から推定",
      ),
    );

    if (has(/更新/) && has(/返品/)) {
      addNode(
        localNode(
          p("update-inventory"),
          "process",
          "返品在庫更新",
          "返品された商品の在庫情報を更新する。",
          "confirmed",
          "倉庫で在庫情報を更新すると明示",
          "倉庫",
        ),
      );
      addEdge({
        sourceKey: p("register-return"),
        targetKey: p("update-inventory"),
        relation: "next",
        label: "倉庫へ依頼",
      });
      addEdge({
        sourceKey: p("update-inventory"),
        targetKey: "data:inventory",
        relation: "writes",
        label: "更新",
      });
    } else {
      addNode(
        localNode(
          p("check-inventory"),
          "process",
          "在庫確認",
          "受注数量を引き当て可能か確認する。",
          "confirmed",
          "在庫を確認すると明示",
          "営業",
        ),
      );
      addEdge({
        sourceKey: "system:erp",
        targetKey: p("check-inventory"),
        relation: "next",
        label: "登録後",
      });
      addEdge({
        sourceKey: "data:inventory",
        targetKey: p("check-inventory"),
        relation: "reads",
        label: "参照",
      });
    }

    if (has(/WMS/i)) {
      addNode(
        localNode(
          "system:wms",
          "system",
          "WMS",
          "在庫・倉庫管理システム。",
          "confirmed",
          "WMSへの明示的な言及",
        ),
      );
      addEdge({
        sourceKey: "system:wms",
        targetKey: "data:inventory",
        relation: "writes",
        label: "保持",
      });
    } else {
      questions.push("在庫情報は、どのシステムを正として管理していますか？");
    }
  }

  if (has(/出荷/) && workflowId !== "return") {
    addNode(
      localNode(
        p("arrange-shipping"),
        "process",
        "出荷手配",
        "在庫が確保できた受注を出荷工程へ渡す。",
        "confirmed",
        "出荷手配に進むと明示",
        "営業",
      ),
    );
    addEdge({
      sourceKey: p("check-inventory"),
      targetKey: p("arrange-shipping"),
      relation: "next",
      label: "在庫あり",
    });
    questions.push("出荷手配では、どのシステムや帳票を使いますか？");
  }

  if (
    nodes.some((node) => node.canonicalKey === "system:excel-order-sheet") &&
    nodes.some((node) => node.canonicalKey === "system:erp")
  ) {
    questions.unshift("ExcelとERPへの二重入力は、なぜ必要ですか？");
    dataFlows.push({
      sourceSystemKey: "system:excel-order-sheet",
      targetSystemKey: "system:erp",
      dataKeys: ["data:order"],
      transferType: "manual",
      direction: "push",
      automation: "manual",
      frequency: null,
      evidence: "Excelの受注管理表に入力して、その後ERPにも同じ内容を登録",
      status: "confirmed",
      relatedStepKeys: [
        nodes.some((node) => node.canonicalKey === p("check-order"))
          ? "check-order"
          : "receive-order",
      ],
    });
  }

  if (has(/メール|email/i)) {
    questions.push("メール受信後の担当者割り当てや引き継ぎはどうしていますか？");
  }

  return {
    nodes,
    edges,
    dataFlows,
    questions: [...new Set(questions)].slice(0, 4),
  };
}

export function createDemoGraph(): LensGraph {
  let graph = emptyGraph();

  for (const sample of SAMPLE_WORKFLOWS) {
    graph = replaceWorkflowGraph(
      graph,
      {
        id: sample.id,
        name: sample.name,
        description: sample.description,
      },
      extractInterviewLocal(sample.transcript, sample.id),
    );
  }

  // Give the credential-free demo enough ownership context to exercise
  // department/person filters without pretending these values came from AI.
  graph = {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind !== "process") return node;
      if (node.workflowId === "order") {
        return {
          ...node,
          department: "営業部",
          responsiblePerson: "営業担当A",
        };
      }
      if (node.actor === "倉庫") {
        return {
          ...node,
          department: "物流部",
          responsiblePerson: "倉庫担当A",
        };
      }
      return {
        ...node,
        department: "カスタマーサポート部",
        responsiblePerson: "CS担当A",
      };
    }),
  };

  const excel = graph.nodes.find(
    (node) => node.canonicalKey === "system:excel-order-sheet",
  );
  const erp = graph.nodes.find(
    (node) => node.canonicalKey === "system:erp",
  );
  const orderData = graph.nodes.find(
    (node) => node.canonicalKey === "data:order",
  );
  const orderProcesses = graph.nodes
    .filter(
      (node) => node.kind === "process" && node.workflowId === "order",
    )
    .map((node) => node.id);

  if (excel && erp && orderData) {
    graph = {
      ...graph,
      dataFlows: [
        ...graph.dataFlows,
        {
          id: "demo-excel-to-erp-order",
          sourceSystemId: excel.id,
          targetSystemId: erp.id,
          dataIds: [orderData.id],
          transferType: "manual",
          direction: "push",
          automation: "manual",
          evidence: "Excelの受注管理表に入力して、その後ERPにも同じ内容を登録",
          status: "confirmed",
          workflowIds: ["order"],
          processIds: orderProcesses,
        },
      ],
    };
  }

  return graph;
}


export type StepAssetLink = {
  asset: LensNode;
  relation: Relation;
  label?: string;
};

export function getWorkflowProcesses(
  graph: LensGraph,
  workflowId: string,
): LensNode[] {
  return graph.nodes
    .filter(
      (node) =>
        node.kind === "process" && node.workflowId === workflowId,
    )
    .sort((a, b) => {
      const ai = a.stepOrder ?? Number.MAX_SAFE_INTEGER;
      const bi = b.stepOrder ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return graph.nodes.indexOf(a) - graph.nodes.indexOf(b);
    });
}

export function getProcessAssetLinks(
  graph: LensGraph,
  processId: string,
): StepAssetLink[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const links: StepAssetLink[] = [];

  for (const edge of graph.edges) {
    if (edge.source !== processId && edge.target !== processId) continue;

    const otherId = edge.source === processId ? edge.target : edge.source;
    const asset = byId.get(otherId);
    if (!asset || asset.kind === "process") continue;

    links.push({
      asset,
      relation: edge.relation,
      label: edge.label,
    });
  }

  return links;
}

export type AssetUsage = {
  workflowId: string;
  workflowName: string;
  processId: string;
  processName: string;
  relation: Relation;
  label?: string;
};

export function getAssetUsages(
  graph: LensGraph,
  assetId: string,
): AssetUsage[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const workflowName = new Map(
    graph.workflows.map((workflow) => [workflow.id, workflow.name]),
  );
  const usages: AssetUsage[] = [];

  for (const edge of graph.edges) {
    if (edge.source !== assetId && edge.target !== assetId) continue;

    const otherId = edge.source === assetId ? edge.target : edge.source;
    const process = byId.get(otherId);
    if (
      !process ||
      process.kind !== "process" ||
      !process.workflowId
    ) {
      continue;
    }

    usages.push({
      workflowId: process.workflowId,
      workflowName:
        workflowName.get(process.workflowId) ?? process.workflowId,
      processId: process.id,
      processName: process.label,
      relation: edge.relation,
      label: edge.label,
    });
  }

  return usages;
}


export type OwnershipFilter = {
  department?: string | null;
  responsiblePerson?: string | null;
};

export function processMatchesOwnership(
  node: LensNode,
  filter: OwnershipFilter,
): boolean {
  if (node.kind !== "process") return true;
  if (filter.department && node.department !== filter.department) return false;
  if (
    filter.responsiblePerson &&
    node.responsiblePerson !== filter.responsiblePerson
  ) {
    return false;
  }
  return true;
}

export function getDepartments(graph: LensGraph): string[] {
  return [
    ...new Set(
      graph.nodes
        .filter((node) => node.kind === "process" && node.department)
        .map((node) => node.department as string),
    ),
  ].sort((a, b) => a.localeCompare(b, "ja"));
}

export function getResponsiblePeople(graph: LensGraph): string[] {
  return [
    ...new Set(
      graph.nodes
        .filter((node) => node.kind === "process" && node.responsiblePerson)
        .map((node) => node.responsiblePerson as string),
    ),
  ].sort((a, b) => a.localeCompare(b, "ja"));
}

export type NodeRelationship = {
  node: LensNode;
  relation: string;
  workflowIds: string[];
};

export function getNodeRelationships(
  graph: LensGraph,
  nodeId: string,
): NodeRelationship[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const related = new Map<string, NodeRelationship>();

  for (const edge of graph.edges) {
    if (edge.source !== nodeId && edge.target !== nodeId) continue;
    const otherId = edge.source === nodeId ? edge.target : edge.source;
    const other = byId.get(otherId);
    if (!other) continue;

    related.set(`${other.id}:${edge.id}`, {
      node: other,
      relation:
        edge.source === nodeId
          ? `${edge.relation} →`
          : `← ${edge.relation}`,
      workflowIds: edge.workflowIds,
    });
  }

  for (const flow of graph.dataFlows ?? []) {
    const touches =
      flow.sourceSystemId === nodeId ||
      flow.targetSystemId === nodeId ||
      flow.dataIds.includes(nodeId);
    if (!touches) continue;

    const ids = [
      flow.sourceSystemId,
      flow.targetSystemId,
      ...flow.dataIds,
    ].filter((id) => id !== nodeId);

    for (const id of ids) {
      const other = byId.get(id);
      if (!other) continue;
      related.set(`${other.id}:flow:${flow.id}`, {
        node: other,
        relation: `data-flow · ${flow.transferType}`,
        workflowIds: flow.workflowIds,
      });
    }
  }

  return [...related.values()];
}

export function getDataFlowsForSystem(
  graph: LensGraph,
  systemId: string,
): SystemDataFlow[] {
  return (graph.dataFlows ?? []).filter(
    (flow) =>
      flow.sourceSystemId === systemId ||
      flow.targetSystemId === systemId,
  );
}
