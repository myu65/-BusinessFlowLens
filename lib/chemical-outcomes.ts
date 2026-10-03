import { canonicalNodeId, type LensGraph, type LensNode } from "./graph";

// Only used while constructing a NEW synthetic company. Never enriches stored
// user graphs or claims these fictional design rules are extracted facts.
export function enrichChemicalOutcomes(graph: LensGraph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const inputByProcess = new Map<string, string[]>();
  for (const e of graph.edges)
    if (e.relation === "reads") {
      const p = byId.get(e.source)?.kind === "process" ? e.source : e.target,
        d = byId.get(e.source)?.kind === "data" ? e.source : e.target;
      const list = inputByProcess.get(p) ?? [];
      list.push(byId.get(d)?.label ?? d);
      inputByProcess.set(p, list);
    }
  for (const n of graph.nodes.filter((n) => n.kind === "process")) {
    const transfer = n.label.includes("転記"),
      excel = n.label.includes("Excelへ出力"),
      teams = n.label.includes("Teams"),
      sharepoint = n.label.includes("SharePoint"),
      analytic = n.label.includes("分析基盤");
    n.meaning = {
      purpose: transfer
        ? "工場で承認した調整値を基幹の正式記録へ戻す"
        : excel
          ? "基幹だけでは扱えない工場固有の設備・納期制約を調整する"
          : teams
            ? "担当部署間で例外の処置と判断責任を共有する"
            : sharepoint
              ? "共同編集の結果と承認済みの版を残す"
              : analytic
                ? "各活動の実績を同じ定義で分析する"
                : "製品・ロット・案件を次の担当へつなぐ",
      basis: (inputByProcess.get(n.id) ?? []).join("、"),
      result: transfer
        ? "承認済み調整値が正式記録へ反映される"
        : excel
          ? "工場固有の差異と調整案が明らかになる"
          : teams
            ? "例外の処置と担当が決まる"
            : sharepoint
              ? "承認済みの記録と版が確定する"
              : analytic
                ? "分析用の実績が更新される"
                : "",
      next: transfer
        ? "後工程が確定値で処理する"
        : excel
          ? "関係部署が例外を判断する"
          : teams
            ? "承認結果を保管する"
            : sharepoint
              ? "承認済み値を業務システムへ反映する"
              : analytic
                ? "活動別の実績を分析する"
                : "",
      condition: "",
      halt: false,
      certainty: "confirmed",
      evidence: "新規の架空メーカーサンプルの運用設計",
    };
  }
  const addEdge = (
    source: string,
    target: string,
    relation: "next" | "reads" | "writes",
    workflowId: string,
    label?: string,
  ) =>
    graph.edges.push({
      id: `outcome:${source}:${relation}:${target}`,
      source,
      target,
      relation,
      label,
      workflowIds: [workflowId],
      status: "confirmed",
      evidence: "架空の受注シナリオで定義した処理と条件",
    });
  for (let vi = 0; vi < 5; vi++) {
    const workflowId = `chemical-1-0-${vi}`,
      w = graph.workflows.find((w) => w.id === workflowId)!;
    const steps = graph.nodes
      .filter((n) => n.workflowId === workflowId)
      .sort((a, b) => a.stepOrder! - b.stepOrder!);
    const outputIds = new Map<string, string>();
    const cases = [
      [
        "価格条件",
        "確定受注価格",
        "顧客・製品・契約期間・数量別の価格条件",
        "受注価格と値引条件が確定する",
        "確定金額を使って与信判定する",
      ],
      [
        "与信チェック",
        "与信判定（許可・保留）",
        "確定受注金額、顧客与信限度、未回収債権残高",
        "限度内は許可、限度超過は受注を保留する",
        "許可時だけ在庫と納期の判定へ進む",
      ],
      [
        "ATPチェック",
        "出荷可否・不足数量",
        "利用可能在庫、入荷予定、製造予定と要求納期",
        "約束できる数量・納期と不足数量が分かる",
        "在庫充足なら引当、不足なら製造・納期を調整する",
      ],
      [
        "MRPへ",
        "製造必要量・原料所要量",
        "不足数量、部品表、原料在庫、調達リードタイム",
        "製造必要量と不足原料が算出される",
        "需給調整・製造計画・購買依頼を動かす",
      ],
    ];
    for (const [pattern, label, basis, result, next] of cases) {
      const s = steps.find((s) => s.label.includes(pattern));
      if (!s) continue;
      s.meaning = {
        purpose: "受注を実行可能な数量・納期・計画へつなぐ",
        basis,
        result,
        next,
        condition: "",
        halt: false,
        certainty: "confirmed",
        evidence: `架空設計：${basis}を根拠に${result}。${next}。`,
      };
      const id = canonicalNodeId(`data:outcome-${workflowId}-${pattern}`);
      outputIds.set(pattern, id);
      graph.nodes.push({
        id,
        canonicalKey: `data:outcome-${workflowId}-${pattern}`,
        kind: "data",
        label: `${w.landscape!.productLabel} ${label}`,
        description: result,
        status: "confirmed",
        evidence: s.meaning.evidence,
      });
      graph.edges = graph.edges.filter(
        (e) => !(e.source === s.id && e.relation === "writes"),
      );
      addEdge(s.id, id, "writes", workflowId, result);
      const successor = steps[steps.indexOf(s) + 1];
      if (successor)
        addEdge(successor.id, id, "reads", workflowId, "前の判断結果を使う");
    }
    const credit = steps.find((s) => s.label.includes("与信チェック"))!,
      atp = steps.find((s) => s.label.includes("ATPチェック"))!,
      mrp = steps.find((s) => s.label.includes("MRPへ"))!,
      stock = steps.find((s) => s.label.includes("在庫・所要量"))!;
    const extra = (
      key: string,
      label: string,
      department: string,
      result: string,
      next: string,
      halt: boolean,
    ): LensNode => {
      const canonicalKey = `process:${workflowId}:${key}`;
      const n: LensNode = {
        id: canonicalNodeId(canonicalKey),
        canonicalKey,
        kind: "process",
        workflowId,
        label,
        action: label,
        description: result,
        status: "confirmed",
        actor: `${department}担当者`,
        department,
        executionMode: "manual",
        stepOrder:
          steps.length +
          1 +
          graph.nodes.filter(
            (n) =>
              n.workflowId === workflowId &&
              n.canonicalKey.includes(":exception-"),
          ).length,
        evidence: "架空の与信・在庫例外シナリオ",
        meaning: {
          purpose: "例外を解消するまで確定処理を止める",
          basis: key.includes("credit")
            ? "与信限度と保留された受注"
            : "不足数量と要求納期",
          result,
          next,
          condition: "",
          halt,
          certainty: "confirmed",
          evidence: "架空設計：担当者が解除・製造必要量を確認する",
        },
      };
      graph.nodes.push(n);
      return n;
    };
    const hold = extra(
      "exception-credit-hold",
      "与信超過の受注を保留し、経理へ解除判断を依頼する",
      "営業部",
      "受注は保留状態になる",
      "経理が与信条件と回収見込みを審査する",
      true,
    );
    const release = extra(
      "exception-credit-release",
      "経理担当が与信保留の解除可否を判断する",
      "経理部",
      "解除許可または保留継続が決まる",
      "解除許可なら与信判定を再実行する",
      false,
    );
    const shortage = extra(
      "exception-stock-hold",
      "在庫不足の納期回答を保留して生産計画へ渡す",
      "受注管理部",
      "納期未確定と不足数量が共有される",
      "生産計画担当が製造・納期を調整する",
      true,
    );
    const adjust = extra(
      "exception-stock-adjust",
      "生産計画担当が製造必要量と納期変更を確認する",
      "生産計画部",
      "製造を計画する必要量が決まる",
      "MRPで原料所要量を計算する",
      false,
    );
    const link = graph.edges.find(
      (e) =>
        e.source === credit.id && e.target === atp.id && e.relation === "next",
    )!;
    link.label = "与信限度内 / 許可";
    link.status = "confirmed";
    link.evidence = "架空設計：与信許可時だけATPへ進む";
    graph.edges = graph.edges.filter(
      (e) =>
        !(e.source === atp.id && e.target === mrp.id && e.relation === "next"),
    );
    addEdge(credit.id, hold.id, "next", workflowId, "与信限度超過");
    addEdge(
      hold.id,
      release.id,
      "next",
      workflowId,
      "経理が解除判断を受け付けた時",
    );
    addEdge(
      release.id,
      credit.id,
      "next",
      workflowId,
      "解除許可 / 条件を更新して再判定",
    );
    addEdge(release.id, hold.id, "next", workflowId, "解除不可 / 保留を継続");
    addEdge(atp.id, stock.id, "next", workflowId, "在庫・納期を約束できる");
    addEdge(atp.id, shortage.id, "next", workflowId, "在庫不足 / 納期未確定");
    addEdge(
      shortage.id,
      adjust.id,
      "next",
      workflowId,
      "生産計画担当が調整を受け付ける",
    );
    addEdge(adjust.id, mrp.id, "next", workflowId, "製造が必要と承認された");
    for (const p of [hold, release])
      addEdge(p.id, outputIds.get("与信チェック")!, "reads", workflowId);
    for (const p of [shortage, adjust])
      addEdge(p.id, outputIds.get("ATPチェック")!, "reads", workflowId);
    const h = graph.knowledge!.handoffs!.find(
      (h) =>
        h.sourceWorkflowId === workflowId &&
        h.targetWorkflowId === `chemical-3-0-${vi}`,
    )!;
    h.sourceProcessId = mrp.id;
    h.dataIds = [outputIds.get("MRPへ")!];
    h.description = "不足から確定した製造必要量を需給調整へ渡す";
    h.status = "confirmed";
    if (h.targetProcessId)
      addEdge(
        h.targetProcessId,
        h.dataIds[0],
        "reads",
        h.targetWorkflowId,
        "製造必要量を受け取る",
      );
    const demandId = h.targetWorkflowId;
    const demandSteps = graph.nodes
      .filter((n) => n.workflowId === demandId)
      .sort((a, b) => a.stepOrder! - b.stepOrder!);
    const demandCases = [
      [
        "不足と販売予測を受け取る",
        "販売予測、受注からの製造必要量、現在在庫",
        "受注による不足数量が計画対象になる",
        "製品別の需要・供給を集計する",
      ],
      [
        "需要と供給を集計する",
        "販売予測、製造必要量、利用可能在庫と設備能力",
        "製品別の供給不足と余剰が分かる",
        "営業と製造可能日・納期を調整する",
      ],
      [
        "供給不足を調整する",
        "供給不足、設備制約、顧客の希望納期",
        "工場別の製造数量と納期の調整案が決まる",
        "計画責任者が生産配分を承認する",
      ],
      [
        "生産配分を承認する",
        "営業と工場が合意した調整案",
        "承認済み生産配分が確定する",
        "月次需給計画を確定する",
      ],
      [
        "月次需給計画を確定する",
        "承認済み生産配分と製造可能日",
        "製造数量と実施日を含む月次需給計画が確定する",
        "MRP確認で原料不足と購買必要量を確認する",
      ],
    ];
    let priorData = h.dataIds[0];
    for (let i = 0; i < demandCases.length; i++) {
      const p = demandSteps[i];
      const [label, basis, result, next] = demandCases[i];
      p.meaning = {
        purpose: "不足を実行可能な工場・数量・日付の計画へ変える",
        basis,
        result,
        next,
        condition: "",
        halt: false,
        certainty: "confirmed",
        evidence: `架空設計：${basis}から${result}。${next}。`,
      };
      addEdge(
        p.id,
        priorData,
        "reads",
        demandId,
        "前の作業で決まった情報を使う",
      );
      const key = `data:demand-outcome-${demandId}-${i}`,
        id = canonicalNodeId(key);
      graph.nodes.push({
        id,
        canonicalKey: key,
        kind: "data",
        label: `${w.landscape!.productLabel} ${label}結果`,
        description: result,
        status: "confirmed",
        evidence: p.meaning.evidence,
      });
      graph.edges = graph.edges.filter(
        (e) => !(e.source === p.id && e.relation === "writes"),
      );
      addEdge(p.id, id, "writes", demandId, result);
      priorData = id;
    }
    const demandHandoff = graph.knowledge!.handoffs!.find(
      (link) =>
        link.sourceWorkflowId === demandId &&
        link.targetWorkflowId === `chemical-3-1-${vi}`,
    );
    if (demandHandoff) {
      demandHandoff.sourceProcessId = demandSteps[4].id;
      demandHandoff.dataIds = [priorData];
      demandHandoff.description = "承認された製造数量・実施日をMRP確認へ渡す";
      demandHandoff.evidence =
        "架空設計：月次需給計画の確定後に原料所要量を確認する";
      demandHandoff.status = "confirmed";
      if (demandHandoff.targetProcessId)
        addEdge(
          demandHandoff.targetProcessId,
          priorData,
          "reads",
          demandHandoff.targetWorkflowId,
          "確定した製造数量と実施日を受け取る",
        );
    }
  }
}
