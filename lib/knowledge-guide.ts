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

export function termExplanations(name: string) {
  const terms: Array<[RegExp, string]> = [
    [
      /\bATP\b/i,
      "注文の数量を、在庫や入荷予定からいつ用意できるか確認する処理",
    ],
    [/\bMRP\b/i, "製品を作るために不足する原料と、必要な時期を計算する処理"],
    [/与信/, "代金を回収できる見込みを確認し、取引してよい金額か判断すること"],
    [/\bCAPA\b/i, "品質問題の原因を取り除き、再発を防ぐ対応"],
    [
      /\b(?:SAP|ERP)\b/i,
      "受注・購買・在庫・会計など、会社の取引記録をまとめるシステム",
    ],
    [/\bMES\b/i, "工場の製造指示と実際の作業・製造結果を管理するシステム"],
    [/\bLIMS\b/i, "検体・分析試験・検査結果を管理するシステム"],
    [/\bQMS\b/i, "品質のルール、問題への対応、承認記録を管理するシステム"],
    [/\bPLM\b/i, "製品の仕様・処方・開発記録を管理するシステム"],
    [/\bEAM\b/i, "設備の点検・修理・保全を管理するシステム"],
    [/\bDCS\b/i, "製造設備の温度や圧力などを監視・制御するシステム"],
    [/\bTeams\b/i, "担当者への連絡や相談、共同作業をつなぐ道具"],
    [/\bSharePoint\b/i, "部署で共有するファイルや情報を保存・共同編集する場所"],
    [/\bOutlook\b|メール/, "情報の受取り、確認依頼や通知に使う連絡手段"],
    [
      /\b(?:Snowflake|DWH|Data Lake)\b/i,
      "複数のシステムのデータを集め、分析に使えるように保管する場所",
    ],
    [
      /\b(?:ETL|Integration|API)\b/i,
      "システム同士で情報を渡し、必要に応じて形式を整える仕組み",
    ],
    [
      /\bMDM\b/i,
      "製品や取引先など、複数の業務で共通に使う基本情報をそろえる仕組み",
    ],
    [/\bData Catalog\b/i, "どこにどんなデータがあるかを調べるための案内"],
    [/\bPower BI\b/i, "集めたデータを集計し、グラフや報告書で見る道具"],
    [
      /\b(?:Entra|SSO)\b/i,
      "誰がどのシステムを利用できるか確認する認証の仕組み",
    ],
    [/\b(?:VBA|Macro)\b/i, "Excel上の繰り返し作業を自動で行うプログラム"],
    [/\bExcel\b/i, "表を作り、集計・調整や手作業の記録に使う道具"],
  ];
  return terms.flatMap(([pattern, explanation]) => {
    const matched = name.match(pattern);
    return matched ? [{ term: matched[0], explanation }] : [];
  });
}

export function termExplanation(name: string): string | undefined {
  return termExplanations(name)[0]?.explanation;
}

type ConnectionKind = { kind: "information" | "material"; via?: "handoff" | "reference" };
export function connectionKindLabel(connection: ConnectionKind) {
  if (connection.kind === "material") return "物の受渡し";
  return connection.via === "reference" ? "情報の参照"
    : connection.via === "handoff" ? "情報の受渡し" : "情報の受渡し・参照";
}

export function connectionRoleLabel(connection: ConnectionKind, incoming = false) {
  if (connection.kind === "information" && connection.via === "reference")
    return incoming ? "情報をつくる業務" : "この情報を参照する業務";
  if (connection.kind === "material" || connection.via === "handoff")
    return incoming ? "渡す業務" : "受け取る業務";
  return "関係する業務";
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
      sourceId: string;
      targetId: string;
      description: string;
      workflowId: string;
      count: number;
      status: import("./graph").Confidence;
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
        ? {
            ...prior,
            count: prior.count + 1,
            status:
              prior.status === "unknown" ||
              !handoff.status ||
              handoff.status === "unknown"
                ? "unknown"
                : prior.status === "inferred" || handoff.status === "inferred"
                  ? "inferred"
                  : "confirmed",
          }
        : {
            source: source.name,
            target: target.name,
            sourceId: source.id,
            targetId: target.id,
            description: handoff.description,
            workflowId: handoff.sourceWorkflowId,
            count: 1,
            status: handoff.status ?? "unknown",
          },
    );
  }
  return [...grouped.values()];
}

// A small example path, not a claim that every company has one fixed value chain.
// Search is bounded even when users register many activities and cyclic handoffs.
export function overviewPath(
  connections: ReturnType<typeof companyConnections>,
  startId?: string,
) {
  const outgoing = new Map<string, typeof connections>();
  for (const edge of connections) {
    const list = outgoing.get(edge.sourceId) ?? [];
    list.push(edge);
    outgoing.set(edge.sourceId, list);
  }
  const starts =
    startId && outgoing.has(startId)
      ? [startId]
      : [...outgoing.keys()].slice(0, 24);
  let paths = starts.map((id) => ({
    ids: [id],
    edges: [] as typeof connections,
  }));
  let best = paths[0];
  for (let depth = 0; depth < 5; depth++) {
    const next: typeof paths = [];
    for (const path of paths) {
      for (const edge of outgoing.get(path.ids.at(-1)!) ?? []) {
        if (path.ids.includes(edge.targetId)) continue;
        next.push({
          ids: [...path.ids, edge.targetId],
          edges: [...path.edges, edge],
        });
        if (next.length >= 64) break;
      }
      if (next.length >= 64) break;
    }
    if (!next.length) break;
    paths = next;
    best = paths[0];
  }
  return best?.edges ?? [];
}
