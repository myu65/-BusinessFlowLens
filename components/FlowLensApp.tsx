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
  getDataFlowsForSystem,
  getDepartments,
  getNodeRelationships,
  getNodeWorkflowIds,
  getProcessAssetLinks,
  getResponsiblePeople,
  getWorkflowProcesses,
  processMatchesOwnership,
  type ExtractionReview,
  type LensGraph,
  type LensNode,
  type NodeKind,
  type OwnershipFilter,
  type Relation,
  type SystemDataFlow,
} from "@/lib/graph";

type Section =
  | "interviews"
  | "workflow"
  | "dataflow"
  | "assets"
  | "overview";
type AssetFilter = "all" | "system" | "data";

type PendingExtraction = {
  review: ExtractionReview;
  provider: string;
  answers: Record<string, string>;
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

      <div className="step-ownership">
        {step.department ? <span>🏢 {step.department}</span> : null}
        {step.responsiblePerson ? (
          <span>👤 {step.responsiblePerson}</span>
        ) : step.actor ? (
          <span>👤 {step.actor}</span>
        ) : null}
      </div>

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
  ownership: OwnershipFilter,
): { nodes: WorkflowStepNode[]; edges: Edge[] } {
  const processes = getWorkflowProcesses(graph, workflowId).filter((process) =>
    processMatchesOwnership(process, ownership),
  );
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
    { id: "interviews", label: "業務入力", hint: "新規・更新" },
    { id: "workflow", label: "業務フロー", hint: "1業務を読む" },
    { id: "dataflow", label: "データフロー", hint: "System間の流れ" },
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

type OwnershipState = {
  department: string;
  responsiblePerson: string;
};

function ownershipFilter(state: OwnershipState): OwnershipFilter {
  return {
    department: state.department || null,
    responsiblePerson: state.responsiblePerson || null,
  };
}

function OwnershipFilters({
  graph,
  value,
  onChange,
}: {
  graph: LensGraph;
  value: OwnershipState;
  onChange: (value: OwnershipState) => void;
}) {
  const departments = getDepartments(graph);
  const people = getResponsiblePeople(graph);

  return (
    <div className="ownership-filters">
      <label>
        <span>部署</span>
        <select
          value={value.department}
          onChange={(event) =>
            onChange({ ...value, department: event.target.value })
          }
        >
          <option value="">すべて</option>
          {departments.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>担当者</span>
        <select
          value={value.responsiblePerson}
          onChange={(event) =>
            onChange({
              ...value,
              responsiblePerson: event.target.value,
            })
          }
        >
          <option value="">すべて</option>
          {people.map((person) => (
            <option key={person} value={person}>
              {person}
            </option>
          ))}
        </select>
      </label>
      {value.department || value.responsiblePerson ? (
        <button
          className="filter-clear"
          onClick={() =>
            onChange({ department: "", responsiblePerson: "" })
          }
        >
          クリア
        </button>
      ) : null}
    </div>
  );
}

function RelationshipPanel({
  graph,
  node,
  onClose,
  onSelectNode,
}: {
  graph: LensGraph;
  node: LensNode;
  onClose: () => void;
  onSelectNode?: (node: LensNode) => void;
}) {
  const relationships = getNodeRelationships(graph, node.id);
  const workflows = new Map(
    graph.workflows.map((workflow) => [workflow.id, workflow.name]),
  );
  const dataFlows =
    node.kind === "system" ? getDataFlowsForSystem(graph, node.id) : [];

  return (
    <aside className="relationship-panel">
      <button className="close-button" onClick={onClose}>
        ×
      </button>
      <div className="eyebrow">RELATED TO THIS NODE</div>
      <div className="relationship-title">
        <span className={`asset-kind asset-kind--${node.kind}`}>
          {node.kind === "process"
            ? "STEP"
            : node.kind === "system"
              ? "SYS"
              : "DATA"}
        </span>
        <h2>{node.label}</h2>
      </div>

      {node.kind === "process" ? (
        <div className="relationship-owner">
          <span>部署</span>
          <strong>{node.department ?? "未確認"}</strong>
          <span>担当者</span>
          <strong>{node.responsiblePerson ?? node.actor ?? "未確認"}</strong>
        </div>
      ) : null}

      <p>{node.description}</p>

      <div className="relationship-section">
        <header>
          <strong>直接関連</strong>
          <span>{relationships.length}</span>
        </header>
        <div className="relationship-list">
          {relationships.map((item, index) => (
            <button
              key={`${item.node.id}-${item.relation}-${index}`}
              onClick={() => onSelectNode?.(item.node)}
            >
              <span
                className={`asset-kind asset-kind--${item.node.kind}`}
              >
                {item.node.kind === "process"
                  ? "STEP"
                  : item.node.kind === "system"
                    ? "SYS"
                    : "DATA"}
              </span>
              <span>
                <strong>{item.node.label}</strong>
                <small>
                  {item.relation}
                  {item.workflowIds.length > 0
                    ? ` · ${item.workflowIds
                        .map((id) => workflows.get(id) ?? id)
                        .join(" / ")}`
                    : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      </div>

      {dataFlows.length > 0 ? (
        <div className="relationship-section">
          <header>
            <strong>System間データフロー</strong>
            <span>{dataFlows.length}</span>
          </header>
          <div className="relationship-flows">
            {dataFlows.map((flow) => {
              const source = graph.nodes.find(
                (item) => item.id === flow.sourceSystemId,
              );
              const target = graph.nodes.find(
                (item) => item.id === flow.targetSystemId,
              );
              const data = flow.dataIds
                .map((id) => graph.nodes.find((item) => item.id === id)?.label)
                .filter(Boolean)
                .join(" / ");

              return (
                <article key={flow.id}>
                  <strong>
                    {source?.label ?? "?"} → {target?.label ?? "?"}
                  </strong>
                  <span>{data || "データ未特定"}</span>
                  <small>
                    {flow.transferType} · {flow.automation}
                    {flow.frequency ? ` · ${flow.frequency}` : ""}
                  </small>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </aside>
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
  onRefine,
  applying,
  refining,
}: {
  pending: PendingExtraction | null;
  onChange: (pending: PendingExtraction) => void;
  onApply: () => void;
  onDiscard: () => void;
  onRefine: () => void;
  applying: boolean;
  refining: boolean;
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

  const changeAnswer = (question: string, answer: string) =>
    onChange({
      ...pending,
      answers: {
        ...pending.answers,
        [question]: answer,
      },
    });

  const hasFollowUpAnswers = review.questions.some(
    (question) => (pending.answers[question.question] ?? "").trim().length > 0,
  );

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

  const updateDataFlow = (
    index: number,
    patch: Partial<ExtractionReview["dataFlows"][number]>,
  ) => {
    changeReview({
      ...review,
      dataFlows: review.dataFlows.map((flow, itemIndex) =>
        itemIndex === index ? { ...flow, ...patch } : flow,
      ),
    });
  };

  const removeDataFlow = (index: number) => {
    changeReview({
      ...review,
      dataFlows: review.dataFlows.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
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

              <div className="review-step-meta review-step-meta--ownership">
                <input
                  value={step.actor ?? ""}
                  placeholder="役割 例: 営業担当"
                  onChange={(event) =>
                    updateStep(step.stepKey, {
                      actor: event.target.value || null,
                    })
                  }
                />
                <input
                  value={step.department ?? ""}
                  placeholder="部署 例: 営業部"
                  onChange={(event) =>
                    updateStep(step.stepKey, {
                      department: event.target.value || null,
                    })
                  }
                />
                <input
                  value={step.responsiblePerson ?? ""}
                  placeholder="担当者 例: 田中さん"
                  onChange={(event) =>
                    updateStep(step.stepKey, {
                      responsiblePerson: event.target.value || null,
                    })
                  }
                />
              </div>
              <div className="review-evidence">
                {step.certainty === "explicit" ? "明示" : "AI推定"} · 根拠:{" "}
                {step.evidence || "—"}
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

        {review.dataFlows.length > 0 ? (
          <div className="review-dataflows">
            <div className="review-section-title">
              <span>System間データフロー</span>
              <b>{review.dataFlows.length}</b>
            </div>
            {review.dataFlows.map((flow, index) => (
              <article key={`${flow.sourceSystem}-${flow.targetSystem}-${index}`}>
                <div className="review-dataflow-title">
                  <input
                    value={flow.sourceSystem}
                    onChange={(event) =>
                      updateDataFlow(index, {
                        sourceSystem: event.target.value,
                      })
                    }
                  />
                  <span>→</span>
                  <input
                    value={flow.targetSystem}
                    onChange={(event) =>
                      updateDataFlow(index, {
                        targetSystem: event.target.value,
                      })
                    }
                  />
                  <button
                    className="review-delete"
                    onClick={() => removeDataFlow(index)}
                    title="このデータフローを除外"
                  >
                    ×
                  </button>
                </div>
                <input
                  className="review-dataflow-data"
                  value={flow.data.join(", ")}
                  placeholder="流れるデータ（カンマ区切り）"
                  onChange={(event) =>
                    updateDataFlow(index, {
                      data: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <div className="review-dataflow-options">
                  <select
                    value={flow.transferType}
                    onChange={(event) =>
                      updateDataFlow(index, {
                        transferType: event.target.value as typeof flow.transferType,
                      })
                    }
                  >
                    {["api", "file", "database", "message", "email", "manual", "unknown"].map(
                      (item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ),
                    )}
                  </select>
                  <select
                    value={flow.direction}
                    onChange={(event) =>
                      updateDataFlow(index, {
                        direction: event.target.value as typeof flow.direction,
                      })
                    }
                  >
                    {["push", "pull", "bidirectional", "unknown"].map(
                      (item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ),
                    )}
                  </select>
                  <select
                    value={flow.automation}
                    onChange={(event) =>
                      updateDataFlow(index, {
                        automation: event.target.value as typeof flow.automation,
                      })
                    }
                  >
                    {["automatic", "manual", "mixed", "unknown"].map(
                      (item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ),
                    )}
                  </select>
                  <input
                    value={flow.frequency ?? ""}
                    placeholder="頻度 例: 15分ごと"
                    onChange={(event) =>
                      updateDataFlow(index, {
                        frequency: event.target.value || null,
                      })
                    }
                  />
                </div>
                <small>根拠: {flow.evidence || "—"}</small>
              </article>
            ))}
          </div>
        ) : null}

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
              <article key={question.question} className="followup-question">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{question.question}</strong>
                  <small>{question.reason}</small>
                  <textarea
                    value={pending.answers[question.question] ?? ""}
                    placeholder="ここに回答・補足を入力"
                    onChange={(event) =>
                      changeAnswer(question.question, event.target.value)
                    }
                  />
                </div>
              </article>
            ))}
            <div className="followup-refine">
              <p>
                回答は元のヒアリングへの追加情報としてAIに戻し、現在の手修正もできるだけ保持して下書きを更新します。
              </p>
              <button
                className="button-secondary"
                onClick={onRefine}
                disabled={!hasFollowUpAnswers || refining || applying}
              >
                {refining ? "回答を反映中…" : "回答をAIに反映して再整理"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="review-actions">
        <button
          className="button-secondary"
          onClick={onDiscard}
          disabled={applying || refining}
        >
          破棄
        </button>
        <button
          className="button-primary"
          onClick={onApply}
          disabled={applying || refining || review.steps.length === 0}
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
  const [refining, setRefining] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const workflow = graph.workflows.find(
    (item) => item.id === selectedWorkflowId,
  );
  const existingProcessCount = workflow
    ? getWorkflowProcesses(graph, workflow.id).length
    : 0;
  const isStructured = existingProcessCount > 0;

  function updateWorkflowMeta(patch: {
    name?: string;
    description?: string;
  }) {
    if (!workflow) return;

    onGraphApply({
      ...graph,
      workflows: graph.workflows.map((item) =>
        item.id === workflow.id
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    });
  }

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
          graph,
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
        answers: {},
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "抽出に失敗しました。",
      );
    } finally {
      setMapping(false);
    }
  }

  async function refineDraft() {
    if (!workflow || !pending) return;

    const interview = transcripts[workflow.id]?.trim();
    if (!interview) return;

    const followUpAnswers = pending.review.questions
      .map((question) => ({
        question: question.question,
        answer: pending.answers[question.question] ?? "",
      }))
      .filter((item) => item.answer.trim().length > 0);

    if (followUpAnswers.length === 0) return;

    setRefining(true);
    setError(null);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interview,
          workflow,
          graph,
          previousReview: pending.review,
          followUpAnswers,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "追加回答の反映に失敗しました。");
      }

      setProvider(payload.provider ?? pending.provider);
      setPending({
        review: payload.review,
        provider: payload.provider ?? pending.provider,
        answers: {},
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "追加回答の反映に失敗しました。",
      );
    } finally {
      setRefining(false);
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
            <div className="eyebrow">BUSINESS INPUT</div>
            <h2>業務一覧</h2>
          </div>
          <button
            className="icon-button"
            onClick={() => setCreating((value) => !value)}
            aria-label="新規業務"
          >
            ＋
          </button>
        </div>

        {creating ? (
          <div className="create-workflow">
            <input
              autoFocus
              placeholder="新しい業務名 例: 購買業務"
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
            <div className="eyebrow">BUSINESS INPUT</div>
            <h1>{isStructured ? "既存業務を更新" : "業務を入力"}</h1>
            <p>
              業務情報とヒアリングメモを更新し、AI下書きを確認して同じ業務モデルへ反映します。
            </p>
          </div>
          <div className="editor-status">
            <span className="provider-badge">
              {isStructured
                ? `構造化済み · ${existingProcessCount} steps`
                : "未構造化"}
            </span>
            <span className="provider-badge">{provider}</span>
          </div>
        </div>

        {workflow ? (
          <div className="workflow-meta-editor">
            <label>
              <span>業務名</span>
              <input
                value={workflow.name}
                onChange={(event) =>
                  updateWorkflowMeta({
                    name: event.target.value,
                  })
                }
                placeholder="例: 受注業務"
              />
            </label>
            <label>
              <span>概要</span>
              <input
                value={workflow.description ?? ""}
                onChange={(event) =>
                  updateWorkflowMeta({
                    description: event.target.value,
                  })
                }
                placeholder="例: 注文書受領から出荷手配まで"
              />
            </label>
          </div>
        ) : null}

        <div className="business-notes-label">
          <span>ヒアリング / 業務メモ</span>
          <small>
            会話のメモ、既存手順、補足情報をそのまま入力できます。
          </small>
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
            {isStructured
              ? "現在の業務構造を直接壊さず、新しい下書きをレビューしてから同じ業務IDへ更新します。"
              : "まずAI下書きを作り、レビューしてから新しい業務構造として反映します。"}
          </p>
          <button
            className="button-primary button-primary--large"
            disabled={
              mapping ||
              !workflow?.name.trim() ||
              !(transcripts[selectedWorkflowId] ?? "").trim()
            }
            onClick={extract}
          >
            {mapping
              ? "構造を読み取り中…"
              : isStructured
                ? "AIで構造を更新"
                : "AIで構造化"}
          </button>
        </div>
      </main>

      <ReviewPanel
        pending={pending}
        onChange={setPending}
        onDiscard={() => setPending(null)}
        onRefine={refineDraft}
        onApply={applyDraft}
        applying={applying}
        refining={refining}
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<OwnershipState>({
    department: "",
    responsiblePerson: "",
  });

  const workflow = graph.workflows.find((item) => item.id === workflowId);
  const filter = ownershipFilter(ownership);
  const processes = getWorkflowProcesses(graph, workflowId).filter((process) =>
    processMatchesOwnership(process, filter),
  );
  const flow = useMemo(
    () => workflowFlow(graph, workflowId, filter),
    [graph, workflowId, ownership.department, ownership.responsiblePerson],
  );

  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? null;

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
      <header className="page-header page-header--stackable">
        <div>
          <div className="eyebrow">WORKFLOW DETAIL</div>
          <h1>1業務を、担当の視点で読む</h1>
          <p>
            部署・担当者で絞りながら、ステップを押すと前後工程・利用System・Dataまで関連を辿れます。
          </p>
        </div>
        <div className="page-header-controls">
          <WorkflowPicker
            graph={graph}
            selectedWorkflowId={workflowId}
            onSelect={(id) => {
              setWorkflowId(id);
              setSelectedNodeId(null);
            }}
          />
          <OwnershipFilters
            graph={graph}
            value={ownership}
            onChange={(value) => {
              setOwnership(value);
              setSelectedNodeId(null);
            }}
          />
        </div>
      </header>

      <div className="workflow-summary">
        <div>
          <span>業務</span>
          <strong>{workflow?.name ?? "—"}</strong>
        </div>
        <div>
          <span>表示ステップ</span>
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
          <strong>条件に合うステップがありません</strong>
          <p>部署・担当者フィルタを変更するか、ヒアリング内容を確認してください。</p>
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
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={28} size={1} />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>

          {selectedNode ? (
            <RelationshipPanel
              graph={graph}
              node={selectedNode}
              onClose={() => setSelectedNodeId(null)}
              onSelectNode={(node) => setSelectedNodeId(node.id)}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

function AssetsView({ graph }: { graph: LensGraph }) {
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [search, setSearch] = useState("");
  const [ownership, setOwnership] = useState<OwnershipState>({
    department: "",
    responsiblePerson: "",
  });
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const processById = new Map(
    graph.nodes
      .filter((node) => node.kind === "process")
      .map((node) => [node.id, node]),
  );
  const ownerFilter = ownershipFilter(ownership);

  const assets = graph.nodes
    .filter((node) => node.kind === "system" || node.kind === "data")
    .map((node) => ({
      node,
      usages: getAssetUsages(graph, node.id).filter((usage) => {
        const process = processById.get(usage.processId);
        return process
          ? processMatchesOwnership(process, ownerFilter)
          : !ownership.department && !ownership.responsiblePerson;
      }),
    }))
    .filter(
      ({ node, usages }) =>
        usages.length > 0 &&
        (filter === "all" || node.kind === filter) &&
        (!search.trim() ||
          node.label.toLowerCase().includes(search.trim().toLowerCase()) ||
          node.description
            .toLowerCase()
            .includes(search.trim().toLowerCase())),
    )
    .sort((a, b) => b.usages.length - a.usages.length);

  const selected =
    assets.find(({ node }) => node.id === selectedAssetId) ??
    assets[0] ??
    null;

  const workflowGroups = new Map<string, NonNullable<typeof selected>["usages"]>();
  if (selected) {
    for (const usage of selected.usages) {
      const list = workflowGroups.get(usage.workflowId) ?? [];
      list.push(usage);
      workflowGroups.set(usage.workflowId, list);
    }
  }

  const selectedFlows =
    selected?.node.kind === "system"
      ? getDataFlowsForSystem(graph, selected.node.id).filter((flow) => {
          if (!ownership.department && !ownership.responsiblePerson) return true;
          return flow.processIds.some((processId) => {
            const process = processById.get(processId);
            return process
              ? processMatchesOwnership(process, ownerFilter)
              : false;
          });
        })
      : [];

  return (
    <section className="page-view">
      <header className="page-header page-header--stackable">
        <div>
          <div className="eyebrow">ASSET IMPACT</div>
          <h1>システム・データから、担当と影響範囲を辿る</h1>
          <p>
            資産を押すと、どの部署・担当者のどの業務ステップが、読む・書く・使うのかを確認できます。
          </p>
        </div>
        <OwnershipFilters
          graph={graph}
          value={ownership}
          onChange={(value) => {
            setOwnership(value);
            setSelectedAssetId(null);
          }}
        />
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
                  <span className={`asset-kind asset-kind--${node.kind}`}>
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

              <div className="impact-workflows">
                {[...workflowGroups.entries()].map(
                  ([workflowId, usages]) => (
                    <section key={workflowId}>
                      <header>
                        <strong>{usages[0].workflowName}</strong>
                        <span>{usages.length} touchpoints</span>
                      </header>
                      {usages.map((usage) => {
                        const process = processById.get(usage.processId);
                        return (
                          <article
                            key={`${usage.processId}-${usage.relation}`}
                          >
                            <span className="impact-owner">
                              {process?.department ?? "部署未確認"}
                              {process?.responsiblePerson
                                ? ` · ${process.responsiblePerson}`
                                : ""}
                            </span>
                            <strong>{usage.processName}</strong>
                            <span>{relationLabel[usage.relation]}</span>
                            <small>{usage.label ?? "—"}</small>
                          </article>
                        );
                      })}
                    </section>
                  ),
                )}
              </div>

              {selectedFlows.length > 0 ? (
                <section className="impact-dataflows">
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">SYSTEM DATA FLOWS</div>
                      <h2>このSystemにつながるデータフロー</h2>
                    </div>
                  </div>
                  {selectedFlows.map((flow) => {
                    const source = graph.nodes.find(
                      (node) => node.id === flow.sourceSystemId,
                    );
                    const target = graph.nodes.find(
                      (node) => node.id === flow.targetSystemId,
                    );
                    const data = flow.dataIds
                      .map(
                        (id) =>
                          graph.nodes.find((node) => node.id === id)?.label,
                      )
                      .filter(Boolean)
                      .join(" / ");
                    return (
                      <article key={flow.id}>
                        <strong>
                          {source?.label ?? "?"} → {target?.label ?? "?"}
                        </strong>
                        <span>{data || "データ未特定"}</span>
                        <small>
                          {flow.transferType} · {flow.automation}
                          {flow.frequency ? ` · ${flow.frequency}` : ""}
                        </small>
                      </article>
                    );
                  })}
                </section>
              ) : null}
            </>
          ) : (
            <div className="empty-state">
              条件に合うシステム・データがありません。
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function DataFlowView({ graph }: { graph: LensGraph }) {
  const [ownership, setOwnership] = useState<OwnershipState>({
    department: "",
    responsiblePerson: "",
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);

  const ownerFilter = ownershipFilter(ownership);
  const processById = new Map(
    graph.nodes
      .filter((node) => node.kind === "process")
      .map((node) => [node.id, node]),
  );

  const flows = (graph.dataFlows ?? []).filter((flow) => {
    if (!ownership.department && !ownership.responsiblePerson) return true;
    return flow.processIds.some((processId) => {
      const process = processById.get(processId);
      return process
        ? processMatchesOwnership(process, ownerFilter)
        : false;
    });
  });

  const systemIds = new Set(
    flows.flatMap((flow) => [flow.sourceSystemId, flow.targetSystemId]),
  );
  const systems = graph.nodes.filter(
    (node) => node.kind === "system" && systemIds.has(node.id),
  );

  const flowNodes: Node[] = systems.map((system, index) => ({
    id: system.id,
    position: {
      x: (index % 4) * 310,
      y: Math.floor(index / 4) * 220 + (index % 2) * 35,
    },
    data: {
      label: system.label,
    },
    style: {
      width: 220,
      borderRadius: 12,
      border: "1px solid #cfd5eb",
      background: "#ffffff",
      padding: 14,
      fontSize: 12,
      fontWeight: 800,
      boxShadow: "0 8px 24px rgba(42, 47, 42, 0.08)",
    },
  }));

  const flowEdges: Edge[] = flows.map((flow) => {
    const dataLabels = flow.dataIds
      .map((id) => graph.nodes.find((node) => node.id === id)?.label)
      .filter(Boolean);
    const manual = flow.automation === "manual" || flow.transferType === "manual";

    return {
      id: flow.id,
      source: flow.sourceSystemId,
      target: flow.targetSystemId,
      label: [
        dataLabels.join(" / ") || "データ未特定",
        flow.transferType,
        flow.frequency,
      ]
        .filter(Boolean)
        .join(" · "),
      type: "smoothstep",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
      },
      style: {
        strokeWidth: 2,
        strokeDasharray: manual ? "7 5" : undefined,
      },
      labelStyle: { fontSize: 9, fontWeight: 750 },
      labelBgPadding: [7, 5],
      labelBgBorderRadius: 6,
    };
  });

  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedFlow =
    flows.find((flow) => flow.id === selectedFlowId) ?? null;

  return (
    <section className="page-view">
      <header className="page-header page-header--stackable">
        <div>
          <div className="eyebrow">SYSTEM DATA FLOW</div>
          <h1>System間で、何がどう動くかを見る</h1>
          <p>
            Systemを主役にして、転送されるData・API/ファイル/手入力・自動/手動・頻度をエッジに集約します。
          </p>
        </div>
        <OwnershipFilters
          graph={graph}
          value={ownership}
          onChange={(value) => {
            setOwnership(value);
            setSelectedNodeId(null);
            setSelectedFlowId(null);
          }}
        />
      </header>

      <div className="dataflow-summary">
        <article>
          <span>表示System</span>
          <strong>{systems.length}</strong>
        </article>
        <article>
          <span>データフロー</span>
          <strong>{flows.length}</strong>
        </article>
        <article>
          <span>手動転記</span>
          <strong>
            {
              flows.filter(
                (flow) =>
                  flow.automation === "manual" ||
                  flow.transferType === "manual",
              ).length
            }
          </strong>
        </article>
        <article>
          <span>要確認</span>
          <strong>
            {flows.filter((flow) => flow.status !== "confirmed").length}
          </strong>
        </article>
      </div>

      {flows.length === 0 ? (
        <div className="empty-state">
          <strong>条件に合うSystem間データフローがありません</strong>
          <p>
            ヒアリングで「どのSystemからどのSystemへ、何をどう渡すか」を明示すると抽出されます。
          </p>
        </div>
      ) : (
        <div className="dataflow-canvas-wrap">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.35}
            maxZoom={1.4}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedFlowId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedFlowId(edge.id);
              setSelectedNodeId(null);
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={28} size={1} />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>

          {selectedNode ? (
            <RelationshipPanel
              graph={graph}
              node={selectedNode}
              onClose={() => setSelectedNodeId(null)}
              onSelectNode={(node) => {
                setSelectedNodeId(node.id);
                setSelectedFlowId(null);
              }}
            />
          ) : null}

          {selectedFlow ? (
            <aside className="relationship-panel dataflow-detail-panel">
              <button
                className="close-button"
                onClick={() => setSelectedFlowId(null)}
              >
                ×
              </button>
              <div className="eyebrow">DATA FLOW DETAIL</div>
              <h2>
                {graph.nodes.find(
                  (node) => node.id === selectedFlow.sourceSystemId,
                )?.label ?? "?"}
                {" → "}
                {graph.nodes.find(
                  (node) => node.id === selectedFlow.targetSystemId,
                )?.label ?? "?"}
              </h2>

              <div className="dataflow-detail-grid">
                <span>Data</span>
                <strong>
                  {selectedFlow.dataIds
                    .map(
                      (id) =>
                        graph.nodes.find((node) => node.id === id)?.label,
                    )
                    .filter(Boolean)
                    .join(" / ") || "未特定"}
                </strong>
                <span>方式</span>
                <strong>{selectedFlow.transferType}</strong>
                <span>自動化</span>
                <strong>{selectedFlow.automation}</strong>
                <span>方向</span>
                <strong>{selectedFlow.direction}</strong>
                <span>頻度</span>
                <strong>{selectedFlow.frequency ?? "未確認"}</strong>
              </div>

              <div className="relationship-section">
                <header>
                  <strong>関連する担当・業務</strong>
                  <span>{selectedFlow.processIds.length}</span>
                </header>
                <div className="flow-process-context">
                  {selectedFlow.processIds.map((processId) => {
                    const process = processById.get(processId);
                    if (!process) return null;
                    const workflow = graph.workflows.find(
                      (item) => item.id === process.workflowId,
                    );
                    return (
                      <article key={processId}>
                        <strong>{process.label}</strong>
                        <span>
                          {process.department ?? "部署未確認"}
                          {process.responsiblePerson
                            ? ` · ${process.responsiblePerson}`
                            : ""}
                        </span>
                        <small>{workflow?.name ?? "—"}</small>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="flow-evidence">
                <span>根拠</span>
                <p>{selectedFlow.evidence ?? "—"}</p>
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}

function OverviewView({ graph }: { graph: LensGraph }) {
  const [ownership, setOwnership] = useState<OwnershipState>({
    department: "",
    responsiblePerson: "",
  });
  const ownerFilter = ownershipFilter(ownership);
  const processById = new Map(
    graph.nodes
      .filter((node) => node.kind === "process")
      .map((node) => [node.id, node]),
  );

  const filteredUsages = (assetId: string) =>
    getAssetUsages(graph, assetId).filter((usage) => {
      const process = processById.get(usage.processId);
      return process
        ? processMatchesOwnership(process, ownerFilter)
        : false;
    });

  const workflows = graph.workflows.filter((workflow) => {
    if (!ownership.department && !ownership.responsiblePerson) return true;
    return getWorkflowProcesses(graph, workflow.id).some((process) =>
      processMatchesOwnership(process, ownerFilter),
    );
  });

  const assets = graph.nodes
    .filter((node) => node.kind === "system" || node.kind === "data")
    .map((node) => ({
      node,
      usages: filteredUsages(node.id),
    }))
    .filter(({ usages }) => usages.length > 0);

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
    const usages = filteredUsages(assetId).filter(
      (usage) => usage.workflowId === workflowId,
    );
    return [
      ...new Set(usages.map((usage) => relationLabel[usage.relation])),
    ];
  }

  return (
    <section className="page-view">
      <header className="page-header page-header--stackable">
        <div>
          <div className="eyebrow">CROSS-BUSINESS OVERVIEW</div>
          <h1>部署・担当者を軸に、共有と依存を見る</h1>
          <p>
            全社グラフではなく、フィルタ後の業務・共有資産・利用関係をマトリクスで比較します。
          </p>
        </div>
        <OwnershipFilters
          graph={graph}
          value={ownership}
          onChange={setOwnership}
        />
      </header>

      <div className="overview-stats">
        <article>
          <span>表示業務</span>
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
              <h2>フィルタ対象が共通利用するもの</h2>
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
            <div className="empty-state">共有資産はありません。</div>
          )}
        </section>

        <section className="workflow-health-card">
          <div className="section-heading">
            <div>
              <div className="eyebrow">WORKFLOWS</div>
              <h2>対象者が関わる業務</h2>
            </div>
          </div>
          <div className="workflow-health">
            {workflows.map((workflow) => {
              const steps = getWorkflowProcesses(graph, workflow.id).filter(
                (step) => processMatchesOwnership(step, ownerFilter),
              );
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
            <h2>誰の仕事が、何に依存しているか</h2>
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

      {section === "dataflow" ? <DataFlowView graph={graph} /> : null}

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
