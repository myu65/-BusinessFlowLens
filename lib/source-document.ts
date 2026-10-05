/** Original document evidence is separate from business entities and AI interpretations. */
export type SourceCell = { address: string; sourceAddress: string; text: string };
export type SourceImage = { unitId: string; bytes: Uint8Array; mimeType: "image/jpeg"; width: number; height: number };
/** Logical evidence identity, independent of SQLite BLOBs or a future object stage. */
export type SourceReference = { documentId: string; unitId: string };
export type WorkflowSourceImage = SourceImage & SourceReference & { location: string };
export type VisualReading = {
  description: string;
  uncertainties: string[];
  method: "ai";
  provider: string;
  model: string | null;
  completedAt: string;
};
export type DocumentFinding = {
  kind: "duplicate" | "conflict" | "scope_difference" | "unknown";
  unitIds: string[];
  description: string;
};
export type SourceUnit = {
  id: string;
  location: string;
  text: string;
  sheet?: string;
  row?: number;
  page?: number;
  cells?: SourceCell[];
  image?: { width: number; height: number; mimeType: "image/jpeg" };
  visualReading?: VisualReading;
};
export type SourceDocument = {
  id: string;
  name: string;
  format: "xlsx" | "pdf" | "docx" | "pptx" | "png" | "jpeg" | "webp";
  sha256: string;
  byteSize: number;
  createdAt: string;
  units: SourceUnit[];
  warnings: string[];
  workItems?: DocumentWorkItem[];
  findings?: DocumentFinding[];
  rendering?: { status: "pending" | "ready" | "unavailable"; message?: string };
  lifecycle?: { state: "active" | "withdrawn"; generation: number; changedAt: string };
  analysis?: { method: "ai"; provider: string; model: string | null; completedAt: string };
};
export type DocumentWorkItem = {
  id: string;
  title: string;
  scope: "current" | "future" | "alternative";
  site: string;
  unitIds: string[];
  contextUnitIds: string[];
  note: string;
};
export type DocumentEvidence = {
  documentId: string;
  documentName: string;
  sha256: string;
  itemId: string;
  unitIds: string[];
};
export const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_MAX_UNITS = 700;
export const DOCUMENT_MAX_CHARACTERS = 90_000;
export function documentWorkName(item: DocumentWorkItem): string {
  return item.title;
}
export function matchingSourceUnits(document: SourceDocument, unitIds: string[], quote: string): SourceUnit[] {
  const units=document.units.filter(unit=>unitIds.includes(unit.id));
  const occurrences=new Map<string,number>();
  for(const unit of units) for(const value of new Set(unit.cells?.map(cell=>cell.text.trim())??[])) occurrences.set(value,(occurrences.get(value)??0)+1);
  if(quote.trim().length<8)return [];
  return units.map(unit=>({unit,score:unit.cells?Math.max(0,...unit.cells.map(cell=>{
    const value=cell.text.trim();
    return value.length>=8&&occurrences.get(value)===1&&(quote.includes(value)||value.includes(quote))?Math.min(quote.length,value.length):0;
  })):unit.text.includes(quote)||unit.visualReading?.description.includes(quote)?quote.length:0})).filter(match=>match.score>0).sort((a,b)=>b.score-a.score).map(match=>match.unit);
}

export function documentWorkSource(document: SourceDocument, item: DocumentWorkItem): string {
  const ids = new Set([...item.contextUnitIds, ...item.unitIds]);
  const source = document.units.filter(unit => ids.has(unit.id));
  return [
    `資料「${document.name}」から読む仕事：${item.title}`,
    `読み取り範囲の候補（AIの推定・要確認）：${item.scope === "future" ? "将来案" : item.scope === "alternative" ? "代替案" : "現在"}${item.site ? ` / ${item.site}` : ""}`,
    "以下は元資料の記載。空欄、未確認、提案、対象工場を保つ。表の順序だけでは、別業務を接続しない。",
    ...source.map(unit => [
      `[${unit.location}]\n${unit.text || "[抽出できる文字なし・下の画像読取りを要確認]"}`,
      ...(unit.visualReading ? [visualSourceBlock(unit.id, [unit.visualReading.description,
        ...unit.visualReading.uncertainties.map(question => `画像で確認できないこと：${question}`)].join("\n"))] : []),
    ].join("\n\n")),
    ...(document.findings ?? []).filter(finding => finding.unitIds.some(id => ids.has(id))).map((finding,i) =>
      visualSourceBlock(`finding-${i+1}`, `資料の照合：${finding.description} / 元の箇所：${finding.unitIds.map(id => document.units.find(u => u.id === id)?.location ?? id).join("、")}`)),
  ].join("\n\n");
}

