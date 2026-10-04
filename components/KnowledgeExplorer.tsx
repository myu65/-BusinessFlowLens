"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { LensGraph, LensNode } from "@/lib/graph";
import { handoffJourney, type FlowJourney, type FlowReadingPosition } from "@/lib/flow-context";
import {
  compareWorkflow,
  comparisonExecutor,
  comparisonResources,
  executionLabels,
  confidenceLabels,
  knowledgeIndex,
  knowledgeReportDocument,
  knowledgeReportText,
  type KnowledgeReportDocument,
  type KnowledgeScope,
} from "@/lib/knowledge";
import { ProcessContextEditor } from "./ProcessContextEditor";
import { WorkflowReading } from "./WorkflowReading";
import { USAGE_DEFINITION } from "./ScopedExplorers";
import { CompanyOrientation } from "./CompanyOrientation";
import { termExplanation, connectionKindLabel, connectionRoleLabel } from "@/lib/knowledge-guide";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { createChemicalCompany } from "@/lib/chemical-company";
import { inputSystemRoles } from "@/lib/input-knowledge";
import { SystemLandscapeCards } from "./SystemLandscapeCards";
import { SystemRelationshipMap } from "./SystemRelationshipMap";
import { KnowledgeReportPreview } from "./KnowledgeReportPreview";
import type { ExplorationFocus as Focus, ExplorationPosition, KnowledgeExploration } from "@/lib/exploration";
export type { KnowledgeExploration } from "@/lib/exploration";

const mode = {
  manual: "人による作業",
  automatic: "システム自動処理",
  mixed: "人＋自動処理",
  unknown: "実行方法未確認",
};

