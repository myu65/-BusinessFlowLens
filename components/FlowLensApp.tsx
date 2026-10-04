"use client";

import { scopedDataFlows, aggregateDataFlows, scenarioGraph } from "@/lib/knowledge";
import { DataFlowExplorer } from "./DataFlowExplorer";
import { KnowledgeExplorer, type KnowledgeExploration } from "./KnowledgeExplorer";
import { exploreSavedStory } from "@/lib/exploration";
import { InputWorkbench } from "./InputWorkbench";
import { AssetExplorer, CrossBusinessOverview, type AssetExploration } from "./ScopedExplorers";
import { NEW_MEMO_ID, hasUnreflectedNotes, inputKeyForWorkflow, previewReviewGraph, recordReviewEdits, type InputDraft } from "@/lib/review-workbench";

import { StepDetailEditor, TechnicalDetails, WorkflowExplorer } from "./ProgressiveWorkflow";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getDataFlowsForSystem,
  getDepartments,
  getNodeRelationships,
  getProcessExecutionMode,
  getProcessAssetLinks,
  getResponsiblePeople,
  getWorkflowProcesses,
  processMatchesOwnership,
  type ExtractionReview,
  type FollowUpAnswer,
  type LensGraph,
  type LensNode,
  type NodeKind,
  type OwnershipFilter,
  type ProcessExecutionMode,
  type Relation,
  type Workflow,
  type WorkflowScenario,
} from "@/lib/graph";

type Section =
  | "company"
  | "interviews"
  | "workflow"
  | "dataflow"
  | "assets"
  | "overview";


type PendingExtraction = {
  workflowId: string;
  review: ExtractionReview;
  provider: string;
  answers: Record<string, string>;
  answerHistory: FollowUpAnswer[];
};

type RevisionSummary = {
  id: number;
  projectId: string;
  workflowId: string;
  revisionNumber: number;
  workflowName: string;
  summary: string;
  updatedBy: string;
  createdAt: string;
};

type RevisionDetail = RevisionSummary & {
  workflowDescription?: string;
  familyId?: string;
  scenario?: string;
  scenarioLabel?: string;
  basedOnWorkflowId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceNotes: string;
  followUpAnswers: FollowUpAnswer[];
  review: ExtractionReview;
};

type StepNodeData = {
  step: LensNode;
  systems: string[];
  executingSystem?: string;
  data: Array<{ label: string; relation: Relation }>;
};

type WorkflowStepNode = Node<StepNodeData, "workflowStep">;

const relationLabel: Record<Relation, string> = {
  next: "次へ",
  uses: "利用",
  reads: "参照",
  writes: "更新",
  sends: "送信",
  executes: "自動実行",
};

const kindLabel: Record<NodeKind, string> = {
  process: "業務",
  system: "システム",
  data: "データ",
};

