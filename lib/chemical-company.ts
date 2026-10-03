import { enrichChemicalOutcomes } from "./chemical-outcomes";
import { chemicalRecipes } from "./chemical-recipes";
import {
  canonicalNodeId,
  branchWorkflowScenario,
  type LensGraph,
  type LensNode,
  type CompanyKnowledge,
} from "./graph";

// Synthetic business evidence: these are fictional operating assumptions, not claims about a real company.
const domains = [
  [
    "市場・顧客を理解する",
    "営業部",
    "sap",
    "顧客需要",
    [
      "市場需要分析",
      "顧客仕様確認",
      "販売予測策定",
      "製品見積",
      "契約条件審査",
    ],
    [
      "引合を受け取る",
      "顧客仕様を確認する",
      "価格条件を決定する",
      "与信を判定する",
      "営業責任者が提案を承認する",
    ],
  ],
  [
    "受注から納品・回収まで",
    "受注管理部",
    "sap",
    "受注・出荷指図",
    ["受注登録", "納期回答", "出荷指示", "輸出書類作成", "売掛金回収"],
    [
      "注文書を受け取る",
      "受注を入力する",
      "価格条件を決定する",
      "与信チェック",
      "ATPチェック",
      "MRPへ反映する",
      "在庫・所要量を更新する",
      "生産計画担当が確認する",
    ],
  ],
  [
    "原料・サービスを調達する",
    "購買部",
    "sap",
    "購買依頼・原料規格",
    ["購買依頼", "サプライヤ評価", "原料発注", "入荷検収", "請求照合"],
    [
      "購買依頼を受け取る",
      "原料規格と供給先を照合する",
      "発注条件を計算する",
      "購買責任者が承認する",
      "入荷数量と請求を照合する",
    ],
  ],
  [
    "生産を計画する",
    "生産計画部",
    "sap",
    "製造所要量・計画",
    ["需要供給調整", "MRP確認", "設備能力調整", "製造指図発行", "計画変更調整"],
    [
      "需要と在庫を受け取る",
      "所要量を計算する",
      "設備能力を照合する",
      "計画担当者が制約を判断する",
      "製造指図を発行する",
    ],
  ],
  [
    "安全に製造する",
    "製造部",
    "mes",
    "製造ロット・実績",
    ["原料払出", "仕込計量", "反応工程管理", "充填包装", "製造実績確定"],
    [
      "製造指図を受け取る",
      "作業者が原料と設備を確認する",
      "レシピ条件を照合する",
      "温度・圧力の逸脱を検知する",
      "製造実績を確定する",
    ],
  ],
  [
    "品質を保証する",
    "品質保証部",
    "lims",
    "試験結果・品質判定",
    ["検体受付", "分析試験", "規格判定", "ロット出荷判定", "品質逸脱CAPA"],
    [
      "検体とロットを受け取る",
      "分析担当者が測定する",
      "規格値を判定する",
      "品質責任者が逸脱を確認する",
      "出荷可否を承認する",
    ],
  ],
  [
    "製品を保管・配送する",
    "物流部",
    "sap",
    "在庫・配送実績",
    ["倉庫受入", "危険物保管", "在庫棚卸", "配車手配", "配送追跡"],
    [
      "ロットと出荷予定を受け取る",
      "危険物区分を確認する",
      "保管条件を照合する",
      "物流担当者が配車を判断する",
      "受領実績を確定する",
    ],
  ],
  [
    "製品・処方を開発する",
    "研究開発部",
    "plm",
    "処方・実験結果",
    [
      "研究テーマ審査",
      "処方設計",
      "実験記録",
      "スケールアップ",
      "製品仕様移管",
    ],
    [
      "顧客要求と研究テーマを受け取る",
      "研究員が処方を設計する",
      "試験結果を集計する",
      "技術責任者が採用を判断する",
      "製造仕様を移管する",
    ],
  ],
  [
    "設備・環境・安全を守る",
    "設備環境部",
    "eam",
    "設備状態・安全記録",
    ["設備点検", "予防保全", "故障復旧", "環境排出管理", "作業許可"],
    [
      "設備状態と作業依頼を受け取る",
      "担当者が現場点検する",
      "監視値の異常を検知する",
      "安全責任者が作業許可を判断する",
      "保全・環境記録を確定する",
    ],
  ],
  [
    "収益・資金を管理する",
    "経理部",
    "sap",
    "仕訳・原価",
    ["原価計算", "買掛金支払", "月次決算", "資金繰り", "投資予算審査"],
    [
      "取引実績を受け取る",
      "担当者が例外仕訳を確認する",
      "原価と会計条件を計算する",
      "経理責任者が差異を承認する",
      "会計実績を確定する",
    ],
  ],
  [
    "人と組織を支える",
    "人事総務部",
    "hr",
    "従業員・資格",
    ["要員計画", "資格教育", "勤怠確認", "入退社手続", "社内申請"],
    [
      "申請と資格情報を受け取る",
      "担当者が要件を確認する",
      "資格・勤怠条件を照合する",
      "所属責任者が承認する",
      "人事記録を更新する",
    ],
  ],
  [
    "情報とデジタル基盤を運営する",
    "情報システム部",
    "snowflake",
    "業務データ・運用記録",
    [
      "データ連携監視",
      "分析データ提供",
      "権限申請",
      "障害対応",
      "バックアップ復旧",
    ],
    [
      "業務データと運用通知を受け取る",
      "担当者がデータ品質を確認する",
      "連携・品質ルールを実行する",
      "運用責任者が例外を判断する",
      "提供結果と復旧記録を確定する",
    ],
  ],
] as const;

