"use client";

import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  SAMPLE_WORKFLOWS,
  createDemoGraph,
  getNodeWorkflowIds,
  lanePositions,
  sharedNodeIds,
  type Confidence,
  type LensGraph,
  type LensNode,
  type NodeKind,
} from "@/lib/graph";

type ViewMode = "all" | NodeKind | "shared";
type ScopeMode = "all" | string;

type LensNodeData = LensNode & {
  index: number;
  usageCount: number;
  workflowNames: string[];
};

type FlowNode = Node<LensNodeData, "lens">;
type LaneNodeData = {
  label: string;
  detail: string;
  kind: NodeKind;
};
type LaneNode = Node<LaneNodeData, "lane">;
type AppNode = FlowNode | LaneNode;

const kindMeta: Record<NodeKind, { label: string; icon: string }> = {
  process: { label: "業務", icon: "↳" },
  system: { label: "システム", icon: "⬡" },
  data: { label: "データ", icon: "◇" },
};

const statusMeta: Record<Confidence, { label: string; mark: string }> = {
  confirmed: { label: "確認済み", mark: "●" },
  inferred: { label: "AI推定", mark: "◐" },
  unknown: { label: "未確認", mark: "○" },
};

function LensCard({ data, selected }: NodeProps<FlowNode>) {
  const meta = kindMeta[data.kind];
  const status = statusMeta[data.status];
  const isShared = data.kind !== "process" && data.usageCount > 1;

  return (
    <div
      className={[
        "lens-node",
        `lens-node--${data.kind}`,
        isShared ? "lens-node--shared" : "",
        selected ? "lens-node--selected" : "",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Left} className="lens-handle" />
      <div className="lens-node__eyebrow">
        <span>
          {meta.icon} {meta.label}
        </span>
        <span className={`status status--${data.status}`}>
          {status.mark} {status.label}
        </span>
      </div>

      <div className="lens-node__title">{data.label}</div>
      <div className="lens-node__description">{data.description}</div>

      <div className="lens-node__footer">
        {data.actor ? (
          <span className="lens-node__actor">👤 {data.actor}</span>
        ) : null}

        {isShared ? (
          <span className="shared-badge">↔ {data.usageCount}業務で共有</span>
        ) : data.workflowNames.length > 0 ? (
          <span className="workflow-badge">{data.workflowNames[0]}</span>
        ) : null}
      </div>

      <Handle type="source" position={Position.Right} className="lens-handle" />
    </div>
  );
}

function LaneLabel({ data }: NodeProps<LaneNode>) {
  return (
    <div className={`lane-label lane-label--${data.kind}`}>
      <strong>{data.label}</strong>
      <span>{data.detail}</span>
    </div>
  );
}

const nodeTypes = {
  lens: LensCard,
  lane: LaneLabel,
};

function graphToFlow(
  graph: LensGraph,
  view: ViewMode,
  scope: ScopeMode,
): { nodes: AppNode[]; edges: Edge[] } {
  const workflowName = new Map(
    graph.workflows.map((workflow) => [workflow.id, workflow.name]),
  );
  const shared = sharedNodeIds(graph);

  const scopeEdges = graph.edges.filter(
    (edge) => scope === "all" || edge.workflowIds.includes(scope),
  );

  let visibleIds = new Set<string>();
  let visibleEdges = scopeEdges;

  if (view === "shared") {
    visibleEdges = scopeEdges.filter(
      (edge) => shared.has(edge.source) || shared.has(edge.target),
    );
    visibleIds = new Set(
      visibleEdges.flatMap((edge) => [edge.source, edge.target]),
    );
  } else {
    for (const edge of scopeEdges) {
      visibleIds.add(edge.source);
      visibleIds.add(edge.target);
    }

    for (const node of graph.nodes) {
      if (
        node.kind === "process" &&
        (scope === "all" || node.workflowId === scope)
      ) {
        visibleIds.add(node.id);
      }
    }
  }

  let graphNodes = graph.nodes.filter((node) => visibleIds.has(node.id));

  if (view !== "all" && view !== "shared") {
    graphNodes = graphNodes.filter((node) => node.kind === view);
  }

  const finalIds = new Set(graphNodes.map((node) => node.id));

  const edges: Edge[] = visibleEdges
    .filter(
      (edge) => finalIds.has(edge.source) && finalIds.has(edge.target),
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label:
        edge.workflowIds.length > 1
          ? `${edge.label ?? edge.relation} · ${edge.workflowIds.length}業務`
          : edge.label,
      type: "smoothstep",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
      },
      style: {
        strokeWidth: edge.workflowIds.length > 1 ? 2.5 : 1.7,
      },
      labelStyle: {
        fontSize: 11,
        fontWeight: 700,
      },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 6,
    }));

  const laneCount: Record<NodeKind, number> = {
    process: 0,
    system: 0,
    data: 0,
  };

  const flowNodes: FlowNode[] = graphNodes.map((node) => {
    const index = laneCount[node.kind]++;
    const xs = lanePositions[node.kind].x;
    const workflowIds = getNodeWorkflowIds(graph, node);

    return {
      id: node.id,
      type: "lens",
      position: {
        x:
          xs[Math.min(index, xs.length - 1)] +
          Math.max(0, index - xs.length + 1) * 280,
        y: lanePositions[node.kind].y,
      },
      data: {
        ...node,
        index,
        usageCount: workflowIds.length,
        workflowNames: workflowIds
          .map((id) => workflowName.get(id))
          .filter((name): name is string => Boolean(name)),
      },
    };
  });

  const visibleKinds = new Set(flowNodes.map((node) => node.data.kind));

  const laneNodes: LaneNode[] = (
    ["process", "system", "data"] as NodeKind[]
  )
    .filter((kind) => visibleKinds.has(kind))
    .map((kind) => ({
      id: `lane-${kind}`,
      type: "lane",
      position: {
        x: 0,
        y: lanePositions[kind].y + 18,
      },
      data: {
        kind,
        label: kindMeta[kind].label,
        detail:
          kind === "process"
            ? "業務ごとの仕事"
            : kind === "system"
              ? "業務横断で共有"
              : "業務横断で参照",
      },
      draggable: false,
      selectable: false,
      zIndex: -1,
    }));

  return {
    nodes: [...laneNodes, ...flowNodes],
    edges,
  };
}

