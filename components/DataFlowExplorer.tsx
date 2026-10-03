"use client";
import { useState, type ReactNode } from "react";
import type { LensGraph, WorkflowScenario } from "@/lib/graph";
import { aggregateDataFlows, scopedDataFlows } from "@/lib/knowledge";
import { transferSteps } from "@/lib/flow-context";
import { WorkflowReading } from "./WorkflowReading";

export function DataFlowExplorer({
  graph,
  initialWorkflowId,
  onGraphApply,
  onEdit,
  onSelectWorkflow,
  children,
}: {
  graph: LensGraph;
  initialWorkflowId: string;
  onGraphApply: (graph: LensGraph) => void;
  onEdit: (workflowId: string, stepId: string) => void;
  onSelectWorkflow: (id: string) => void;
  children?: ReactNode;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [workflowId, setWorkflow] = useState(initialWorkflowId);
  const [scope, setScope] = useState<WorkflowScenario>(
    graph.workflows.find((w) => w.id === initialWorkflowId)?.scenario ??
      "current",
  );
  const [query, setQuery] = useState("");
  const [flowId, setFlow] = useState("");
  const [page, setPage] = useState(0);
  const [transferPage, setTransferPage] = useState(0);
  const [path, setPath] = useState("");
  const [readerVersion, setReaderVersion] = useState(0);
  const workflows = graph.workflows.filter(
    (w) => (w.scenario ?? "current") === scope,
  );
  const filtered = workflows.filter((w) =>
    `${w.name} ${w.description}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const flows = scopedDataFlows(graph, scope, workflowId);
  const pairs = aggregateDataFlows(flows);
  const visibleFlows = flows.filter(
    (f) => !path || `${f.sourceSystemId}|${f.targetSystemId}` === path,
  );
  const flow = flows.find((f) => f.id === flowId);
  const related = flow
    ? transferSteps(graph, flow.id, workflowId || undefined)
    : [];
  const label = (id: string) =>
    graph.nodes.find((n) => n.id === id)?.label ?? "未登録";
  const chooseFlow = (id: string) => {
    const selected = flows.find((f) => f.id === id);
    if (!selected) return;
    setFlow(id);
    const context = transferSteps(graph, id, workflowId || undefined)[0];
    if (context) {
      setWorkflow(context.workflowId!);
      onSelectWorkflow(context.workflowId!);
      setPath("");
      setPage(0);
      setTransferPage(0);
    }
    setReaderVersion((v) => v + 1);
  };
  return (
    <section className="page-view kg-view">
      <div className="eyebrow">仕事の中で、情報がどう渡るか</div>
      <h1>情報の流れから、作業・人・道具へ</h1>
      <p>
        受渡しを選ぶと、同じ画面で関連する業務の手順まで辿れます。「判断・個別作業」に拡大しても、選んだ情報と作業は変わりません。
      </p>
      <div className="kg-toolbar">
        <label>
          表示する状態
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as WorkflowScenario);
              setWorkflow("");
              setFlow("");
              setPath("");
              setPage(0);
              setTransferPage(0);
              setQuery("");
            }}
          >
            <option value="current">現在の仕事</option>
            <option value="future">改善後の案</option>
            <option value="alternative">別の案</option>
          </select>
        </label>
        <label>
          業務を検索
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="工場・業務名"
          />
        </label>
        <label>
          情報を辿る業務
          <select
            value={workflowId}
            onChange={(e) => {
              setWorkflow(e.target.value);
              if (e.target.value) onSelectWorkflow(e.target.value);
              setFlow("");
              setPage(0);
              setTransferPage(0);
              setPath("");
            }}
          >
            <option value="">会社全体の経路から選ぶ</option>
            {!filtered.some((w) => w.id === workflowId) &&
              workflows.some((w) => w.id === workflowId) && (
                <option value={workflowId}>
                  {workflows.find((w) => w.id === workflowId)?.name}（表示中）
                </option>
              )}
            {filtered.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!workflowId && (
        <>
          <h2>システム間の経路を、業務へつないで読む</h2>
          <p>
            {pairs.length}経路 / {flows.length}
            受渡し。まず経路を一つ選び、その中の受渡しを選びます。
          </p>
          <div className="flow-paths">
            {pairs.slice(page * 8, (page + 1) * 8).map((p) => (
              <button
                key={p.id}
                aria-pressed={path === p.id}
                onClick={() => {
                  setPath(p.id);
                  setTransferPage(0);
                }}
              >
                {label(p.source)} → {label(p.target)}
                <span>
                  {p.flowIds.length}受渡し ·{" "}
                  {p.manual ? "人の受渡しを含む" : "自動・未確認"}
                </span>
              </button>
            ))}
          </div>
          <div className="kg-toolbar">
            <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
              前の8経路
            </button>
            <button
              disabled={(page + 1) * 8 >= pairs.length}
              onClick={() => setPage((p) => p + 1)}
            >
              次の8経路
            </button>
          </div>
        </>
      )}
      {(workflowId || path) && (
        <details className="flow-transfer-picker" open={Boolean(path) || !flow}>
          <summary>受渡しを選ぶ（{visibleFlows.length}件）</summary>
          <div className="kg-links">
            {visibleFlows
              .slice(transferPage * 8, (transferPage + 1) * 8)
              .map((f) => (
                <button
                  key={f.id}
                  aria-pressed={flowId === f.id}
                  onClick={() => chooseFlow(f.id)}
                >
                  {label(f.sourceSystemId)} → {label(f.targetSystemId)}
                  <span>
                    {f.dataIds.map(label).join(" / ")} ·{" "}
                    {f.automation === "automatic"
                      ? "自動"
                      : f.automation === "manual"
                        ? "人が受渡し・転記"
                        : "実行方法未確認"}
                  </span>
                </button>
              ))}
          </div>
          <div className="kg-toolbar">
            <button
              disabled={!transferPage}
              onClick={() => setTransferPage((p) => p - 1)}
            >
              前の8受渡し
            </button>
            <span>
              {visibleFlows.length ? transferPage * 8 + 1 : 0}–
              {Math.min(visibleFlows.length, (transferPage + 1) * 8)} /{" "}
              {visibleFlows.length}件
            </span>
            <button
              disabled={(transferPage + 1) * 8 >= visibleFlows.length}
              onClick={() => setTransferPage((p) => p + 1)}
            >
              次の8受渡し
            </button>
          </div>
        </details>
      )}
      {flow && (
        <section
          className="flow-selected-transfer"
          aria-label="選んだ情報の受渡し"
        >
          <h2>
            {label(flow.sourceSystemId)} → {label(flow.targetSystemId)}
          </h2>
          <p>情報：{flow.dataIds.map(label).join(" / ") || "未特定"}</p>
          <p>
            関連する仕事：
            {related
              .slice(0, 3)
              .map((p) => `${p.department ?? "担当未確認"} / ${p.label}`)
              .join("、") || "関連手順は未登録"}
          </p>
          {!related.length && (
            <p>
              受渡しの根拠は記録されていますが、実行する手順はまだ接続されていません。
            </p>
          )}
        </section>
      )}
      {workflowId && (!flow || related.length > 0) && (
        <WorkflowReading
          key={`${workflowId}:${readerVersion}`}
          graph={graph}
          workflowId={workflowId}
          initialStepId={related[0]?.id}
          initialDataId={flow?.dataIds[0]}
          initialLens={flow && !flow.dataIds.length ? "work" : "data"}
          onDetail={stepId => onEdit(workflowId, stepId)}
          onGraphApply={onGraphApply}
          onNavigateWorkflow={(id) => {
            setWorkflow(id);
            onSelectWorkflow(id);
            setFlow("");
            setPath("");
            setPage(0);
            setTransferPage(0);
            setReaderVersion((v) => v + 1);
          }}
        />
      )}
      {children && (
        <details onToggle={e=>setAdvanced(e.currentTarget.open)}>
          <summary>システム全体の関係図・条件別の分析を開く</summary>
          {advanced && children}
        </details>
      )}
    </section>
  );
}
