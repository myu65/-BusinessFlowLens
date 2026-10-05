"use client";
import React from "react";
import type { LensGraph } from "@/lib/graph";
import { CompanyMap } from "./CompanyMap";
import type { KnowledgeScope } from "@/lib/knowledge";
import type { knowledgeIndex } from "@/lib/knowledge";
import type { CompanyReadingPosition } from "@/lib/exploration";

export function CompanyOrientation({
  graph,
  scope,
  workflowIds,
  rows,
  onWorkflow,
  onSystems,
  onActivity,
  onSystem,
  onInput,
  position,
  onPositionChange,
}: {
  graph: LensGraph;
  scope: KnowledgeScope;
  workflowIds: string[];
  rows: ReturnType<typeof knowledgeIndex>["rows"];
  onWorkflow: (id: string, stepId?: string) => void;
  onSystems: () => void;
  onActivity: (id: string) => void;
  onSystem: (id: string) => void;
  onInput?: () => void;
  position?: CompanyReadingPosition;
  onPositionChange?: (position: CompanyReadingPosition) => void;
}) {
  const visible = new Set(workflowIds);
  const hasActivities = graph.knowledge?.activities.some((a) =>
    a.capabilities.some((c) => c.workflowIds.some((id) => visible.has(id))),
  );
  const example =
    graph.workflows.find(
      (w) => visible.has(w.id) && w.name.includes("受注登録"),
    ) ?? graph.workflows.find((w) => visible.has(w.id));
  return (
    <section className="company-orientation" aria-label="はじめての会社案内">
      {hasActivities ? (
        <CompanyMap
          key={scope}
          graph={graph}
          scope={scope}
          workflowIds={workflowIds}
          onWorkflow={onWorkflow}
          onActivity={onActivity}
          onSystem={onSystem}
          position={position}
          onPositionChange={onPositionChange}
        />
      ) : rows.length ? (
        <section
          className="company-stories-map"
          aria-label="保存した仕事と人・道具・情報"
        >
          <h2>保存した仕事のつながり</h2>
          <p>
            話を足すと、会社の構造が育ちます。活動への分類は後から整えられます。
          </p>
          <div className="company-story-cards">
            {rows.slice(0, 6).map((r) => {
              const people = [
                ...new Set(r.processes.map((p) => p.actor).filter(Boolean)),
              ];
              const systems = r.assets.filter((n) => n.kind === "system");
              const data = r.assets.filter((n) => n.kind === "data");
              return (
                <article key={r.workflow.id}>
                  <button
                    className="company-story-title"
                    onClick={() => onWorkflow(r.workflow.id)}
                  >
                    {r.workflow.name} →
                  </button>
                  <p>
                    {r.processes.length}手順 · 担当：
                    {people.slice(0, 2).join(" / ") ||
                      r.departments.slice(0, 2).join(" / ") ||
                      "未確認"}
                  </p>
                  <div className="company-story-resources">
                    <strong>使う道具</strong>
                    <div>
                      {systems.slice(0, 4).map((n) => (
                        <button key={n.id} onClick={() => onSystem(n.id)}>
                          {n.label}
                        </button>
                      ))}
                      {systems.length > 4 && (
                        <span>
                          ほか{systems.length - 4}道具（流れの中で確認できます）
                        </span>
                      )}
                      {!systems.length && <span>未確認</span>}
                    </div>
                  </div>
                  <div className="company-story-resources">
                    <strong>扱う情報</strong>
                    <span>
                      {data
                        .slice(0, 3)
                        .map((n) => n.label)
                        .join(" / ") || "未確認"}
                      {data.length > 3 ? ` ほか${data.length - 3}情報` : ""}
                    </span>
                  </div>
                  {(graph.knowledge?.handoffs ?? [])
                    .filter(
                      (h) =>
                        h.sourceWorkflowId === r.workflow.id &&
                        visible.has(h.targetWorkflowId),
                    )
                    .slice(0, 2)
                    .map((h) => (
                      <div key={h.id} className="company-story-handoff">
                        <span>{h.description}</span>
                        <button onClick={() => onWorkflow(h.targetWorkflowId)}>
                          →{" "}
                          {
                            graph.workflows.find(
                              (w) => w.id === h.targetWorkflowId,
                            )?.name
                          }
                        </button>
                      </div>
                    ))}
                </article>
              );
            })}
          </div>
          {rows.length > 6 && (
            <p>
              最初の6業務を表示しています。下の一覧から残り{rows.length - 6}
              業務も読めます。
            </p>
          )}
        </section>
      ) : (
        <div className="company-start-empty">
          <h2>
            {graph.workflows.length
              ? "この条件に合う仕事がありません"
              : "まだ、会社の話が入っていません"}
          </h2>
          <p>
            {graph.workflows.length
              ? "検索・部署・表示する状態を変えると、ほかの仕事を見渡せます。"
              : "知っている仕事を一つ書けば、担当・道具・情報を含む流れから始められます。"}
          </p>
          {onInput && (
            <button className="kg-primary" onClick={onInput}>
              仕事の話を書く →
            </button>
          )}
        </div>
      )}
      {!!workflowIds.length && (
        <div className="company-start-links">
          {example && (
            <button onClick={() => onWorkflow(example.id)}>
              <strong>ひとつの仕事の流れを読む →</strong>
              <span>{example.name}</span>
            </button>
          )}
          <button onClick={onSystems}>
            <strong>システム・道具から調べる →</strong>
            <span>どんな仕事を支え、どの情報を渡しているか</span>
          </button>
        </div>
      )}
    </section>
  );
}
