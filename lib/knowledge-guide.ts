import {
  getWorkflowProcesses,
  getProcessExecutionMode,
  type LensGraph,
} from "./graph";

export function workflowChapters(graph: LensGraph, workflowId: string) {
  const chapters: Array<{
    mode: string;
    department: string;
    steps: ReturnType<typeof getWorkflowProcesses>;
  }> = [];
  for (const step of getWorkflowProcesses(graph, workflowId)) {
    const mode = getProcessExecutionMode(graph, step);
    const department = step.department ?? "担当部署未登録";
    const previous = chapters.at(-1);
    if (previous?.mode === mode && previous.department === department)
      previous.steps.push(step);
    else chapters.push({ mode, department, steps: [step] });
  }
  return chapters;
}

export function termExplanation(name: string): string | undefined {
  const terms: Array<[RegExp, string]> = [
    [/ATP/i, "注文の数量を、在庫や入荷予定からいつ用意できるか確認する処理"],
    [/MRP/i, "製品を作るために不足する原料と、必要な時期を計算する処理"],
    [/与信/, "代金を回収できる見込みを確認し、取引してよい金額か判断すること"],
    [/CAPA/i, "品質問題の原因を取り除き、再発を防ぐ対応"],
    [
      /SAP|ERP/i,
      "受注・購買・在庫・会計など、会社の取引記録をまとめるシステム",
    ],
    [/MES/i, "工場の製造指示と実際の作業・製造結果を管理するシステム"],
    [/LIMS/i, "検体・分析試験・検査結果を管理するシステム"],
    [/QMS/i, "品質のルール、問題への対応、承認記録を管理するシステム"],
    [/PLM/i, "製品の仕様・処方・開発記録を管理するシステム"],
    [/EAM/i, "設備の点検・修理・保全を管理するシステム"],
    [/DCS/i, "製造設備の温度や圧力などを監視・制御するシステム"],
    [
      /Snowflake|DWH|Data Lake/i,
      "複数のシステムのデータを集め、分析に使えるように保管する場所",
    ],
    [
      /ETL|Integration|API/i,
      "システム同士で情報を渡し、必要に応じて形式を整える仕組み",
    ],
    [
      /MDM/i,
      "製品や取引先など、複数の業務で共通に使う基本情報をそろえる仕組み",
    ],
    [/Data Catalog/i, "どこにどんなデータがあるかを調べるための案内"],
    [/Power BI/i, "集めたデータを集計し、グラフや報告書で見る道具"],
    [/Entra|SSO/i, "誰がどのシステムを利用できるか確認する認証の仕組み"],
    [/VBA|Macro/i, "Excel上の繰り返し作業を自動で行うプログラム"],
  ];
  return terms.find(([pattern]) => pattern.test(name))?.[1];
}

// Only show registered cross-activity handoffs. A business story must not invent sequence.
export function companyConnections(graph: LensGraph, workflowIds: string[]) {
  const visible = new Set(workflowIds);
  const activityFor = new Map<
    string,
    NonNullable<LensGraph["knowledge"]>["activities"][number]
  >();
  for (const activity of graph.knowledge?.activities ?? [])
    for (const capability of activity.capabilities)
      for (const id of capability.workflowIds) activityFor.set(id, activity);
  const grouped = new Map<
    string,
    {
      source: string;
      target: string;
      description: string;
      workflowId: string;
      count: number;
    }
  >();
  for (const handoff of graph.knowledge?.handoffs ?? []) {
    if (
      !visible.has(handoff.sourceWorkflowId) ||
      !visible.has(handoff.targetWorkflowId)
    )
      continue;
    const source = activityFor.get(handoff.sourceWorkflowId);
    const target = activityFor.get(handoff.targetWorkflowId);
    if (!source || !target || source.id === target.id) continue;
    const key = `${source.id}:${target.id}`;
    const prior = grouped.get(key);
    grouped.set(
      key,
      prior
        ? { ...prior, count: prior.count + 1 }
        : {
            source: source.name,
            target: target.name,
            description: handoff.description,
            workflowId: handoff.sourceWorkflowId,
            count: 1,
          },
    );
  }
  return [...grouped.values()];
}
