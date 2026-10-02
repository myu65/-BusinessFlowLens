import {
  branchWorkflowScenario,
  type LensGraph,
  type WorkflowLandscape,
} from "./graph";
import { buildOverview, type OverviewScope } from "./overview";

export const BUSINESS_DOMAINS = [
  "サプライチェーン",
  "エンジニアリングチェーン",
  "会計",
  "研究開発",
  "品質",
  "設備・保全",
];
export const emptyLandscape = (): WorkflowLandscape => ({
  domains: [],
  site: "",
  productId: "",
  productLabel: "",
  perspective: "",
  commonProcessId: "",
  processRole: "independent",
  variantNote: "",
  evidence: "",
  materialHandoffs: [],
});
export type LandscapeFilters = {
  domain: string;
  site: string;
  product: string;
  perspective: string;
  query: string;
  range: "all" | "focus" | "nearby" | "interests";
  anchorId: string;
  pinnedIds: string[];
  topic: "relations" | "product" | "common" | "material" | "data" | "business";
};
export const emptyFilters = (): LandscapeFilters => ({
  domain: "",
  site: "",
  product: "",
  perspective: "",
  query: "",
  range: "all",
  anchorId: "",
  pinnedIds: [],
  topic: "relations",
});
export type LandscapeRelation = {
  source: string;
  target: string;
  reasons: string[];
};

