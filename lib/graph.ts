export type NodeKind = "process" | "system" | "data";
export type Confidence = "confirmed" | "inferred" | "unknown";

export type LensNode = {
  id: string;
  kind: NodeKind;
  label: string;
  description: string;
  status: Confidence;
  actor?: string;
  evidence?: string;
};

export type LensEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  relation: "next" | "uses" | "reads" | "writes" | "sends";
};

export type LensGraph = {
  nodes: LensNode[];
  edges: LensEdge[];
};

export const SAMPLE_INTERVIEW = `営業がメールで注文書を受け取ります。
内容を確認したあと、まずExcelの受注管理表に入力して、その後ERPにも同じ内容を登録しています。
ERPで受注登録したあと在庫を確認します。在庫が足りなければ生産管理に連絡します。
在庫があれば出荷手配に進みます。`;

const PROCESS_X = [210, 510, 810, 1110];
const SYSTEM_X = [210, 480, 750, 1020];
const DATA_X = [250, 600, 950];

export const lanePositions = {
  process: { y: 110, x: PROCESS_X },
  system: { y: 365, x: SYSTEM_X },
  data: { y: 620, x: DATA_X },
} as const;

export function extractInterview(text: string): LensGraph {
  const normalized = text.replace(/\s+/g, " ");
  const nodes: LensNode[] = [];
  const edges: LensEdge[] = [];

  const has = (pattern: RegExp) => pattern.test(normalized);
  const addNode = (node: LensNode) => {
    if (!nodes.some((item) => item.id === node.id)) nodes.push(node);
  };
  const addEdge = (edge: LensEdge) => {
    if (!edges.some((item) => item.id === edge.id)) edges.push(edge);
  };

  if (has(/注文書|受注/)) {
    addNode({
      id: "p-receive",
      kind: "process",
      label: "注文書受領",
      description: "注文書を受け取り、受注処理を開始する。",
      status: "confirmed",
      actor: "営業",
      evidence: "ヒアリング中の「注文書を受け取る」記述",
    });
    addNode({
      id: "d-order-doc",
      kind: "data",
      label: "注文書",
      description: "顧客から受領する注文情報の原本。",
      status: "confirmed",
      evidence: "注文書への明示的な言及",
    });
    addEdge({
      id: "e-doc-receive",
      source: "d-order-doc",
      target: "p-receive",
      label: "受領",
      relation: "sends",
    });
  }

  if (has(/メール|email/i)) {
    addNode({
      id: "s-mail",
      kind: "system",
      label: "メール",
      description: "注文書の受領チャネル。",
      status: "confirmed",
      evidence: "メールで注文書を受け取るとの説明",
    });
    if (nodes.some((node) => node.id === "p-receive")) {
      addEdge({
        id: "e-mail-receive",
        source: "p-receive",
        target: "s-mail",
        label: "利用",
        relation: "uses",
      });
    }
  }

  if (has(/確認/)) {
    addNode({
      id: "p-check",
      kind: "process",
      label: "内容確認",
      description: "注文内容に不足や誤りがないか確認する。",
      status: "confirmed",
      actor: "営業",
      evidence: "「内容を確認したあと」と明示",
    });
    if (nodes.some((node) => node.id === "p-receive")) {
      addEdge({
        id: "e-receive-check",
        source: "p-receive",
        target: "p-check",
        label: "次へ",
        relation: "next",
      });
    }
  }

  if (has(/Excel/i)) {
    addNode({
      id: "s-excel",
      kind: "system",
      label: "Excel 受注管理表",
      description: "営業が受注内容を記録する表計算ファイル。",
      status: "confirmed",
      evidence: "Excelの受注管理表に入力すると明示",
    });
    addNode({
      id: "d-order-data",
      kind: "data",
      label: "受注データ",
      description: "注文書から転記された受注情報。",
      status: "inferred",
      evidence: "ExcelとERPへ同内容を入力する説明から推定",
    });
    const processSource = nodes.some((node) => node.id === "p-check")
      ? "p-check"
      : "p-receive";
    if (nodes.some((node) => node.id === processSource)) {
      addEdge({
        id: "e-check-excel",
        source: processSource,
        target: "s-excel",
        label: "手入力",
        relation: "uses",
      });
    }
    addEdge({
      id: "e-excel-order-data",
      source: "s-excel",
      target: "d-order-data",
      label: "記録",
      relation: "writes",
    });
  }

  if (has(/ERP|SAP/i)) {
    const systemName = has(/SAP/i) ? "SAP" : "ERP";
    addNode({
      id: "s-erp",
      kind: "system",
      label: systemName,
      description: "正式な受注登録を行う基幹システム。",
      status: "confirmed",
      evidence: `${systemName}への登録が明示されている`,
    });
    const source = nodes.some((node) => node.id === "s-excel")
      ? "s-excel"
      : nodes.some((node) => node.id === "p-check")
        ? "p-check"
        : "p-receive";
    if (nodes.some((node) => node.id === source)) {
      addEdge({
        id: "e-to-erp",
        source,
        target: "s-erp",
        label: nodes.some((node) => node.id === "s-excel") ? "二重入力" : "登録",
        relation: "uses",
      });
    }
    if (nodes.some((node) => node.id === "d-order-data")) {
      addEdge({
        id: "e-erp-order-data",
        source: "s-erp",
        target: "d-order-data",
        label: "登録",
        relation: "writes",
      });
    }
  }

  if (has(/在庫/)) {
    addNode({
      id: "p-inventory",
      kind: "process",
      label: "在庫確認",
      description: "受注数量を引き当て可能か確認する。",
      status: "confirmed",
      evidence: "在庫を確認すると明示",
    });
    addNode({
      id: "d-inventory",
      kind: "data",
      label: "在庫データ",
      description: "受注可否を判断するための在庫情報。",
      status: "inferred",
      evidence: "在庫確認業務からデータの存在を推定",
    });
    if (nodes.some((node) => node.id === "s-erp")) {
      addEdge({
        id: "e-erp-inventory-process",
        source: "s-erp",
        target: "p-inventory",
        label: "登録後",
        relation: "next",
      });
    }
    addEdge({
      id: "e-inventory-data",
      source: "d-inventory",
      target: "p-inventory",
      label: "参照",
      relation: "reads",
    });

    if (has(/WMS/i)) {
      addNode({
        id: "s-inventory",
        kind: "system",
        label: "WMS",
        description: "在庫・倉庫管理システム。",
        status: "confirmed",
        evidence: "WMSへの明示的な言及",
      });
    } else {
      addNode({
        id: "s-inventory",
        kind: "system",
        label: "在庫管理 ?",
        description: "在庫確認元のシステムがヒアリングでは未確定。",
        status: "unknown",
        evidence: "在庫確認はあるが利用システムが未説明",
      });
    }

    addEdge({
      id: "e-inventory-system-data",
      source: "s-inventory",
      target: "d-inventory",
      label: "保持",
      relation: "writes",
    });
  }

  if (has(/出荷/)) {
    addNode({
      id: "p-ship",
      kind: "process",
      label: "出荷手配",
      description: "在庫が確保できた受注を出荷工程へ渡す。",
      status: "confirmed",
      evidence: "在庫があれば出荷手配に進むとの説明",
    });
    if (nodes.some((node) => node.id === "p-inventory")) {
      addEdge({
        id: "e-inventory-ship",
        source: "p-inventory",
        target: "p-ship",
        label: "在庫あり",
        relation: "next",
      });
    }
  }

  return { nodes, edges };
}

export function generateQuestions(graph: LensGraph): string[] {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const questions: string[] = [];

  if (ids.has("s-excel") && ids.has("s-erp")) {
    questions.push("ExcelとERPへの二重入力は、なぜ必要ですか？");
  }
  if (
    ids.has("p-inventory") &&
    graph.nodes.find((node) => node.id === "s-inventory")?.status === "unknown"
  ) {
    questions.push("在庫確認は、どのシステム・画面で行っていますか？");
  }
  if (ids.has("s-mail")) {
    questions.push("注文書メールは誰が受け取り、担当者不在時はどう引き継ぎますか？");
  }
  if (ids.has("p-ship")) {
    questions.push("出荷手配では、どのシステムや帳票を使いますか？");
  }

  return questions.slice(0, 4);
}
