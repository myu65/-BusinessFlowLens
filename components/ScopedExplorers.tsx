"use client";
import { useEffect, useMemo, useState } from "react";
import {
  getProcessAssetLinks,
  type LensGraph,
  type LensNode,
  type WorkflowScenario,
} from "@/lib/graph";
import { knowledgeIndex } from "@/lib/knowledge";
import { AssetMergePanel } from "./ProgressiveWorkflow";
import { WorkflowReading } from "./WorkflowReading";

export const USAGE_DEFINITION =
  "直接関連＝手順での利用・自動実行、System間の連携、System/Data間の記録済み関係のいずれかがある業務の重複なし件数。間接影響＝登録された基盤依存を介して支える業務。";
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
export type AssetExploration = { id: string; scope: WorkflowScenario; department: string };
export function AssetExplorer({
  graph,
  onGraphApply,
  onEdit,
  exploration,
  onExplorationChange,
}: {
  graph: LensGraph;
  onGraphApply: (graph: LensGraph) => void;
  onEdit: (id: string) => void;
  exploration?: AssetExploration;
  onExplorationChange?: (value: AssetExploration) => void;
}) {
  const [scope, setScope] = useState<WorkflowScenario>(exploration?.scope ?? "current"),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState("all"),
    [department, setDepartment] = useState(exploration?.department ?? "");
  const [selectedId, setSelectedId] = useState(exploration?.id ?? ""),
    [page, setPage] = useState(0),
    [assetPage, setAssetPage] = useState(0),
    [reading, setReading] = useState<{
      workflowId: string;
      stepId?: string;
    } | null>(null);
  const view = useMemo(
    () => knowledgeIndex(graph, scope, "", department),
    [graph, scope, department],
  );
  const assets = useMemo(() => {
    const ids = new Set(view.rows.flatMap((r) => r.assets.map((n) => n.id)));
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
    if (activeId) onExplorationChange?.({ id: activeId, scope, department });
  }, [activeId, scope, department, onExplorationChange]);
  const impact = selected?.impact;
  const activeRows = impact?.direct ?? [];
  function reset() {
    setPage(0);
    setAssetPage(0);
    setReading(null);
  }
  return (
    <section className="page-view">
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
      <p className="kg-context">
        {USAGE_DEFINITION} 現在は
        {scope === "current"
          ? "現行"
          : scope === "future"
            ? "将来案"
            : "別の案"}
        の{view.rows.length}
        業務。部署を選ぶと、その部署が関わる業務全体を対象にします。
      </p>
      <div className="assets-layout">
        <aside className="asset-list-panel">
          <label className="kg-edit-field">
            System・Dataを検索
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
                onClick={() => {
                  setSelectedId(a.node.id);
                  setPage(0);
                  setReading(null);
                }}
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
              前の12資産
            </button>
            <span>{assets.length}資産</span>
            <button
              disabled={(assetPage + 1) * 12 >= assets.length}
              onClick={() => setAssetPage((p) => p + 1)}
            >
              次の12資産
            </button>
          </div>
        </aside>
        <main className="impact-panel">
          {selected && impact ? (
            <>
              <h2>{selected.node.label}</h2>
              <p>{impact.profile?.purpose ?? selected.node.description}</p>
              <p className="kg-context" aria-label="集計の内訳">
                直接関連 {impact.direct.length}業務（手順で利用{" "}
                {impact.stepUse.length} / 連携で関連 {impact.flowUse.length} ·
                重複あり） / 間接影響 {impact.indirect.length}業務
              </p>
              <AssetMergePanel
                graph={graph}
                source={selected.node}
                onApply={onGraphApply}
              />
              <h3>変えると、どの仕事の結果に関わるか</h3>
              <p>
                登録された関係から見る確認対象です。変更後の結果が同じになるかは、ルールと例外も確認します。
              </p>
              {activeRows.slice(page * 5, (page + 1) * 5).map((row) => {
                const processIds = new Set(
                  row.flows
                    .filter((f) =>
                      [
                        f.sourceSystemId,
                        f.targetSystemId,
                        ...f.dataIds,
                      ].includes(selected.node.id),
                    )
                    .flatMap((f) => f.processIds),
                );
                const processes = row.processes.filter(
                  (p) =>
                    processIds.has(p.id) ||
                    getProcessAssetLinks(graph, p.id).some(
                      (l) => l.asset.id === selected.node.id,
                    ),
                );
                return (
                  <article key={row.workflow.id} className="flow-decision">
                    <h4>{row.workflow.name}</h4>
                    <p>
                      {row.capabilities
                        .map((c) => `${c.activity.name} → ${c.capability.name}`)
                        .join(" / ") || "活動との所属は未分類"}{" "}
                      · {row.departments.join("、")}
                    </p>
                    {processes.slice(0, 3).map((p) => (
                      <div key={p.id}>
                        <button
                          onClick={() =>
                            setReading({
                              workflowId: row.workflow.id,
                              stepId: p.id,
                            })
                          }
                        >
                          {p.stepOrder}. {p.label} を読む →
                        </button>
                        <p>
                          根拠：{p.meaning?.basis || "未確認"} → 結果：
                          {p.meaning?.result || "未確認"} → 次の仕事：
                          {p.meaning?.next || "未確認"}
                        </p>
                        {p.meaning?.purpose && (
                          <p>必要な理由：{p.meaning.purpose}</p>
                        )}
                      </div>
                    ))}
                    {!processes.length && (
                      <p>
                        連携先として関連しています。担当する手順は未確認です。
                      </p>
                    )}
                    <button onClick={() => onEdit(row.workflow.id)}>
                      この業務の話を補足・訂正する
                    </button>
                  </article>
                );
              })}
              <div className="kg-pagination">
                <button
                  disabled={!page}
                  onClick={() => {
                    setPage((p) => p - 1);
                    setReading(null);
                  }}
                >
                  前の5業務
                </button>
                <span>
                  {activeRows.length}業務のうち{" "}
                  {activeRows.length ? page * 5 + 1 : 0}–
                  {Math.min(activeRows.length, (page + 1) * 5)}
                </span>
                <button
                  disabled={(page + 1) * 5 >= activeRows.length}
                  onClick={() => {
                    setPage((p) => p + 1);
                    setReading(null);
                  }}
                >
                  次の5業務
                </button>
              </div>
              {reading && (
                <WorkflowReading
                  key={`${selected.node.id}:${reading.workflowId}:${reading.stepId}`}
                  graph={graph}
                  workflowId={reading.workflowId}
                  initialStepId={reading.stepId}
                  initialDepth="detail"
                  onDetail={() => onEdit(reading.workflowId)}
                  onGraphApply={onGraphApply}
                />
              )}
              <details>
                <summary>連携経路と基盤依存の根拠を確認する</summary>
                {impact.flows.slice(0, 12).map((f) => (
                  <p key={f.id}>
                    {view.nodeById.get(f.sourceSystemId)?.label} →{" "}
                    {view.nodeById.get(f.targetSystemId)?.label}：
                    {f.dataIds
                      .map((id) => view.nodeById.get(id)?.label)
                      .join("、")}{" "}
                    · {f.automation} · {f.evidence || "根拠未確認"}
                  </p>
                ))}
                <p>
                  {impact.flows.length}
                  件のうち最初の12件。詳しい経路はデータフローから業務を選んで辿れます。
                </p>
                {impact.indirect.slice(0, 8).map((r) => (
                  <p key={r.workflow.id}>基盤依存：{r.workflow.name}</p>
                ))}
              </details>
            </>
          ) : (
            <p>対象の資産はありません。</p>
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
        対象 {view.rows.length}業務 / {assets.length}資産。{USAGE_DEFINITION}{" "}
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
