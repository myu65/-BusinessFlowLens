"use client";

import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LensGraph, Relation } from "@/lib/graph";
import { overviewDataWindow, readingPage, type OverviewView } from "@/lib/overview-reading";

const roles: Record<Relation, string> = { next: "順序", executes: "自動実行", uses: "利用", reads: "参照", writes: "登録・更新", sends: "送信" };
function Pages({ window: w, noun, size, onPage }: {
  window: ReturnType<typeof readingPage>; noun: string; size: number; onPage: (page: number) => void;
}) {
  return <div className="kg-pagination" role="group" aria-label={`${noun}の表示ページ`}>
    <button disabled={!w.page} onClick={() => onPage(w.page - 1)}>前の{size}{noun}</button>
    <span>{w.start}–{w.end} / {w.total}{noun}</span>
    <button disabled={w.page >= w.last} onClick={() => onPage(w.page + 1)}>次の{size}{noun}</button>
  </div>;
}

function DataEvidence({ row, label, onOpen }: {
  row: OverviewView["data"][number]; label: (id: string) => string; onOpen: (id: string) => void;
}) {
  const [evidencePage, setEvidencePage] = useState(0), [workflowPage, setWorkflowPage] = useState(0);
  const evidence: ReactNode[] = [
    ...row.usages.map(u => <>{u.process.label}：{roles[u.relation]} · 根拠：{u.process.evidence || "未登録"}{u.process.status !== "confirmed" ? "（要確認）" : ""}</>),
    ...row.direct.map(e => <>{label(e.source)} → {label(e.target)}：{roles[e.relation]} · {e.label || "根拠未登録"}</>),
    ...row.transfers.map(f => <>{label(f.sourceSystemId)} {f.direction === "bidirectional" ? "↔" : f.direction === "unknown" ? "—（方向未確認）" : "→"} {label(f.targetSystemId)} · {f.evidence || "根拠未登録"}{f.status !== "confirmed" ? "（要確認）" : ""}</>),
    ...row.materialLinks.map(h => <>物：{h.material} · {h.dataContinuity === "linked" ? "対応確認済み" : h.dataContinuity === "broken" ? "途切れ確認" : "対応未確認"} · 根拠：{h.evidence || "未登録"}</>),
  ];
  const proofs = readingPage(evidence, evidencePage, 8), workflows = readingPage(row.workflows, workflowPage, 6);
  return <aside className="overview-focus" aria-label="選択したデータの根拠">
    <h3>{row.asset.label}の関係と確認事項</h3>
    <p>{row.asset.description || "意味・対象範囲は未登録です。"}</p>
    <p>記録上の関連システム：{row.systems.slice(0, 6).map(s => s.label).join(" / ") || "未確認"}</p>
    {row.systems.length > 6 && <details><summary>ほか{row.systems.length - 6}システムの名前を読む</summary><p>{row.systems.slice(6).map(s => s.label).join(" / ")}</p></details>}
    <p className="uncertainty-note">正本・管理責任・識別子・対象範囲は、この一覧だけでは確定できません。
      {row.systems.length > 1 ? "複数システムとの関係があります。同じデータの複製か、役割が異なるか確認してください。" : "担当者にデータの意味と管理先を確認できます。"}</p>
    <ul>{proofs.items.map((item, i) => <li key={`${proofs.page}:${i}`}>{item}</li>)}</ul>
    <Pages window={proofs} noun="根拠" size={8} onPage={setEvidencePage} />
    <div className="bird-assets">{workflows.items.map(w => <button key={w.id} onClick={() => onOpen(w.id)}>{w.name}の手順へ →</button>)}</div>
    <Pages window={workflows} noun="関連業務" size={6} onPage={setWorkflowPage} />
  </aside>;
}