/** Clearly delimited interpretation cannot become a literal source quote. */
export function visualSourceBlock(unitId: string, description: string): string {
  return `[AI画像解釈 ${unitId}・推定・要確認]\n${description.replace(/\[\/AI画像解釈\]/g, "")}\n[/AI画像解釈]`;
}
export function splitVisualSource(source: string): { literal: string; interpretations: string[] } {
  const interpretations: string[] = [];
  const literal = source.replace(/\[AI画像解釈 [^\]\n]+\]\s*([\s\S]*?)\[\/AI画像解釈\]/g, (_, text: string) => {
    interpretations.push(text); return "";
  });
  return { literal, interpretations };
}
export function validateDocumentFindings(document: SourceDocument, raw: unknown): DocumentFinding[] {
  if (!Array.isArray(raw) || raw.length > 30) throw new Error("資料の照合結果を読み取れませんでした。");
  const valid = new Set(document.units.map(unit => unit.id));
  return raw.map(value => {
    const finding = value as Partial<DocumentFinding> | null;
    if (!finding || !["duplicate", "conflict", "scope_difference", "unknown"].includes(finding.kind ?? "") ||
      typeof finding.description !== "string" || !finding.description.trim() || finding.description.length > 1000 ||
      !Array.isArray(finding.unitIds) || !finding.unitIds.length || finding.unitIds.some(id => !valid.has(id)) ||
      (finding.kind !== "unknown" && new Set(finding.unitIds).size < 2)) throw new Error("AIの照合結果を元資料で確認できませんでした。再試行できます。");
    return { kind: finding.kind!, description: finding.description.trim(), unitIds: [...new Set(finding.unitIds)] };
  });
}

/** A model can select existing evidence, never invent cell/page IDs. */
export function validateDocumentItems(document: SourceDocument, raw: unknown): DocumentWorkItem[] {
  if (!Array.isArray(raw) || raw.length > 40) throw new Error("資料内の仕事を読み取れませんでした。もう一度整理できます。");
  const valid = new Set(document.units.map(unit => unit.id));
  return raw.map((value, i) => {
    if (!value || typeof value !== "object") throw new Error("資料内の仕事の応答が不正です。");
    const item = value as Partial<DocumentWorkItem>;
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 100 || !Array.isArray(item.unitIds) || !item.unitIds.length || !Array.isArray(item.contextUnitIds) ||
        [...item.unitIds, ...item.contextUnitIds].some(id => typeof id !== "string" || !valid.has(id)) ||
        !["current", "future", "alternative"].includes(item.scope ?? "")) throw new Error("AIが元資料にない参照を返しました。もう一度整理できます。");
    const proposedSite = typeof item.site === "string" ? item.site.trim().slice(0,100) : "";
    const selectedIds = new Set([...item.unitIds, ...item.contextUnitIds]);
    // A site label must be written in this item's source, rather than invented
    // from its title, business ID, or a site in another unrelated workflow.
    const literalSite = proposedSite && document.units.some(unit => selectedIds.has(unit.id) && unit.text.includes(proposedSite));
    const visualSite = proposedSite && document.units.some(unit => selectedIds.has(unit.id) && unit.visualReading?.description.includes(proposedSite));
    const site = literalSite || visualSite ? proposedSite : "";
    const note = typeof item.note === "string" ? item.note.slice(0,500) : "";
    const visualSiteNote="工場の区分は画像の読取りに基づく候補です。";
    const title=item.title.trim(),prefix=site?[`${site}：`,`${site}:`].find(value=>title.startsWith(value)):undefined;
    return { id: `work-${i + 1}`, title: prefix?title.slice(prefix.length).trim()||title:title, scope: item.scope!, site, unitIds: [...new Set(item.unitIds)], contextUnitIds: [...new Set(item.contextUnitIds)],
      note: proposedSite && !site ? `${note} 対象「${proposedSite}」は原資料で確認できないため、工場の区分には使っていません。` : visualSite && !literalSite && !note.includes(visualSiteNote) ? `${note} ${visualSiteNote}` : note };
  });
}
