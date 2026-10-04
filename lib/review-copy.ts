export const REVIEW_FIELD_LABELS: Record<string, string> = {
  name: "手順名", action: "行うこと", actor: "担当する人", department: "部署",
  responsiblePerson: "責任者", executionMode: "実行方法", certainty: "根拠の確かさ",
  executingSystem: "実行するシステム", executionContext: "開始条件・ルール・例外",
  trigger: "開始条件", rule: "実行・判断のルール", exception: "例外の扱い",
  systems: "使う道具", data: "情報", order: "順序", technicalDetails: "技術詳細",
  detailSteps: "個別作業", purpose: "必要な理由", basis: "判断の根拠",
  result: "決まる・変わること", next: "次に動く仕事", condition: "実行条件",
  halt: "停止・保留", system: "依存する道具", prerequisite: "必要な仕組み",
  reason: "必要な理由", rejected: "依存関係の除外",
};

export function reviewFieldLabel(field: string) {
  return REVIEW_FIELD_LABELS[field.split(".").at(-1)!] ?? "訂正した項目";
}