export function OverviewDataMatrix({ graph, view, onOpen, initialSelectedId = null }: {
  graph: LensGraph; view: OverviewView; onOpen: (id: string) => void; initialSelectedId?: string | null;
}) {
  const selectedPage = Math.floor(Math.max(0, view.data.findIndex(d => d.asset.id === initialSelectedId)) / 20);
  const [workflowPage, setWorkflowPage] = useState(0), [dataPage, setDataPage] = useState(selectedPage), [flowPage, setFlowPage] = useState(0);
  const [workflowQuery, setWorkflowQuery] = useState(""), [dataQuery, setDataQuery] = useState(""), [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  useEffect(() => {
    setWorkflowPage(0); setDataPage(selectedPage); setFlowPage(0);
    setSelectedId(initialSelectedId); setWorkflowQuery(""); setDataQuery("");
  }, [view, initialSelectedId, selectedPage]);
  const window = overviewDataWindow(view, workflowPage, dataPage, workflowQuery, dataQuery);
  const flows = readingPage(view.flows, flowPage, 6);
  const selected = view.data.find(d => d.asset.id === selectedId);
  const byId = useMemo(() => new Map(graph.nodes.map(n => [n.id, n.label])), [graph.nodes]);
  const label = (id: string) => byId.get(id) ?? "未確認";
  return <>
    <div className="overview-summary" aria-label="選んだ範囲全体の集計">
      <span>業務 <b>{view.workflows.length}</b></span>
      <span>共通データ <b>{view.data.filter(d => d.workflows.length > 1).length}</b></span>
      <span>個別データ <b>{view.data.filter(d => d.workflows.length === 1).length}</b></span>
      <span>記録済み受け渡し <b>{view.flows.length}</b></span>
    </div>
    <section className="overview-map" aria-label="業務とデータの接点">
      <h2>データから業務の接点を見る</h2>
      <p>12業務 × 20情報ずつ読めます。表の検索とページ切替は、上の範囲全体の集計を変えません。</p>
      <p>共通＝この範囲で複数業務と記録された関係を持つ同じ情報。名前が同じというだけで、受渡しや管理先を確定しません。</p>
      <div className="landscape-filter-grid">
        <label>この表の業務名を検索<input value={workflowQuery} onChange={e => { setWorkflowQuery(e.target.value); setWorkflowPage(0); }} /></label>
        <label>この表の情報名を検索<input value={dataQuery} onChange={e => { setDataQuery(e.target.value); setDataPage(0); }} /></label>
      </div>
      <Pages window={window.workflows} noun="業務" size={12} onPage={setWorkflowPage} />
      <Pages window={window.data} noun="情報" size={20} onPage={setDataPage} />
      {window.workflows.items.length && window.data.items.length ? <div className="overview-table-scroll">
        <table className="overview-table" aria-label="業務データと業務の関係">
          <caption>表示した業務と情報の接点。未表示の関係は、ページを切り替えて確認できます。</caption>
          <thead><tr><th scope="col">業務データ</th>{window.workflows.items.map(w => <th scope="col" key={w.id}><button onClick={() => onOpen(w.id)}>{w.name}</button><small>{w.scenario === "future" ? "将来案" : w.scenario === "alternative" ? "代替案" : "現状"}</small></th>)}</tr></thead>
          <tbody>{window.data.items.map(row => <tr key={row.asset.id}>
            <th scope="row"><button aria-pressed={selectedId === row.asset.id} onClick={() => setSelectedId(row.asset.id)}>{row.asset.label}</button><small>{row.workflows.length > 1 ? "共通" : "個別"} · {row.asset.status === "confirmed" ? "確認済み" : "要確認"}</small></th>
            {window.workflows.items.map(w => {
              const names = [...new Set(row.usages.filter(u => u.process.workflowId === w.id).map(u => roles[u.relation]))];
              if (row.transfers.some(f => f.workflowIds.includes(w.id))) names.push("受け渡し");
              if (row.materialLinks.some(h => h.sourceWorkflowId === w.id || h.targetWorkflowId === w.id)) names.push("物との対応");
              if (!names.length && row.direct.some(e => e.workflowIds.includes(w.id))) names.push("システム関連");
              return <td key={w.id}>{names.length ? names.join(" / ") : "—"}</td>;
            })}
          </tr>)}</tbody>
        </table>
      </div> : <p>この表の検索に合う業務と情報の接点がありません。検索を空欄にすると、この範囲の全件を辿れます。</p>}
      {selected ? <DataEvidence key={selected.asset.id} row={selected} label={label} onOpen={onOpen} /> : <p className="uncertainty-note">情報名を選ぶと、原文の根拠と関連業務を読めます。システムとデータの同時利用だけから、保存先や連携を推定しません。</p>}
    </section>
    <details className="bird-transfers"><summary>記録済みのシステム間受け渡し · {view.flows.length}件</summary>
      <Pages window={flows} noun="受渡し" size={6} onPage={setFlowPage} />
      {flows.items.map(f => <article key={f.id}><strong>{label(f.sourceSystemId)} {f.direction === "bidirectional" ? "↔" : f.direction === "unknown" ? "—（方向未確認）" : "→"} {label(f.targetSystemId)}</strong>
        <span>{f.dataIds.map(label).join(" / ") || "データ未確認"} · {f.automation === "automatic" ? "自動" : f.automation === "manual" ? "手動" : f.automation === "mixed" ? "自動・手動混在" : "方式未確認"}</span>
        <small>{view.workflows.filter(w => f.workflowIds.includes(w.id)).map(w => w.name).join(" / ")} · {f.evidence || "根拠未登録"} · {f.status === "confirmed" ? "確認済み" : "要確認"}</small>
      </article>)}
      {!view.flows.length && <p>受け渡しは未登録です。共有データがあっても、業務間の受け渡しがあるとは確定できません。</p>}
    </details>
  </>;
}
