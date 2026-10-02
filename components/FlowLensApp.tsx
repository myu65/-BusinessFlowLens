"use client";

import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
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
  getAssetUsages,
  getNodeWorkflowIds,
  getProcessAssetLinks,
  getWorkflowProcesses,
  type ExtractionReview,
  type LensGraph,
  type LensNode,
  type NodeKind,
  type Relation,
} from "@/lib/graph";

type Section = "interviews" | "workflow" | "assets" | "overview";
type AssetFilter = "all" | "system" | "data";

type PendingExtraction = {
  review: ExtractionReview;
  provider: string;
};

type StepNodeData = {
  step: LensNode;
  systems: string[];
  data: Array<{ label: string; relation: Relation }>;
};

type WorkflowStepNode = Node<StepNodeData, "workflowStep">;

const relationLabel: Record<Relation, string> = {
  next: "次へ",
  uses: "利用",
  reads: "参照",
  writes: "更新",
  sends: "送信",
};

const kindLabel: Record<NodeKind, string> = {
  process: "業務",
  system: "システム",
  data: "データ",
};

function WorkflowStepCard({ data, selected }: NodeProps<WorkflowStepNode>) {
  const { step, systems, data: dataAssets } = data;

  return (
    <div
      className={[
        "step-node",
        selected ? "step-node--selected" : "",
        step.status === "inferred" ? "step-node--inferred" : "",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Left} className="step-handle" />

      <div className="step-node__top">
        <span className="step-number">
          {String(step.stepOrder ?? 0).padStart(2, "0")}
        </span>
        <span className={`confidence confidence--${step.status}`}>
          {step.status === "confirmed"
            ? "確認済み"
            : step.status === "inferred"
              ? "AI推定"
              : "要確認"}
        </span>
      </div>

      <h3>{step.label}</h3>
      <p>{step.action ?? step.description}</p>

      {step.actor ? (
        <div className="step-actor">👤 {step.actor}</div>
      ) : null}

      {systems.length > 0 ? (
        <div className="step-assets">
          <span>System</span>
          <div>
            {systems.map((system) => (
              <i key={system} className="asset-chip asset-chip--system">
                {system}
              </i>
            ))}
          </div>
        </div>
      ) : null}

      {dataAssets.length > 0 ? (
        <div className="step-assets">
          <span>Data</span>
          <div>
            {dataAssets.map((item) => (
              <i
                key={`${item.label}-${item.relation}`}
                className="asset-chip asset-chip--data"
              >
                {item.label} · {relationLabel[item.relation]}
              </i>
            ))}
          </div>
        </div>
      ) : null}

      <Handle type="source" position={Position.Right} className="step-handle" />
    </div>
  );
}

const nodeTypes = {
  workflowStep: WorkflowStepCard,
};

function workflowFlow(
  graph: LensGraph,
  workflowId: string,
): { nodes: WorkflowStepNode[]; edges: Edge[] } {
  const processes = getWorkflowProcesses(graph, workflowId);
  const processIds = new Set(processes.map((process) => process.id));

  const nodes: WorkflowStepNode[] = processes.map((step, index) => {
    const links = getProcessAssetLinks(graph, step.id);
    const systems = links
      .filter((link) => link.asset.kind === "system")
      .map((link) => link.asset.label);
    const data = links
      .filter((link) => link.asset.kind === "data")
      .map((link) => ({
        label: link.asset.label,
        relation: link.relation,
      }));

    return {
      id: step.id,
      type: "workflowStep",
      position: {
        x: index * 330,
        y: index % 2 === 0 ? 80 : 118,
      },
      data: { step, systems, data },
    };
  });

  const edges: Edge[] = graph.edges
    .filter(
      (edge) =>
        edge.relation === "next" &&
        processIds.has(edge.source) &&
        processIds.has(edge.target),
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      label: edge.label,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
      },
      style: { strokeWidth: 1.8 },
      labelStyle: { fontSize: 10, fontWeight: 700 },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 6,
    }));

  return { nodes, edges };
}

function slugifyWorkflow(name: string) {
  return (
    name
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "workflow"
  );
}

