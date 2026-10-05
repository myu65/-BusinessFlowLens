"use client";
import React, { useEffect, useMemo, useState } from "react";
import { getProcessExecutionMode, type LensGraph, type LensNode } from "@/lib/graph";
import { comparisonExecutor, comparisonResources, confidenceLabels, executionLabels, type knowledgeIndex } from "@/lib/knowledge";
import { inputSystemRoles } from "@/lib/input-knowledge";
import { termExplanation } from "@/lib/knowledge-guide";
import { readingPage } from "@/lib/overview-reading";
import type { AssetReadingPosition } from "@/lib/exploration";
import { USAGE_DEFINITION } from "./ScopedExplorers";

type View = ReturnType<typeof knowledgeIndex>;
type Impact = ReturnType<View["systemProfile"]>;
function Pages({ window, size, noun, onPage }: {
  window: { start: number; end: number; total: number; page: number; last: number };
  size: number; noun: string; onPage: (page: number) => void;
}) {
  return <div className="asset-reading-pages" aria-label={`${noun}のページ`}>
    <span>{window.start}–{window.end} / {window.total}{noun}</span>
    {window.last > 0 && <><button disabled={window.page === 0} onClick={() => onPage(window.page - 1)}>前の{size}件</button>
      <button disabled={window.page === window.last} onClick={() => onPage(window.page + 1)}>次の{size}件</button></>}
  </div>;
}
function FlowWorkflows({ ids, graph, onWorkflow }: { ids: string[]; graph: LensGraph; onWorkflow: (id: string) => void }) {
  const [page, setPage] = useState(0), window = readingPage(ids, page, 6);
  return <><div className="kg-links">{window.items.map(id => <button key={id} onClick={() => onWorkflow(id)}>{graph.workflows.find(w => w.id === id)?.name ?? id} →</button>)}</div>
    <Pages window={window} size={6} noun="関連業務" onPage={setPage} /></>;
}