const categories = [
  ["transaction", "基幹・トランザクション", "受注・購買・会計・在庫・生産計画"],
  ["manufacturing", "製造・研究・品質", "製造実行、品質、処方、設備"],
  ["data", "データ・分析・連携", "統合、分析、マスタ、データ提供"],
  [
    "collaboration",
    "Groupware / Collaboration",
    "受信、通知、承認、保管、共同編集",
  ],
  ["platform", "Infrastructure / Platform", "認証、通信、実行環境、運用保護"],
  ["local", "Local Tool / Shadow IT", "部門ツール、転記、個人ファイル"],
];
const systems = [
  ["sap", "SAP S/4HANA", "transaction", "取引と在庫・会計・計画の記録"],
  ["hr", "人事・給与システム", "transaction", "従業員・資格・勤怠管理"],
  ["mes", "MES", "manufacturing", "製造指図・ロット・実績の管理"],
  ["lims", "LIMS", "manufacturing", "検体・分析結果・規格判定"],
  ["qms", "QMS", "manufacturing", "品質逸脱・CAPAと承認記録"],
  ["plm", "PLM / 研究データ管理", "manufacturing", "処方・製品仕様の版管理"],
  ["eam", "EAM", "manufacturing", "設備点検・保全作業"],
  ["dcs", "DCS", "manufacturing", "反応工程の監視と制御"],
  ["instrument", "分析機器システム", "manufacturing", "測定と原データ保管"],
  ["snowflake", "Snowflake DWH", "data", "業務実績を統合して分析へ提供"],
  ["lake", "Data Lake", "data", "分析・設備の原データ保管"],
  ["etl", "ETL / Integration API", "data", "SAP・MES・LIMSからの連携"],
  ["mdm", "MDM", "data", "製品・原料・顧客のマスタ統合"],
  ["bi", "Power BI", "data", "活動別の実績分析"],
  ["catalog", "Data Catalog", "data", "データ定義と責任者の検索"],
  ["teams", "Microsoft Teams", "collaboration", "例外判断と部門間の通知・会議"],
  [
    "sharepoint",
    "SharePoint",
    "collaboration",
    "承認済みファイル保管と共同編集",
  ],
  [
    "mail",
    "Outlook / Mail / Calendar",
    "collaboration",
    "社内外の受付・通知と予定調整",
  ],
  [
    "portal",
    "社内ポータル / Forms / 電子申請",
    "collaboration",
    "申請受付・承認",
  ],
  ["files", "ファイルサーバ", "collaboration", "部門文書・旧版の保管"],
  ["identity", "Entra ID / SSO", "platform", "認証と利用権限"],
  ["network", "拠点ネットワーク", "platform", "工場・本社・クラウドの接続"],
  ["cloud", "Azure / Server", "platform", "システムの実行環境"],
  ["endpoint", "Endpoint Management / Security", "platform", "端末構成と保護"],
  ["monitor", "Monitoring", "platform", "システム障害・連携遅延の検知"],
  ["backup", "Backup", "platform", "復旧用データ保全"],
  ["excel", "Excel 部門計画表", "local", "人による集計・調整・転記"],
  ["vba", "Excel Macro / VBA", "local", "部門集計の自動化"],
  ["access", "Access 部門DB", "local", "保全・物流の補助台帳"],
  ["csv", "CSV / ローカルファイル", "local", "エクスポートと受渡し"],
];
const contexts = [
  ["千葉工場", "機能性樹脂", "resin"],
  ["川崎工場", "電子材料", "electronic"],
  ["四日市工場", "工業用溶剤", "solvent"],
  ["大阪工場", "塗料添加剤", "additive"],
  ["姫路工場", "特殊ポリマー", "polymer"],
];