function ShellNav({
  section,
  setSection,
}: {
  section: Section;
  setSection: (section: Section) => void;
}) {
  const items: Array<{ id: Section; label: string; hint: string }> = [
    { id: "interviews", label: "ヒアリング", hint: "聞く・レビュー" },
    { id: "workflow", label: "業務フロー", hint: "1業務を読む" },
    { id: "assets", label: "システム・データ", hint: "影響範囲を見る" },
    { id: "overview", label: "横断ビュー", hint: "共通点を俯瞰" },
  ];

  return (
    <nav className="main-nav">
      {items.map((item) => (
        <button
          key={item.id}
          className={section === item.id ? "active" : ""}
          onClick={() => setSection(item.id)}
        >
          <strong>{item.label}</strong>
          <span>{item.hint}</span>
        </button>
      ))}
    </nav>
  );
}

function WorkflowPicker({
  graph,
  selectedWorkflowId,
  onSelect,
}: {
  graph: LensGraph;
  selectedWorkflowId: string;
  onSelect: (workflowId: string) => void;
}) {
  return (
    <div className="workflow-tabs">
      {graph.workflows.map((workflow) => (
        <button
          key={workflow.id}
          className={selectedWorkflowId === workflow.id ? "active" : ""}
          onClick={() => onSelect(workflow.id)}
        >
          {workflow.name}
        </button>
      ))}
    </div>
  );
}