export function AssetReading({ graph, view, asset, impact, position, onPositionChange, onActivity, onWorkflow, onAsset, onProcess, onReadData, onInput, editor }: {
  graph: LensGraph; view: View; asset: LensNode; impact: Impact; position?: AssetReadingPosition;
  onPositionChange?: (position: AssetReadingPosition) => void;
  onActivity: (id: string) => void; onWorkflow: (id: string) => void; onAsset: (id: string) => void;
  onProcess: (id: string) => void; onReadData: () => void; onInput?: (id: string) => void; editor?: React.ReactNode;
}) {
  const [reading, setReading] = useState<AssetReadingPosition>(() => position?.assetId === asset.id ? position : {
    assetId: asset.id, section: "work", rolesPage: 0, activityPage: 0, workPage: 0, flowPage: 0,
    processPage: 0, dependencyPage: 0, dependentPage: 0, workKind: "direct",
  });
  useEffect(() => onPositionChange?.(reading), [reading, onPositionChange]);
  const change = (value: Partial<AssetReadingPosition>) => setReading(r => ({ ...r, ...value }));
  const roles = useMemo(() => asset.kind === "system" ? inputSystemRoles(graph, asset.id, impact.direct.map(r => r.workflow.id)) : [], [graph, asset.id, asset.kind, impact.direct]);
  const related = [...impact.direct, ...impact.indirect];
  const critical = related.filter(r => graph.knowledge?.criticalWorkflows.some(w => w.workflowId === r.workflow.id));
  const activities = view.activities.filter(a => a.rows.some(r => related.includes(r)));
  const roleWindow = readingPage(roles, reading.rolesPage, 2), activityWindow = readingPage(activities, reading.activityPage, 6);
  const workRows = reading.workKind === "indirect" ? impact.indirect : reading.workKind === "critical" ? critical : impact.direct;
  const workWindow = readingPage(workRows, reading.workPage, 6), flowWindow = readingPage(impact.flows, reading.flowPage, 6);
  const processWindow = readingPage(impact.processes, reading.processPage, 6);
  const dependencyWindow = readingPage(impact.profile?.dependsOn ?? [], reading.dependencyPage, 6);
  const dependentWindow = readingPage(impact.dependents, reading.dependentPage, 6);
  const label = (id: string) => view.nodeById.get(id)?.label ?? id;
  const certainty = (value?: string) => value === "confirmed" ? "原文に明示" : value === "unknown" ? "未確認" : "整理案・要確認";
  const generalPurpose = asset.kind === "system" ? termExplanation(asset.label) : undefined;
  const sections = [{ id: "work", name: "役割と仕事", count: impact.direct.length },
    { id: "flows", name: "情報の受渡し", count: impact.flows.length },
    { id: "processes", name: "人・自動処理", count: impact.processes.length },
    { id: "dependencies", name: "稼働の依存", count: (impact.profile?.dependsOn.length ?? 0) + impact.dependents.length }] as const;
  return <section className="asset-reading" aria-label={`${asset.label}の仕事・情報・依存`}>
    <div className="asset-reading-summary">
      <p>{generalPurpose || impact.profile?.purpose || asset.description || (asset.kind === "data" ? "仕事で参照・更新・受渡しする情報です。" : "会社での役割はまだ説明されていません。")}</p>
      <span>{generalPurpose ? "道具の一般説明 · " : impact.profile?.certainty ? `${certainty(impact.profile.certainty)} · ` : ""}直接関連 {impact.direct.length}業務 · 基盤を介した影響 {impact.indirect.length}業務</span>
      <details><summary>用語・役割の根拠・集計の内訳</summary>
        {termExplanation(asset.label) && <p>{termExplanation(asset.label)}</p>}
        {asset.kind === "system" && <p>管理部署：{impact.profile?.owner || "未登録"}</p>}
        <p>使う手順で説明された部署：{[...new Set(impact.processes.map(p => p.department).filter(Boolean))].join(" / ") || "未確認"}</p>
        {impact.profile?.purpose && <p>登録された役割：{impact.profile.purpose}{impact.profile.sourceWorkflowId && ` · 出典の業務：${graph.workflows.find(w => w.id === impact.profile!.sourceWorkflowId)?.name || "未登録"}`}</p>}
        {impact.profile?.certainty && <p>{certainty(impact.profile.certainty)} · 根拠：{impact.profile.evidence || "未確認"}</p>}
        {asset.kind === "system" && asset.status === "unknown" && <p>既存の道具と同じものか未確認です。入力した話で使う道具として表示しています。</p>}
        <p>{USAGE_DEFINITION}</p><p aria-label="集計の内訳">直接関連 {impact.direct.length}業務（手順で利用 {impact.stepUse.length} / 連携で関連 {impact.flowUse.length} · 重複あり） / 間接影響 {impact.indirect.length}業務</p>
      </details>
    </div>
    <nav className="asset-reading-sections" aria-label="この道具・情報から読むもの">
      {sections.map(s => <button key={s.id} aria-pressed={reading.section === s.id} onClick={() => change({ section: s.id })}>{s.name}<span>{s.count}</span></button>)}
    </nav>
    <section className="asset-reading-panel" aria-label={sections.find(s => s.id === reading.section)?.name}>
      {reading.section === "work" && <>
        {roles.length > 0 && <section aria-label="入力した話ごとのシステムの役割"><h3>仕事で何をする？</h3>
          <div className="asset-role-cards">{roleWindow.items.map(r => <article key={`${r.workflowId}:${r.name}`}>
            <button onClick={() => onWorkflow(r.workflowId)}>{r.workflowName} →</button><p>{r.purpose}</p>
            <details><summary>{certainty(r.certainty)} · 原文の根拠</summary><p>{r.evidence || "未確認"}</p></details>
          </article>)}</div><Pages window={roleWindow} size={2} noun="役割" onPage={rolesPage => change({ rolesPage })} />
        </section>}
        {asset.kind === "data" && impact.direct.length > 0 && <button className="kg-primary" onClick={onReadData}>この情報を業務の流れの中で辿る →</button>}
        <section><h3>支える会社の活動</h3><div className="asset-activity-links">
          {activityWindow.items.map(a => <button key={a.id} onClick={() => onActivity(a.id)}>{a.name}<small>直接 {a.rows.filter(r => impact.direct.includes(r)).length}業務 · 間接 {a.rows.filter(r => impact.indirect.includes(r)).length}業務</small></button>)}
        </div>{activities.length ? <Pages window={activityWindow} size={6} noun="活動" onPage={activityPage => change({ activityPage })} /> : <p>会社の活動との対応はまだ整理されていません。</p>}</section>
        <section><h3>関わる業務</h3><div className="asset-work-kinds" aria-label="関連する業務の範囲">
          {([{ id: "direct", name: "直接関連", count: impact.direct.length }, { id: "indirect", name: "基盤を介した影響", count: impact.indirect.length }, { id: "critical", name: "重要業務", count: critical.length }] as const).map(k =>
            <button key={k.id} aria-pressed={reading.workKind === k.id} onClick={() => change({ workKind: k.id, workPage: 0 })}>{k.name} {k.count}</button>)}
        </div><div className="asset-work-cards">{workWindow.items.map(r => <article key={r.workflow.id}>
          <button onClick={() => onWorkflow(r.workflow.id)}>{r.workflow.name} →</button>
          {r.workflow.outcome ? <p>決まること：{r.workflow.outcome}</p> : <p>{r.workflow.description || "仕事の結果は未確認です。"}</p>}
          <small>{r.departments.join(" / ") || "部署は未確認"} · {r.processes.length}手順</small>
          {reading.workKind === "critical" && <p>{graph.knowledge?.criticalWorkflows.find(w => w.workflowId === r.workflow.id)?.reason}</p>}
        </article>)}</div>{workRows.length ? <Pages window={workWindow} size={6} noun="業務" onPage={workPage => change({ workPage })} /> : <p>この範囲の業務は登録されていません。</p>}</section>
      </>}
      {reading.section === "flows" && <><h3>道具の間で何を、どう渡す？</h3>
        {!impact.flows.length && <p>別の道具への転送は、まだ説明されていません。手順ごとの情報は「人・自動処理」で確認できます。</p>}
        <div className="asset-flow-cards">{flowWindow.items.map(f => <article key={f.id}>
          <div className="asset-flow-direction"><button onClick={() => onAsset(f.sourceSystemId)}>{label(f.sourceSystemId)}</button><span aria-label="受渡しの方向">{f.direction === "bidirectional" ? " ⇄ " : " → "}</span><button onClick={() => onAsset(f.targetSystemId)}>{label(f.targetSystemId)}</button></div>
          <p>{f.dataIds.map(id => <button className="kg-chip" key={id} onClick={() => onAsset(id)}>{label(id)}</button>)}</p>
          <small>{{ manual: "人が転記・受渡し", email: "メール", api: "システム間連携", file: "ファイル", database: "データベース", message: "メッセージ", unknown: "受渡し方法は未確認" }[f.transferType]} · {executionLabels[f.automation]} · {confidenceLabels[f.status]}</small>
          {f.direction === "unknown" && <small>取込みの方向は未確認</small>}
          <details><summary>原文と関係する仕事を読む</summary><p>{f.evidence || "根拠は未登録"}</p><FlowWorkflows ids={f.workflowIds.filter(id => view.rows.some(r => r.workflow.id === id))} graph={graph} onWorkflow={onWorkflow} /></details>
        </article>)}</div>{impact.flows.length > 0 && <Pages window={flowWindow} size={6} noun="受渡し" onPage={flowPage => change({ flowPage })} />}
      </>}
      {reading.section === "processes" && <><h3>誰が何を判断し、どの情報が変わる？</h3>
        {!impact.processes.length && <p>この道具・情報を使う個別の手順は、まだ登録されていません。</p>}
        <div className="asset-process-cards">{processWindow.items.map(p => { const resources = comparisonResources(graph, p); return <article key={p.id}>
          <button onClick={() => onProcess(p.id)}>{p.label} →</button><small>{comparisonExecutor(graph, p)} · {executionLabels[getProcessExecutionMode(graph, p)]}</small>
          <p>{p.meaning?.result || "この処理で何が決まるかは未確認です。"}</p>
          <dl><div><dt>参照・受取</dt><dd>{resources.input}</dd></div><div><dt>作成・更新</dt><dd>{resources.output}</dd></div></dl>
          {p.meaning?.halt && <p>停止・保留あり：{p.meaning.condition || "条件は未確認"}</p>}
          <details><summary>{confidenceLabels[p.meaning?.certainty ?? p.status]} · 根拠と前後の仕事</summary><p>{p.meaning?.evidence || p.evidence || "未登録"}</p>{p.workflowId && <button onClick={() => onWorkflow(p.workflowId!)}>{graph.workflows.find(w => w.id === p.workflowId)?.name} →</button>}</details>
        </article>; })}</div>{impact.processes.length > 0 && <Pages window={processWindow} size={6} noun="手順" onPage={processPage => change({ processPage })} />}
      </>}
      {reading.section === "dependencies" && <>
        <h3>{asset.label}が動くために必要な仕組み</h3>
        {!dependencyWindow.total && <p>稼働の依存先はまだ登録されていません。</p>}
        <div className="asset-dependency-cards">{dependencyWindow.items.map(d => <article key={d.systemId}><button onClick={() => onAsset(d.systemId)}>{label(d.systemId)} →</button><p>{d.reason}</p>
          <details><summary>{d.sourceWorkflowId ? certainty(d.certainty) : "登録された依存"} · 根拠を読む</summary><p>{d.evidence || "原文の根拠は未登録"}</p>{d.sourceWorkflowId && <><button onClick={() => onWorkflow(d.sourceWorkflowId!)}>根拠の業務を開く →</button>{onInput && <button onClick={() => onInput(d.sourceWorkflowId!)}>この話で依存を確認・訂正する</button>}</>}</details>
        </article>)}</div>{dependencyWindow.total > 0 && <Pages window={dependencyWindow} size={6} noun="依存先" onPage={dependencyPage => change({ dependencyPage })} />}
        <h3>この仕組みを必要とする道具</h3><p>登録された基盤依存を辿った道具です。直接関連と重複しない業務への間接影響は {impact.indirect.length}業務。</p>
        <div className="asset-dependency-cards">{dependentWindow.items.map(n => <article key={n.id}><button onClick={() => onAsset(n.id)}>{n.label} →</button></article>)}</div>
        {dependentWindow.total > 0 ? <Pages window={dependentWindow} size={6} noun="道具" onPage={dependentPage => change({ dependentPage })} /> : <p>必要とする道具は未登録です。</p>}
        {impact.indirect.length > 0 && <button onClick={() => change({ section: "work", workKind: "indirect", workPage: 0 })}>基盤を介して影響する{impact.indirect.length}業務を読む →</button>}
      </>}
    </section>
    {editor && <details className="asset-reading-editor"><summary>道具の分類・役割・管理部署・依存を編集する</summary>{editor}</details>}
  </section>;
}
