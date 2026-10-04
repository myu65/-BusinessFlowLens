"use client";
import React, { useMemo, useState } from "react";
import type { LensGraph, LensNode } from "@/lib/graph";
import type { knowledgeIndex, KnowledgeScope } from "@/lib/knowledge";
import { groupRelationships, overviewWindow, systemRelationships, type OverviewNode } from "@/lib/relationship-overview";
import { RelationshipDiagram, RelationshipEvidence } from "./RelationshipDiagram";
import { termExplanation } from "@/lib/knowledge-guide";

export function SystemRelationshipMap({ graph, scope, systems, view, onSelect, onActivity, onWorkflow }: {
  graph: LensGraph; scope: KnowledgeScope; systems: LensNode[]; view: ReturnType<typeof knowledgeIndex>;
  onSelect: (id: string) => void; onActivity: (id: string) => void; onWorkflow: (id: string, stepId?: string) => void;
}) {
  const [categoryId, setCategory] = useState("");
  const [systemId, setSystem] = useState("");
  const [page, setPage] = useState(0);
  const [relationId, setRelation] = useState("");
  const [relationPage, setRelationPage] = useState(0);
  const [relationKind, setRelationKind] = useState<"transfer" | "dependency">("transfer");
  const ranked = useMemo(() => systems.map(node => ({ node, related: view.systemProfile(node.id) }))
    .filter(s => s.related.direct.length || s.related.indirect.length)
    .sort((a, b) => b.related.direct.length + b.related.indirect.length - a.related.direct.length - a.related.indirect.length
      || b.related.direct.length - a.related.direct.length || a.node.label.localeCompare(b.node.label, "ja")), [systems, view]);
  const relations = useMemo(() => systemRelationships(graph, scope, view.rows.map(r => r.workflow.id), ranked.map(s => s.node.id)), [graph, scope, view, ranked]);
  const groupFor = new Map<string, string>();
  for (const { node } of ranked) {
    const category = graph.knowledge?.systems.find(s => s.systemId === node.id)?.categoryId;
    groupFor.set(node.id, graph.knowledge?.categories.some(c => c.id === category) ? category! : "overview:unclassified");
  }
  const groups = [...new Set(groupFor.values())].map(id => {
    const members = ranked.filter(s => groupFor.get(s.node.id) === id);
    const workflows = new Set(members.flatMap(s => [...s.related.direct, ...s.related.indirect].map(r => r.workflow.id)));
    return { id, label: graph.knowledge?.categories.find(c => c.id === id)?.name ?? "分類未登録",
      subtitle: `${members.length}道具 · ${workflows.size}業務を支える`, kindLabel: "道具のまとまり",
      note: members.slice(0, 2).map(s => s.node.label).join("・") + (members.length > 2 ? "など" : "") };
  });
  const tools: OverviewNode[] = ranked.map(({ node, related }) => ({ id: node.id, label: node.label, kindLabel: "道具",
    subtitle: `直接 ${related.direct.length}業務 · 間接 ${related.indirect.length}業務`, note: node.status === "unknown" ? "対応づけは要確認" : undefined }));
  const selectedCategory = groups.find(g => g.id === categoryId);
  const selectedSystem = ranked.find(s => s.node.id === systemId);
  const categoryMembers = selectedCategory ? ranked.filter(s => groupFor.get(s.node.id) === selectedCategory.id) : [];
  const lastMemberPage = Math.max(0, Math.ceil(categoryMembers.length / 3) - 1);
  const memberPage = Math.min(page, lastMemberPage);
  const memberIds = new Set(categoryMembers.slice(memberPage * 3, (memberPage + 1) * 3).map(s => s.node.id));
  const expandedGroups = new Map(groupFor);
  for (const id of memberIds) expandedGroups.set(id, id);
  const remaining = categoryMembers.length - memberIds.size;
  const expandedNodes = [...tools.filter(n => memberIds.has(n.id)), ...groups.filter(g => g.id !== selectedCategory?.id),
    ...(remaining && selectedCategory ? [{ ...selectedCategory, label: "同じ種類のほかの道具", subtitle: `${remaining}道具`, note: "次の道具へ進むと開けます" }] : [])];
  const shownNodes = selectedSystem ? tools : selectedCategory ? expandedNodes : groups;
  const readingRelations = relations.filter(r => r.kind === relationKind);
  const shownRelations = selectedSystem ? readingRelations : groupRelationships(readingRelations, selectedCategory ? expandedGroups : groupFor);
  const map = overviewWindow(shownNodes, shownRelations, selectedSystem?.node.id, selectedCategory && !selectedSystem ? 0 : page,
    selectedSystem ? 6 : 8, { relationPage, relationLimit: 6 });
  const relation = shownRelations.find(e => e.id === relationId);
  const reset = () => { setCategory(""); setSystem(""); setPage(0); setRelation(""); setRelationPage(0); };
  const choose = (id: string) => {
    setRelation("");
    setRelationPage(0);
    if (ranked.some(s => s.node.id === id)) { setSystem(id); setPage(0); }
    else if (id === selectedCategory?.id) setPage(memberPage === lastMemberPage ? 0 : memberPage + 1);
    else { setCategory(id); setSystem(""); setPage(0); }
  };
  return <section className="system-relationship-map" aria-label="システムの鳥瞰図">
    <div className="company-map-heading"><div><h2>会社を支える道具は、どうつながる？</h2>
      <p>まず役割ごとのまとまりを見渡します。まとまりを開き、道具を選ぶと仕事と情報へ辿れます。</p></div><span>{ranked.length}道具</span></div>
    <nav className="relationship-layer-control" aria-label="図で読む関係">
      <button aria-pressed={relationKind === "transfer"} onClick={() => { setRelationKind("transfer"); setRelation(""); setPage(0); setRelationPage(0); }}>情報の受渡し</button>
      <button aria-pressed={relationKind === "dependency"} onClick={() => { setRelationKind("dependency"); setRelation(""); setPage(0); setRelationPage(0); }}>稼働の依存</button>
      <span>{relationKind === "transfer" ? "矢印：情報を渡す" : "矢印：動くために必要とする"} · 点線：推定・未確認を含む</span>
    </nav>
    <p className="relationship-caption">{selectedSystem ? `${selectedSystem.node.label}と、直接つながる道具` : selectedCategory ? `「${selectedCategory.label}」を3道具ずつ開いています。他の種類はまとまりで表示します。` : `${groups.length}のまとまりに集約。線を選ぶと元の受渡し・依存を読めます。`}
      {!selectedSystem && " まとまり内の関係は、開いてから確認できます。"}</p>
    <RelationshipDiagram nodes={map.nodes} edges={map.edges} layoutEdges={map.layoutEdges} selectedId={selectedSystem?.node.id} onNode={choose} onEdge={setRelation} label="道具のまとまりと関係図" graph={graph} />
    <div className="relationship-pagination"><span role="status">{map.nodes.length}要素 · {map.edges.length} / {map.totalRelations}関係を表示</span>
      {map.lastRelationPage > 0 && <><button disabled={!map.relationPage} onClick={() => { setRelationPage(map.relationPage - 1); setRelation(""); }}>前の6関係</button>
        <span>{map.relationPage * 6 + 1}–{Math.min(map.windowRelations, (map.relationPage + 1) * 6)} / この要素間の{map.windowRelations}関係</span>
        <button disabled={map.relationPage === map.lastRelationPage} onClick={() => { setRelationPage(map.relationPage + 1); setRelation(""); }}>次の6関係</button></>}
      {selectedCategory && !selectedSystem && lastMemberPage > 0 && <><button disabled={!memberPage} onClick={() => { setPage(memberPage - 1); setRelation(""); setRelationPage(0); }}>前の3道具</button>
        <span>{memberPage * 3 + 1}–{Math.min(categoryMembers.length, (memberPage + 1) * 3)} / {categoryMembers.length}道具</span>
        <button disabled={memberPage === lastMemberPage} onClick={() => { setPage(memberPage + 1); setRelation(""); setRelationPage(0); }}>次の3道具</button></>}
      {(!selectedCategory || selectedSystem) && map.lastPage > 0 && <><button disabled={!map.page} onClick={() => { setPage(map.page - 1); setRelation(""); setRelationPage(0); }}>前の要素</button>
        <button disabled={map.page === map.lastPage} onClick={() => { setPage(map.page + 1); setRelation(""); setRelationPage(0); }}>次の要素</button></>}
      {selectedSystem && selectedCategory && <button onClick={() => { setSystem(""); setPage(0); setRelation(""); setRelationPage(0); }}>この種類の道具へ戻る</button>}
      {(selectedSystem || selectedCategory) && <button onClick={reset}>まとまり全体の関係へ戻る</button>}
    </div>
    {!map.edges.length && <p className="input-unconfirmed">この表示範囲では、{relationKind === "transfer" ? "情報の受渡し" : "稼働の依存"}の関係がまだ登録されていません。</p>}
    {relation && <RelationshipEvidence edge={relation} nodes={shownNodes} graph={graph} onWorkflow={onWorkflow} onClose={() => setRelation("")} />}
    {selectedSystem && <aside className="relationship-system-detail" aria-label="選んだ道具が支える仕事">
      <h3>{selectedSystem.node.label}</h3><p>{termExplanation(selectedSystem.node.label) ?? selectedSystem.node.description}</p>
      <p>直接 {selectedSystem.related.direct.length}業務 · 間接 {selectedSystem.related.indirect.length}業務。上の図は、登録された隣接関係だけを表示しています。</p>
      <h4>支える活動</h4><div className="company-system-chips">
        {view.activities.filter(a => a.rows.some(r => selectedSystem.related.direct.includes(r) || selectedSystem.related.indirect.includes(r)))
          .slice(0, 5).map(a => <button key={a.id} onClick={() => onActivity(a.id)}>{a.name} →</button>)}
      </div>
      <h4>関わる仕事の例</h4><div className="company-system-chips">{selectedSystem.related.direct.slice(0, 3).map(r => <button key={r.workflow.id} onClick={() => onWorkflow(r.workflow.id)}>{r.workflow.name} →</button>)}</div>
      <button className="kg-primary" onClick={() => onSelect(selectedSystem.node.id)}>この道具の業務・情報・自動処理を詳しく見る →</button>
    </aside>}
    {!ranked.length && <p>この範囲で使う道具はまだ登録されていません。</p>}
    <details><summary>まとまりと業務数は、何を表している？</summary><p>まとまりは編集できる道具の分類です。業務数は、表示する状態・部署・検索に合う業務を重複なく数え、直接利用と登録された基盤依存による間接影響を含めます。分類は入力からの整理案を含みます。依存の根拠は同じ状態の別部署の話にもあります。</p></details>
  </section>;
}
