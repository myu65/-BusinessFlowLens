import type { ExtractionReview, WorkBoundary } from "./graph";

export const boundaryVisibility = { visible: "進め方が分かっている", partial: "分かるのは一部", unavailable: "内部の進め方は見えない", unknown: "見える範囲は未確認" };
export const boundaryScope = { internal: "社内", external: "社外", unknown: "社内・社外は未確認" };
export function workBoundaryText(b?: WorkBoundary): string {
  return b ? `${boundaryScope[b.scope]}${b.party ? ` · ${b.party}` : ""} / ${boundaryVisibility[b.visibility]} / 渡す：${b.incoming.join("、") || "未確認"} / 戻る：${b.outgoing.join("、") || "未確認"} / 見えていない点：${b.unknowns.join("、") || "未登録"}` : "工程の範囲は未登録";
}
const key = (name: string) => name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export function normalizeWorkBoundary(value: unknown): WorkBoundary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const b = value as Partial<WorkBoundary>;
  if (!["internal", "external", "unknown"].includes(b.scope ?? "") || !["visible", "partial", "unavailable", "unknown"].includes(b.visibility ?? "")) return undefined;
  const list = (items: unknown) => Array.isArray(items) ? [...new Set(items.filter((s): s is string => typeof s === "string" && !!s.trim()).map(s => s.trim().slice(0, 700)))].slice(0, 12) : [];
  return { scope: b.scope!, visibility: b.visibility!, party: typeof b.party === "string" ? b.party.trim().slice(0, 200) : "",
    incoming: list(b.incoming), outgoing: list(b.outgoing), unknowns: list(b.unknowns),
    certainty: ["confirmed", "inferred", "unknown"].includes(b.certainty ?? "") ? b.certainty! : "unknown",
    evidence: typeof b.evidence === "string" ? b.evidence : "" };
}

/** Exact organizational identities cannot become system endpoints. Named vendor portals remain distinct tools. */
export function separateWorkParties<T extends ExtractionReview>(review: T): T {
  const parties = new Set(review.steps.flatMap(s => s.boundary?.scope === "external" && s.boundary.party ? [key(s.boundary.party)] : []));
  if (!review.steps.some(s => s.boundary?.scope === "external")) return review;
  const removed = new Set<string>();
  const tool = (name: string) => { if (!parties.has(key(name))) return true; removed.add(name); return false; };
  const steps = review.steps.map(s => {
    const b = s.boundary, data = [...s.data];
    // Project the declared boundary exchanges onto the same information graph.
    // A human's explicit edit of the data list wins over this projection.
    if (b?.scope === "external" && !s.humanEdits?.some(e => e.field === "data")) {
      for (const [names, operation] of [[b.incoming, "receive"], [b.outgoing, "send"]] as const)
        for (const name of names)
          if (!data.some(d => key(d.name) === key(name) && d.operation === operation)) data.push({ name, operation, evidence: b.evidence });
    }
    return { ...s, data, certainty: b?.scope === "external" && b.certainty !== "confirmed" ? "inferred" as const : s.certainty, systems: s.systems.filter(t => tool(t.name)),
    executingSystem: s.executingSystem && !tool(s.executingSystem) ? null : s.executingSystem,
    technicalDetails: s.technicalDetails?.filter(t => tool(t.system)) };
  });
  const dataFlows = review.dataFlows.filter(f => { const from = tool(f.sourceSystem), to = tool(f.targetSystem); return from && to; });
  const systemProfiles = review.systemProfiles?.filter(p => tool(p.name));
  const systemDependencies = review.systemDependencies?.filter(d => { const from = tool(d.system), to = tool(d.prerequisite); return from && to; });
  return { ...review, steps, dataFlows, systemProfiles, systemDependencies,
    warnings: [...review.warnings, ...[...removed].map(p => `「${p}」は社外の相手として扱います。相手名を道具とした候補・システム間連携は採用しませんでした。社外の工程と受渡し情報を確認してください。`)] };
}
