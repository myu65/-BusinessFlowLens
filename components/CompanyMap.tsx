"use client";
import { useMemo, useRef, useState } from "react";
import type { LensGraph } from "@/lib/graph";
import { knowledgeIndex, type KnowledgeScope } from "@/lib/knowledge";
import { companyConnections, overviewPath } from "@/lib/knowledge-guide";

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
  onWorkflow: (id: string) => void;
  onActivity?: (id: string) => void;
  onSystem?: (id: string) => void;
}) {
  const index = useMemo(() => knowledgeIndex(graph, scope), [graph, scope]);
  const visible = new Set(workflowIds);
  const activities = index.activities.filter((a) =>
    a.rows.some((r) => visible.has(r.workflow.id)),
  );
  const [selectedId, setSelected] = useState("");
  const detail = useRef<HTMLDivElement>(null);
  const connections = useMemo(
    () => companyConnections(graph, workflowIds),
    [graph, workflowIds],
  );
  const example =
    graph.workflows.find(
      (w) => visible.has(w.id) && w.name.includes("受注登録"),
    ) ?? graph.workflows.find((w) => visible.has(w.id));
  const start = activities.find((a) =>
    a.rows.some((r) => r.workflow.id === example?.id),
  );
  const path = overviewPath(connections, start?.id);
  const pathIds = path.length
    ? [path[0].sourceId, ...path.map((e) => e.targetId)]
    : [];
  const others = activities.filter((a) => !pathIds.includes(a.id));
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
  const choose = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() =>
      detail.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };
  const card = (id: string, compact = false) => {
    const a = activities.find((a) => a.id === id)!;
    const rows = a.rows.filter((r) => visible.has(r.workflow.id));
    const departments = [...new Set(rows.flatMap((r) => r.departments))];
    const actors = [
      ...new Set(
        rows.flatMap((r) =>
          r.processes
            .filter((p) => p.executionMode !== "automatic")
            .map((p) => p.actor)
            .filter(Boolean),
        ),
      ),
    ];
    return (
      <button
        className={
          compact
            ? "company-activity company-activity--compact"
            : "company-activity"
        }
        aria-pressed={selectedId === id}
        onClick={() => choose(id)}
      >
        <strong>{a.name}</strong>
        {a.certainty && a.certainty !== "confirmed" && (
          <small>話からの整理案</small>
        )}
        <span>
          {rows.length}業務 · {departments[0] ?? actors[0] ?? "担当は未確認"}
          {departments.length > 1 ? ` ほか${departments.length - 1}部署` : ""}
        </span>
      </button>
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
          <p>活動を選ぶと、前後の仕事・担当部署・使う道具が見えます。</p>
        </div>
        <span>{activities.length}の活動</span>
      </div>
      {!!path.length && (
        <>
          <p className="company-map-caption">
            登録された受渡しの一例{" "}
            <span>
              矢印は、登録された活動間の受渡しや情報の参照です。
              {path.some((c) => c.status !== "confirmed") &&
                " 点線の矢印（⇢）は要確認です。"}
            </span>
          </p>
          <div
            className="company-value-path"
            aria-label="登録された活動間の受渡し"
          >
            {pathIds.map((id, i) => (
              <div key={id} className="company-path-stop">
                {card(id)}
                {i < pathIds.length - 1 && (
                  <button
                    className="company-path-arrow"
                    aria-label={`${path[i].source}から${path[i].target}への受渡しを見る${path[i].status !== "confirmed" ? "（要確認）" : ""}`}
                    title={path[i].description}
                    onClick={() => choose(id)}
                  >
                    {path[i].status === "confirmed" ? "→" : "⇢"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {!!others.length && (
        <>
          <h3 className="company-other-heading">
            {path.length ? "会社を構成する、ほかの活動" : "会社の活動"}
          </h3>
          <div className="company-other-activities">
            {others.map((a) => (
              <div key={a.id}>{card(a.id, true)}</div>
            ))}
          </div>
        </>
      )}
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
              <p>{selected.description}</p>
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
                {[...new Set(rows.flatMap((r) => r.departments))].join(" / ") ||
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
              <p className="company-tools-label">使うシステム・道具</p>
              <div
                className="company-system-chips"
                aria-label="この活動を支える道具"
              >
                {systems.slice(0, 4).map((n) => (
                  <button key={n.id} onClick={() => onSystem?.(n.id)}>
                    {n.label}
                  </button>
                ))}
              </div>
              {systems.length > 4 && (
                <details>
                  <summary>ほか{systems.length - 4}道具も見る</summary>
                  <div className="company-system-chips">
                    {systems.slice(4).map((n) => (
                      <button key={n.id} onClick={() => onSystem?.(n.id)}>
                        {n.label}
                      </button>
                    ))}
                  </div>
                </details>
              )}
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
        </div>
      )}
    </section>
  );
}
