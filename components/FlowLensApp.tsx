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
  SAMPLE_INTERVIEW,
  extractInterview,
  generateQuestions,
  lanePositions,
  type Confidence,
  type LensGraph,
  type LensNode,
  type NodeKind,
} from "@/lib/graph";

type ViewMode = "all" | NodeKind;
type LensNodeData = LensNode & { index: number };
type FlowNode = Node<LensNodeData, "lens">;
type LaneNodeData = { label: string; detail: string; kind: NodeKind };
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

  return (
    <div
      className={[
        "lens-node",
        `lens-node--${data.kind}`,
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
      {data.actor ? <div className="lens-node__actor">👤 {data.actor}</div> : null}
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
): { nodes: AppNode[]; edges: Edge[] } {
  const laneCount: Record<NodeKind, number> = {
    process: 0,
    system: 0,
    data: 0,
  };
  const visibleKinds: NodeKind[] =
    view === "all" ? ["process", "system", "data"] : [view];

  const laneNodes: LaneNode[] = visibleKinds.map((kind) => ({
    id: `lane-${kind}`,
    type: "lane",
    position: { x: 0, y: lanePositions[kind].y + 18 },
    data: {
      kind,
      label: kindMeta[kind].label,
      detail:
        kind === "process"
          ? "人が行う仕事"
          : kind === "system"
            ? "使っている道具"
            : "受け渡される情報",
    },
    draggable: false,
    selectable: false,
    zIndex: -1,
  }));

  const graphNodes: FlowNode[] = graph.nodes
    .filter((node) => view === "all" || node.kind === view)
    .map((node) => {
      const index = laneCount[node.kind]++;
      const xs = lanePositions[node.kind].x;
      return {
        id: node.id,
        type: "lens",
        position: {
          x:
            xs[Math.min(index, xs.length - 1)] +
            Math.max(0, index - xs.length + 1) * 280,
          y: lanePositions[node.kind].y,
        },
        data: { ...node, index },
      };
    });

  const visibleIds = new Set(graphNodes.map((node) => node.id));
  const edges: Edge[] = graph.edges
    .filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: "smoothstep",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
      },
      style: { strokeWidth: 1.7 },
      labelStyle: { fontSize: 11, fontWeight: 700 },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 6,
    }));

  return { nodes: [...laneNodes, ...graphNodes], edges };
}

function Workspace() {
  const [transcript, setTranscript] = useState(SAMPLE_INTERVIEW);
  const [graph, setGraph] = useState<LensGraph>(() =>
    extractInterview(SAMPLE_INTERVIEW),
  );
  const [view, setView] = useState<ViewMode>("all");
  const [selected, setSelected] = useState<LensNode | null>(null);
  const [revision, setRevision] = useState(1);

  const flow = useMemo(() => graphToFlow(graph, view), [graph, view]);
  const questions = useMemo(() => generateQuestions(graph), [graph]);

  function mapInterview() {
    const next = extractInterview(transcript);
    setGraph(next);
    setSelected(null);
    setRevision((value) => value + 1);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">FL</div>
          <div>
            <div className="brand-name">BusinessFlowLens</div>
            <div className="brand-tagline">
              Turn interviews into a shared map of work, systems, and data.
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="prototype-pill">PROTOTYPE</span>
          <button className="ghost-button">Export</button>
          <button className="primary-button" onClick={mapInterview}>
            Map interview
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="interview-panel">
          <div className="panel-heading">
            <div>
              <div className="kicker">01 / INTERVIEW</div>
              <h1>聞いたことを、そのまま貼る。</h1>
            </div>
            <span className="revision">v{revision}</span>
          </div>

          <textarea
            aria-label="Interview transcript"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />

          <button className="map-button" onClick={mapInterview}>
            <span>↗</span>
            構造に変換
          </button>

          <div className="question-box">
            <div className="kicker">NEXT QUESTIONS</div>
            <p className="question-intro">
              グラフの穴から、次に聞くべきことを出します。
            </p>
            <div className="question-list">
              {questions.map((question, index) => (
                <button key={question} className="question-item">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {question}
                </button>
              ))}
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
              <div className="kicker">02 / MAP</div>
              <h2>受注業務 / 現状</h2>
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

          <div className="flow-wrap">
            <ReactFlow
              key={`${view}-${revision}`}
              nodes={flow.nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.45}
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
