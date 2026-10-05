"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  type LensGraph,
  type LensNode,
  type WorkflowScenario,
} from "@/lib/graph";
import { knowledgeIndex } from "@/lib/knowledge";
import { AssetMergePanel } from "./ProgressiveWorkflow";
import { WorkflowReading } from "./WorkflowReading";
import { AssetReading } from "./AssetReading";
import type { AssetReadingPosition } from "@/lib/exploration";
import { USAGE_DEFINITION } from "@/lib/usage-definition";

export { USAGE_DEFINITION } from "@/lib/usage-definition";
function ScopeControl({
  scope,
  onChange,
}: {
  scope: WorkflowScenario;
  onChange: (value: WorkflowScenario) => void;
}) {
  return (
    <label className="kg-edit-field">
      表示する状態
      <select
        value={scope}
        onChange={(e) => onChange(e.target.value as WorkflowScenario)}
      >
        <option value="current">現在の仕事</option>
        <option value="future">改善後の案</option>
        <option value="alternative">別の案</option>
      </select>
    </label>
  );
}
type AssetSelectionPosition = { id: string; readingPosition?: AssetReadingPosition; query: string; kind: string; page: number };
export type AssetExploration = { id: string; scope: WorkflowScenario; department: string; readingPosition?: AssetReadingPosition; trail?: AssetSelectionPosition[] };
export function AssetExplorer({
  graph,
  onGraphApply,
  onEdit,
  onActivity,
  exploration,
  onExplorationChange,
}: {
  graph: LensGraph;
  onGraphApply: (graph: LensGraph) => void;
  onEdit: (id: string) => void;
  onActivity?: (id: string) => void;
  exploration?: AssetExploration;
  onExplorationChange?: (value: AssetExploration) => void;
}) {
  const [scope, setScope] = useState<WorkflowScenario>(exploration?.scope ?? "current"),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState("all"),
    [department, setDepartment] = useState(exploration?.department ?? "");
  const [selectedId, setSelectedId] = useState(exploration?.id ?? ""),
    [assetReading, setAssetReading] = useState(exploration?.readingPosition),
    [assetPage, setAssetPage] = useState(0),
    [reading, setReading] = useState<{
      workflowId: string;
      stepId?: string;
      dataId?: string;
    } | null>(null);
  const [trail, setTrail] = useState(exploration?.trail ?? []);
  const detail = useRef<HTMLElement>(null);
  const view = useMemo(
    () => knowledgeIndex(graph, scope, "", department),
    [graph, scope, department],
  );
  const assets = useMemo(() => {
    const ids = new Set(view.rows.flatMap((r) => r.assets.map((n) => n.id)));
    view.systemDeclarations.forEach(d => { ids.add(d.systemId); ids.add(d.prerequisiteId); });
    graph.nodes.filter(n => n.kind === "system" && view.systemProfile(n.id).indirect.length).forEach(n => ids.add(n.id));
    return graph.nodes
      .filter(
        (n) =>
          n.kind !== "process" &&
          ids.has(n.id) &&
          (kind === "all" || n.kind === kind) &&
          `${n.label} ${(n.aliases ?? []).join(" ")} ${n.description}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .map((node) => ({ node, impact: view.systemProfile(node.id) }))
      .sort((a, b) => b.impact.direct.length - a.impact.direct.length);
  }, [graph, view, query, kind]);
  const selectedNode = graph.nodes.find(n => n.id === selectedId && n.kind !== "process");
  const selected = selectedNode ? { node: selectedNode, impact: view.systemProfile(selectedNode.id) } : assets[0];
  const activeId = selected?.node.id ?? "";
  useEffect(() => {
    if (activeId) onExplorationChange?.({ id: activeId, scope, department, readingPosition: assetReading, trail });
  }, [activeId, scope, department, assetReading, trail, onExplorationChange]);
  const impact = selected?.impact;
  const activeRows = impact?.direct ?? [];
  function reset() {
    setAssetReading(undefined);
    setAssetPage(0);
    setReading(null);
    setTrail([]);
  }
  const showDetail = () => requestAnimationFrame(() => detail.current?.scrollIntoView({ block: "start", behavior: "instant" }));
  const openWork = (value: NonNullable<typeof reading>) => { setReading(value); showDetail(); };
  const chooseAsset = (id: string, related = false) => {
    if (id !== activeId) {
      setTrail(t => [...t, { id: activeId, readingPosition: assetReading, query, kind, page: assetPage }]);
      setSelectedId(id); setAssetReading(undefined);
      if (related) { setQuery(""); setKind("all"); setAssetPage(0); }
    }
    setReading(null); showDetail();
  };
  return (
    <section className="page-view kg-view asset-explorer">
      <header className="page-header">
        <div>
          <h1>蓄積したシステム・情報から仕事を調べる</h1>
          <p>
            利用する手順だけでなく、連携先と、その処理で変わる仕事の結果を確認できます。
          </p>
        </div>
        <ScopeControl
          scope={scope}
          onChange={(s) => {
            setScope(s);
            reset();
          }}
        />
      </header>
      <details className="asset-scope-definition"><summary>表示範囲：
        {scope === "current"
          ? "現行"
          : scope === "future"
            ? "将来案"
            : "別の案"}
        の{view.rows.length}
        業務 · {department || "すべての部署"} — 集計の意味を確認する
      </summary><p>{USAGE_DEFINITION} 部署を選ぶと、その部署が関わる業務全体を対象にします。道具・情報の検索は左の一覧だけを絞ります。</p></details>
      <div className="assets-layout">
        <aside className="asset-list-panel">
          <label className="kg-edit-field">
            道具・情報を検索
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                reset();
              }}
            />
          </label>
          <label className="kg-edit-field">
            種類
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                reset();
              }}
            >
              <option value="all">すべて</option>
              <option value="system">システム・道具</option>
              <option value="data">情報・データ</option>
            </select>
          </label>
          <label className="kg-edit-field">
            関わる部署
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                reset();
              }}
            >
              <option value="">すべて</option>
              {view.departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <div className="shared-ranking">
            {assets.slice(assetPage * 12, (assetPage + 1) * 12).map((a) => (
              <button
                key={a.node.id}
                aria-pressed={a.node.id === selected?.node.id}
                onClick={() => chooseAsset(a.node.id)}
              >
                <strong>{a.node.label}</strong>
                <small>
                  直接関連 {a.impact.direct.length}業務 · 手順で利用{" "}
                  {a.impact.stepUse.length} · 連携 {a.impact.flowUse.length}
                </small>
              </button>
            ))}
          </div>
          <div className="kg-pagination">
            <button
              disabled={!assetPage}
              onClick={() => setAssetPage((p) => p - 1)}
            >
              前の12件
            </button>
            <span>{assets.length}件</span>
            <button
              disabled={(assetPage + 1) * 12 >= assets.length}
              onClick={() => setAssetPage((p) => p + 1)}
            >
              次の12件
            </button>
          </div>
        </aside>
        <main ref={detail} className="impact-panel">
          {selected && impact ? (
            <>
              <h2>{selected.node.label}</h2>
              {!reading && trail.length > 0 && <button className="asset-return-action" onClick={() => {
                const previous = trail[trail.length - 1];
                setSelectedId(previous.id); setAssetReading(previous.readingPosition); setQuery(previous.query); setKind(previous.kind); setAssetPage(previous.page);
                setTrail(t => t.slice(0, -1)); showDetail();
              }}>ひとつ前の道具・情報へ戻る</button>}
              {!activeRows.length && <p className="kg-context">この表示範囲で直接関連する仕事はありません。状態・部署を変えて同じ道具を調べられます。</p>}
              {reading ? <section className="asset-open-work" aria-label="道具から開いた業務">
                <button className="asset-return-action" onClick={() => { setReading(null); showDetail(); }}>{selected.node.label}の詳細へ戻る →</button>
                {!view.rows.some(r => r.workflow.id === reading.workflowId) && <p>この業務は、表示範囲外の根拠として開いています。</p>}
                <WorkflowReading key={`${selected.node.id}:${reading.workflowId}:${reading.stepId}`}
                  graph={graph} workflowId={reading.workflowId} initialStepId={reading.stepId}
                  initialDataId={reading.dataId} initialDepth="step" compactControls initialLens={reading.dataId ? "data" : "work"}
                  onDetail={() => onEdit(reading.workflowId)} onGraphApply={onGraphApply} />
              </section> : <AssetReading key={JSON.stringify([selected.node.id, scope, department])}
                graph={graph} view={view} asset={selected.node} impact={impact}
                position={assetReading} onPositionChange={setAssetReading} initialSection="impact"
                onActivity={id => onActivity?.(id)}
                onWorkflow={id => openWork({ workflowId: id })}
                onAsset={id => chooseAsset(id, true)}
                onProcess={id => { const process = view.nodeById.get(id); if (process?.workflowId) openWork({ workflowId: process.workflowId, stepId: id }); }}
                onReadData={() => { if (impact.direct[0]) openWork({ workflowId: impact.direct[0].workflow.id, dataId: selected.node.id }); }}
                onInput={onEdit} standaloneEditor editor={<AssetMergePanel graph={graph} source={selected.node} onApply={onGraphApply} />} />}

            </>
          ) : (
            <p>この範囲の道具・情報はまだ登録されていません。</p>
          )}
        </main>
      </div>
    </section>
  );
}

export function CrossBusinessOverview({
  graph,
  onOpen,
}: {
  graph: LensGraph;
  onOpen: (id: string) => void;
}) {
  const [scope, setScope] = useState<WorkflowScenario>("current"),
    [query, setQuery] = useState(""),
    [department, setDepartment] = useState(""),
    [page, setPage] = useState(0),
    [assetPage, setAssetPage] = useState(0);
  const view = useMemo(
    () => knowledgeIndex(graph, scope, query, department),
    [graph, scope, query, department],
  );
  const assets = useMemo(() => {
    const counts = new Map<string, { node: LensNode; count: number }>();
    for (const r of view.rows)
      for (const n of r.assets) {
        const v = counts.get(n.id) ?? { node: n, count: 0 };
        v.count++;
        counts.set(n.id, v);
      }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [view]);
  const rows = view.rows.slice(page * 12, (page + 1) * 12),
    shownAssets = assets.slice(assetPage * 20, (assetPage + 1) * 20);
  const reset = () => {
    setPage(0);
    setAssetPage(0);
  };
  return (
    <section className="page-view">
      <header className="page-header">
        <div>
          <h1>蓄積した仕事の共通点を俯瞰する</h1>
          <p>
            12業務 ×
            20資産ずつ表示します。検索・部署・状態で範囲を絞り、仕事を選ぶと入力と構造へ戻れます。
          </p>
        </div>
        <ScopeControl
          scope={scope}
          onChange={(s) => {
            setScope(s);
            reset();
          }}
        />
      </header>
      <label className="kg-edit-field">
        横断する仕事を検索
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            reset();
          }}
        />
      </label>
      <label className="kg-edit-field">
        関わる部署
        <select
          value={department}
          onChange={(e) => {
            setDepartment(e.target.value);
            reset();
          }}
        >
          <option value="">すべて</option>
          {view.departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <p className="kg-context">
        対象 {view.rows.length}業務 / {assets.length}件。{USAGE_DEFINITION}{" "}
        未登録は依存がないことを意味しません。
      </p>
      <div className="overview-stats">
        <article>
          <span>表示対象の業務</span>
          <strong>{view.rows.length}</strong>
        </article>
        <article>
          <span>複数業務に関わる資産</span>
          <strong>{assets.filter((a) => a.count > 1).length}</strong>
        </article>
      </div>
      <div className="kg-pagination">
        <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
          前の12業務
        </button>
        <span>
          {view.rows.length ? page * 12 + 1 : 0}–
          {Math.min(view.rows.length, (page + 1) * 12)} / {view.rows.length}業務
        </span>
        <button
          disabled={(page + 1) * 12 >= view.rows.length}
          onClick={() => setPage((p) => p + 1)}
        >
          次の12業務
        </button>
        <button
          disabled={!assetPage}
          onClick={() => setAssetPage((p) => p - 1)}
        >
          前の20資産
        </button>
        <button
          disabled={(assetPage + 1) * 20 >= assets.length}
          onClick={() => setAssetPage((p) => p + 1)}
        >
          次の20資産
        </button>
      </div>
      <div className="matrix-scroll">
        <table className="usage-matrix">
          <thead>
            <tr>
              <th>関わるSystem・Data</th>
              {rows.map((r) => (
                <th key={r.workflow.id}>
                  <button onClick={() => onOpen(r.workflow.id)}>
                    {r.workflow.name}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownAssets.map((a) => (
              <tr key={a.node.id}>
                <th>
                  {a.node.label}
                  <small> · {a.count}業務</small>
                </th>
                {rows.map((r) => (
                  <td key={r.workflow.id}>
                    {r.assets.some((n) => n.id === a.node.id)
                      ? "関連あり"
                      : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
