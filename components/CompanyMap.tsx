"use client";
import React, { useMemo, useRef, useState } from "react";
import type { LensGraph } from "@/lib/graph";
import { knowledgeIndex, type KnowledgeScope } from "@/lib/knowledge";
import { companyConnections } from "@/lib/knowledge-guide";
import { activityRelationships, overviewWindow } from "@/lib/relationship-overview";
import { RelationshipDiagram, RelationshipEvidence } from "./RelationshipDiagram";

export function CompanyMap({
  graph,
  scope = "current",
  workflowIds,
  onWorkflow,
  onActivity,
  onSystem,
}: {
  graph: LensGraph;
  scope?: KnowledgeScope;
  workflowIds: string[];
  onWorkflow: (id: string, stepId?: string) => void;
  onActivity?: (id: string) => void;
  onSystem?: (id: string) => void;
}) {
  const index = useMemo(() => knowledgeIndex(graph, scope), [graph, scope]);
  const visible = new Set(workflowIds);
  const activities = index.activities.filter((a) =>
    a.rows.some((r) => visible.has(r.workflow.id)),
  );
  const [chosenId, setSelected] = useState("");
  const [relationId, setRelation] = useState("");
  const [mapPage, setMapPage] = useState(0);
  const [relationPage, setRelationPage] = useState(0);
  const detail = useRef<HTMLDivElement>(null);
  const connections = useMemo(
    () => companyConnections(graph, workflowIds),
    [graph, workflowIds],
  );
  const selectedId = activities.some(a => a.id === chosenId) ? chosenId : "";
  const relations = useMemo(() => activityRelationships(graph, workflowIds), [graph, workflowIds]);
  const mapNodes = activities.map(a => ({ id: a.id, label: a.name, kindLabel: "活動",
    subtitle: `${a.rows.filter(r => visible.has(r.workflow.id)).length}業務 · ${a.capabilities.filter(c => c.rows.some(r => visible.has(r.workflow.id))).length}種類の仕事`,
    note: a.certainty && a.certainty !== "confirmed" ? "まとまりは整理案" : undefined }));
  const map = overviewWindow(mapNodes, relations, selectedId, mapPage, 8, { relationPage, relationLimit: 6 });
  const relation = relations.find(e => e.id === relationId);
  const selected = activities.find((a) => a.id === selectedId);
  const rows = selected?.rows.filter((r) => visible.has(r.workflow.id)) ?? [];
  const systems = [
    ...new Map(
      rows.flatMap((r) =>
        r.assets
          .filter((n) => n.kind === "system")
          .map((n) => [n.id, n] as const),
      ),
    ).values(),
  ];
  const data = [...new Map(rows.flatMap(r => r.assets.filter(n => n.kind === "data").map(n => [n.id, n] as const))).values()];
  const departments = [...new Set(rows.flatMap(r => r.departments))];
  const choose = (id: string) => {
    setSelected(id);
    setRelation("");
    setMapPage(0);
    setRelationPage(0);
    requestAnimationFrame(() =>
      window.matchMedia("(max-width: 900px)").matches && detail.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };
  const related = (direction: "source" | "target") => {
    const edges = connections.filter((c) =>
      direction === "source"
        ? c.targetId === selectedId
        : c.sourceId === selectedId,
    );
    return (
      <>
        {edges.slice(0, 3).map((c) => (
          <article key={`${c.sourceId}:${c.targetId}`}>
            <button
              onClick={() =>
                choose(direction === "source" ? c.sourceId : c.targetId)
              }
            >
              {c[direction]} {direction === "target" ? "→" : "←"}
            </button>
            <p>{c.description}</p>
            {c.status !== "confirmed" && <small>受渡しの根拠は要確認</small>}
            <button
              className="company-example-link"
              onClick={() => onWorkflow(c.workflowId)}
            >
              受渡しの実例を見る →
            </button>
          </article>
        ))}
        {!edges.length && (
          <p className="input-unconfirmed">この範囲では受渡しが未登録です。</p>
        )}
        {edges.length > 3 && (
          <details>
            <summary>ほか{edges.length - 3}件の受渡し</summary>
            {edges.slice(3).map((c) => (
              <p key={`${c.sourceId}:${c.targetId}`}>
                <button
                  onClick={() =>
                    choose(direction === "source" ? c.sourceId : c.targetId)
                  }
                >
                  {c[direction]}
                </button>{" "}
                · {c.description}
              </p>
            ))}
          </details>
        )}
      </>
    );
  };
  if (!activities.length) return null;
  return (
    <section className="company-overview-map" aria-label="会社の鳥瞰図">
      <div className="company-map-heading">
        <div>
          <h2>仕事は、どうつながっている？</h2>
          <p>まず活動のまとまりを見渡します。選ぶと、前後の活動と、その中の仕事を開けます。</p>
        </div>
        <span>{activities.length}の活動</span>
      </div>
      <p className="relationship-caption">{selectedId ? "選んだ活動と、直接つながる活動" : "会社の活動と、登録された受渡し・参照"}。線を選ぶと根拠を読めます。点線は推定・未確認を含みます。</p>
      <RelationshipDiagram nodes={map.nodes} edges={map.edges} layoutEdges={map.layoutEdges} selectedId={selectedId}
        onNode={choose} onEdge={setRelation} label="活動の関係図" graph={graph} />
      <div className="relationship-pagination">
        <span role="status">{map.nodes.length} / {selectedId ? (map.neighborCount ?? 0) + 1 : map.totalNodes}活動 · {map.edges.length} / {map.totalRelations}関係を表示</span>
        {map.lastRelationPage > 0 && <><button disabled={!map.relationPage} onClick={() => { setRelationPage(map.relationPage - 1); setRelation(""); }}>前の6関係</button>
          <span>{map.relationPage * 6 + 1}–{Math.min(map.windowRelations, (map.relationPage + 1) * 6)} / この活動間の{map.windowRelations}関係</span>
          <button disabled={map.relationPage === map.lastRelationPage} onClick={() => { setRelationPage(map.relationPage + 1); setRelation(""); }}>次の6関係</button></>}
        {map.lastPage > 0 && <><button disabled={map.page === 0} onClick={() => { setMapPage(map.page - 1); setRelationPage(0); setRelation(""); }}>前の活動</button><button disabled={map.page === map.lastPage} onClick={() => { setMapPage(map.page + 1); setRelationPage(0); setRelation(""); }}>次の活動</button></>}
        {selectedId && <button onClick={() => choose("")}>活動全体の関係へ戻る</button>}
      </div>
      {!map.edges.length && <p className="input-unconfirmed">この表示範囲の活動間では、受渡しがまだ登録されていません。活動内の仕事は各ノードから読めます。</p>}
      {relation && <RelationshipEvidence edge={relation} nodes={mapNodes} graph={graph} onWorkflow={onWorkflow} onClose={() => setRelation("")} />}
      <div className="company-map-body company-map-body--relations">
      {selected && (
        <div
          ref={detail}
          className="company-activity-detail"
          aria-label="選んだ活動と前後の仕事"
        >
          <div className="company-detail-title">
            <h3>{selected.name}</h3>
            <button
              onClick={() => {
                setSelected("");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              全体の見渡しに戻る
            </button>
          </div>
          <div className="company-detail-flow">
            <section>
              <h4>前の活動から受け取る</h4>
              {related("source")}
            </section>
            <section className="company-detail-center">
              <h4>ここで行う仕事</h4>
              {selected.description && !selected.description.startsWith("入力された話をまとめる整理案") && <p>{selected.description}</p>}
              <div className="company-activity-work-examples" aria-label="この活動の仕事の例">
                {rows.slice(0, 4).map(r => <button key={r.workflow.id} onClick={() => onWorkflow(r.workflow.id)}>{r.workflow.name} →</button>)}
              </div>
              {selected.evidence && (
                <details>
                  <summary>活動のまとまりの根拠</summary>
                  <blockquote>{selected.evidence}</blockquote>
                  <p>
                    {selected.certainty === "confirmed"
                      ? "確認済み"
                      : "話をまとめる整理案です。内容を確認・訂正できます。"}
                  </p>
                </details>
              )}
              <p>
                担当：
                {departments.slice(0, 3).join(" / ") ||
                  [
                    ...new Set(
                      rows.flatMap((r) =>
                        r.processes
                          .filter((p) => p.executionMode !== "automatic")
                          .map((p) => p.actor)
                          .filter(Boolean),
                      ),
                    ),
                  ].join(" / ") ||
                  "担当は未確認"}
                {rows.some(r => !r.departments.length) && departments.length > 0 && "（部署は一部未確認）"}
              </p>
              <p>
                {rows.length}業務 ·{" "}
                {
                  selected.capabilities.filter((c) =>
                    c.rows.some((r) => visible.has(r.workflow.id)),
                  ).length
                }
                種類の仕事
              </p>
              {onActivity && (
                <button
                  className="kg-primary"
                  onClick={() => onActivity(selected.id)}
                >
                  この活動の仕事を見る →
                </button>
              )}
              {!onActivity &&
                rows.slice(0, 3).map((r) => (
                  <button
                    key={r.workflow.id}
                    onClick={() => onWorkflow(r.workflow.id)}
                  >
                    {r.workflow.name} →
                  </button>
                ))}
            </section>
            <section>
              <h4>次の活動へ渡す</h4>
              {related("target")}
            </section>
          </div>
          <div className="company-activity-resources">
            <section><h4>この活動で使う道具・システム</h4><div className="company-system-chips" aria-label="この活動を支える道具">{systems.slice(0, 6).map(n => <button key={n.id} onClick={() => onSystem?.(n.id)}>{n.label}</button>)}{!systems.length && <span>道具は未確認</span>}</div>
              {systems.length > 6 && <small>ほか{systems.length - 6}道具は「この活動の仕事」で確認できます。</small>}
            </section>
            <section><h4>この活動で扱う情報</h4><div className="company-info-chips">{data.slice(0, 6).map(n => <span key={n.id}>{n.label}</span>)}{!data.length && <span>情報は未確認</span>}</div>{data.length > 6 && <small>ほか{data.length - 6}情報は各仕事の中で確認できます。</small>}</section>
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