function Workspace() {
  const [graph, setGraph] = useState<LensGraph>(() => createDemoGraph());
  const [view, setView] = useState<ViewMode>("all");
  const [scope, setScope] = useState<ScopeMode>("all");
  const [selected, setSelected] = useState<LensNode | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    SAMPLE_WORKFLOWS[0].id,
  );
  const [transcripts, setTranscripts] = useState<Record<string, string>>(
    Object.fromEntries(
      SAMPLE_WORKFLOWS.map((sample) => [sample.id, sample.transcript]),
    ),
  );
  const [questions, setQuestions] = useState<string[]>([
    "ExcelとERPへの二重入力は、なぜ必要ですか？",
    "在庫情報は、どのシステムを正として管理していますか？",
  ]);
  const [provider, setProvider] = useState("local-demo-extractor");
  const [revision, setRevision] = useState(1);
  const [mapping, setMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingInterview, setCreatingInterview] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [newWorkflowDescription, setNewWorkflowDescription] = useState("");

  const flow = useMemo(
    () => graphToFlow(graph, view, scope),
    [graph, view, scope],
  );

  const selectedWorkflow = graph.workflows.find(
    (workflow) => workflow.id === selectedWorkflowId,
  );

  const selectedUsage = selected
    ? getNodeWorkflowIds(graph, selected)
        .map((id) => graph.workflows.find((item) => item.id === id)?.name)
        .filter((name): name is string => Boolean(name))
    : [];

  const sharedCount = graph.nodes.filter(
    (node) =>
      node.kind !== "process" &&
      getNodeWorkflowIds(graph, node).length > 1,
  ).length;

  function createInterview() {
    const name = newWorkflowName.trim();
    if (!name) return;

    const slug =
      name
        .toLowerCase()
        .normalize("NFKC")
        .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "workflow";

    let id = slug;
    let suffix = 2;
    const existingIds = new Set(graph.workflows.map((workflow) => workflow.id));
    while (existingIds.has(id)) {
      id = `${slug}-${suffix++}`;
    }

    const workflow = {
      id,
      name,
      description: newWorkflowDescription.trim() || undefined,
    };

    setGraph((current) => ({
      ...current,
      workflows: [...current.workflows, workflow],
    }));
    setTranscripts((current) => ({
      ...current,
      [id]: "",
    }));
    setSelectedWorkflowId(id);
    setScope(id);
    setView("all");
    setQuestions([]);
    setSelected(null);
    setError(null);
    setNewWorkflowName("");
    setNewWorkflowDescription("");
    setCreatingInterview(false);
  }

  async function mapInterview() {
    if (!selectedWorkflow) return;

    setMapping(true);
    setError(null);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          interview: transcripts[selectedWorkflow.id] ?? "",
          workflow: selectedWorkflow,
          graph,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error ?? "Graph extraction failed.");
      }

      setGraph(payload.graph);
      setQuestions(payload.questions ?? []);
      setProvider(payload.provider ?? "unknown");
      setSelected(null);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Graph extraction failed.",
      );
    } finally {
      setMapping(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">FL</div>
          <div>
            <div className="brand-name">BusinessFlowLens</div>
            <div className="brand-tagline">
              One graph for processes, systems, and data across the business.
            </div>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="prototype-pill">PROTOTYPE</span>
          <button className="ghost-button">Export</button>
          <button
            className="primary-button"
            onClick={mapInterview}
            disabled={mapping}
          >
            {mapping ? "Mapping..." : "Map interview"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="interview-panel">
          <div className="panel-heading">
            <div>
              <div className="kicker">01 / INTERVIEW</div>
              <h1>業務ごとに聞く。全体ではつなげる。</h1>
            </div>
            <span className="revision">v{revision}</span>
          </div>

          <div className="workflow-picker">
            {graph.workflows.map((workflow) => (
              <button
                key={workflow.id}
                className={
                  selectedWorkflowId === workflow.id ? "active" : ""
                }
                onClick={() => {
                  setSelectedWorkflowId(workflow.id);
                  setQuestions([]);
                  setCreatingInterview(false);
                }}
              >
                <span>{workflow.name}</span>
                <small>Interview</small>
              </button>
            ))}

            <button
              className="workflow-add"
              onClick={() => setCreatingInterview((value) => !value)}
              aria-expanded={creatingInterview}
            >
              <span>＋ 新規ヒアリング</span>
              <small>New workflow</small>
            </button>
          </div>

          {creatingInterview ? (
            <div className="new-interview-form">
              <div className="kicker">NEW INTERVIEW</div>
              <label>
                <span>業務名</span>
                <input
                  autoFocus
                  value={newWorkflowName}
                  onChange={(event) => setNewWorkflowName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createInterview();
                    if (event.key === "Escape") setCreatingInterview(false);
                  }}
                  placeholder="例: 購買業務"
                />
              </label>
              <label>
                <span>概要 <small>任意</small></span>
                <input
                  value={newWorkflowDescription}
                  onChange={(event) =>
                    setNewWorkflowDescription(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createInterview();
                    if (event.key === "Escape") setCreatingInterview(false);
                  }}
                  placeholder="例: 発注から入荷まで"
                />
              </label>
              <div className="new-interview-actions">
                <button
                  className="secondary-button"
                  onClick={() => setCreatingInterview(false)}
                >
                  キャンセル
                </button>
                <button
                  className="primary-button"
                  onClick={createInterview}
                  disabled={!newWorkflowName.trim()}
                >
                  作成してヒアリング開始
                </button>
              </div>
            </div>
          ) : null}

          <div className="interview-context">
            <strong>{selectedWorkflow?.name ?? "ヒアリング"}</strong>
            <span>
              {selectedWorkflow?.description ??
                "現状の業務を、話したまま・メモのまま入力してください。"}
            </span>
          </div>

          <textarea
            aria-label="Interview transcript"
            value={transcripts[selectedWorkflowId] ?? ""}
            onChange={(event) =>
              setTranscripts((current) => ({
                ...current,
                [selectedWorkflowId]: event.target.value,
              }))
            }
          />

          <button
            className="map-button"
            onClick={mapInterview}
            disabled={mapping}
          >
            <span>↗</span>
            {mapping ? "構造化中..." : "構造に変換"}
          </button>

          <div className="provider-line">
            <span>AI endpoint</span>
            <strong>{provider}</strong>
          </div>

          {error ? <div className="error-box">{error}</div> : null}

          <div className="question-box">
            <div className="kicker">NEXT QUESTIONS</div>
            <p className="question-intro">
              グラフの穴と業務横断の重複から、次に聞くことを出します。
            </p>
            <div className="question-list">
              {questions.length > 0 ? (
                questions.map((question, index) => (
                  <button key={question} className="question-item">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {question}
                  </button>
                ))
              ) : (
                <div className="question-empty">
                  この業務を再マッピングすると質問を更新します。
                </div>
              )}
            </div>
          </div>

          <div className="legend">
            <span>
              <i className="dot dot--confirmed" />
              確認済み
            </span>
            <span>
              <i className="dot dot--inferred" />
              AI推定
            </span>
            <span>
              <i className="dot dot--unknown" />
              未確認
            </span>
          </div>
        </aside>

        <section className="map-panel">
          <div className="map-toolbar">
            <div>
              <div className="kicker">02 / CANONICAL GRAPH</div>
              <div className="map-title-row">
                <h2>業務構造マップ</h2>
                <span className="metric-pill">
                  {graph.workflows.length} workflows
                </span>
                <span className="metric-pill metric-pill--shared">
                  {sharedCount} shared assets
                </span>
              </div>
            </div>

            <div className="map-controls">
              <div className="scope-switcher">
                <button
                  className={scope === "all" ? "active" : ""}
                  onClick={() => {
                    setScope("all");
                    setSelected(null);
                  }}
                >
                  全業務
                </button>
                {graph.workflows.map((workflow) => (
                  <button
                    key={workflow.id}
                    className={scope === workflow.id ? "active" : ""}
                    onClick={() => {
                      setScope(workflow.id);
                      setSelected(null);
                    }}
                  >
                    {workflow.name}
                  </button>
                ))}
              </div>

              <div
                className="view-switcher"
                role="tablist"
                aria-label="Map view"
              >
                {(
                  [
                    ["all", "全体"],
                    ["process", "業務"],
                    ["system", "システム"],
                    ["data", "データ"],
                    ["shared", "共有"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={view === value ? "active" : ""}
                    onClick={() => {
                      setView(value);
                      setSelected(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flow-wrap">
            <ReactFlow
              key={`${view}-${scope}-${revision}`}
              nodes={flow.nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.35}
              maxZoom={1.5}
              onNodeClick={(_, node) => {
                if (node.type !== "lens") return;
                setSelected(
                  graph.nodes.find((item) => item.id === node.id) ?? null,
                );
              }}
              nodesDraggable
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={26} size={1} />
              <Controls position="bottom-right" showInteractive={false} />
              <MiniMap
                position="bottom-left"
                pannable
                zoomable
                nodeStrokeWidth={2}
                maskColor="rgba(248, 248, 245, 0.78)"
              />
            </ReactFlow>

            {selected ? (
              <div className="inspector">
                <button
                  className="inspector-close"
                  onClick={() => setSelected(null)}
                  aria-label="Close inspector"
                >
                  ×
                </button>

                <div className="kicker">SELECTED NODE</div>

                <div className="inspector-title-row">
                  <span
                    className={`kind-chip kind-chip--${selected.kind}`}
                  >
                    {kindMeta[selected.kind].label}
                  </span>
                  <span
                    className={`status status--${selected.status}`}
                  >
                    {statusMeta[selected.status].mark}{" "}
                    {statusMeta[selected.status].label}
                  </span>
                </div>

                <h3>{selected.label}</h3>
                <p>{selected.description}</p>

                <div className="usage-box">
                  <span>利用業務</span>
                  <div>
                    {selectedUsage.map((name) => (
                      <strong key={name}>{name}</strong>
                    ))}
                  </div>
                </div>

                <div className="evidence">
                  <span>根拠</span>
                  <strong>{selected.evidence ?? "—"}</strong>
                </div>

                <div className="inspector-actions">
                  <button>確認済みにする</button>
                  <button>編集</button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

export default function FlowLensApp() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}