export function createChemicalCompany(): LensGraph {
  const knowledge: CompanyKnowledge = {
    name: "青葉ケミカル株式会社（架空）",
    description:
      "5工場の化学メーカー。顧客要求を処方・生産計画へつなぎ、原料を調達し、製造・品質保証・配送・回収を行う。研究、人事、経理、デジタル基盤がこれを支える。300業務は60の業務能力×5工場・製品の実装。すべて検証用の架空データ。",
    categories: categories.map(([id, name, description]) => ({
      id,
      name,
      description,
    })),
    activities: [],
    systems: [],
    criticalWorkflows: [],
  };
  const graph: LensGraph = {
    workflows: [],
    nodes: [],
    edges: [],
    dataFlows: [],
    knowledge,
  };
  const asset = (
    kind: "system" | "data",
    key: string,
    label: string,
    description: string,
  ) => {
    const canonicalKey = `${kind}:${key}`;
    const id = canonicalNodeId(canonicalKey);
    if (!graph.nodes.some((n) => n.id === id))
      graph.nodes.push({
        id,
        canonicalKey,
        kind,
        label,
        description,
        status: "confirmed",
        evidence: "架空メーカーの運用シナリオ",
      });
    return id;
  };
  const sys = (key: string) => canonicalNodeId(`system:${key}`);
  for (const [key, name, category, purpose] of systems) {
    const systemId = asset("system", key, name, purpose);
    knowledge.systems.push({
      systemId,
      categoryId: category,
      purpose,
      owner: category === "local" ? "各利用部署" : "情報システム部",
      dependsOn:
        category === "platform"
          ? key === "network"
            ? []
            : [{ systemId: sys("network"), reason: "拠点間通信" }]
          : [
              { systemId: sys("identity"), reason: "利用者・サービス認証" },
              { systemId: sys("network"), reason: "拠点接続" },
              ...(category === "local"
                ? [{ systemId: sys("endpoint"), reason: "利用端末の保護" }]
                : [
                    { systemId: sys("cloud"), reason: "実行環境" },
                    { systemId: sys("backup"), reason: "障害時の復旧" },
                    { systemId: sys("monitor"), reason: "稼働監視" },
                  ]),
            ],
    });
  }
  const edge = (
    source: string,
    target: string,
    relation: LensGraph["edges"][number]["relation"],
    workflowId: string,
    label?: string,
  ) =>
    graph.edges.push({
      id: `edge:${graph.edges.length}`,
      source,
      target,
      relation,
      label,
      workflowIds: [workflowId],
    });
  const flow = (
    from: string,
    to: string,
    dataId: string,
    workflowId: string,
    processIds: string[],
    automatic = false,
  ) =>
    graph.dataFlows.push({
      id: `flow:${graph.dataFlows.length}`,
      sourceSystemId: sys(from),
      targetSystemId: sys(to),
      dataIds: [dataId],
      workflowIds: [workflowId],
      processIds,
      transferType: automatic ? "api" : to === "mail" ? "email" : "manual",
      direction: "push",
      automation: automatic ? "automatic" : "manual",
      frequency: automatic ? "日次 / イベント" : "案件ごと",
      status: "confirmed",
      evidence: automatic
        ? "架空シナリオ：記録されたSystem間API連携。"
        : "架空シナリオ：担当者が確認しファイルの内容を受け渡す・転記する。",
    });
  domains.forEach(
    ([name, department, core, dataName, capabilities, actions], ai) => {
      const activity = {
        id: `activity:${ai}`,
        name,
        description: `${department}を中心に${dataName}を扱う活動。`,
        capabilities:
          [] as CompanyKnowledge["activities"][number]["capabilities"],
      };
      knowledge.activities.push(activity);
      capabilities.forEach((capName, ci) => {
        const cap = {
          id: `capability:${ai}:${ci}`,
          name: capName,
          description: `${capName}を各工場・製品で実行する能力。共通ルールと工場の実装を比較できる。`,
          workflowIds: [] as string[],
        };
        activity.capabilities.push(cap);
        contexts.forEach(([site, product, productId], vi) => {
          const id = `chemical-${ai}-${ci}-${vi}`;
          cap.workflowIds.push(id);
          const dataId = asset(
            "data",
            `${ai}-${ci}-${vi}`,
            `${product} ${capName}記録`,
            `${site}の${dataName}。製品・ロット・案件番号で追跡する。`,
          );
          const master = asset(
            "data",
            `master-${vi}`,
            `${product} 製品・原料マスタ`,
            "製品仕様・原料規格・危険物区分。MDMから各業務へ提供する。",
          );
          const primary =
            ai === 5 && ci === 4
              ? "qms"
              : ai === 11 && ci >= 2
                ? ["identity", "monitor", "backup"][ci - 2]
                : core;
          const recipe = chemicalRecipes[ai][ci];
          const pathNote =
            ci === 2
              ? "確定記録をAPI連携する"
              : ci === 3
                ? "電子承認と共同編集を行う"
                : ci === 4
                  ? "部門ツールと人の判断を介して記録を確定する"
                  : "Excel調整を経てTeamsで例外判断し、承認結果をSharePointに保管する";
          graph.workflows.push({
            id,
            name: `${capName}｜${site}・${product}`,
            description: `${department}が${capName}を行う。${site}では${pathNote}。`,
            trigger: `${product}の${capName}依頼・イベント`,
            outcome: `${capName}の確定記録を次の担当へ渡す`,
            familyId: id,
            scenario: "current",
            landscape: {
              domains: [name],
              site,
              productId,
              productLabel: product,
              perspective: capName,
              commonProcessId: cap.id,
              processRole: "site",
              variantNote:
                vi % 2
                  ? "VBAで集計。例外は担当者が判断する。"
                  : "Excelへ手動転記して調整する。",
              evidence: "架空の運用設計",
              materialHandoffs: [],
            },
          });
          if ([1, 4, 5, 8].includes(ai) && ci === 3)
            knowledge.criticalWorkflows.push({
              workflowId: id,
              reason:
                ai === 5
                  ? "未判定ロットの出荷を防止する"
                  : ai === 8
                    ? "設備・作業の安全を確保する"
                    : "出荷・製造の継続に必要",
            });
          const sequence: Array<[string, string | null, boolean]> = recipe.map(
            (action, si) => [
              `${capName}：${action.replace("⚙", "")}`,
              si === 0
                ? "mail"
                : action.includes("分析機器")
                  ? "instrument"
                  : action.includes("温度・圧力") || action.includes("設定範囲")
                    ? "dcs"
                    : primary,
              action.startsWith("⚙"),
            ],
          );
          if (ci !== 2 && ci !== 3)
            sequence.push([
              "結果をExcelへ出力して差異を調整する",
              "excel",
              false,
            ]);
          if (vi % 2 && ci !== 2 && ci !== 3)
            sequence.push(["VBAで部門集計する", "vba", true]);
          if (ci === 0 || ci === 4)
            sequence.push(["メールで確認依頼を送る", "mail", false]);
          if (ci !== 2)
            sequence.push([
              "Teamsで関係部署へ通知し例外を判断する",
              "teams",
              false,
            ]);
          if (ci === 4)
            sequence.push([
              "現場で差異を確認し担当者が処置を判断する",
              null,
              false,
            ]);
          if (ci !== 2)
            sequence.push([
              "SharePointで共同編集し承認記録を保管する",
              "sharepoint",
              false,
            ]);
          if (ci === 3)
            sequence.push(["電子申請で処置を承認する", "portal", false]);
          if (ci !== 2 && ci !== 3)
            sequence.push([
              "Excelの確定値を業務システムへ転記する",
              primary,
              false,
            ]);
          sequence.push(["分析基盤へ実績を連携する", "etl", true]);
          const processIds: string[] = [];
          sequence.forEach(([label, system, automatic], si) => {
            const canonicalKey = `process:${id}:s${si}`;
            const pid = canonicalNodeId(canonicalKey);
            const node: LensNode = {
              id: pid,
              canonicalKey,
              kind: "process",
              label,
              action: label,
              description: `${product}の${capName}。ロット・案件番号を確認し処理する。`,
              workflowId: id,
              stepOrder: si + 1,
              executionMode: automatic ? "automatic" : "manual",
              department: label.includes("生産計画担当")
                ? "生産計画部"
                : label.includes("品質保証部が")
                  ? "品質保証部"
                  : label.includes("法務担当")
                    ? "法務部"
                    : department,
              actor: automatic ? undefined : `${department}担当者`,
              status: "confirmed",
              evidence: "架空の運用設計",
              executionContext: {
                trigger:
                  si === 0
                    ? "依頼・対象イベントの受信"
                    : `${sequence[si - 1][0]}の完了`,
                rule: label.includes("与信チェック")
                  ? "受注金額と未回収債権の合計が顧客与信限度内か判定する"
                  : label.includes("ATPチェック")
                    ? "利用可能在庫と入荷・製造予定から約束可能数量・納期を判定する"
                    : label.includes("価格条件")
                      ? "顧客・製品・契約期間・数量に合う価格と値引条件を適用する"
                      : label.includes("MRP")
                        ? "製品所要量、部品表、在庫、調達リードタイムから原料不足を計算する"
                        : automatic
                          ? `${product}の登録済み条件・閾値と対象データを照合する`
                          : "対象・版・ロットを確認し例外を担当者が判断する",
                exception: label.includes("与信チェック")
                  ? "与信超過は受注を保留し営業・経理へ解除判断を依頼する"
                  : label.includes("ATPチェック")
                    ? "数量不足は納期回答を保留し生産計画担当へ調整を依頼する"
                    : automatic
                      ? "条件不一致は保留しTeamsで担当部署へ通知する"
                      : "不足・差異がある場合は前工程へ差戻す",
              },
              detailSteps: [
                {
                  id: `${pid}:task1`,
                  action: "対象の製品・ロット・案件番号を照合する",
                  condition: null,
                  evidence: "架空シナリオ",
                },
                {
                  id: `${pid}:task2`,
                  action: "結果と判断根拠を記録する",
                  condition: "対象が一致した場合",
                  evidence: "架空シナリオ",
                },
              ],
            };
            graph.nodes.push(node);
            processIds.push(pid);
            if (si) edge(processIds[si - 1], pid, "next", id);
            if (system)
              edge(
                automatic ? sys(system) : pid,
                automatic ? pid : sys(system),
                automatic ? "executes" : "uses",
                id,
                automatic ? "ルール実行" : label,
              );
            edge(pid, dataId, "reads", id);
            if (si > 0) edge(pid, dataId, "writes", id);
            const ruleData = label.includes("与信チェック")
              ? "顧客与信限度・債権残高"
              : label.includes("ATPチェック")
                ? "利用可能在庫・入荷予定"
                : label.includes("価格条件")
                  ? "顧客・契約価格条件"
                  : label.includes("MRP")
                    ? "部品表・原料所要量"
                    : "";
            if (ruleData)
              edge(
                pid,
                asset(
                  "data",
                  `rule-${vi}-${ruleData}`,
                  `${product} ${ruleData}`,
                  "自動判定に必要なマスタ・取引情報",
                ),
                "reads",
                id,
              );
            if (si === 1) edge(pid, master, "reads", id);
          });
          const stepFor = (text: string) =>
            processIds.filter((_, i) => sequence[i][0].includes(text));
          if (ci !== 2 && ci !== 3) {
            flow(primary, "excel", dataId, id, stepFor("結果をExcel"));
            flow("excel", primary, dataId, id, stepFor("確定値"));
          }
          if (ci === 0 || ci === 4) {
            flow("excel", "mail", dataId, id, stepFor("メールで確認"));
            flow("mail", "teams", dataId, id, stepFor("Teams"));
          }
          if (ci !== 2)
            flow("teams", "sharepoint", dataId, id, stepFor("SharePoint"));
          if (ci === 3)
            flow("sharepoint", "portal", dataId, id, stepFor("電子申請"), true);
          flow(primary, "etl", dataId, id, processIds.slice(-1), true);
          flow("etl", "snowflake", dataId, id, processIds.slice(-1), true);
          flow("snowflake", "bi", dataId, id, processIds.slice(-1), true);
          flow("mdm", primary, master, id, processIds.slice(1, 2), true);
          const extra =
            ai === 4
              ? "dcs"
              : ai === 5
                ? "instrument"
                : ai === 8
                  ? "access"
                  : ai === 11
                    ? ["catalog", "monitor", "identity", "backup", "lake"][ci]
                    : ai === 10
                      ? "portal"
                      : ci === 4
                        ? "files"
                        : "csv";
          edge(processIds[1], sys(extra), "uses", id, "補助記録・受付・制御");
          if (ai === 4 || ai === 5)
            flow(extra, primary, dataId, id, [processIds[1]], true);
        });
      });
    },
  );
  // Cross-department handoffs are declared at the actual business boundary, not by similar names.
  const routes = [
    [0, 2, 3, 0, "販売予測を需給計画へ渡す"],
    [0, 1, 7, 0, "顧客仕様を研究テーマへ渡す"],
    [7, 4, 3, 3, "承認済み製造仕様を製造指図へ渡す"],
    [1, 0, 3, 0, "受注所要量を需給計画へ渡す"],
    [3, 1, 2, 0, "MRPの不足原料を購買依頼へ渡す"],
    [2, 3, 4, 0, "検収済み原料とロットを製造へ渡す"],
    [3, 3, 4, 0, "製造指図をMESへ渡す"],
    [4, 2, 5, 0, "反応工程の製品検体とロットを試験室へ渡す"],
    [4, 4, 9, 0, "製造実績を原価計算へ渡す"],
    [5, 3, 6, 0, "出荷判定された製品と品質状態を倉庫へ渡す"],
    [6, 4, 1, 4, "受領・納品記録を請求と回収へ渡す"],
    [1, 4, 9, 2, "入金・消込実績を月次決算へ渡す"],
    [8, 1, 3, 2, "設備保全の停止予定を能力計画へ渡す"],
    [10, 1, 4, 2, "作業資格を反応工程の担当配置へ渡す"],
  ] as const;
  contexts.forEach(([, product, productId], vi) =>
    routes.forEach(([ai, ci, targetAi, targetCi, description], ri) => {
      const source = graph.workflows.find(
        (w) => w.id === `chemical-${ai}-${ci}-${vi}`,
      )!;
      const targetId = `chemical-${targetAi}-${targetCi}-${vi}`;
      const dataId = canonicalNodeId(`data:${ai}-${ci}-${vi}`);
      const targetProcess = graph.nodes.find(
        (n) => n.workflowId === targetId && n.stepOrder === 1,
      )!;
      edge(targetProcess.id, dataId, "reads", targetId, description);
      source.landscape!.materialHandoffs.push({
        id: `handoff:${ri}:${vi}`,
        targetWorkflowId: targetId,
        material: `${product}: ${description}`,
        productId,
        traceKey: "製品ID / ロット / 案件番号",
        dataIds: [dataId],
        dataContinuity: "linked",
        evidence: "架空の製品別業務連鎖：前活動の確定記録を次活動が参照する",
      });
      if (domains[ai][2] !== domains[targetAi][2])
        flow(
          domains[ai][2],
          domains[targetAi][2],
          dataId,
          targetId,
          [targetProcess.id],
          true,
        );
    }),
  );
  knowledge.activities.forEach((a, ai) =>
    contexts.forEach(([, product], vi) =>
      a.capabilities.slice(0, -1).forEach((c, ci) => {
        const source = graph.workflows.find(
          (w) => w.id === `chemical-${ai}-${ci}-${vi}`,
        )!;
        const targetId = `chemical-${ai}-${ci + 1}-${vi}`;
        const dataId = canonicalNodeId(`data:${ai}-${ci}-${vi}`);
        const p = graph.nodes.find(
          (n) => n.workflowId === targetId && n.stepOrder === 1,
        )!;
        edge(p.id, dataId, "reads", targetId, "前業務の確定記録を受け取る");
        source.landscape!.materialHandoffs.push({
          id: `cap-handoff:${ai}:${ci}:${vi}`,
          targetWorkflowId: targetId,
          material: `${product} ${c.name}の確定記録`,
          traceKey: "製品ID / ロット / 案件番号",
          dataIds: [dataId],
          dataContinuity: "linked",
          evidence: "架空シナリオ：同一活動内の情報受渡し",
        });
      }),
    ),
  );
  knowledge.handoffs = graph.workflows.flatMap((w) =>
    (w.landscape?.materialHandoffs ?? []).map((h) => ({
      id: h.id,
      sourceWorkflowId: w.id,
      sourceProcessId: graph.nodes
        .filter((n) => n.workflowId === w.id)
        .sort((a, b) => b.stepOrder! - a.stepOrder!)[0]?.id,
      targetWorkflowId: h.targetWorkflowId,
      targetProcessId: graph.nodes.find(
        (n) => n.workflowId === h.targetWorkflowId && n.stepOrder === 1,
      )?.id,
      dataIds: h.dataIds,
      description: h.material,
      kind: (h.material.includes("原料とロット") ||
      h.material.includes("製品検体") ||
      h.material.includes("判定された製品") ||
      (h.id.startsWith("cap-handoff:4:") &&
        !h.id.startsWith("cap-handoff:4:3:")) ||
      h.id.startsWith("cap-handoff:5:0:")
        ? "material"
        : "information") as "material" | "information",
      evidence: h.evidence,
      status: "confirmed" as const,
    })),
  );
  // Information continuity and physical movement are separate facts.
  for (const w of graph.workflows)
    if (w.landscape)
      w.landscape.materialHandoffs = w.landscape.materialHandoffs.filter(
        (h) =>
          knowledge.handoffs!.find((k) => k.id === h.id)?.kind === "material",
      );
  enrichChemicalOutcomes(graph);
  let result = graph;
  for (const sourceId of [
    "chemical-1-0-0",
    "chemical-4-0-0",
    "chemical-5-0-0",
  ]) {
    const source = result.workflows.find((w) => w.id === sourceId)!;
    const futureId = `${sourceId}-future`;
    result = branchWorkflowScenario(result, sourceId, {
      id: futureId,
      name: `${source.name}（将来案）`,
      scenario: "future",
      effectiveFrom: "2027-04-01",
      description:
        "手動Excel転記をAPI連携へ置換。例外の人による判断と承認記録は維持する。",
    });
    const remove = new Set(
      result.nodes
        .filter(
          (n) =>
            n.workflowId === futureId &&
            ["結果をExcel", "メールで確認", "Excelの確定値"].some((t) =>
              n.label.startsWith(t),
            ),
        )
        .map((n) => n.id),
    );
    const priorNext = result.edges.filter(
      (e) => e.relation === "next" && e.workflowIds.includes(futureId),
    );
    result.nodes = result.nodes.filter((n) => !remove.has(n.id));
    result.edges = result.edges.filter(
      (e) => !remove.has(e.source) && !remove.has(e.target),
    );
    // Skip replaced manual steps while preserving declared decision routes.
    for (const start of priorNext.filter(
      (e) => !remove.has(e.source) && remove.has(e.target),
    )) {
      const queue = [{ id: start.target, condition: start.label ?? "" }],
        seen = new Set<string>();
      while (queue.length) {
        const item = queue.shift()!;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        for (const edge of priorNext.filter((e) => e.source === item.id)) {
          const condition = [item.condition, edge.label]
            .filter(Boolean)
            .join(" / ");
          if (remove.has(edge.target))
            queue.push({ id: edge.target, condition });
          else
            result.edges.push({
              ...edge,
              id: `future-bridge:${futureId}:${start.source}:${edge.target}`,
              source: start.source,
              label: condition || undefined,
              evidence: "架空将来案：手動転記の置換。条件分岐は保持",
            });
        }
      }
    }
    result.dataFlows = result.dataFlows.filter(
      (f) =>
        !f.workflowIds.includes(futureId) ||
        ![sys("excel"), sys("mail")].some(
          (s) => s === f.sourceSystemId || s === f.targetSystemId,
        ),
    );
    const original = result.nodes.find(
      (n) => n.workflowId === futureId && n.label.startsWith("分析基盤"),
    )!;
    const canonicalKey = `process:${futureId}:api-confirm`;
    const pid = canonicalNodeId(canonicalKey);
    result.nodes.push({
      ...structuredClone(original),
      id: pid,
      canonicalKey,
      label: "API連携で承認済み確定値を業務システムへ反映する",
      action: "SharePointの承認済み記録をAPIで反映し、照合結果を記録する",
      stepOrder: original.stepOrder! - 0.5,
      executionContext: {
        trigger: "SharePointの承認記録が確定",
        rule: "案件・ロット・版の一致を検証して反映する",
        exception: "不一致は連携を停止しTeamsで担当者へ通知する",
      },
      meaning: {
        purpose: "工場の承認済み調整値を手動転記せず正式記録へ戻す",
        basis: "SharePointの承認済み記録と案件・ロット・版",
        result: "版の照合に成功した値だけが正式記録へ自動反映される",
        next: "後工程が承認済みの確定値で処理する",
        condition: "承認済み / 版が一致",
        halt: false,
        certainty: "inferred",
        evidence: "架空の将来案：一致時のAPI反映、不一致時の停止を提案",
      },
    });
    const coreId =
      graph.edges.find(
        (e) =>
          e.relation === "executes" &&
          graph.nodes.some(
            (n) => n.id === e.target && n.workflowId === sourceId,
          ) &&
          e.source !== sys("etl"),
      )?.source ?? sys("sap");
    result.edges.push({
      id: `future-exec:${futureId}`,
      source: coreId,
      target: pid,
      relation: "executes",
      workflowIds: [futureId],
    });
    const dataId = canonicalNodeId(`data:${sourceId.split("-")[1]}-0-0`);
    result.edges.push({
      id: `future-write:${futureId}`,
      source: pid,
      target: dataId,
      relation: "writes",
      workflowIds: [futureId],
    });
    result.dataFlows.push({
      id: `future-api:${futureId}`,
      sourceSystemId: sys("sharepoint"),
      targetSystemId: coreId,
      dataIds: [dataId],
      transferType: "api",
      direction: "push",
      automation: "automatic",
      status: "confirmed",
      evidence: "架空将来案：承認記録のAPI反映",
      workflowIds: [futureId],
      processIds: [pid],
    });
    const steps = result.nodes
      .filter((n) => n.workflowId === futureId)
      .sort((a, b) => a.stepOrder! - b.stepOrder!);
    steps.forEach((s, i) => {
      s.stepOrder = i + 1;
    });
    const incoming = result.edges.filter(
      (e) =>
        e.relation === "next" &&
        e.target === original.id &&
        e.workflowIds.includes(futureId),
    );
    result.edges = result.edges.filter((e) => !incoming.includes(e));
    result.edges.push(
      ...incoming.map((e) => ({
        ...e,
        id: `future-api-in:${e.id}`,
        target: pid,
      })),
      {
        id: `future-api-out:${futureId}`,
        source: pid,
        target: original.id,
        relation: "next",
        workflowIds: [futureId],
        label: "照合に成功した値を反映した時",
        status: "inferred",
        evidence: "架空将来案",
      },
    );
    const holdKey = `process:${futureId}:api-mismatch`,
      holdId = canonicalNodeId(holdKey);
    result.nodes.push({
      id: holdId,
      canonicalKey: holdKey,
      kind: "process",
      workflowId: futureId,
      label: "版の不一致で連携を保留し、Teamsで担当者に照合差異を通知する",
      action:
        "システムは反映を止め、担当者が案件・ロット・版を確認して再申請する",
      description: "不一致を自動で確定値へ上書きしない",
      status: "inferred",
      executionMode: "mixed",
      department: original.department,
      evidence: "架空将来案：版不一致時の停止と担当者による再申請",
      stepOrder: steps.length + 1,
      meaning: {
        purpose: "誤った版の正式記録への反映を防ぐ",
        basis: "案件・ロット・版の照合差異",
        result: "正式記録を更新せず連携が保留される",
        next: "担当者が差異を修正して再申請する",
        condition: "版の照合が不一致",
        halt: true,
        certainty: "inferred",
        evidence: "架空の将来案：担当者の確認後にAPI照合から再開",
      },
    });
    result.edges.push(
      {
        id: `future-api-hold:${futureId}`,
        source: pid,
        target: holdId,
        relation: "next",
        workflowIds: [futureId],
        label: "案件・ロット・版が不一致",
        status: "inferred",
        evidence: "架空将来案",
      },
      {
        id: `future-api-retry:${futureId}`,
        source: holdId,
        target: pid,
        relation: "next",
        workflowIds: [futureId],
        label: "担当者が差異を修正して再申請",
        status: "inferred",
        evidence: "架空将来案",
      },
      {
        id: `future-hold-tool:${futureId}`,
        source: holdId,
        target: sys("teams"),
        relation: "uses",
        workflowIds: [futureId],
        label: "照合差異の通知",
      },
    );
  }
  return result;
}