function WorkflowStepCard({ data, selected }: NodeProps<WorkflowStepNode>) {
  const {
    step,
    systems,
    executingSystem,
    data: dataAssets,
  } = data;

  const executionMode =
    step.executionMode ??
    (executingSystem
      ? "automatic"
      : step.actor || step.responsiblePerson
        ? "manual"
        : "unknown");
  const executionLabel: Record<ProcessExecutionMode, string> = {
    manual: "👤 手作業",
    automatic: "⚙ 自動",
    mixed: "👤⚙ 人＋自動",
    unknown: "? 実行不明",
  };

  return (
    <div
      className={[
        "step-node",
        selected ? "step-node--selected" : "",
        step.status === "inferred" ? "step-node--inferred" : "",
        `step-node--execution-${executionMode}`,
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
        <span className={`execution-badge execution-badge--${executionMode}`}>
          {executionLabel[executionMode]}
        </span>
        {executingSystem ? <span>⚙ {executingSystem}</span> : null}
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
  executionMode: "all" | ProcessExecutionMode = "all",
): { nodes: WorkflowStepNode[]; edges: Edge[] } {
  const processes = getWorkflowProcesses(graph, workflowId).filter(
    (process) =>
      processMatchesOwnership(process, ownership) &&
      (executionMode === "all" ||
        getProcessExecutionMode(graph, process) === executionMode),
  );
  const processIds = new Set(processes.map((process) => process.id));

  const nodes: WorkflowStepNode[] = processes.map((step, index) => {
    const links = getProcessAssetLinks(graph, step.id);
    const executingSystem = links.find(
      (link) =>
        link.asset.kind === "system" &&
        link.relation === "executes",
    )?.asset.label;
    const systems = links
      .filter(
        (link) =>
          link.asset.kind === "system" &&
          link.relation !== "executes",
      )
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
      data: { step: { ...step, stepOrder: step.stepOrder ?? index + 1 }, systems, executingSystem, data },
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
      label: edge.holdEffect === "response" ? `停止中の対応${edge.label ? `：${edge.label}` : ""}` : edge.holdEffect === "resume" ? `再開${edge.label ? `：${edge.label}` : ""}` : edge.label,
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
  const items: Array<{ id: Section; label: string }> = [
    { id: "interviews", label: "話を入力" },
    { id: "company", label: "会社の全体像" },
    { id: "assets", label: "詳しく調べる" },
  ];

  return (
    <nav className="main-nav" aria-label="アプリの使い方を選ぶ">
      {items.map((item) => {
        const active = section === item.id || (item.id === "assets" && !["company", "interviews"].includes(section));
        return (
        <button
          key={item.id}
          className={active ? "active" : ""}
          aria-current={active ? "page" : undefined}
          onClick={() => setSection(active ? section : item.id)}
        >
          <strong>{item.label}</strong>
        </button>
        );
      })}
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
          <span>実行方式</span>
          <strong>
            {node.executionMode === "automatic"
              ? "System内で自動"
              : node.executionMode === "mixed"
                ? "人＋自動"
                : node.executionMode === "manual"
                  ? "手作業"
                  : "未確認"}
          </strong>
          <span>部署</span>
          <strong>{node.department ?? "未確認"}</strong>
          <span>担当者</span>
          <strong>{node.responsiblePerson ?? node.actor ?? "未確認"}</strong>
        </div>
      ) : null}

      <p>{node.description}</p>
      {node.kind === "process" ? <TechnicalDetails node={node} /> : null}

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
  const [query, setQuery] = useState("");
  const matching = graph.workflows.filter(w => `${w.name} ${w.description ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if (graph.workflows.length > 8) return <div className="kg-toolbar">
    <label>業務選択の検索<input value={query} onChange={e => setQuery(e.target.value)} placeholder="業務名・工場・製品" /></label>
    <label>表示する業務<select value={selectedWorkflowId} onChange={e => onSelect(e.target.value)}>
      {!matching.some(w => w.id === selectedWorkflowId) && <option value={selectedWorkflowId}>{graph.workflows.find(w => w.id === selectedWorkflowId)?.name}（現在表示中）</option>}
      {matching.map(w => <option key={w.id} value={w.id}>{w.name} / {w.scenario ?? 'current'}</option>)}
    </select></label><span>{matching.length}件</span>
  </div>;
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
  graph,
  model,
  dirty,
  onChange,
  onApply,
  onDiscard,
  onRefine,
  applying,
  refining,
  revisions,
  historyDetail,
  historyLoading,
  onOpenRevision,
  onCloseHistory,
}: {
  graph: LensGraph;
  model: PendingExtraction | null;
  dirty: boolean;
  onChange: (pending: PendingExtraction) => void;
  onApply: () => void;
  onDiscard: () => void;
  onRefine: () => void;
  applying: boolean;
  refining: boolean;
  revisions: RevisionSummary[];
  historyDetail: RevisionDetail | null;
  historyLoading: boolean;
  onOpenRevision: (id: number) => void;
  onCloseHistory: () => void;
}) {
  if (!model) {
    return (
      <aside className="review-panel review-panel--empty">
        <div className="eyebrow">BUSINESS MODEL</div>
        <h2>業務構造はまだありません</h2>
        <p>
          左の業務メモからAIで構造化すると、ここにステップ・担当・
          System/Data・データフローが表示されます。
        </p>
        <div className="review-principles">
          <span>01 業務メモから構造化</span>
          <span>02 ここで直接修正</span>
          <span>03 保存時に共有資産を照合</span>
        </div>
      </aside>
    );
  }

  const { review } = model;
  const systemOptions = [
    ...new Set(
      graph.nodes
        .filter((node) => node.kind === "system")
        .map((node) => node.label),
    ),
  ].sort((a, b) => a.localeCompare(b, "ja"));
  const dataOptions = [
    ...new Set(
      graph.nodes
        .filter((node) => node.kind === "data")
        .map((node) => node.label),
    ),
  ].sort((a, b) => a.localeCompare(b, "ja"));

  const changeReview = (nextReview: ExtractionReview) =>
    onChange({ ...model, review: nextReview });

  const changeAnswer = (question: string, answer: string) =>
    onChange({
      ...model,
      answers: {
        ...model.answers,
        [question]: answer,
      },
    });

  const hasFollowUpAnswers = review.questions.some(
    (question) => (model.answers[question.question] ?? "").trim().length > 0,
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

  const addStep = () => {
    const used = new Set(review.steps.map((step) => step.stepKey));
    let index = review.steps.length + 1;
    let stepKey = `manual-step-${index}`;
    while (used.has(stepKey)) {
      index += 1;
      stepKey = `manual-step-${index}`;
    }

    const steps = [
      ...review.steps,
      {
        stepKey,
        name: "新しいステップ",
        order: review.steps.length + 1,
        actor: null,
        department: null,
        responsiblePerson: null,
        executionMode: "unknown" as const,
        executingSystem: null,
        action: "",
        certainty: "explicit" as const,
        evidence: "手動追加",
        systems: [],
        data: [],
      },
    ];

    changeReview({
      ...review,
      steps,
    });
  };

  const moveStep = (stepKey: string, direction: -1 | 1) => {
    const index = review.steps.findIndex(
      (step) => step.stepKey === stepKey,
    );
    const target = index + direction;
    if (index < 0 || target < 0 || target >= review.steps.length) return;

    const steps = [...review.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    const reordered = steps.map((step, itemIndex) => ({
      ...step,
      order: itemIndex + 1,
    }));

    changeReview({
      ...review,
      steps: reordered,
    });
  };

  const removeStep = (stepKey: string) => {
    if (!window.confirm("この業務ステップを削除しますか？")) return;

    const steps = review.steps
      .filter((step) => step.stepKey !== stepKey)
      .map((step, index) => ({ ...step, order: index + 1 }));

    changeReview({
      ...review,
      steps,
      transitions: review.transitions.filter(
        (transition) =>
          transition.fromStepKey !== stepKey &&
          transition.toStepKey !== stepKey,
      ),
      dataFlows: review.dataFlows.map((flow) => ({
        ...flow,
        relatedStepKeys: flow.relatedStepKeys.filter(
          (key) => key !== stepKey,
        ),
      })),
    });
  };

  const updateSystem = (
    stepKey: string,
    index: number,
    patch: Partial<ExtractionReview["steps"][number]["systems"][number]>,
  ) => {
    const step = review.steps.find((item) => item.stepKey === stepKey);
    if (!step) return;
    updateStep(stepKey, {
      systems: step.systems.map((system, itemIndex) =>
        itemIndex === index ? { ...system, ...patch } : system,
      ),
    });
  };

  const addSystem = (stepKey: string) => {
    const step = review.steps.find((item) => item.stepKey === stepKey);
    if (!step) return;
    updateStep(stepKey, {
      systems: [
        ...step.systems,
        {
          name: "",
          interaction: "other",
          evidence: "手動追加",
        },
      ],
    });
  };

  const updateData = (
    stepKey: string,
    index: number,
    patch: Partial<ExtractionReview["steps"][number]["data"][number]>,
  ) => {
    const step = review.steps.find((item) => item.stepKey === stepKey);
    if (!step) return;
    updateStep(stepKey, {
      data: step.data.map((data, itemIndex) =>
        itemIndex === index ? { ...data, ...patch } : data,
      ),
    });
  };

  const addData = (stepKey: string) => {
    const step = review.steps.find((item) => item.stepKey === stepKey);
    if (!step) return;
    updateStep(stepKey, {
      data: [
        ...step.data,
        {
          name: "",
          operation: "read",
          evidence: "手動追加",
        },
      ],
    });
  };

  const removeStepAsset = (
    type: "system" | "data",
    stepKey: string,
    index: number,
  ) => {
    const label = type === "system" ? "System" : "Data";
    if (!window.confirm(`この${label}参照を削除しますか？`)) return;
    if (type === "system") removeSystem(stepKey, index);
    else removeData(stepKey, index);
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

  const addTransition = () => {
    const from = review.steps[0]?.stepKey ?? "";
    const to = review.steps[1]?.stepKey ?? review.steps[0]?.stepKey ?? "";

    changeReview({
      ...review,
      transitions: [
        ...review.transitions,
        {
          fromStepKey: from,
          toStepKey: to,
          condition: null,
          evidence: "手動追加",
        },
      ],
    });
  };

  const updateTransition = (
    index: number,
    patch: Partial<ExtractionReview["transitions"][number]>,
  ) => {
    changeReview({
      ...review,
      transitions: review.transitions.map((transition, itemIndex) =>
        itemIndex === index ? { ...transition, ...patch } : transition,
      ),
    });
  };

  const removeTransition = (index: number) => {
    if (!window.confirm("このステップ間の接続を削除しますか？")) return;
    changeReview({
      ...review,
      transitions: review.transitions.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
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

  const addDataFlow = () => {
    changeReview({
      ...review,
      dataFlows: [
        ...review.dataFlows,
        {
          sourceSystem: "",
          targetSystem: "",
          data: [],
          transferType: "unknown",
          direction: "unknown",
          automation: "unknown",
          frequency: null,
          evidence: "手動追加",
          certainty: "explicit",
          relatedStepKeys: [],
        },
      ],
    });
  };

  const toggleDataFlowStep = (
    index: number,
    stepKey: string,
  ) => {
    const flow = review.dataFlows[index];
    if (!flow) return;

    const relatedStepKeys = flow.relatedStepKeys.includes(stepKey)
      ? flow.relatedStepKeys.filter((key) => key !== stepKey)
      : [...flow.relatedStepKeys, stepKey];

    updateDataFlow(index, { relatedStepKeys });
  };

  const removeDataFlow = (index: number) => {
    if (!window.confirm("このSystem間データフローを削除しますか？")) return;
    changeReview({
      ...review,
      dataFlows: review.dataFlows.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    });
  };

  return (
    <aside className="review-panel">
      <datalist id="existing-system-options">
        {systemOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="existing-data-options">
        {dataOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div className="review-header">
        <div>
          <div className="eyebrow">
            {dirty ? "WORKING BUSINESS MODEL" : "CURRENT BUSINESS MODEL"}
          </div>
          <h2>{dirty ? "変更中の業務構造" : "現在の業務構造"}</h2>
        </div>
        <span className="provider-badge">
          {dirty ? model.provider : "保存済み"}
        </span>
      </div>

      {historyDetail ? (
        <section className="revision-preview">
          <div className="revision-preview__header">
            <div>
              <div className="eyebrow">HISTORY SNAPSHOT</div>
              <strong>
                v{historyDetail.revisionNumber} ·{" "}
                {historyDetail.workflowName}
              </strong>
              <small>
                {new Date(historyDetail.createdAt).toLocaleString("ja-JP")} ·{" "}
                {historyDetail.updatedBy}
              </small>
            </div>
            <button className="close-button" onClick={onCloseHistory}>
              ×
            </button>
          </div>
          <p>{historyDetail.summary}</p>
          <div className="revision-preview__meta">
            <span>
              {historyDetail.scenarioLabel ??
                historyDetail.scenario ??
                "current"}
            </span>
            <span>
              {historyDetail.effectiveFrom ?? "開始未設定"} →{" "}
              {historyDetail.effectiveTo ?? "終了未設定"}
            </span>
          </div>
          <details>
            <summary>当時のヒアリング / 業務メモ</summary>
            <pre>{historyDetail.sourceNotes || "—"}</pre>
          </details>
          {historyDetail.followUpAnswers.length > 0 ? (
            <details>
              <summary>
                当時の追加Q&A ({historyDetail.followUpAnswers.length})
              </summary>
              <div className="revision-qa-list">
                {historyDetail.followUpAnswers.map((item, index) => (
                  <article key={`${item.question}-${index}`}>
                    <strong>{item.question}</strong>
                    <p>{item.answer}</p>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
          <details>
            <summary>
              当時の構造 ({historyDetail.review.steps.length} steps)
            </summary>
            <div className="revision-step-list">
              {historyDetail.review.steps.map((step) => (
                <article key={step.stepKey}>
                  <b>{String(step.order).padStart(2, "0")}</b>
                  <span>
                    <strong>{step.name}</strong>
                    <small>
                      {(step.detailSteps ?? [])
                        .map(
                          (detail) =>
                            `${detail.action}${detail.condition ? `（${detail.condition}）` : ""}`,
                        )
                        .join(" → ")}
                    </small>
                    {(step.technicalDetails ?? []).map((detail, index) => (
                      <small key={index}>
                        {[
                          detail.system,
                          detail.module,
                          detail.transaction,
                          detail.hanaArea,
                          detail.objects,
                        ]
                          .filter(Boolean)
                          .join(" / ")}{" "}
                        · 根拠：{detail.evidence || "未確認"}
                      </small>
                    ))}

                    <small>
                      {step.department ?? "部署未確認"} ·{" "}
                      {step.responsiblePerson ?? step.actor ?? "担当未確認"}
                    </small>
                  </span>
                </article>
              ))}
            </div>
          </details>
        </section>
      ) : null}

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
        <details className="model-section" open>
          <summary>
            <span>業務ステップ</span>
            <b>{review.steps.length}</b>
          </summary>

          <div className="model-section-toolbar">
            <span>順番・担当・自動処理・System/Dataを直接編集できます。</span>
            <button className="button-secondary" onClick={addStep}>
              ＋ ステップ
            </button>
          </div>

          <div className="review-steps">
            {review.steps.map((step, stepIndex) => (
              <article
                key={step.stepKey}
                className="review-step review-step--editable"
              >
                <div className="review-step__top review-step__top--actions">
                  <span>{String(step.order).padStart(2, "0")}</span>
                  <input
                    className="review-step-name"
                    value={step.name}
                    placeholder="ステップ名"
                    onChange={(event) =>
                      updateStep(step.stepKey, { name: event.target.value })
                    }
                  />
                  <div className="step-order-actions">
                    <button
                      title="1つ前へ"
                      disabled={stepIndex === 0}
                      onClick={() => moveStep(step.stepKey, -1)}
                    >
                      ↑
                    </button>
                    <button
                      title="1つ後へ"
                      disabled={stepIndex === review.steps.length - 1}
                      onClick={() => moveStep(step.stepKey, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="review-delete"
                      title="このステップを削除"
                      onClick={() => removeStep(step.stepKey)}
                    >
                      ×
                    </button>
                  </div>
                </div>

                <textarea
                  className="review-step-action"
                  value={step.action}
                  placeholder="このステップで何をするか"
                  onChange={(event) =>
                    updateStep(step.stepKey, { action: event.target.value })
                  }
                />

                <div className="step-execution-editor">
                  <label>
                    <span>実行方式</span>
                    <select
                      value={step.executionMode}
                      onChange={(event) =>
                        updateStep(step.stepKey, {
                          executionMode:
                            event.target.value as ProcessExecutionMode,
                        })
                      }
                    >
                      <option value="manual">手作業</option>
                      <option value="automatic">System内で自動</option>
                      <option value="mixed">人＋自動</option>
                      <option value="unknown">未確認</option>
                    </select>
                  </label>
                  <label>
                    <span>実行System</span>
                    <input
                      value={step.executingSystem ?? ""}
                      list="existing-system-options"
                      placeholder="例: SAP / ERP"
                      onChange={(event) =>
                        updateStep(step.stepKey, {
                          executingSystem: event.target.value || null,
                        })
                      }
                    />
                  </label>
                </div>

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

                <StepDetailEditor step={step} onChange={patch => updateStep(step.stepKey, patch)} />
                <div className="review-evidence">
                  {step.certainty === "explicit" ? "明示" : "AI推定"} · 根拠:{" "}
                  {step.evidence || "—"}
                </div>

                <details className="step-subsection" open>
                  <summary>
                    <span>利用System</span>
                    <b>{step.systems.length}</b>
                  </summary>
                  <div className="resource-editor">
                    {step.systems.map((system, index) => (
                      <div
                        className="resource-row"
                        key={`s-${step.stepKey}-${index}`}
                      >
                        <input
                          value={system.name}
                          list="existing-system-options"
                          placeholder="System名"
                          onChange={(event) =>
                            updateSystem(step.stepKey, index, {
                              name: event.target.value,
                            })
                          }
                        />
                        <select
                          value={system.interaction}
                          onChange={(event) =>
                            updateSystem(step.stepKey, index, {
                              interaction:
                                event.target
                                  .value as typeof system.interaction,
                            })
                          }
                        >
                          <option value="view">閲覧</option>
                          <option value="search">検索</option>
                          <option value="input">入力</option>
                          <option value="approve">承認</option>
                          <option value="send">送信</option>
                          <option value="receive">受信</option>
                          <option value="other">その他</option>
                        </select>
                        <button
                          className="row-remove"
                          title="System参照を削除"
                          onClick={() =>
                            removeStepAsset(
                              "system",
                              step.stepKey,
                              index,
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      className="inline-add"
                      onClick={() => addSystem(step.stepKey)}
                    >
                      ＋ System
                    </button>
                  </div>
                </details>

                <details className="step-subsection" open>
                  <summary>
                    <span>Data</span>
                    <b>{step.data.length}</b>
                  </summary>
                  <div className="resource-editor">
                    {step.data.map((data, index) => (
                      <div
                        className="resource-row"
                        key={`d-${step.stepKey}-${index}`}
                      >
                        <input
                          value={data.name}
                          list="existing-data-options"
                          placeholder="Data / 文書名"
                          onChange={(event) =>
                            updateData(step.stepKey, index, {
                              name: event.target.value,
                            })
                          }
                        />
                        <select
                          value={data.operation}
                          onChange={(event) =>
                            updateData(step.stepKey, index, {
                              operation:
                                event.target
                                  .value as typeof data.operation,
                            })
                          }
                        >
                          <option value="read">参照</option>
                          <option value="create">作成</option>
                          <option value="update">更新</option>
                          <option value="send">送信</option>
                          <option value="receive">受信</option>
                        </select>
                        <button
                          className="row-remove"
                          title="Data参照を削除"
                          onClick={() =>
                            removeStepAsset("data", step.stepKey, index)
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      className="inline-add"
                      onClick={() => addData(step.stepKey)}
                    >
                      ＋ Data
                    </button>
                  </div>
                </details>
              </article>
            ))}
          </div>
        </details>

        <details className="model-section">
          <summary>
            <span>ステップ間の接続・条件分岐</span>
            <b>{review.transitions.length}</b>
          </summary>

          <div className="model-section-toolbar">
            <span>
              通常の順番だけでなく「在庫あり」「承認NG」などの条件分岐を編集できます。
            </span>
            <button className="button-secondary" onClick={addTransition}>
              ＋ 接続
            </button>
          </div>

          <div className="transition-editor">
            {review.transitions.map((transition, index) => (
              <div
                className="transition-row"
                key={`${transition.fromStepKey}-${transition.toStepKey}-${index}`}
              >
                <select
                  value={transition.fromStepKey}
                  onChange={(event) =>
                    updateTransition(index, {
                      fromStepKey: event.target.value,
                    })
                  }
                >
                  {review.steps.map((step) => (
                    <option key={step.stepKey} value={step.stepKey}>
                      {step.order}. {step.name}
                    </option>
                  ))}
                </select>
                <span>→</span>
                <select
                  value={transition.toStepKey}
                  onChange={(event) =>
                    updateTransition(index, {
                      toStepKey: event.target.value,
                    })
                  }
                >
                  {review.steps.map((step) => (
                    <option key={step.stepKey} value={step.stepKey}>
                      {step.order}. {step.name}
                    </option>
                  ))}
                </select>
                <input
                  value={transition.condition ?? ""}
                  placeholder="条件（空欄なら通常遷移）"
                  onChange={(event) =>
                    updateTransition(index, {
                      condition: event.target.value || null,
                    })
                  }
                />
                <button
                  className="row-remove"
                  title="接続を削除"
                  onClick={() => removeTransition(index)}
                >
                  ×
                </button>
              </div>
            ))}
            {review.transitions.length === 0 ? (
              <p className="inline-empty">
                接続はありません。必要な場合だけ「＋ 接続」から追加してください。
              </p>
            ) : null}
          </div>
        </details>

        <details className="model-section" open>
          <summary>
            <span>System間データフロー</span>
            <b>{review.dataFlows.length}</b>
          </summary>

          <div className="model-section-toolbar">
            <span>連携だけでなくCSV転送や人手転記もここで追加できます。</span>
            <button className="button-secondary" onClick={addDataFlow}>
              ＋ Data Flow
            </button>
          </div>

          <div className="review-dataflows">
            {review.dataFlows.map((flow, index) => (
              <article
                key={index}
              >
                <div className="review-dataflow-title">
                  <input
                    value={flow.sourceSystem}
                    list="existing-system-options"
                    placeholder="送信元System"
                    onChange={(event) =>
                      updateDataFlow(index, {
                        sourceSystem: event.target.value,
                      })
                    }
                  />
                  <span>→</span>
                  <input
                    value={flow.targetSystem}
                    list="existing-system-options"
                    placeholder="送信先System"
                    onChange={(event) =>
                      updateDataFlow(index, {
                        targetSystem: event.target.value,
                      })
                    }
                  />
                  <button
                    className="review-delete"
                    onClick={() => removeDataFlow(index)}
                    title="このデータフローを削除"
                  >
                    ×
                  </button>
                </div>

                <label className="dataflow-field">
                  <span>流れるData</span>
                  <input
                    className="review-dataflow-data"
                    value={flow.data.join(",")}
                    placeholder="受注データ, 出荷指示"
                    onChange={(event) =>
                      updateDataFlow(index, {
                        data: event.target.value.split(","),
                      })
                    }
                    onBlur={() =>
                      updateDataFlow(index, {
                        data: flow.data.map((item) => item.trim()).filter(Boolean),
                      })
                    }
                  />
                </label>

                <div className="review-dataflow-options">
                  <label>
                    <span>方式</span>
                    <select
                      value={flow.transferType}
                      onChange={(event) =>
                        updateDataFlow(index, {
                          transferType:
                            event.target
                              .value as typeof flow.transferType,
                        })
                      }
                    >
                      {[
                        "api",
                        "file",
                        "database",
                        "message",
                        "email",
                        "manual",
                        "unknown",
                      ].map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>方向</span>
                    <select
                      value={flow.direction}
                      onChange={(event) =>
                        updateDataFlow(index, {
                          direction:
                            event.target.value as typeof flow.direction,
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
                  </label>
                  <label>
                    <span>自動化</span>
                    <select
                      value={flow.automation}
                      onChange={(event) =>
                        updateDataFlow(index, {
                          automation:
                            event.target.value as typeof flow.automation,
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
                  </label>
                  <label>
                    <span>頻度</span>
                    <input
                      value={flow.frequency ?? ""}
                      placeholder="例: 15分ごと"
                      onChange={(event) =>
                        updateDataFlow(index, {
                          frequency: event.target.value || null,
                        })
                      }
                    />
                  </label>
                </div>
                <label className="dataflow-field">
                  <span>メモ / 根拠</span>
                  <input
                    value={flow.evidence}
                    placeholder="例: 15分ごとにERPからWMSへCSV送信"
                    onChange={(event) =>
                      updateDataFlow(index, {
                        evidence: event.target.value,
                      })
                    }
                  />
                </label>

                <div className="dataflow-related-steps">
                  <span>関連ステップ</span>
                  <div>
                    {review.steps.map((step) => {
                      const selected = flow.relatedStepKeys.includes(
                        step.stepKey,
                      );
                      return (
                        <button
                          key={step.stepKey}
                          className={selected ? "active" : ""}
                          onClick={() =>
                            toggleDataFlowStep(index, step.stepKey)
                          }
                        >
                          {step.order}. {step.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </details>

        {review.warnings.length > 0 ? (
          <div className="review-warning">
            <div className="review-section-title">
              <span>要確認</span>
              <b>{review.warnings.length}</b>
            </div>
            {review.warnings.map((warning) => (
              <p key={warning}>△ {warning}</p>
            ))}
          </div>
        ) : null}

        {model.answerHistory.length > 0 ? (
          <div className="answered-followups">
            <div className="review-section-title">
              <span>反映済みの追加Q&A</span>
              <b>{model.answerHistory.length}</b>
            </div>
            {model.answerHistory.map((item, index) => (
              <article key={`${item.question}-${index}`}>
                <strong>{item.question}</strong>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        ) : null}

        {review.questions.length > 0 ? (
          <div className="review-questions">
            <div className="review-section-title">
              <span>追加で確認したいこと</span>
              <b>{review.questions.length}</b>
            </div>
            {review.questions.map((question, index) => (
              <article key={question.question} className="followup-question">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{question.question}</strong>
                  <small>{question.reason}</small>
                  <textarea
                    value={model.answers[question.question] ?? ""}
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
                回答を追加情報としてAIへ戻し、現在の業務モデルを再整理します。
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

        <div className="revision-history">
          <div className="review-section-title">
            <span>更新履歴</span>
            <b>{revisions.length}</b>
          </div>
          {historyLoading ? (
            <p className="revision-history__empty">履歴を読み込み中…</p>
          ) : revisions.length > 0 ? (
            <div className="revision-history__list">
              {revisions.map((revision) => (
                <button
                  key={revision.id}
                  onClick={() => onOpenRevision(revision.id)}
                >
                  <b>v{revision.revisionNumber}</b>
                  <span>
                    <strong>{revision.summary || revision.workflowName}</strong>
                    <small>
                      {new Date(revision.createdAt).toLocaleString("ja-JP")} ·{" "}
                      {revision.updatedBy}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="revision-history__empty">
              まだ保存済みの更新履歴はありません。
            </p>
          )}
        </div>
      </div>

      <div className="review-actions">
        <button
          className="button-secondary"
          onClick={onDiscard}
          disabled={!dirty || applying || refining}
        >
          変更を破棄
        </button>
        <button
          className="button-primary"
          onClick={onApply}
          disabled={
            !dirty ||
            applying ||
            refining ||
            review.steps.length === 0
          }
        >
          {applying ? "保存中…" : "業務構造を保存"}
        </button>
      </div>
    </aside>
  );
}

function WorkflowView({
  focusedStepId, onFocusStep,
  graph,
  workflowId,
  setWorkflowId,
  onEdit,
  onGraphApply,
}: {
  graph: LensGraph;
  workflowId: string;
  setWorkflowId: (id: string) => void;
  onEdit: () => void;
  onGraphApply: (graph: LensGraph) => void;
  focusedStepId?: string; onFocusStep?: (workflowId:string,stepId:string)=>void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<OwnershipState>({
    department: "",
    responsiblePerson: "",
  });
  const [executionMode, setExecutionMode] = useState<
    "all" | ProcessExecutionMode
  >("all");

  const workflow = graph.workflows.find((item) => item.id === workflowId);
  const filter = ownershipFilter(ownership);
  const processes = getWorkflowProcesses(graph, workflowId).filter(
    (process) =>
      processMatchesOwnership(process, filter) &&
      (executionMode === "all" ||
        getProcessExecutionMode(graph, process) === executionMode),
  );
  const flow = useMemo(
    () => workflowFlow(graph, workflowId, filter, executionMode),
    [
      graph,
      workflowId,
      ownership.department,
      ownership.responsiblePerson,
      executionMode,
    ],
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
    <WorkflowExplorer initialLevel="business" graph={graph} workflowId={workflowId} selectedStepId={selectedNode?.kind === "process" ? selectedNode.id : focusedStepId} onFocusStep={onFocusStep} onSelectWorkflow={setWorkflowId} onEdit={onEdit} onGraphApply={onGraphApply}>
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
          <div className="workflow-filter-row">
            <OwnershipFilters
              graph={graph}
              value={ownership}
              onChange={(value) => {
                setOwnership(value);
                setSelectedNodeId(null);
              }}
            />
            <label className="execution-filter">
              <span>実行方式</span>
              <select
                value={executionMode}
                onChange={(event) => {
                  setExecutionMode(
                    event.target.value as "all" | ProcessExecutionMode,
                  );
                  setSelectedNodeId(null);
                }}
              >
                <option value="all">すべて</option>
                <option value="manual">手作業</option>
                <option value="automatic">System内で自動</option>
                <option value="mixed">人＋自動</option>
                <option value="unknown">未確認</option>
              </select>
            </label>
          </div>
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
        <div>
          <span>自動ステップ</span>
          <strong>
            {
              processes.filter(
                (process) =>
                  getProcessExecutionMode(graph, process) === "automatic" ||
                  getProcessExecutionMode(graph, process) === "mixed",
              ).length
            }
          </strong>
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
    </WorkflowExplorer>
  );
}

function DataFlowView({ graph, initialWorkflowId }: { graph: LensGraph; initialWorkflowId: string }) {
  const [scope, setScope] = useState<WorkflowScenario>(graph.workflows.find(w => w.id === initialWorkflowId)?.scenario ?? "current");
  const [workflowId, setWorkflowId] = useState(graph.workflows.some(w => w.id === initialWorkflowId) ? initialWorkflowId : "");
  const [pair, setPair] = useState("");
  const [page, setPage] = useState(0);
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

  const flows = scopedDataFlows(graph, scope, workflowId, ownerFilter);
  const grouped = aggregateDataFlows(flows);
  const listedFlows = flows.filter(f => !pair || `${f.sourceSystemId}|${f.targetSystemId}` === pair);

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

  const flowEdges: Edge[] = grouped.map(g => ({
    id: g.id, source: g.source, target: g.target, label: `${g.flowIds.length} 受渡し${g.manual ? ' / 手動を含む' : ''}`,
    type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 2, strokeDasharray: g.manual ? '7 5' : undefined },
    labelStyle: { fontSize: 10 }, labelBgPadding: [7, 5], labelBgBorderRadius: 6,
  }));

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
            業務・シナリオで範囲を選び、System間の経路を俯瞰します。同じ経路の受渡しは1本に集約し、Data・方式・担当を下の一覧で確認できます。
          </p>
        </div>
        <OwnershipFilters
          graph={graph}
          value={ownership}
          onChange={(value) => {
            setOwnership(value);
            setSelectedNodeId(null);
            setSelectedFlowId(null);
            setPage(0);
            setPair("");
          }}
        />
      </header>

      <div className="kg-toolbar">
        <label>データフローのシナリオ<select value={scope} onChange={e => { setScope(e.target.value as WorkflowScenario); setWorkflowId(''); setPair(''); setPage(0); setSelectedFlowId(null); setSelectedNodeId(null); }}><option value="current">Current / 現状</option><option value="future">Future / 将来案</option><option value="alternative">Alternative / 代替案</option></select></label>
        <label>データフローの業務範囲<select value={workflowId} onChange={e => { setWorkflowId(e.target.value); setPair(''); setPage(0); setSelectedFlowId(null); setSelectedNodeId(null); }}><option value="">全業務（経路を集約）</option>{graph.workflows.filter(w => (w.scenario ?? 'current') === scope).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <span>{grouped.length} System間経路</span>
        {pair && <button onClick={() => { setPair(''); setPage(0); }}>経路の絞り込みを解除</button>}
      </div>
      <div className="kg-links">
        <p>受渡し一覧: {listedFlows.length}件 / {Math.min(listedFlows.length, page * 20 + 1)}–{Math.min(listedFlows.length, (page + 1) * 20)}を表示</p>
        {listedFlows.slice(page * 20, (page + 1) * 20).map(f => <button key={f.id} onClick={() => { setSelectedFlowId(f.id); setSelectedNodeId(null); }}>{graph.nodes.find(n => n.id === f.sourceSystemId)?.label} → {graph.nodes.find(n => n.id === f.targetSystemId)?.label} · {f.dataIds.map(id => graph.nodes.find(n => n.id === id)?.label).join(' / ')} · {f.transferType} / {f.automation}</button>)}
        <div className="kg-toolbar"><button disabled={!page} onClick={() => setPage(p => p - 1)}>前の20受渡し</button><button disabled={(page + 1) * 20 >= listedFlows.length} onClick={() => setPage(p => p + 1)}>次の20受渡し</button></div>
      </div>
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
              setPair(edge.id);
              setPage(0);
              setSelectedFlowId(null);
              setSelectedNodeId(null);
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={28} size={1} />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>

          {selectedNode ? (
            <RelationshipPanel
              graph={scenarioGraph(graph, scope, workflowId)}
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

function Workspace() {
  const [projectId, setProjectId] = useState("default");
  const [section, setSection] = useState<Section>("interviews");
  const [knowledgeExploration, setKnowledgeExploration] = useState<KnowledgeExploration>();
  const [assetExploration, setAssetExploration] = useState<AssetExploration>();
  const keepKnowledgeExploration = useCallback((value: KnowledgeExploration) => {
    setKnowledgeExploration(value);
    const focus = value.focus;
    setAssetExploration(previous => focus.kind === "asset"
      ? { id: focus.id, scope: value.scope, department: value.department }
      : previous ? { ...previous, scope: value.scope, department: value.department } : undefined);
  }, []);
  const keepAssetExploration = useCallback((value: AssetExploration) => {
    setAssetExploration(value);
    setKnowledgeExploration(previous => ({
      focus: { kind: "asset", id: value.id }, scope: value.scope,
      department: value.department, query: "", category: "",
      history: previous?.history ?? [],
    }));
  }, []);
  const [graph, setGraph] = useState<LensGraph>(() => createDemoGraph());
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    NEW_MEMO_ID,
  );
  const [transcripts, setTranscripts] = useState<Record<string, string>>(
    Object.fromEntries(
      SAMPLE_WORKFLOWS.map((sample) => [sample.id, sample.transcript]),
    ),
  );
  const [focusedSteps,setFocusedSteps]=useState<Record<string,string>>({});
  const [drafts, setDrafts] = useState<Record<string, InputDraft>>({});
  const [draftHydrated, setDraftHydrated] = useState(false);
  const savedSnapshot = useRef("");
  const persistedTranscripts = useRef(transcripts);
  const activeDraft = drafts[selectedWorkflowId];
  const visibleGraph = useMemo(() => activeDraft ? previewReviewGraph(graph, activeDraft.workflow, activeDraft.review) : graph, [graph, activeDraft]);
  const visibleWorkflowId = activeDraft?.workflow.id ?? selectedWorkflowId;

  const [hydrated, setHydrated] = useState(false);
  const [storageBackend, setStorageBackend] = useState("sqlite");
  const [saveStatus, setSaveStatus] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      try {
        const activeProject = new URLSearchParams(window.location.search).get("projectId") || "default";
        setProjectId(activeProject);
        const response = await fetch(`/api/project?projectId=${encodeURIComponent(activeProject)}`, {
          cache: "no-store",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            payload?.error ?? "保存済みプロジェクトの読込に失敗しました。",
          );
        }

        if (cancelled) return;

        setStorageBackend(payload.storage ?? "sqlite");

        if (payload.project) {
          const loadedGraph = payload.project.graph as LensGraph;
          const loadedTranscripts =
            payload.project.transcripts as Record<string, string>;

          setGraph(loadedGraph);
          setTranscripts(loadedTranscripts);
          persistedTranscripts.current = loadedTranscripts;

          savedSnapshot.current = JSON.stringify({graph: loadedGraph, transcripts: loadedTranscripts});
        } else if (activeProject !== "default") {
          const blank = {workflows: [], nodes: [], edges: [], dataFlows: []};
          setGraph(blank); setTranscripts({});
          persistedTranscripts.current = {};
          savedSnapshot.current = JSON.stringify({graph: blank, transcripts: {}});
        }

        setSaveStatus("saved");
        setHydrated(true);
      } catch (error) {
        console.error(error);
        if (!cancelled) setSaveStatus("error");
      }
    }

    void loadProject();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`flow-input:${projectId}`) ?? "null");
      if (saved) { setDrafts(saved.drafts ?? {});setFocusedSteps(saved.focusedSteps??{}); setSelectedWorkflowId(saved.selectedId ?? NEW_MEMO_ID); if (saved.notes) setTranscripts(t => ({...t, ...saved.notes})); }
    } catch { /* A broken browser draft must never prevent opening saved data. */ }
    setDraftHydrated(true);
  }, [hydrated, projectId]);
  useEffect(() => {
    if (!draftHydrated) return;
    try { sessionStorage.setItem(`flow-input:${projectId}`, JSON.stringify({drafts, focusedSteps, selectedId: selectedWorkflowId, notes: transcripts})); } catch { /* Storage quota does not prevent editing or explicit saving. */ }
  }, [drafts, focusedSteps, selectedWorkflowId, transcripts, draftHydrated, projectId]);

  useEffect(() => {
    if (!hydrated) return;
    const savedNotes = persistedTranscripts.current;
    const fingerprint = JSON.stringify({graph, transcripts: savedNotes});
    if (fingerprint === savedSnapshot.current) return;

    const timer = window.setTimeout(async () => {
      setSaveStatus("saving");

      try {
        const response = await fetch("/api/project", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            projectName: "BusinessFlowLens",
            graph,
            transcripts: savedNotes,
            updatedAt: new Date().toISOString(),
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error ?? "保存に失敗しました。");
        }

        setStorageBackend(payload.storage ?? storageBackend);
        savedSnapshot.current = fingerprint;
        setSaveStatus("saved");
      } catch (error) {
        console.error(error);
        setSaveStatus("error");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [graph, hydrated]);

  const saveLabel =
    saveStatus === "loading"
      ? "読込中"
      : saveStatus === "saving"
        ? "保存中"
        : saveStatus === "error"
          ? "保存エラー"
          : "保存済み";
  const draftCount = Object.keys(drafts).length;
  const pendingNotes = hasUnreflectedNotes(transcripts, persistedTranscripts.current);
  const inputStatus = draftCount ? `保存前 ${draftCount}件` : pendingNotes ? "未反映のメモあり" : saveLabel;
  const navigateSection = (next: Section) => {
    setSection(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">FL</div>
          <div>
            <strong>BusinessFlowLens</strong>
            <span>仕事の話を、会社のしくみに</span>
          </div>
        </div>

        <ShellNav section={section} setSection={navigateSection} />

        <div className="header-meta" data-pending={saveStatus !== "error" && (draftCount > 0 || pendingNotes)}>
          <span>{hydrated ? graph.workflows.length : "—"}業務を蓄積</span>
          <span
            className={[
              "storage-status",
              `storage-status--${saveStatus}`,
            ].join(" ")}
          >
            {saveStatus === "error" ? saveLabel : inputStatus}
          </span>
        </div>
      </header>
      {!["company", "interviews"].includes(section) && (
        <nav className="detail-nav" aria-label="調べる対象を選ぶ">
          <span>詳しく調べる：</span>
          {([
            { id: "workflow", label: "業務の流れ" },
            { id: "dataflow", label: "情報の流れ" },
            { id: "assets", label: "システム・道具" },
            { id: "overview", label: "業務を比較" },
          ] as const).map(item => (
            <button key={item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => navigateSection(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {section === "company" && (hydrated ? (
        <KnowledgeExplorer
          exploration={knowledgeExploration}
          onExplorationChange={keepKnowledgeExploration}
          onInput={id => { setSelectedWorkflowId(id ?? NEW_MEMO_ID); navigateSection("interviews"); }}
          onFocusStep={(id, step) => setFocusedSteps(s => ({ ...s, [id]: step }))}
          projectId={projectId}
          graph={graph}
          onGraphApply={setGraph}
          onWorkflowFocus={setSelectedWorkflowId}
          onOpenWorkflow={id => { setSelectedWorkflowId(id); navigateSection("workflow"); }}
        />
      ) : (
        <section className="page-view">
          <h1>{saveStatus === "error" ? "会社の情報を読み込めませんでした" : "会社の情報を読み込んでいます"}</h1>
          {saveStatus === "error" && <button onClick={() => window.location.reload()}>もう一度読み込む</button>}
        </section>
      ))}

      {section === "interviews" && hydrated && draftHydrated ? (
        <InputWorkbench
          onExplore={(id, stepId) => { setKnowledgeExploration(exploreSavedStory(graph, id, stepId)); navigateSection("company"); }}
          focusedStepId={focusedSteps[visibleWorkflowId]} onFocusStep={(id,step)=>setFocusedSteps(s=>({...s,[id]:step}))}
          projectId={projectId}
          graph={graph}
          selectedId={selectedWorkflowId}
          onSelect={setSelectedWorkflowId}
          transcripts={transcripts}
          savedTranscripts={persistedTranscripts.current}
          onTranscripts={setTranscripts}
          drafts={drafts}
          onDraft={(id, value) => setDrafts(current => { const next = {...current}; if (value) next[id] = value; else delete next[id]; return next; })}
          onGraphApply={setGraph}
          onSaved={(nextGraph, nextNotes, sourceKey) => {persistedTranscripts.current=nextNotes;savedSnapshot.current=JSON.stringify({graph:nextGraph,transcripts:nextNotes});setGraph(nextGraph);setTranscripts(current=>{const next={...nextNotes,...current};if(sourceKey===NEW_MEMO_ID)delete next[NEW_MEMO_ID];return next;});setSaveStatus("saved");}}
          renderAdvanced={a => <ReviewPanel graph={graph} model={{workflowId: a.draft.workflow.id, review: a.draft.review, provider: a.draft.provider, answers: a.draft.answers, answerHistory: a.draft.answerHistory}} dirty onChange={v => setDrafts(current => ({...current, [selectedWorkflowId]: {...a.draft, review: recordReviewEdits(a.draft.review,v.review), answers: v.answers, answerHistory: v.answerHistory}}))} onDiscard={a.onDiscard} onRefine={a.onRefine} onApply={a.onSave} applying={a.busy} refining={a.busy} revisions={[]} historyDetail={null} historyLoading={false} onOpenRevision={()=>{}} onCloseHistory={()=>{}} />}
        />
      ) : null}

      {section === "workflow" ? (
        <>
        {activeDraft && <div className="input-preview-banner" role="status">保存前の候補を表示しています。<button onClick={() => setSection("interviews")}>話と構造の確認・訂正へ戻る</button></div>}
        <WorkflowView
          focusedStepId={focusedSteps[visibleWorkflowId]} onFocusStep={(id,step)=>setFocusedSteps(s=>({...s,[id]:step}))}
          graph={visibleGraph}
          workflowId={visibleWorkflowId}
          setWorkflowId={id => setSelectedWorkflowId(inputKeyForWorkflow(drafts, id))}
          onEdit={() => setSection("interviews")}
          onGraphApply={activeDraft ? () => setSection("interviews") : setGraph}
        />
        </>
      ) : null}

      {section === "dataflow" ? <>{activeDraft && <div className="input-preview-banner" role="status">保存前の候補を表示しています。<button onClick={()=>setSection("interviews")}>入力と構造の確認へ戻る</button></div>}<DataFlowExplorer graph={visibleGraph} initialWorkflowId={visibleWorkflowId} onSelectWorkflow={id => setSelectedWorkflowId(inputKeyForWorkflow(drafts, id))} onGraphApply={activeDraft ? ()=>setSection("interviews") : setGraph} onEdit={id => {setSelectedWorkflowId(inputKeyForWorkflow(drafts, id));setSection("interviews");}}><DataFlowView graph={visibleGraph} initialWorkflowId={visibleWorkflowId} /></DataFlowExplorer></> : null}

      {section === "assets" ? <AssetExplorer exploration={assetExploration} onExplorationChange={keepAssetExploration} graph={graph} onGraphApply={setGraph} onEdit={id=>{setSelectedWorkflowId(id);setSection("interviews");}} /> : null}
      {section === "overview" ? <CrossBusinessOverview graph={graph} onOpen={id=>{setSelectedWorkflowId(id);setSection("interviews");}} /> : null}
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
