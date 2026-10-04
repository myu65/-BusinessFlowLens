"use client";
import React from "react";
import type { LensGraph, LensNode } from "@/lib/graph";
import { inputSystemRoles } from "@/lib/input-knowledge";
import { termExplanation } from "@/lib/knowledge-guide";
import type { knowledgeIndex } from "@/lib/knowledge";
import { USAGE_DEFINITION } from "./ScopedExplorers";

export function SystemLandscapeCards({ graph, systems, view, page, onPage, onSelect }: {
  graph: LensGraph;
  systems: LensNode[];
  view: ReturnType<typeof knowledgeIndex>;
  page: number;
  onPage: (page: number) => void;
  onSelect: (id: string) => void;
}) {
  const ranked = systems.map(node => ({ node, related: view.systemProfile(node.id) }))
    .sort((a, b) => (b.related.direct.length + b.related.indirect.length) -
      (a.related.direct.length + a.related.indirect.length) || b.related.direct.length - a.related.direct.length || a.node.label.localeCompare(b.node.label, "ja"));
  const lastPage = Math.max(0, Math.ceil(ranked.length / 6) - 1);
  const shownPage = Math.min(Math.max(0, page), lastPage);
  return (
    <section className="system-landscape-reading" aria-label="会社を支える道具の一覧">
      <p>関わる業務が多い順。種類・検索で絞り、6道具ずつ読めます。</p>
      <div className="kg-toolbar">
        <button disabled={!shownPage} onClick={() => onPage(shownPage - 1)}>前の6道具</button>
        <span role="status">{ranked.length}道具 / {ranked.length ? shownPage * 6 + 1 : 0}–{Math.min(ranked.length, (shownPage + 1) * 6)}を表示</span>
        <button disabled={shownPage === lastPage} onClick={() => onPage(shownPage + 1)}>次の6道具</button>
      </div>
      {!ranked.length && <p>この条件に合う道具はありません。種類や検索の条件を変えて探せます。</p>}
      <div className="kg-cards">
        {ranked.slice(shownPage * 6, (shownPage + 1) * 6).map(({node, related}) => {
          const profile = graph.knowledge?.systems.find(s => s.systemId === node.id);
          const roles = inputSystemRoles(graph, node.id, related.direct.map(r => r.workflow.id));
          const profileInScope = !profile?.sourceWorkflowId || view.rows.some(r => r.workflow.id === profile.sourceWorkflowId);
          const purpose = (profileInScope ? profile?.purpose : "") || roles[0]?.purpose;
          const example = Boolean(purpose && (profile?.sourceWorkflowId || !profile?.purpose));
          return (
            <button key={node.id} onClick={() => onSelect(node.id)}>
              <strong>{node.label}</strong>
              {node.status === "unknown" && <small>同じ道具か、対応づけは要確認</small>}
              <p>{purpose || termExplanation(node.label) || node.description}</p>
              {example && <small>入力で分かった使い方の一例</small>}
              <span>{graph.knowledge?.categories.find(c => c.id === profile?.categoryId)?.name ?? "分類未登録"} · 直接 {related.direct.length}業務 · 間接 {related.indirect.length}業務</span>
            </button>
          );
        })}
      </div>
      <details>
        <summary>直接・間接の業務数は、何を数えている？</summary>
        <p>{USAGE_DEFINITION} 件数は表示する状態・部署・検索の範囲に従います。</p>
      </details>
    </section>
  );
}