function ReviewPanel({
  pending,
  onChange,
  onApply,
  onDiscard,
  applying,
}: {
  pending: PendingExtraction | null;
  onChange: (pending: PendingExtraction) => void;
  onApply: () => void;
  onDiscard: () => void;
  applying: boolean;
}) {
  if (!pending) {
    return (
      <aside className="review-panel review-panel--empty">
        <div className="eyebrow">AI DRAFT</div>
        <h2>まず下書きを作る</h2>
        <p>
          AIは直接グラフを書き換えません。ヒアリングから業務ステップ、
          System/Data、分岐、未確認事項を根拠付きで抽出します。
        </p>
        <div className="review-principles">
          <span>01 事実を先に抽出</span>
          <span>02 人が下書きを修正</span>
          <span>03 修正後に共有資産を照合</span>
        </div>
      </aside>
    );
  }

  const { review } = pending;

  const changeReview = (nextReview: ExtractionReview) =>
    onChange({ ...pending, review: nextReview });

  const updateStep = (
    stepKey: string,
    patch: Partial<ExtractionReview["steps"][number]>,
  ) => {
    changeReview({
      ...review,
      steps: review.steps.map((step) =>
        step.stepKey === stepKey ? { ...step, ...patch } : step,
      ),
    });
  };

  const removeStep = (stepKey: string) => {
    changeReview({
      ...review,
      steps: review.steps
        .filter((step) => step.stepKey !== stepKey)
        .map((step, index) => ({ ...step, order: index + 1 })),
      transitions: review.transitions.filter(
        (transition) =>
          transition.fromStepKey !== stepKey &&
          transition.toStepKey !== stepKey,
      ),
    });
  };

  const removeSystem = (stepKey: string, index: number) => {
    const step = review.steps.find((item) => item.stepKey === stepKey);
    if (!step) return;
    updateStep(stepKey, {
      systems: step.systems.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  const removeData = (stepKey: string, index: number) => {
    const step = review.steps.find((item) => item.stepKey === stepKey);
    if (!step) return;
    updateStep(stepKey, {
      data: step.data.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  return (
    <aside className="review-panel">
      <div className="review-header">
        <div>
          <div className="eyebrow">AI DRAFT / EDIT BEFORE APPLY</div>
          <h2>抽出結果を直してから反映</h2>
        </div>
        <span className="provider-badge">{pending.provider}</span>
      </div>

      <div className="review-summary review-summary--editable">
        <label>
          <span>業務の要約</span>
          <textarea
            value={review.summary}
            onChange={(event) =>
              changeReview({ ...review, summary: event.target.value })
            }
          />
        </label>
        <div className="review-summary-fields">
          <label>
            <span>開始条件</span>
            <input
              value={review.trigger ?? ""}
              placeholder="未確認"
              onChange={(event) =>
                changeReview({
                  ...review,
                  trigger: event.target.value || null,
                })
              }
            />
          </label>
          <label>
            <span>完了状態</span>
            <input
              value={review.outcome ?? ""}
              placeholder="未確認"
              onChange={(event) =>
                changeReview({
                  ...review,
                  outcome: event.target.value || null,
                })
              }
            />
          </label>
        </div>
      </div>

      <div className="review-scroll">
        <div className="review-section-title">
          <span>抽出ステップ — 誤りはここで直す</span>
          <b>{review.steps.length}</b>
        </div>

        <div className="review-steps">
          {review.steps.map((step) => (
            <article key={step.stepKey} className="review-step review-step--editable">
              <div className="review-step__top">
                <span>{String(step.order).padStart(2, "0")}</span>
                <input
                  className="review-step-name"
                  value={step.name}
                  onChange={(event) =>
                    updateStep(step.stepKey, { name: event.target.value })
                  }
                />
                <button
                  className="review-delete"
                  title="このステップを除外"
                  onClick={() => removeStep(step.stepKey)}
                >
                  ×
                </button>
              </div>

              <textarea
                className="review-step-action"
                value={step.action}
                onChange={(event) =>
                  updateStep(step.stepKey, { action: event.target.value })
                }
              />

              <div className="review-step-meta">
                <input
                  value={step.actor ?? ""}
                  placeholder="担当者・部署 未確認"
                  onChange={(event) =>
                    updateStep(step.stepKey, {
                      actor: event.target.value || null,
                    })
                  }
                />
                <span>
                  {step.certainty === "explicit" ? "明示" : "AI推定"} · 根拠:{" "}
                  {step.evidence || "—"}
                </span>
              </div>

              {(step.systems.length > 0 || step.data.length > 0) && (
                <div className="review-assets review-assets--editable">
                  {step.systems.map((system, index) => (
                    <span
                      key={`s-${system.name}-${index}`}
                      className="asset-chip asset-chip--system"
                    >
                      {system.name} · {system.interaction}
                      <button
                        title="誤抽出なら除外"
                        onClick={() => removeSystem(step.stepKey, index)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {step.data.map((data, index) => (
                    <span
                      key={`d-${data.name}-${data.operation}-${index}`}
                      className="asset-chip asset-chip--data"
                    >
                      {data.name} · {data.operation}
                      <button
                        title="誤抽出なら除外"
                        onClick={() => removeData(step.stepKey, index)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>

        {review.warnings.length > 0 ? (
          <div className="review-warning">
            <div className="review-section-title">
              <span>AIが迷っているところ</span>
              <b>{review.warnings.length}</b>
            </div>
            {review.warnings.map((warning) => (
              <p key={warning}>△ {warning}</p>
            ))}
          </div>
        ) : null}

        {review.questions.length > 0 ? (
          <div className="review-questions">
            <div className="review-section-title">
              <span>次に聞くと精度が上がること</span>
              <b>{review.questions.length}</b>
            </div>
            {review.questions.map((question, index) => (
              <article key={question.question}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{question.question}</strong>
                  <small>{question.reason}</small>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <div className="review-actions">
        <button
          className="button-secondary"
          onClick={onDiscard}
          disabled={applying}
        >
          破棄
        </button>
        <button
          className="button-primary"
          onClick={onApply}
          disabled={applying || review.steps.length === 0}
        >
          {applying ? "共有資産を照合中…" : "修正内容を反映"}
        </button>
      </div>
    </aside>
  );
}

function InterviewsView({
  graph,
  selectedWorkflowId,
  setSelectedWorkflowId,
  transcripts,
  setTranscripts,
  pending,
  setPending,
  provider,
  setProvider,
  onGraphApply,
}: {
  graph: LensGraph;
  selectedWorkflowId: string;
  setSelectedWorkflowId: (id: string) => void;
  transcripts: Record<string, string>;
  setTranscripts: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  pending: PendingExtraction | null;
  setPending: (pending: PendingExtraction | null) => void;
  provider: string;
  setProvider: (provider: string) => void;
  onGraphApply: (graph: LensGraph) => void;
}) {
  const [mapping, setMapping] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const workflow = graph.workflows.find(
    (item) => item.id === selectedWorkflowId,
  );

  function createInterview() {
    const name = newName.trim();
    if (!name) return;

    const base = slugifyWorkflow(name);
    const ids = new Set(graph.workflows.map((item) => item.id));
    let id = base;
    let suffix = 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;

    onGraphApply({
      ...graph,
      workflows: [
        ...graph.workflows,
        {
          id,
          name,
          description: newDescription.trim() || undefined,
        },
      ],
    });
    setTranscripts((current) => ({ ...current, [id]: "" }));
    setSelectedWorkflowId(id);
    setNewName("");
    setNewDescription("");
    setCreating(false);
    setPending(null);
  }

  async function extract() {
    if (!workflow) return;
    const interview = transcripts[workflow.id]?.trim();
    if (!interview) {
      setError("ヒアリング内容を入力してください。");
      return;
    }

    setMapping(true);
    setError(null);
    setPending(null);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interview,
          workflow,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "抽出に失敗しました。");
      }

      setProvider(payload.provider ?? "unknown");
      setPending({
        review: payload.review,
        provider: payload.provider ?? "unknown",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "抽出に失敗しました。",
      );
    } finally {
      setMapping(false);
    }
  }

  async function applyDraft() {
    if (!workflow || !pending) return;

    setApplying(true);
    setError(null);

    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review: pending.review,
          workflow,
          graph,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "反映に失敗しました。");
      }

      onGraphApply(payload.graph);
      setProvider(payload.provider ?? pending.provider);
      setPending(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "反映に失敗しました。",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="interview-layout">
      <aside className="interview-list">
        <div className="pane-title">
          <div>
            <div className="eyebrow">INTERVIEWS</div>
            <h2>業務を聞く</h2>
          </div>
          <button
            className="icon-button"
            onClick={() => setCreating((value) => !value)}
            aria-label="新規ヒアリング"
          >
            ＋
          </button>
        </div>

        {creating ? (
          <div className="create-workflow">
            <input
              autoFocus
              placeholder="業務名 例: 購買業務"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <input
              placeholder="概要 例: 発注から入荷まで"
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createInterview();
              }}
            />
            <div>
              <button
                className="button-secondary"
                onClick={() => setCreating(false)}
              >
                やめる
              </button>
              <button
                className="button-primary"
                disabled={!newName.trim()}
                onClick={createInterview}
              >
                作成
              </button>
            </div>
          </div>
        ) : null}

        <div className="interview-items">
          {graph.workflows.map((item) => {
            const processCount = getWorkflowProcesses(graph, item.id).length;
            return (
              <button
                key={item.id}
                className={selectedWorkflowId === item.id ? "active" : ""}
                onClick={() => {
                  setSelectedWorkflowId(item.id);
                  setPending(null);
                  setError(null);
                }}
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description ?? "説明なし"}</small>
                </span>
                <b>{processCount || "—"}</b>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="interview-editor">
        <div className="editor-header">
          <div>
            <div className="eyebrow">RAW INTERVIEW</div>
            <h1>{workflow?.name ?? "ヒアリング"}</h1>
            <p>
              {workflow?.description ??
                "現状を話したまま、メモのまま入力します。整形はAI側で行います。"}
            </p>
          </div>
          <span className="provider-badge">{provider}</span>
        </div>

        <textarea
          value={transcripts[selectedWorkflowId] ?? ""}
          onChange={(event) => {
            setTranscripts((current) => ({
              ...current,
              [selectedWorkflowId]: event.target.value,
            }));
            setPending(null);
          }}
          placeholder="例:
営業がメールで注文書を受け取ります。
内容を確認してExcelに入力し、その後ERPにも登録しています…"
        />

        {error ? <div className="error-message">{error}</div> : null}

        <div className="editor-footer">
          <p>
            AIは既存グラフへ直接反映せず、まず右側にレビュー用の下書きを作成します。
          </p>
          <button
            className="button-primary button-primary--large"
            disabled={
              mapping || !(transcripts[selectedWorkflowId] ?? "").trim()
            }
            onClick={extract}
          >
            {mapping ? "構造を読み取り中…" : "AIで構造化"}
          </button>
        </div>
      </main>

      <ReviewPanel
        pending={pending}
        onChange={setPending}
        onDiscard={() => setPending(null)}
        onApply={applyDraft}
        applying={applying}
      />
    </section>
  );
}

function WorkflowView({
  graph,
  workflowId,
  setWorkflowId,
}: {
  graph: LensGraph;
  workflowId: string;
  setWorkflowId: (id: string) => void;
}) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const workflow = graph.workflows.find((item) => item.id === workflowId);
  const processes = getWorkflowProcesses(graph, workflowId);
  const flow = useMemo(
    () => workflowFlow(graph, workflowId),
    [graph, workflowId],
  );

  const selectedStep =
    processes.find((process) => process.id === selectedStepId) ?? null;
  const selectedLinks = selectedStep
    ? getProcessAssetLinks(graph, selectedStep.id)
    : [];

  const systemIds = new Set<string>();
  const dataIds = new Set<string>();
  for (const process of processes) {
    for (const link of getProcessAssetLinks(graph, process.id)) {
      if (link.asset.kind === "system") systemIds.add(link.asset.id);
      if (link.asset.kind === "data") dataIds.add(link.asset.id);
    }
  }

  return (
    <section className="page-view">
      <header className="page-header">
        <div>
          <div className="eyebrow">WORKFLOW DETAIL</div>
          <h1>1業務を、読める形で見る</h1>
          <p>
            System/Dataを別レーンに散らさず、各ステップが何を使い何を読む・書くかに寄せて表示します。
          </p>
        </div>
        <WorkflowPicker
          graph={graph}
          selectedWorkflowId={workflowId}
          onSelect={(id) => {
            setWorkflowId(id);
            setSelectedStepId(null);
          }}
        />
      </header>

      <div className="workflow-summary">
        <div>
          <span>業務</span>
          <strong>{workflow?.name ?? "—"}</strong>
        </div>
        <div>
          <span>ステップ</span>
          <strong>{processes.length}</strong>
        </div>
        <div>
          <span>システム</span>
          <strong>{systemIds.size}</strong>
        </div>
        <div>
          <span>データ</span>
          <strong>{dataIds.size}</strong>
        </div>
      </div>

      {processes.length === 0 ? (
        <div className="empty-state">
          <strong>まだ構造化されていません</strong>
          <p>ヒアリング画面で内容を入力し、AI下書きを確認して反映してください。</p>
        </div>
      ) : (
        <div className="workflow-canvas-wrap">
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.4}
            maxZoom={1.25}
            onNodeClick={(_, node) => setSelectedStepId(node.id)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={28} size={1} />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>

          {selectedStep ? (
            <aside className="step-inspector">
              <button
                className="close-button"
                onClick={() => setSelectedStepId(null)}
              >
                ×
              </button>
              <div className="eyebrow">STEP DETAIL</div>
              <h2>{selectedStep.label}</h2>
              <p>{selectedStep.action ?? selectedStep.description}</p>
              <dl>
                <div>
                  <dt>担当</dt>
                  <dd>{selectedStep.actor ?? "未確認"}</dd>
                </div>
                <div>
                  <dt>根拠</dt>
                  <dd>{selectedStep.evidence ?? "—"}</dd>
                </div>
              </dl>
              <div className="inspector-assets">
                {selectedLinks.map((link) => (
                  <article key={`${link.asset.id}-${link.relation}`}>
                    <span>{kindLabel[link.asset.kind]}</span>
                    <strong>{link.asset.label}</strong>
                    <small>
                      {relationLabel[link.relation]}
                      {link.label ? ` · ${link.label}` : ""}
                    </small>
                  </article>
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}

function AssetsView({ graph }: { graph: LensGraph }) {
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [search, setSearch] = useState("");
  const assets = graph.nodes
    .filter((node) => node.kind === "system" || node.kind === "data")
    .map((node) => ({
      node,
      usages: getAssetUsages(graph, node.id),
    }))
    .filter(
      ({ node }) =>
        (filter === "all" || node.kind === filter) &&
        (!search.trim() ||
          node.label.toLowerCase().includes(search.trim().toLowerCase()) ||
          node.description
            .toLowerCase()
            .includes(search.trim().toLowerCase())),
    )
    .sort((a, b) => b.usages.length - a.usages.length);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const selected =
    assets.find(({ node }) => node.id === selectedAssetId) ??
    assets[0] ??
    null;

  const workflowGroups = new Map<string, typeof selected.usages>();
  if (selected) {
    for (const usage of selected.usages) {
      const list = workflowGroups.get(usage.workflowId) ?? [];
      list.push(usage);
      workflowGroups.set(usage.workflowId, list);
    }
  }

  return (
    <section className="page-view">
      <header className="page-header">
        <div>
          <div className="eyebrow">ASSET IMPACT</div>
          <h1>システム・データは「影響範囲」を見る</h1>
          <p>
            単独ノードを眺めるのではなく、その資産をどの業務・どのステップがどう触っているかを確認します。
          </p>
        </div>
      </header>

      <div className="asset-layout">
        <aside className="asset-browser">
          <div className="asset-filters">
            <input
              placeholder="システム・データを検索"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div>
              {(
                [
                  ["all", "すべて"],
                  ["system", "System"],
                  ["data", "Data"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={filter === id ? "active" : ""}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="asset-list">
            {assets.map(({ node, usages }) => {
              const workflowCount = new Set(
                usages.map((usage) => usage.workflowId),
              ).size;
              return (
                <button
                  key={node.id}
                  className={selected?.node.id === node.id ? "active" : ""}
                  onClick={() => setSelectedAssetId(node.id)}
                >
                  <span
                    className={`asset-kind asset-kind--${node.kind}`}
                  >
                    {node.kind === "system" ? "SYS" : "DATA"}
                  </span>
                  <span>
                    <strong>{node.label}</strong>
                    <small>{node.description}</small>
                  </span>
                  <b>{workflowCount}</b>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="impact-panel">
          {selected ? (
            <>
              <div className="impact-header">
                <div>
                  <span
                    className={`asset-kind asset-kind--${selected.node.kind}`}
                  >
                    {selected.node.kind === "system" ? "SYSTEM" : "DATA"}
                  </span>
                  <h2>{selected.node.label}</h2>
                  <p>{selected.node.description}</p>
                </div>
                <div className="impact-count">
                  <strong>{workflowGroups.size}</strong>
                  <span>業務で利用</span>
                </div>
              </div>

              {selected.node.status === "unknown" ? (
                <div className="review-warning">
                  △ この資産は同一性が未確認です。既存資産とのマージ候補を人が確認してください。
                </div>
              ) : null}

              <div className="impact-workflows">
                {[...workflowGroups.entries()].map(
                  ([workflowId, usages]) => (
                    <section key={workflowId}>
                      <header>
                        <strong>{usages[0].workflowName}</strong>
                        <span>{usages.length} touchpoints</span>
                      </header>
                      {usages.map((usage) => (
                        <article
                          key={`${usage.processId}-${usage.relation}`}
                        >
                          <strong>{usage.processName}</strong>
                          <span>{relationLabel[usage.relation]}</span>
                          <small>{usage.label ?? "—"}</small>
                        </article>
                      ))}
                    </section>
                  ),
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">該当する資産がありません。</div>
          )}
        </main>
      </div>
    </section>
  );
}

function OverviewView({ graph }: { graph: LensGraph }) {
  const workflows = graph.workflows;
  const assets = graph.nodes
    .filter((node) => node.kind === "system" || node.kind === "data")
    .map((node) => ({
      node,
      usages: getAssetUsages(graph, node.id),
    }));

  const sharedAssets = assets
    .filter(
      ({ usages }) =>
        new Set(usages.map((usage) => usage.workflowId)).size > 1,
    )
    .sort((a, b) => b.usages.length - a.usages.length);

  const unresolved = assets.filter(
    ({ node }) => node.status === "unknown",
  ).length;

  function matrixCell(assetId: string, workflowId: string) {
    const usages = getAssetUsages(graph, assetId).filter(
      (usage) => usage.workflowId === workflowId,
    );
    const labels = [
      ...new Set(usages.map((usage) => relationLabel[usage.relation])),
    ];
    return labels;
  }

  return (
    <section className="page-view">
      <header className="page-header">
        <div>
          <div className="eyebrow">CROSS-BUSINESS OVERVIEW</div>
          <h1>横断はグラフではなく、比較と共有を見る</h1>
          <p>
            業務が増えても破綻しないよう、共通資産と依存関係をマトリクスで俯瞰します。
          </p>
        </div>
      </header>

      <div className="overview-stats">
        <article>
          <span>業務</span>
          <strong>{workflows.length}</strong>
        </article>
        <article>
          <span>共有資産</span>
          <strong>{sharedAssets.length}</strong>
        </article>
        <article>
          <span>システム</span>
          <strong>
            {assets.filter(({ node }) => node.kind === "system").length}
          </strong>
        </article>
        <article>
          <span>データ</span>
          <strong>
            {assets.filter(({ node }) => node.kind === "data").length}
          </strong>
        </article>
        <article className={unresolved > 0 ? "stat-warning" : ""}>
          <span>要確認</span>
          <strong>{unresolved}</strong>
        </article>
      </div>

      <div className="overview-grid">
        <section className="shared-assets-card">
          <div className="section-heading">
            <div>
              <div className="eyebrow">SHARED ASSETS</div>
              <h2>複数業務が依存するもの</h2>
            </div>
          </div>
          {sharedAssets.length > 0 ? (
            <div className="shared-ranking">
              {sharedAssets.slice(0, 8).map(({ node, usages }, index) => {
                const workflowCount = new Set(
                  usages.map((usage) => usage.workflowId),
                ).size;
                return (
                  <article key={node.id}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>
                      <strong>{node.label}</strong>
                      <small>
                        {kindLabel[node.kind]} · {workflowCount}業務 ·{" "}
                        {usages.length}接点
                      </small>
                    </span>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">共有資産はまだありません。</div>
          )}
        </section>

        <section className="workflow-health-card">
          <div className="section-heading">
            <div>
              <div className="eyebrow">WORKFLOWS</div>
              <h2>業務ごとの構造化状況</h2>
            </div>
          </div>
          <div className="workflow-health">
            {workflows.map((workflow) => {
              const steps = getWorkflowProcesses(graph, workflow.id);
              const touched = new Set<string>();
              for (const step of steps) {
                for (const link of getProcessAssetLinks(graph, step.id)) {
                  touched.add(link.asset.id);
                }
              }
              const inferred = steps.filter(
                (step) => step.status !== "confirmed",
              ).length;

              return (
                <article key={workflow.id}>
                  <span>
                    <strong>{workflow.name}</strong>
                    <small>{workflow.description ?? "—"}</small>
                  </span>
                  <div>
                    <b>{steps.length}</b>
                    <small>steps</small>
                  </div>
                  <div>
                    <b>{touched.size}</b>
                    <small>assets</small>
                  </div>
                  <div className={inferred > 0 ? "needs-review" : ""}>
                    <b>{inferred}</b>
                    <small>review</small>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <section className="matrix-card">
        <div className="section-heading">
          <div>
            <div className="eyebrow">WORKFLOW × ASSET MATRIX</div>
            <h2>どの業務が、何をどう触るか</h2>
          </div>
        </div>

        <div className="matrix-scroll">
          <table>
            <thead>
              <tr>
                <th>System / Data</th>
                {workflows.map((workflow) => (
                  <th key={workflow.id}>{workflow.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets
                .filter(({ usages }) => usages.length > 0)
                .sort((a, b) => b.usages.length - a.usages.length)
                .map(({ node }) => (
                  <tr key={node.id}>
                    <th>
                      <span
                        className={`asset-kind asset-kind--${node.kind}`}
                      >
                        {node.kind === "system" ? "SYS" : "DATA"}
                      </span>
                      {node.label}
                    </th>
                    {workflows.map((workflow) => {
                      const labels = matrixCell(node.id, workflow.id);
                      return (
                        <td key={workflow.id}>
                          {labels.length > 0 ? (
                            <span>{labels.join(" / ")}</span>
                          ) : (
                            <i>—</i>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function Workspace() {
  const [section, setSection] = useState<Section>("interviews");
  const [graph, setGraph] = useState<LensGraph>(() => createDemoGraph());
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    SAMPLE_WORKFLOWS[0].id,
  );
  const [transcripts, setTranscripts] = useState<Record<string, string>>(
    Object.fromEntries(
      SAMPLE_WORKFLOWS.map((sample) => [sample.id, sample.transcript]),
    ),
  );
  const [pending, setPending] = useState<PendingExtraction | null>(null);
  const [provider, setProvider] = useState("local-demo-extractor");

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">FL</div>
          <div>
            <strong>BusinessFlowLens</strong>
            <span>Interviews → workflows → shared business architecture</span>
          </div>
        </div>

        <ShellNav section={section} setSection={setSection} />

        <div className="header-meta">
          <span>{graph.workflows.length} workflows</span>
          <span className="prototype-badge">PROTOTYPE</span>
        </div>
      </header>

      {section === "interviews" ? (
        <InterviewsView
          graph={graph}
          selectedWorkflowId={selectedWorkflowId}
          setSelectedWorkflowId={setSelectedWorkflowId}
          transcripts={transcripts}
          setTranscripts={setTranscripts}
          pending={pending}
          setPending={setPending}
          provider={provider}
          setProvider={setProvider}
          onGraphApply={setGraph}
        />
      ) : null}

      {section === "workflow" ? (
        <WorkflowView
          graph={graph}
          workflowId={selectedWorkflowId}
          setWorkflowId={setSelectedWorkflowId}
        />
      ) : null}

      {section === "assets" ? <AssetsView graph={graph} /> : null}
      {section === "overview" ? <OverviewView graph={graph} /> : null}
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