export function KnowledgeExplorer({
  projectId,
  graph,
  onGraphApply,
  onOpenWorkflow,
  onWorkflowFocus,
  onFocusStep,
  onInput,
  exploration,
  onExplorationChange,
}: {
  projectId: string;
  graph: LensGraph;
  onGraphApply: (g: LensGraph) => void;
  onOpenWorkflow: (id: string) => void;
  onWorkflowFocus: (id: string) => void;
  onFocusStep?: (workflowId: string, stepId: string) => void;
  onInput?: (workflowId?: string) => void;
  exploration?: KnowledgeExploration;
  onExplorationChange?: (value: KnowledgeExploration) => void;
}) {
  const [report, setReport] = useState<{ document: KnowledgeReportDocument; text: string; url: string } | null>(
    null,
  );
  const [focus, setFocus] = useState<Focus>(exploration?.focus ?? { kind: "company" });
  const [history, setHistory] = useState<ExplorationPosition[]>(exploration?.history ?? []);
  const [scope, setScope] = useState<KnowledgeScope>(exploration?.scope ?? "current");
  const [query, setQuery] = useState(exploration?.query ?? "");
  const [department, setDepartment] = useState(exploration?.department ?? "");
  const [category, setCategory] = useState(exploration?.category ?? "");
  const [page, setPage] = useState(0);
  const [readStepId, setReadStep] = useState(exploration?.stepId ?? "");
  const [readerJourney, setReaderJourney] = useState<FlowJourney | undefined>(exploration?.journey);
  const [readDataId, setReadData] = useState(exploration?.dataId ?? "");
  const [readDepth, setReadDepth] = useState<FlowReadingPosition["depth"]>(exploration?.depth ?? "step");
  const [readLens, setReadLens] = useState<FlowReadingPosition["lens"]>(exploration?.lens ?? (exploration?.dataId ? "data" : "work"));
  const rememberReading = useCallback((position: FlowReadingPosition) => {
    setReadStep(position.stepId); setReadData(position.dataId);
    setReadDepth(position.depth); setReadLens(position.lens); setReaderJourney(position.journey);
  }, []);
  useEffect(() => {
    onExplorationChange?.({ focus, history, scope, query, department, category, stepId: readStepId, dataId: readDataId, depth: readDepth, lens: readLens, journey: readerJourney });
  }, [focus, history, scope, query, department, category, readStepId, readDataId, readDepth, readLens, readerJourney, onExplorationChange]);
  const [editingStep, setEditingStep] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [dependencyId, setDependencyId] = useState("");
  const [dependencyReason, setDependencyReason] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const view = useMemo(
    () => knowledgeIndex(graph, scope, query, department),
    [graph, scope, query, department],
  );
  const go = (next: Focus) => {
    setHistory((h) => [...h, { focus, scope, query, department, category, stepId: readStepId, dataId: readDataId, depth: readDepth, lens: readLens, journey: readerJourney }]);
    setFocus(next);
    if (next.kind === "process") { setReadDepth("detail"); setReadLens("work"); setReadData(""); }
    setPage(0);
    setEditingStep("");
    if (next.kind === "workflow") onWorkflowFocus(next.id);
    if (next.kind === "process") {
      const process = graph.nodes.find((n) => n.id === next.id);
      if (process?.workflowId) onWorkflowFocus(process.workflowId);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const row =
    focus.kind === "workflow"
      ? view.rows.find((r) => r.workflow.id === focus.id)
      : undefined;
  const asset =
    focus.kind === "asset" || focus.kind === "process"
      ? view.nodeById.get(focus.id)
      : undefined;
  const activity =
    focus.kind === "activity"
      ? view.activities.find((a) => a.id === focus.id)
      : undefined;
  const cap =
    focus.kind === "capability"
      ? view.activities
          .flatMap((a) => a.capabilities)
          .find((c) => c.id === focus.id)
      : undefined;
  const impact =
    focus.kind === "asset" ? view.systemProfile(focus.id) : undefined;
  const registeredProfile = graph.knowledge?.systems.find(s => s.systemId === asset?.id);
  const label = (id: string) => view.nodeById.get(id)?.label ?? id;
  const assetButton = (n: LensNode) => (
    <button
      className={`kg-chip kg-chip--${n.kind}`}
      key={n.id}
      title={
        termExplanation(n.label) ??
        (n.kind === "system"
          ? "この道具が支える仕事を見る"
          : "この情報を使う仕事を見る")
      }
      onClick={() => go({ kind: "asset", id: n.id })}
    >
      {n.label}
    </button>
  );
  const workflowButton = (id: string) => (
    <button key={id} onClick={() => go({ kind: "workflow", id })}>
      {graph.workflows.find((w) => w.id === id)?.name ?? id}
    </button>
  );
  const processButton = (p: LensNode) => <button key={p.id} onClick={() => go({ kind: "process", id: p.id })}>
    {p.label} · {mode[p.executionMode ?? "unknown"]} · {graph.workflows.find(w => w.id === p.workflowId)?.name}
  </button>;
  const flowCard = (f: LensGraph["dataFlows"][number]) => <article key={f.id}>
    <div>{view.nodeById.get(f.sourceSystemId) && assetButton(view.nodeById.get(f.sourceSystemId)!)}
      <span aria-label="受渡しの方向"> → </span>{view.nodeById.get(f.targetSystemId) && assetButton(view.nodeById.get(f.targetSystemId)!)}
      <span> · {{ manual: "人が転記・受渡し", email: "メール", api: "システム間連携", file: "ファイル",
        database: "データベース", message: "メッセージ", unknown: "受渡し方法は未確認" }[f.transferType]} / {mode[f.automation]}</span>
    </div>
    <div>{f.dataIds.map(id => view.nodeById.get(id)!).filter(Boolean).map(assetButton)}</div>
    <p>{f.evidence}</p>
    {f.workflowIds.filter(id => view.rows.some(r => r.workflow.id === id)).slice(0, 3).map(workflowButton)}
    {f.workflowIds.filter(id => view.rows.some(r => r.workflow.id === id)).length > 3 && <p>ほかの関連業務は下の一覧・レポートで確認できます。</p>}
  </article>;
  const download = () => {
    const document = knowledgeReportDocument(
      graph,
      scope,
      query,
      department,
      selectedRows.map((r) => r.workflow.id),
      focus.kind === "asset" ? focus.id : undefined,
    );
    const params = new URLSearchParams({
      projectId,
      scope,
      query,
      department,
      workflows: selectedRows.map((r) => r.workflow.id).join(","),
    });
    if (focus.kind === "asset") params.set("assetId", focus.id);
    setReport({ document, text: knowledgeReportText(document), url: `/api/report?${params.toString()}` });
  };
  const loadExample = async () => {
    setError("");
    try {
      // Separate project snapshot prevents the example from replacing the user's working graph.
      const response = await fetch("/api/project?projectId=chemical-demo");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (!payload.project) {
        const result = await fetch("/api/project", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "chemical-demo",
            projectName: "青葉ケミカル（検証用）",
            graph: createChemicalCompany(),
            transcripts: {},
          }),
        });
        if (!result.ok)
          throw new Error("化学メーカーのサンプルを保存できませんでした");
      }
      window.location.assign("/?projectId=chemical-demo");
    } catch (e) {
      setError(e instanceof Error ? e.message : "サンプル読込に失敗しました");
      setImporting(false);
    }
  };
  const namedSystems = new Set(
    graph.nodes
      .filter(
        (n) =>
          n.kind === "system" &&
          query &&
          `${n.label} ${n.description} ${(n.aliases ?? []).join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .map((n) => n.id),
  );
  const systems = graph.nodes
    .filter((n) => n.kind === "system")
    .filter(
      (n) =>
        (!category ||
          graph.knowledge?.systems.find((s) => s.systemId === n.id)
            ?.categoryId === category) &&
        (!query ||
          (namedSystems.size
            ? namedSystems.has(n.id)
            : view.systemProfile(n.id).direct.length)),
    )
    .filter(
      (n) =>
        !department ||
        view.systemProfile(n.id).direct.length ||
        view.systemProfile(n.id).indirect.length,
    );
  const processRow =
    focus.kind === "process"
      ? view.rows.find((r) => r.workflow.id === asset?.workflowId)
      : undefined;
  const selectedRows =
    focus.kind === "workflow"
      ? row
        ? [row]
        : []
      : focus.kind === "process"
        ? processRow
          ? [processRow]
          : []
        : focus.kind === "systems" && category
          ? view.rows.filter((r) =>
              systems.some((n) => {
                const p = view.systemProfile(n.id);
                return p.direct.includes(r) || p.indirect.includes(r);
              }),
            )
          : (activity?.rows ?? cap?.rows ?? impact?.direct ?? view.rows);
  const list = (rows: typeof view.rows) => (
    <>
      <p>
        {rows.length}業務 /{" "}
        {rows.length
          ? `${page * 20 + 1}–${Math.min(rows.length, (page + 1) * 20)}`
          : "0"}
        を表示
      </p>
      <div className="kg-workflows">
        {rows.slice(page * 20, (page + 1) * 20).map((r) => (
          <article key={r.workflow.id}>
            {workflowButton(r.workflow.id)}
            <p>{r.workflow.description}</p>
            <span>
              {r.departments.join(" / ")} · {r.processes.length}工程 ·{" "}
              {r.assets.filter((n) => n.kind === "system").length}道具
            </span>
            {graph.knowledge?.criticalWorkflows.some(
              (w) => w.workflowId === r.workflow.id,
            ) && <strong className="kg-important">重要業務</strong>}
          </article>
        ))}
      </div>
      <div className="kg-toolbar">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          前の20件
        </button>
        <button
          disabled={(page + 1) * 20 >= rows.length}
          onClick={() => setPage((p) => p + 1)}
        >
          次の20件
        </button>
      </div>
    </>
  );
  return (
    <section className="page-view kg-view" data-focus={focus.kind}>
      <header className="company-page-header">
        <div>
          <span className="company-heading-kicker">
            {focus.kind === "company" ? graph.knowledge?.name || "入力した話から育つ会社の構造" : "入力した話から、会社のしくみを知る"}
          </span>
          <h1>
            {focus.kind === "company"
              ? "会社の全体像"
              : focus.kind === "systems"
                ? "システム・道具の全体像"
                : (row?.workflow.name ??
                  asset?.label ??
                  activity?.name ??
                  cap?.name ??
                  "会社の構造を探索")}
          </h1>
          {focus.kind === "company" && (
            <p>
              活動を選ぶと、仕事の前後と人・道具・情報が見えます。
            </p>
          )}
        </div>
        {onInput && (
          <button onClick={() => onInput(row?.workflow.id)}>
            {row ? "この仕事の話を補足する →" : "仕事の話を書く →"}
          </button>
        )}
      </header>
      {focus.kind !== "company" && (
        <div className="kg-toolbar kg-explore-nav">
          <button
            onClick={() => {
              go({ kind: "company" });
              setQuery("");
              setDepartment("");
              setCategory("");
            }}
          >
            会社全体
          </button>
          <button onClick={() => go({ kind: "systems" })}>
            システム・道具の全体像
          </button>
          <button
            disabled={!history.length}
            onClick={() => {
              const previous = history.at(-1)!;
              setFocus(previous.focus);
              if (previous.focus.kind === "workflow")
                onWorkflowFocus(previous.focus.id);
              if (previous.focus.kind === "process") {
                const process = graph.nodes.find(
                  (n) => n.id === (previous.focus as { id: string }).id,
                );
                if (process?.workflowId) onWorkflowFocus(process.workflowId);
              }
              setEditingStep("");
              setScope(previous.scope);
              setQuery(previous.query);
              setDepartment(previous.department);
              setCategory(previous.category);
              setReadStep(previous.stepId ?? "");
              setReadData(previous.dataId ?? "");
              setReadDepth(previous.depth ?? "step");
              setReadLens(previous.lens ?? (previous.dataId ? "data" : "work"));
              setReaderJourney(previous.journey);
              setHistory((h) => h.slice(0, -1));
              setPage(0);
              window.scrollTo({ top: 0, behavior: "instant" });
            }}
          >
            ひとつ戻る
          </button>
          <button onClick={download}>この範囲をレポート出力</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {report && <KnowledgeReportPreview key={report.url} {...report} onClose={() => setReport(null)} />}

      <div className="kg-toolbar company-filters">
        <label>
          表示する状態
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as KnowledgeScope);
              if (focus.kind !== "asset" && focus.kind !== "systems") setFocus({ kind: "company" });
              setHistory([]);
              setPage(0);
            }}
          >
            <option value="current">現在の仕事</option>
            <option value="future">改善後の案</option>
            <option value="alternative">別の案</option>
          </select>
        </label>
        <label>
          部署
          <select
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(0);
            }}
          >
            <option value="">すべての部署</option>
            {view.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          会社内を検索
          <input
            value={query}
            placeholder="業務名・部署・システム・情報・工場"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <span>この範囲：{selectedRows.length}業務</span>
      </div>
      {(query || department) && (
        <button
          onClick={() => {
            setQuery("");
            setDepartment("");
            setPage(0);
          }}
        >
          検索・部署の条件をクリア
        </button>
      )}
      {focus.kind === "company" && (
        <CompanyOrientation
          graph={graph}
          scope={scope}
          rows={view.rows}
          workflowIds={view.rows.map((r) => r.workflow.id)}
          onWorkflow={(id, stepId) => { setReadStep(stepId ?? ""); setReaderJourney(undefined); setReadData(""); setReadDepth("step"); setReadLens("work"); go({ kind: "workflow", id }); }}
          onSystems={() => go({ kind: "systems" })}
          onActivity={(id) => go({ kind: "activity", id })}
          onSystem={(id) => go({ kind: "asset", id })}
          onInput={onInput ? () => onInput() : undefined}
        />
      )}
      {focus.kind !== "company" && focus.kind !== "systems" && (
        <p className="kg-trail" aria-label="現在の探索位置">
          会社全体
          {activity
            ? ` → ${activity.name}`
            : cap
              ? ` → ${view.activities.find((a) => a.capabilities.some((c) => c.id === cap.id))?.name} → ${cap.name}`
              : row
                ? ` → ${row.capabilities.map((c) => `${c.activity.name} → ${c.capability.name}`).join(" / ")} → ${row.workflow.name}`
                : asset
                  ? ` → ${asset.kind === "process" ? "ひとつの手順" : asset.kind === "system" ? "システム・道具" : "業務で使う情報"} → ${asset.label}`
                  : ""}
        </p>
      )}
      {(row || processRow || cap || activity) && (
        <nav className="kg-toolbar" aria-label="大きな視点へ戻る">
          {(row ?? processRow)?.capabilities.slice(0, 1).map((c) => (
            <span key={c.capability.id}>
              <button
                onClick={() => go({ kind: "activity", id: c.activity.id })}
              >
                ↑ 活動全体：{c.activity.name}
              </button>{" "}
              <button
                onClick={() => go({ kind: "capability", id: c.capability.id })}
              >
                ↑ 仕事の種類：{c.capability.name}
              </button>
            </span>
          ))}
          {processRow && (
            <button
              onClick={() =>
                go({ kind: "workflow", id: processRow.workflow.id })
              }
            >
              ↑ 業務の流れに戻る
            </button>
          )}
        </nav>
      )}
      {focus.kind === "company" && (
        <>
          {view.activities.some((a) => a.rows.length) &&
            view.rows.some((r) => !r.capabilities.length) && (
              <>
                <h2>保存した話</h2>
                <p className="company-map-caption">
                  まだ活動にまとめていない仕事も、そのまま読めます。
                </p>
                {list(view.rows.filter((r) => !r.capabilities.length))}
              </>
            )}
          <details>
            <summary>業務の一覧を直接見る（{view.rows.length}件）</summary>
            {list(view.rows)}
          </details>
          <details className="kg-secondary">
            <summary>会社の説明・レポート・サンプル</summary>
            {graph.knowledge?.description && (
              <p>{graph.knowledge.description}</p>
            )}
            <div className="kg-toolbar">
              <button onClick={download}>この範囲をレポート出力</button>
              <button
                disabled={importing}
                onClick={() => {
                  setImporting(true);
                  void loadExample();
                }}
              >
                架空の化学メーカー300業務を開く
              </button>
              <a href="/?projectId=default">自分のプロジェクトへ</a>
            </div>
          </details>
          <KnowledgeEditor graph={graph} onApply={onGraphApply} />
        </>
      )}
      {activity && (
        <>
          <h2>{activity.name}</h2>
          {activity.certainty && activity.certainty !== "confirmed" && (
            <p>入力された話からの整理案です。</p>
          )}
          <p>{activity.description}</p>
          <p className="kg-context">
            ここでは、この活動に必要な「仕事の種類」を選びます。たとえば受注登録は仕事の種類で、工場ごとに担当部署や手順が違います。
          </p>
          <h3>どの仕事を知りたいですか？</h3>
          <div className="kg-cards">
            {activity.capabilities
              .filter((c) => c.rows.length)
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => go({ kind: "capability", id: c.id })}
                >
                  <strong>{c.name}</strong>
                  {c.certainty && c.certainty !== "confirmed" && (
                    <small> 整理案</small>
                  )}
                  <p>{c.description}</p>
                  {c.rows.length}業務
                </button>
              ))}
          </div>
          <h3>この活動を支えるシステム・道具</h3>
          {[
            ...new Map(
              activity.rows
                .flatMap((r) => r.assets.filter((n) => n.kind === "system"))
                .map((n) => [n.id, n]),
            ).values(),
          ].map(assetButton)}
          <h3>関係部署</h3>
          <p>
            {[...new Set(activity.rows.flatMap((r) => r.departments))].join(
              " / ",
            )}
          </p>
          {list(activity.rows)}
        </>
      )}
      {cap && (
        <>
          <h2>{cap.name}</h2>
          <p>{cap.description}</p>
          <p className="kg-context">
            同じ仕事でも、部署・工場・製品ごとに行い方が違います。ひとつ選ぶと、開始から完了までの手順がわかります。
          </p>
          {list(cap.rows)}
        </>
      )}
      {row && (
        <>
          <h2>{row.workflow.name}</h2>
          <p className="kg-context">
            手順と条件のつながりを辿ってください。手順を押すと判断や個別作業が、青いラベルを押すとシステムの役割が、緑のラベルを押すと情報の使われ方がわかります。
          </p>
          <p>{row.workflow.description}</p>
          <p>
            起点: {row.workflow.trigger ?? "未登録"} → 成果:{" "}
            {row.workflow.outcome ?? "未登録"}
          </p>
          <p>
            重要性:{" "}
            {graph.knowledge?.criticalWorkflows.find(
              (w) => w.workflowId === row.workflow.id,
            )?.reason ?? "未評価"}
          </p>
          <div className="kg-toolbar">
            <button onClick={() => onOpenWorkflow(row.workflow.id)}>
              業務フロー図・詳細編集を開く
            </button>
            {row.capabilities.map((c) => (
              <button
                key={c.capability.id}
                onClick={() => go({ kind: "activity", id: c.activity.id })}
              >
                {c.activity.name}へ戻る
              </button>
            ))}
          </div>
          <details>
            <summary>この業務で使うシステム・情報をまとめて見る</summary>
            <h3>システム・道具</h3>
            {row.assets.filter((n) => n.kind === "system").map(assetButton)}
            <h3>記録・ファイルなどの情報</h3>
            {row.assets.filter((n) => n.kind === "data").map(assetButton)}
          </details>
          <h3>業務の流れ</h3>
          <WorkflowReading
            key={row.workflow.id}
            graph={graph}
            workflowId={row.workflow.id}
            initialStepId={readStepId}
            initialDataId={readDataId || undefined}
            initialDepth={readDepth}
            initialLens={readLens}
            onReadingChange={rememberReading}
            onGraphApply={onGraphApply}
            onStepChange={(id) => {
              setReadStep(id);
              setEditingStep("");
              onFocusStep?.(row.workflow.id, id);
            }}
            journey={
              readerJourney?.workflowId === row.workflow.id
                ? readerJourney
                : undefined
            }
            onNavigateWorkflow={(id, journey) => {
              setReaderJourney(journey);
              setReadStep(journey.stepId ?? "");
              setReadData(journey.dataId ?? "");
              setReadLens(journey.dataId ? "data" : "work");
              setQuery("");
              setDepartment("");
              go({ kind: "workflow", id });
            }}
            onDetail={(id) => {
              setReadStep(id);
              setEditingStep(id);
            }}
            onAsset={(n, stepId) => {
              setReadStep(stepId);
              if (n.kind === "data") { setReadData(n.id); setReadLens("data"); }
              go({ kind: "asset", id: n.id });
            }}
          />
          {editingStep &&
            graph.nodes.some(
              (n) => n.id === editingStep && n.workflowId === row.workflow.id,
            ) && (
              <ProcessContextEditor
                graph={graph}
                stepId={editingStep}
                onApply={onGraphApply}
              />
            )}
          <h3>前後の業務・活動</h3>
          <div className="kg-links">
            {(graph.knowledge?.handoffs ?? [])
              .filter(
                (h) =>
                  h.sourceWorkflowId === row.workflow.id ||
                  h.targetWorkflowId === row.workflow.id,
              )
              .map((h) => {
                const target =
                  h.sourceWorkflowId === row.workflow.id
                    ? h.targetWorkflowId
                    : h.sourceWorkflowId;
                return (
                  <article key={h.id}>
                    {connectionRoleLabel(h, h.targetWorkflowId === row.workflow.id)}（{connectionKindLabel(h)}）：{" "}
                    <button
                      onClick={() => {
                        const journey = handoffJourney(
                          graph,
                          h,
                          row.workflow.id,
                          h.sourceWorkflowId === row.workflow.id
                            ? h.sourceProcessId ||
                                readStepId ||
                                row.processes[0]?.id
                            : readStepId || row.processes[0]?.id,
                          readerJourney,
                          readDataId,
                        );
                        setReaderJourney(journey);
                        setReadStep(journey.stepId ?? "");
                        setReadData(journey.dataId ?? "");
                        setReadLens(journey.dataId ? "data" : "work");
                        go({ kind: "workflow", id: target });
                      }}
                    >
                      {graph.workflows.find((w) => w.id === target)?.name ??
                        target}
                    </button>
                    <p>{h.description}</p>
                    {h.dataIds
                      .map((id) => view.nodeById.get(id))
                      .filter((n): n is LensNode => !!n)
                      .map(assetButton)}
                    <p>{h.evidence}</p>
                  </article>
                );
              })}
          </div>
          <details>
            <summary>現状と将来案の違いを確認する</summary>
            {compareWorkflow(graph, row.workflow.id).length ? (
              compareWorkflow(graph, row.workflow.id).map((c) => (
                <article key={c.workflow.id}>
                  <p>
                    比較の向き：{row.workflow.name} → {c.workflow.name}
                  </p>
                  <button
                    onClick={() => {
                      setScope(c.workflow.scenario ?? "current");
                      setQuery("");
                      setDepartment("");
                      setReadStep(c.correspondingSteps.find(x => x.before.id === readStepId)?.after.id ?? "");
                      setReaderJourney(undefined);
                      setReadData("");
                      setReadLens("work");
                      go({ kind: "workflow", id: c.workflow.id });
                    }}
                  >
                    {c.workflow.name}
                  </button>
                  <p>
                    有効日: {c.workflow.effectiveFrom ?? "未定"} · 登録された手動の受渡し{" "}
                    {c.beforeManual} → {c.afterManual}
                  </p>
                  <p>
                    除外する手順の候補:{" "}
                    {c.removed.map((n) => n.label).join(" / ") || "なし"}
                  </p>
                  <p>
                    追加する手順の候補:{" "}
                    {c.added.map((n) => n.label).join(" / ") || "なし"}
                  </p>
                  <p>同じ業務から引き継いだ手順を並べています。手動の受渡し件数は、登録された道具間の線を数え、人の操作全体や未登録の受渡しを含みません。</p>
                  <p>
                    道具: {c.beforeSystems.map((n) => n.label).join(" / ")} →{" "}
                    {c.afterSystems.map((n) => n.label).join(" / ")}
                  </p>
                  <p>
                    完了する状態：{c.beforeOutcome || "未確認"} →{" "}
                    {c.afterOutcome || "未確認"}
                  </p>
                  {c.resultChanges.map((x) => (
                    <article className="kg-comparison-change" key={x.before.id}>
                      <h4>同じ手順の変更：{x.before.label} → {x.after.label}</h4>
                      <p>担当・実行主体：{comparisonExecutor(graph, x.before)} → {comparisonExecutor(graph, x.after)}</p>
                      <p>実行方法：{executionLabels[x.before.executionMode ?? "unknown"]} → {executionLabels[x.after.executionMode ?? "unknown"]}</p>
                      <p>結果：
                      {x.before.meaning?.result || "結果未確認"} →{" "}
                      {x.after.meaning?.result || "結果未確認"}</p>
                      <p>次の仕事：{x.before.meaning?.next || "未確認"} → {x.after.meaning?.next || "未確認"}</p>
                      <details><summary>判断の根拠・道具・情報・原文を比べる</summary>
                        <p>仕事の理由：{x.before.meaning?.purpose || "未確認"} → {x.after.meaning?.purpose || "未確認"}</p>
                        <p>判断の根拠：{x.before.meaning?.basis || "未確認"} → {x.after.meaning?.basis || "未確認"}</p>
                        <p>条件：{x.before.meaning?.condition || "未確認"} → {x.after.meaning?.condition || "未確認"}</p>
                        <p>道具：{comparisonResources(graph, x.before).tools} → {comparisonResources(graph, x.after).tools}</p>
                        <p>受け取る情報：{comparisonResources(graph, x.before).input} → {comparisonResources(graph, x.after).input}</p>
                        <p>残す情報：{comparisonResources(graph, x.before).output} → {comparisonResources(graph, x.after).output}</p>
                        <p>比較元「{row.workflow.name}」：{confidenceLabels[x.before.meaning?.certainty ?? x.before.status]} / {x.before.meaning?.evidence || "根拠未登録"}</p>
                        {x.before.evidence && x.before.evidence !== x.before.meaning?.evidence && <blockquote>{x.before.evidence}</blockquote>}
                        <p>比較先「{c.workflow.name}」：{confidenceLabels[x.after.meaning?.certainty ?? x.after.status]} / {x.after.meaning?.evidence || "根拠未登録"}</p>
                        {x.after.evidence && x.after.evidence !== x.after.meaning?.evidence && <blockquote>{x.after.evidence}</blockquote>}
                        <p>人の訂正：比較元{x.before.humanEdits?.length ?? 0}件 / 比較先{x.after.humanEdits?.length ?? 0}件。値は元の手順・履歴で確認できます。</p>
                      </details>
                    </article>
                  ))}
                  {c.added.map(
                    (n) =>
                      n.meaning?.result && (
                        <p key={`result:${n.id}`}>
                          追加する処理の結果：{n.meaning.result} →{" "}
                          {n.meaning.next || "次の仕事は未確認"} /{" "}
                          {n.meaning.evidence}
                        </p>
                      ),
                  )}
                </article>
              ))
            ) : (
              <p>比較できる同一業務の別シナリオは未登録です。</p>
            )}
          </details>
        </>
      )}
      {focus.kind === "workflow" && !row && (
        <p role="status">
          この業務は現在のシナリオ・検索・部署の対象外です。条件を戻すと表示できます。
        </p>
      )}
      {focus.kind === "process" && asset && processRow && (
        <>
          <h2>{asset.label}</h2>
          <WorkflowReading
            key={asset.id}
            graph={graph}
            workflowId={processRow.workflow.id}
            initialStepId={asset.id}
            initialDepth={readDepth}
            initialDataId={readDataId || undefined}
            initialLens={readLens}
            onReadingChange={rememberReading}
            onStepChange={(id) => {
              setReadStep(id);
              setEditingStep("");
            }}
            onGraphApply={onGraphApply}
            onDetail={setEditingStep}
            onAsset={(n, id) => {
              setReadStep(id);
              if (n.kind === "data") { setReadData(n.id); setReadLens("data"); }
              go({ kind: "asset", id: n.id });
            }}
            journey={
              readerJourney?.workflowId === processRow.workflow.id
                ? readerJourney
                : undefined
            }
            onNavigateWorkflow={(id, journey) => {
              setReaderJourney(journey);
              setReadStep(journey.stepId ?? "");
              setReadData(journey.dataId ?? "");
              setReadLens(journey.dataId ? "data" : "work");
              go({ kind: "workflow", id });
            }}
          />
          {editingStep && (
            <ProcessContextEditor
              graph={graph}
              stepId={editingStep}
              onApply={onGraphApply}
            />
          )}
        </>
      )}
      {focus.kind === "process" && !processRow && (
        <p role="status">
          この工程は現在の条件の対象外です。条件をクリアするか、ひとつ戻ると探索を続けられます。
        </p>
      )}
      {focus.kind === "systems" && (
        <>
          {query && (
            <p className="kg-context">
              {namedSystems.size
                ? "名前・説明に一致する道具を表示しています。"
                : "検索に合う仕事で使われる道具を表示しています。"}
            </p>
          )}
          <label>
            道具の種類
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(0);
              }}
            >
              <option value="">すべて</option>
              {graph.knowledge?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <SystemRelationshipMap graph={graph} scope={scope} systems={systems} view={view}
            onSelect={id => go({ kind: "asset", id })} onActivity={id => go({ kind: "activity", id })}
            onWorkflow={(id, stepId) => {
              setReadStep(stepId ?? ""); setReaderJourney(undefined); setReadData(""); setReadDepth("step"); setReadLens("work");
              go({ kind: "workflow", id });
              if (!view.rows.some(r => r.workflow.id === id)) { setQuery(""); setDepartment(""); }
            }} />
          <details><summary>登録された道具の一覧から探す（{systems.length}件・この範囲の利用0件も含む）</summary>
            <SystemLandscapeCards graph={graph} systems={systems} view={view} page={page} onPage={setPage} onSelect={id => go({kind: "asset", id})} />
          </details>
          {graph.knowledge && (
            <details>
              <summary>システム・道具の分類を追加・変更する</summary>
              {graph.knowledge.categories.map((c) => (
                <label className="kg-edit-field" key={c.id}>
                  分類名
                  <input
                    aria-label={`分類名 ${c.name}`}
                    value={c.name}
                    onChange={(e) =>
                      onGraphApply({
                        ...graph,
                        knowledge: {
                          ...graph.knowledge!,
                          categories: graph.knowledge!.categories.map((n) =>
                            n.id === c.id ? { ...n, name: e.target.value } : n,
                          ),
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label>
                新しい分類
                <input
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                />
              </label>
              <button
                disabled={!categoryName.trim()}
                onClick={() => {
                  onGraphApply({
                    ...graph,
                    knowledge: {
                      ...graph.knowledge!,
                      categories: [
                        ...graph.knowledge!.categories,
                        {
                          id: `category:${crypto.randomUUID()}`,
                          name: categoryName.trim(),
                          description: "",
                        },
                      ],
                    },
                  });
                  setCategoryName("");
                }}
              >
                分類を追加
              </button>
            </details>
          )}
        </>
      )}
      {focus.kind === "asset" && asset && impact && (
        <>
          <h2>{asset.label}</h2>
          {termExplanation(asset.label) && (
            <p className="kg-term">{termExplanation(asset.label)}</p>
          )}
          <p>{impact.profile?.purpose ?? (asset.kind === "system" && asset.status === "unknown" ? "同じ道具か確認してください。ここでは、その話で使う道具として扱います。" : asset.description)}</p>
          {impact.profile?.certainty && (
            <p>
              {impact.profile.certainty === "confirmed"
                ? "原文にある役割"
                : "入力された話からの整理案"}{" "}
              · 根拠：{impact.profile.evidence || "未確認"}
            </p>
          )}
          <p>管理部署: {impact.profile?.owner || "未登録"}</p>
          {asset.kind === "system" &&
            (() => {
              const roles = inputSystemRoles(
                graph,
                asset.id,
                impact.direct.map((r) => r.workflow.id),
              );
              const role = (r: (typeof roles)[number]) => (
                <li key={`${r.workflowId}:${r.name}`}>
                  <button
                    onClick={() => go({ kind: "workflow", id: r.workflowId })}
                  >
                    {r.workflowName}
                  </button>
                  <p>{r.purpose}</p>
                  <small>
                    {r.certainty === "confirmed"
                      ? "原文に明示"
                      : r.certainty === "unknown"
                        ? "対応は未確認"
                        : "整理案・要確認"}{" "}
                    · 根拠：{r.evidence}
                  </small>
                </li>
              );
              return (
                roles.length > 0 && (
                  <section aria-label="入力した話ごとのシステムの役割">
                    <h3>この道具は、どの仕事で何をする？</h3>
                    <ul>{roles.slice(0, 3).map(role)}</ul>
                    {roles.length > 3 && (
                      <details>
                        <summary>
                          ほか{roles.length - 3}業務の役割を見る
                        </summary>
                        <ul>{roles.slice(3, 20).map(role)}</ul>
                        {roles.length > 20 && (
                          <p>
                            ここでは20業務まで表示しています。ほかの役割は、下の業務一覧から確認できます。
                          </p>
                        )}
                      </details>
                    )}
                  </section>
                )
              );
            })()}
          <p className="kg-context">
            {asset.kind === "data"
              ? "これは業務で受け取り、参照・更新する情報です。下で、その情報を使う仕事と、受渡し先を確かめられます。"
              : USAGE_DEFINITION}
          </p>
          <p aria-label="集計の内訳">
            直接関連 {impact.direct.length}業務（手順で利用{" "}
            {impact.stepUse.length} / 連携で関連 {impact.flowUse.length} ·
            重複あり） / 間接影響 {impact.indirect.length}業務
          </p>
          {asset.kind === "system" && graph.knowledge && (
            <label>
              分類
              <select
                value={impact.profile?.categoryId ?? ""}
                onChange={(e) =>
                  onGraphApply({
                    ...graph,
                    knowledge: {
                      ...graph.knowledge!,
                      systems: [
                        ...graph.knowledge!.systems.filter(
                          (s) => s.systemId !== asset.id,
                        ),
                        {
                          systemId: asset.id,
                          categoryId: e.target.value,
                          owner: impact.profile?.owner ?? "",
                          purpose: impact.profile?.purpose ?? asset.description,
                          dependsOn: registeredProfile?.dependsOn ?? [],
                        },
                      ],
                    },
                  })
                }
              >
                <option value="">未分類</option>
                {graph.knowledge.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h3>会社のどの活動を支えているか</h3>
          <div className="kg-toolbar">
            {view.activities
              .filter((a) =>
                a.rows.some(
                  (r) =>
                    impact.direct.includes(r) || impact.indirect.includes(r),
                ),
              )
              .map((a) => (
                <button
                  key={a.id}
                  onClick={() => go({ kind: "activity", id: a.id })}
                >
                  {a.name} · 直接
                  {a.rows.filter((r) => impact.direct.includes(r)).length}業務 /
                  間接{a.rows.filter((r) => impact.indirect.includes(r)).length}
                  業務
                </button>
              ))}
          </div>
          <p>
            {[
              ...new Set(
                [...impact.direct, ...impact.indirect].flatMap((r) =>
                  r.capabilities.map((c) => c.capability.name),
                ),
              ),
            ].join(" / ")}
          </p>
          {asset.kind === "data" && impact.direct[0] && (
            <button
              onClick={() => {
                setReadData(asset.id);
                setReadLens("data");
                setReadStep("");
                go({ kind: "workflow", id: impact.direct[0].workflow.id });
              }}
            >
              この情報を業務の流れの中で辿る →
            </button>
          )}
          <h3>使用部署</h3>
          <p>
            {[
              ...new Set(
                [...impact.direct, ...impact.indirect].flatMap(
                  (r) => r.departments,
                ),
              ),
            ].join(" / ") || "登録なし"}
          </p>
          <h3>自動処理・個別工程（{impact.processes.length}）</h3>
          <div className="kg-links">
            {impact.processes.slice(0, 6).map(processButton)}
          </div>
          {impact.processes.length > 6 && <details><summary>ほか{Math.min(30, impact.processes.length) - 6}工程を読む</summary>
            <div className="kg-links">{impact.processes.slice(6, 30).map(processButton)}</div>
          </details>}
          {impact.processes.length > 30 && (
            <p>
              先頭30工程を表示。部署・検索で絞るか、関連業務からすべての工程を読めます。
            </p>
          )}
          <h3>
            道具の間で情報を渡す経路（
            {impact.flows.length}）
          </h3>
          {!impact.flows.length && (
            <p className="kg-context">
              別の道具への転送は、まだ説明されていません。人や業務への受渡しは、上の手順から辿れます。
            </p>
          )}
          <div className="kg-links">
            {impact.flows.slice(0, 4).map(flowCard)}
          </div>
          {impact.flows.length > 4 && <details><summary>ほか{Math.min(30, impact.flows.length) - 4}受渡しを読む</summary>
            <div className="kg-links">{impact.flows.slice(4, 30).map(flowCard)}</div>
          </details>}
          {impact.flows.length > 30 && (
            <p>
              先頭30受渡しを表示。レポートにはこの条件の全受渡しを出力します。
            </p>
          )}
          <h3>動くために必要な仕組み</h3>
          {impact.profile?.dependsOn.length ? (
            impact.profile.dependsOn.map((d) => (
              <p key={d.systemId}>
                <button onClick={() => go({ kind: "asset", id: d.systemId })}>
                  {label(d.systemId)}
                </button>{" "}
                · {d.reason}
                {d.sourceWorkflowId && <><br /><small>{d.certainty === "confirmed" ? "入力・訂正の根拠あり" : "推定・要確認"} · 根拠：{d.evidence}</small> <button onClick={() => onInput?.(d.sourceWorkflowId)}>この話で依存を確認・訂正する</button></>}
              </p>
            ))
          ) : (
            <p>未登録</p>
          )}
          {asset.kind === "system" && graph.knowledge && (
            <details>
              <summary>システムの役割・管理部署・基盤依存を編集</summary>
              {(["purpose", "owner"] as const).map((key, i) => (
                <label className="kg-edit-field" key={key}>
                  {["会社での役割", "管理部署"][i]}
                  <input
                    value={impact.profile?.[key] ?? ""}
                    onChange={(e) =>
                      onGraphApply({
                        ...graph,
                        knowledge: {
                          ...graph.knowledge!,
                          systems: [
                            ...graph.knowledge!.systems.filter(
                              (s) => s.systemId !== asset.id,
                            ),
                            {
                              systemId: asset.id,
                              categoryId: impact.profile?.categoryId ?? "",
                              owner: impact.profile?.owner ?? "",
                              purpose:
                                impact.profile?.purpose ?? asset.description,
                              dependsOn: registeredProfile?.dependsOn ?? [],
                              [key]: e.target.value,
                            },
                          ],
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label className="kg-edit-field">
                依存先システム
                <select
                  value={dependencyId}
                  onChange={(e) => setDependencyId(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {graph.nodes
                    .filter((n) => n.kind === "system" && n.id !== asset.id)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="kg-edit-field">
                依存の理由
                <input
                  value={dependencyReason}
                  onChange={(e) => setDependencyReason(e.target.value)}
                />
              </label>
              <button
                disabled={!dependencyId || !dependencyReason.trim()}
                onClick={() => {
                  onGraphApply({
                    ...graph,
                    knowledge: {
                      ...graph.knowledge!,
                      systems: [
                        ...graph.knowledge!.systems.filter(
                          (s) => s.systemId !== asset.id,
                        ),
                        {
                          systemId: asset.id,
                          categoryId: impact.profile?.categoryId ?? "",
                          owner: impact.profile?.owner ?? "",
                          purpose: impact.profile?.purpose ?? asset.description,
                          dependsOn: [
                            ...(registeredProfile?.dependsOn ?? []).filter(
                              (d) => d.systemId !== dependencyId,
                            ),
                            {
                              systemId: dependencyId,
                              reason: dependencyReason.trim(),
                            },
                          ],
                        },
                      ],
                    },
                  });
                  setDependencyId("");
                  setDependencyReason("");
                }}
              >
                依存関係を登録
              </button>
              {(registeredProfile?.dependsOn ?? []).map((d) => (
                <p key={d.systemId}>
                  {label(d.systemId)}: {d.reason}{" "}
                  <button
                    onClick={() =>
                      onGraphApply({
                        ...graph,
                        knowledge: {
                          ...graph.knowledge!,
                          systems: graph.knowledge!.systems.map((s) =>
                            s.systemId === asset.id
                              ? {
                                  ...s,
                                  dependsOn: s.dependsOn.filter(
                                    (n) => n.systemId !== d.systemId,
                                  ),
                                }
                              : s,
                          ),
                        },
                      })
                    }
                  >
                    依存を解除
                  </button>
                </p>
              ))}
            </details>
          )}
          <h3>この仕組みを必要とするシステム</h3>
          {impact.dependents.map(assetButton)}
          <p>
            間接影響: {impact.indirect.length}
            業務。システムの明示的な依存を辿った範囲です。
          </p>
          {impact.indirect.length > 0 && (
            <details>
              <summary>間接影響の業務を確認</summary>
              <div className="kg-links">
                {impact.indirect.map((r) => workflowButton(r.workflow.id))}
              </div>
            </details>
          )}
          <h3>依存する重要業務</h3>
          <div className="kg-links">
            {[...impact.direct, ...impact.indirect]
              .filter((r) =>
                graph.knowledge?.criticalWorkflows.some(
                  (w) => w.workflowId === r.workflow.id,
                ),
              )
              .map((r) => (
                <article key={r.workflow.id}>
                  {workflowButton(r.workflow.id)}
                  <p>
                    {
                      graph.knowledge?.criticalWorkflows.find(
                        (w) => w.workflowId === r.workflow.id,
                      )?.reason
                    }
                  </p>
                </article>
              ))}
          </div>
          <h3>このシステム・情報を使う業務</h3>
          {list(impact.direct)}
        </>
      )}
      {view.rows.length === 0 && (
        <p role="status">
          この条件に一致する業務はありません。検索・部署・シナリオを変更して探索できます。
        </p>
      )}
    </section>
  );
}
