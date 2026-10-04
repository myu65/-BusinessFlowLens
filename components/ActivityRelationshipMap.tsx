"use client";
import React, { useEffect, useMemo, useState } from "react";
import type { LensGraph } from "@/lib/graph";
import type { knowledgeIndex } from "@/lib/knowledge";
import { activityDetailOverview, overviewWindow } from "@/lib/relationship-overview";
import { RelationshipDiagram, RelationshipEvidence } from "./RelationshipDiagram";
import { readingPage } from "@/lib/overview-reading";
import type { ActivityReadingPosition } from "@/lib/exploration";

export function ActivityRelationshipMap({ graph, activity, workflowIds, onActivity, onCapability, onWorkflow, onSystem, position, onPositionChange }: {
  graph: LensGraph; activity: ReturnType<typeof knowledgeIndex>["activities"][number]; workflowIds: string[];
  onActivity: (id: string) => void; onCapability: (id: string) => void;
  onWorkflow: (id: string, stepId?: string) => void; onSystem: (id: string) => void;
  position?: ActivityReadingPosition; onPositionChange?: (position: ActivityReadingPosition) => void;
}) {
  const initial = position?.activityId === activity.id ? position : undefined;
  const [capabilityId, setCapability] = useState(initial?.capabilityId ?? ""), [relationId, setRelation] = useState("");
  const [page, setPage] = useState(initial?.page ?? 0), [relationPage, setRelationPage] = useState(initial?.relationPage ?? 0), [systemPage, setSystemPage] = useState(initial?.systemPage ?? 0);
  useEffect(() => onPositionChange?.({ activityId: activity.id, capabilityId, page, relationPage, systemPage }),
    [activity.id, capabilityId, page, relationPage, systemPage, onPositionChange]);
  const projection = useMemo(() => activityDetailOverview(graph, activity.id, workflowIds), [graph, activity.id, workflowIds]);
  const selected = activity.capabilities.find(c => c.id === capabilityId && c.rows.length);
  const map = overviewWindow(projection.nodes, projection.relations, selected?.id, page, 8, { relationPage, relationLimit: 6 });
  const relation = projection.relations.find(r => r.id === relationId);
  const systems = [...new Map((selected?.rows ?? activity.rows).flatMap(r => r.assets.filter(n => n.kind === "system").map(n => [n.id, n] as const))).values()];
  const systemWindow = readingPage(systems, systemPage, 6);
  const choose = (id: string) => {
    if (!activity.capabilities.some(c => c.id === id)) { onActivity(id); return; }
    setCapability(id); setPage(0); setRelationPage(0); setRelation(""); setSystemPage(0);
  };
  const internal = selected ? projection.internal.get(selected.id) ?? [] : [];
  return <section className="activity-relationship-map" aria-label="活動の中のまとまりと関係">
    <h2>仕事のまとまりとつながり</h2>
    <p>まとまりを選ぶと中の業務が開きます。線を選ぶと、何を渡す・参照するか確かめられます。</p>
    <p className="relationship-caption">{selected ? `「${selected.name}」と、直接つながるまとまり` : `${activity.capabilities.filter(c => c.rows.length).length}の仕事のまとまりと、つながる別の活動`}。
      点線は推定・未確認の接続です。まとまり自体が整理案の場合は、ノードに示します。</p>
    <RelationshipDiagram nodes={map.nodes} edges={map.edges} layoutEdges={map.layoutEdges} selectedId={selected?.id}
      onNode={choose} onEdge={setRelation} label="仕事のまとまりの関係図" graph={graph} />
    <div className="relationship-pagination">
      <span role="status">{map.nodes.length} / {selected ? (map.neighborCount ?? 0) + 1 : map.totalNodes}まとまり · {map.edges.length} / {map.totalRelations}関係を表示</span>
      {map.lastPage > 0 && <><button disabled={!map.page} onClick={() => { setPage(map.page - 1); setRelationPage(0); setRelation(""); }}>前のまとまり</button>
        <button disabled={map.page === map.lastPage} onClick={() => { setPage(map.page + 1); setRelationPage(0); setRelation(""); }}>次のまとまり</button></>}
      {map.lastRelationPage > 0 && <><button disabled={!map.relationPage} onClick={() => { setRelationPage(map.relationPage - 1); setRelation(""); }}>前の6関係</button>
        <span>{map.relationPage * 6 + 1}–{Math.min(map.windowRelations, (map.relationPage + 1) * 6)} / 表示したまとまり間の{map.windowRelations}関係</span>
        <button disabled={map.relationPage === map.lastRelationPage} onClick={() => { setRelationPage(map.relationPage + 1); setRelation(""); }}>次の6関係</button></>}
      {selected && <button onClick={() => { setCapability(""); setPage(0); setRelationPage(0); setRelation(""); setSystemPage(0); }}>この活動のまとまり全体へ戻る</button>}
    </div>
    {!map.edges.length && <p className="input-unconfirmed">表示したまとまり間の受渡しは未登録です。線のないまとまりも選んで業務を読めます。</p>}
    {projection.nodes.some(n => n.kindLabel === "別の活動") && <p className="relationship-caption">「別の活動」を選ぶと、活動をまたいで続きを読めます。</p>}
    {relation && <RelationshipEvidence edge={relation} nodes={projection.nodes} graph={graph} onWorkflow={onWorkflow} onClose={() => setRelation("")} />}
    {selected && <aside className="relationship-system-detail" aria-label="選んだ仕事のまとまり">
      <h3>{selected.name}</h3><p>{selected.description}</p>
      <p>{selected.rows.length}業務。{projection.nodes.find(n => n.id === selected.id)?.note}</p>
      <div className="company-system-chips">{selected.rows.slice(0, 3).map(r => <button key={r.workflow.id} onClick={() => onWorkflow(r.workflow.id)}>{r.workflow.name} →</button>)}</div>
      <button className="kg-primary" onClick={() => onCapability(selected.id)}>このまとまりの業務を開く →</button>
      {!!internal.length && <details><summary>同じまとまり内の受渡し・参照 · {internal.length}件</summary>
        <RelationshipEvidence edge={{ id: `internal:${selected.id}`, source: selected.id, target: selected.id, kind: "handoff", certainty: "unknown", references: internal }}
          title={`${selected.name}の中の受渡し・参照`} nodes={projection.nodes} graph={graph} onWorkflow={onWorkflow} />
      </details>}
      {selected.evidence && <details><summary>このまとまりの原文の根拠</summary><blockquote>{selected.evidence}</blockquote></details>}
    </aside>}
    <details><summary>{selected ? "このまとまり" : "この活動"}を支えるシステム・道具 · {systems.length}件</summary>
      <div className="company-system-chips">{systemWindow.items.map(n => <button key={n.id} onClick={() => onSystem(n.id)}>{n.label} →</button>)}</div>
      <div className="relationship-pagination"><button disabled={!systemWindow.page} onClick={() => setSystemPage(systemWindow.page - 1)}>前の6道具</button>
        <span>{systemWindow.start}–{systemWindow.end} / {systemWindow.total}道具</span>
        <button disabled={systemWindow.page === systemWindow.last} onClick={() => setSystemPage(systemWindow.page + 1)}>次の6道具</button></div>
      {!systems.length && <p>道具は未登録です。</p>}
    </details>
    {!!projection.unmapped.length && <details><summary>相手のまとまりが未登録の受渡し・参照 · {projection.unmapped.length}件</summary>
      <RelationshipEvidence edge={{ id: "unmapped", source: activity.id, target: "未整理の相手", kind: "handoff", certainty: "unknown", references: projection.unmapped }}
        title="相手のまとまりが未登録の受渡し・参照" nodes={projection.nodes} graph={graph} onWorkflow={onWorkflow} />
    </details>}
    <details><summary>活動のまとまり・部署を確認する</summary>
      <p>{activity.description}</p><p>{activity.certainty === "confirmed" ? "活動のまとまりは確認済みです。" : "活動のまとまりは入力からの整理案です。"}</p>
      {activity.evidence && <blockquote>{activity.evidence}</blockquote>}
      <p>関係部署：{[...new Set(activity.rows.flatMap(r => r.departments))].join(" / ") || "未確認"}</p>
      {activity.rows.some(r => !r.departments.length) && <p>部署は一部未確認です。</p>}
    </details>
  </section>;
}