export function landscapeView(
  graph: LensGraph,
  scope: OverviewScope,
  filters: LandscapeFilters,
) {
  const base = buildOverview(graph, scope);
  const byPair = new Map<string, LandscapeRelation>();
  const add = (a: string, b: string, reason: string) => {
    if (
      a === b ||
      !base.workflows.some((w) => w.id === a) ||
      !base.workflows.some((w) => w.id === b)
    )
      return;
    const [source, target] = [a, b].sort();
    const key = JSON.stringify([source, target]);
    const row = byPair.get(key) ?? { source, target, reasons: [] };
    if (!row.reasons.includes(reason)) row.reasons.push(reason);
    byPair.set(key, row);
  };
  const groups = (key: "productId" | "commonProcessId", label: string) => {
    const map = new Map<string, string[]>();
    for (const w of base.workflows) {
      const value = w.landscape?.[key]?.trim();
      if (value) map.set(value, [...(map.get(value) ?? []), w.id]);
    }
    for (const [value, ids] of map)
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
          add(ids[i], ids[j], `${label}：${value}`);
  };
  groups("productId", "同じ製品");
  groups("commonProcessId", "共通業務");
  for (const row of base.data)
    for (let i = 0; i < row.workflows.length; i++)
      for (let j = i + 1; j < row.workflows.length; j++)
        add(
          row.workflows[i].id,
          row.workflows[j].id,
          `共有データ：${row.asset.label}`,
        );
  for (const w of base.workflows)
    for (const h of w.landscape?.materialHandoffs ?? [])
      add(w.id, h.targetWorkflowId, `物の受け渡し：${h.material}`);
  const relations = [...byPair.values()];
  const anchors = new Set(
    filters.range === "interests" ? filters.pinnedIds : [filters.anchorId],
  );
  const nearby = new Set(anchors);
  for (const r of relations) {
    if (anchors.has(r.source)) nearby.add(r.target);
    if (anchors.has(r.target)) nearby.add(r.source);
  }
  const matches = (actual: string | undefined, requested: string) =>
    !requested ||
    (requested === "__unclassified" ? !actual : actual === requested);
  const workflows = base.workflows.filter((w) => {
    const c = w.landscape;
    if (
      filters.domain === "__unclassified"
        ? c?.domains.length
        : filters.domain && !c?.domains.includes(filters.domain)
    )
      return false;
    if (
      !matches(c?.site, filters.site) ||
      !matches(c?.productId, filters.product) ||
      !matches(c?.perspective, filters.perspective)
    )
      return false;
    if (
      filters.query &&
      ![
        w.name,
        w.description,
        c?.productLabel,
        c?.productId,
        c?.commonProcessId,
        c?.variantNote,
        c?.site,
        ...(c?.domains ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(filters.query.toLocaleLowerCase())
    )
      return false;
    if (filters.range === "focus" && !anchors.has(w.id)) return false;
    if (["nearby", "interests"].includes(filters.range) && !nearby.has(w.id))
      return false;
    return true;
  });
  const visible = new Set(workflows.map((w) => w.id));
  const shownRelations = relations.filter(
    (r) => visible.has(r.source) && visible.has(r.target),
  );
  const boundaryRelations = relations.filter(
    (r) => visible.has(r.source) !== visible.has(r.target),
  );
  const materialFlows = base.workflows
    .flatMap((w) =>
      (w.landscape?.materialHandoffs ?? []).map((h) => ({
        ...h,
        sourceWorkflowId: w.id,
      })),
    )
    .filter(
      (h) => visible.has(h.sourceWorkflowId) || visible.has(h.targetWorkflowId),
    );
  return {
    base,
    workflows,
    relations: shownRelations,
    boundaryRelations,
    materialFlows,
    visible,
  };
}

export function validateLandscape(
  graph: LensGraph,
  workflowId: string,
  value: WorkflowLandscape,
): string | null {
  if (value.processRole !== "independent" && !value.commonProcessId.trim())
    return "共通業務IDを入力してください。";
  if (value.productLabel && !value.productId.trim())
    return "同じ製品を追うための製品IDを入力してください。";
  for (const h of value.materialHandoffs) {
    if (
      !h.material.trim() ||
      !graph.workflows.some((w) => w.id === h.targetWorkflowId)
    )
      return "物の名前と受け渡し先業務を指定してください。";
    if (
      h.targetWorkflowId === workflowId &&
      (!h.sourceLocation?.trim() ||
        !h.targetLocation?.trim() ||
        h.sourceLocation.trim() === h.targetLocation.trim())
    )
      return "同じ業務内の移動には、異なる送り元・送り先の場所を入力してください。";
    if (
      h.dataIds.some(
        (id) => !graph.nodes.some((n) => n.id === id && n.kind === "data"),
      )
    )
      return "対応データが見つかりません。選び直してください。";
    if (h.dataContinuity === "linked" && !h.dataIds.length)
      return "対応確認済みの物の流れには、対応データを選んでください。";
    if (h.dataContinuity !== "unknown" && !h.evidence.trim())
      return "対応確認・途切れ確認には根拠を入力してください。";
  }
  return null;
}

export function duplicateSiteWorkflow(
  graph: LensGraph,
  sourceId: string,
  id: string,
  name: string,
  site: string,
): LensGraph {
  const source = graph.workflows.find((w) => w.id === sourceId);
  if (!source || !name.trim() || !site.trim())
    throw new Error("業務名と拠点名を入力してください。");
  const context = source.landscape ?? emptyLandscape();
  const commonProcessId = context.commonProcessId || source.id;
  const next = branchWorkflowScenario(graph, sourceId, {
    id,
    name: name.trim(),
    description: source.description,
    scenario: source.scenario ?? "current",
    familyId: id,
    reviewContext: source.reviewContext
      ? structuredClone(source.reviewContext)
      : undefined,
    landscape: {
      ...structuredClone(context),
      commonProcessId,
      processRole: "site",
      site: site.trim(),
      variantNote: "元業務の手順を複製。拠点での実施方法は要確認。",
      evidence: `利用者が共通業務として複製：${source.name}`,
      materialHandoffs: [],
    },
  });
  return {
    ...next,
    workflows: next.workflows.map((w) =>
      w.id === sourceId
        ? {
            ...w,
            landscape: {
              ...context,
              commonProcessId,
              processRole: context.processRole === "common" ? "common" : "site",
            },
          }
        : w,
    ),
  };
}
