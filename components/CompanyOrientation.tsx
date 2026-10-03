import type { LensGraph } from "@/lib/graph";
import { CompanyMap } from "./CompanyMap";

export function CompanyOrientation({
  graph,
  workflowIds,
  onWorkflow,
  onSystems,
  onActivity,
}: {
  graph: LensGraph;
  workflowIds: string[];
  onWorkflow: (id: string) => void;
  onSystems: () => void;
  onActivity: (id: string) => void;
}) {
  const example =
    graph.workflows.find(
      (w) => workflowIds.includes(w.id) && w.name.includes("受注登録"),
    ) ?? graph.workflows.find((w) => workflowIds.includes(w.id));
  return (
    <section className="kg-orientation" aria-label="はじめての会社案内">
      <h2>まず、会社の仕事のつながりをつかみましょう</h2>
      <p>
        会社は、部署ごとの仕事と、情報・物の受渡しで動いています。下の活動を選ぶと、誰が何を行い、どの道具や情報を使うかまで順に見られます。
      </p>
      <div className="kg-start-options">
        {example && (
          <button className="kg-primary" onClick={() => onWorkflow(example.id)}>
            <strong>はじめてなら、ひとつの仕事を見てみる →</strong>
            <span>{example.name}</span>
            <span>
              担当者の作業 → システムの自動処理 → 次の担当者への受渡しを読む
            </span>
          </button>
        )}
        <button onClick={onSystems}>
          <strong>使っているシステム・道具から調べる →</strong>
          <span>SAP・Teams・Excelなどが、どの仕事を支えているかを見る</span>
        </button>
      </div>
      <p className="kg-reading-path">
        大きな活動 → 仕事の種類 → 部署・工場ごとの業務 → 手順と個別作業 →
        使うシステム・情報
      </p>
      <CompanyMap
        graph={graph}
        workflowIds={workflowIds}
        onWorkflow={onWorkflow}
        onActivity={onActivity}
      />
    </section>
  );
}
