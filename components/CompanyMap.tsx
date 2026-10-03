"use client";
import { useState } from "react";
import type { LensGraph } from "@/lib/graph";
import { companyConnections } from "@/lib/knowledge-guide";

export function CompanyMap({
  graph,
  workflowIds,
  onWorkflow,
  onActivity,
}: {
  graph: LensGraph;
  workflowIds: string[];
  onWorkflow: (id: string) => void;
  onActivity?: (id: string) => void;
}) {
  const activities = (graph.knowledge?.activities ?? []).filter((a) =>
    a.capabilities.some((c) =>
      c.workflowIds.some((id) => workflowIds.includes(id)),
    ),
  );
  const [selectedId, setSelected] = useState(
    activities.find((a) => a.name.includes("受注"))?.id ?? activities[0]?.id,
  );
  const selected =
    activities.find((a) => a.id === selectedId) ??
    activities.find((a) => a.name.includes("受注")) ??
    activities[0];
  if (!selected) return <p>活動と業務の関係はまだ登録されていません。</p>;
  const connections = companyConnections(graph, workflowIds);
  const incoming = connections.filter((c) => c.target === selected.name);
  const outgoing = connections.filter((c) => c.source === selected.name);
  const sampleIds = selected.capabilities
    .flatMap((c) => c.workflowIds)
    .filter((id) => workflowIds.includes(id));
  const samples = graph.workflows.filter((w) => sampleIds.includes(w.id));
  const departmentNames = [
    ...new Set(
      graph.nodes
        .filter(
          (n) => n.kind === "process" && sampleIds.includes(n.workflowId!),
        )
        .map((n) => n.department)
        .filter(Boolean),
    ),
  ];
  const related = (
    items: typeof connections,
    direction: "source" | "target",
  ) => (
    <>
      {items.slice(0, 3).map((c) => (
        <article key={`${c.source}:${c.target}`}>
          <button
            onClick={() =>
              setSelected(activities.find((a) => a.name === c[direction])!.id)
            }
          >
            {c[direction]} {direction === "target" ? "→" : "←"}
          </button>
          <p>{c.description}</p>
          <button onClick={() => onWorkflow(c.workflowId)}>
            受渡しの実例を見る
          </button>
        </article>
      ))}
      {!items.length && <p>この範囲では受渡し未登録</p>}
      {items.length > 3 && (
        <details>
          <summary>ほか{items.length - 3}件のつながり</summary>
          {items.slice(3).map((c) => (
            <p key={`${c.source}:${c.target}`}>
              <button
                onClick={() =>
                  setSelected(
                    activities.find((a) => a.name === c[direction])!.id,
                  )
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
  return (
    <section className="kg-company-map" aria-label="会社の鳥瞰図">
      <h3>会社の鳥瞰：ひとつの活動と、その前後を見る</h3>
      <p>
        すべての線を一度に読む必要はありません。活動を一つ選ぶと、何を受け取り、誰が働き、次に何を渡すかが見えます。
      </p>
      <div
        className="kg-map-selector"
        role="group"
        aria-label="鳥瞰で注目する活動"
      >
        {activities.map((a) => (
          <button
            key={a.id}
            aria-pressed={selected.id === a.id}
            onClick={() => setSelected(a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>
      <div className="kg-map-flow">
        <section>
          <h4>① 前の活動から受け取る</h4>
          {related(incoming, "source")}
        </section>
        <section className="kg-map-center">
          <h4>② ここで行う仕事</h4>
          <h3>{selected.name}</h3>
          <p>{selected.description}</p>
          <p>担当：{departmentNames.join(" / ") || "未登録"}</p>
          <p>
            {selected.capabilities.length}種類の仕事 / {samples.length}業務
          </p>
          {onActivity && (
            <button
              className="kg-primary"
              onClick={() => onActivity(selected.id)}
            >
              この活動の仕事を詳しく見る →
            </button>
          )}
          {!onActivity &&
            samples.slice(0, 3).map((w) => (
              <button key={w.id} onClick={() => onWorkflow(w.id)}>
                {w.name} →
              </button>
            ))}
        </section>
        <section>
          <h4>③ 次の活動へ渡す</h4>
          {related(outgoing, "target")}
        </section>
      </div>
    </section>
  );
}
