import type { BusinessFlowRepository } from "../storage/repository";
import type { DocumentEvidence, WorkflowSourceImage, SourceReference } from "../source-document";
import { needsSourceRendering, visualSourceBlock } from "../source-document";
import type { ExtractionReview } from "../graph";

/** Load project-scoped originals on the server; clients send identities, never image bytes or paths. */
export async function workflowSourceImages(repo: BusinessFlowRepository, projectId: string, evidence: DocumentEvidence[]): Promise<WorkflowSourceImage[]> {
  if (!projectId || evidence.length > 12) throw new Error("元資料の参照を確認できませんでした。");
  const images: WorkflowSourceImage[] = [], seen = new Set<string>();
  for (const ref of evidence) {
    const record = await repo.getSourceDocument(projectId, ref.documentId);
    if (!record || record.document.sha256 !== ref.sha256 || !Array.isArray(ref.unitIds) || ref.unitIds.length > 700 || ref.unitIds.some(id => !record.document.units.some(unit => unit.id === id)))
      throw new Error("元資料のページを確認できませんでした。保存されている資料を開き直してください。");
    if (record.document.format === "pdf" && needsSourceRendering(record.document))
      throw new Error("PDFのページを作り直す必要があります。元資料を開き直してください。使用を取り消した資料は、読取りを再開してから確認できます。");
    for (const unit of record.document.units.filter(unit => ref.unitIds.includes(unit.id) && unit.image)) {
      const identity = `${ref.documentId}/${unit.id}`;
      if (seen.has(identity)) continue;
      const image = await repo.getSourceImage(projectId, ref.documentId, unit.id);
      if (!image) throw new Error("元ページの画像が見つかりません。資料を開き直してください。");
      seen.add(identity);
      images.push({ ...image, documentId: ref.documentId, location: unit.location });
    }
  }
  return images;
}

/** Image descriptions remain proposals. A valid page identity is not proof of semantic accuracy. */
export function groundDiagramReferences<T extends ExtractionReview>(review: T, images: WorkflowSourceImage[]): { review: T; interpretation: string } {
  const valid = new Set(images.map(image => `${image.documentId}/${image.unitId}`));
  const snippets: string[] = [];
  const refs = (values?: SourceReference[]) => (Array.isArray(values) ? values : []).filter(value => value && valid.has(`${value.documentId}/${value.unitId}`))
    .filter((value, index, list) => list.findIndex(item => item.documentId === value.documentId && item.unitId === value.unitId) === index);
  const steps = review.steps.map(step => {
    const sourceRefs = refs(step.sourceRefs);
    if (!sourceRefs.length) return { ...step, sourceRefs: undefined };
    snippets.push(...[step.evidence, step.meaning?.evidence, step.boundary?.evidence, ...step.systems.map(s => s.evidence), ...step.data.map(d => d.evidence), ...step.technicalDetails?.map(d => d.evidence) ?? [], ...step.detailSteps?.map(d => d.evidence) ?? []].filter((text): text is string => !!text));
    return { ...step, sourceRefs, certainty: "inferred" as const,
      meaning: step.meaning ? { ...step.meaning, certainty: "inferred" as const } : undefined,
      boundary: step.boundary ? { ...step.boundary, certainty: "inferred" as const } : undefined };
  });
  const transitions = review.transitions.map(edge => {
    const sourceRefs = refs(edge.sourceRefs);
    if (!sourceRefs.length) return { ...edge, sourceRefs: undefined };
    if (edge.evidence) snippets.push(edge.evidence);
    return { ...edge, sourceRefs, certainty: "inferred" as const };
  });
  return { review: { ...review, steps, transitions }, interpretation: snippets.length ? visualSourceBlock("direct-pages", [...new Set(snippets)].join("\n")) : "" };
}

/** Disjoint arrows on contradictory pages are document variants, not verified business branches. */
export function markDiagramVariants<T extends ExtractionReview>(review: T, conflicts: SourceReference[][]): T {
  const key = (ref: SourceReference) => `${ref.documentId}/${ref.unitId}`;
  return { ...review, transitions: review.transitions.map(edge => {
    if(edge.humanEdits?.length || !edge.sourceRefs?.length)return edge;
    const own=new Set(edge.sourceRefs.map(key));
    const difference=review.transitions.some(peer=>peer.fromStepKey===edge.fromStepKey&&peer.toStepKey!==edge.toStepKey&&peer.sourceRefs?.length&&
      !peer.sourceRefs.some(ref=>own.has(key(ref)))&&conflicts.some(group=>group.some(ref=>own.has(key(ref)))&&group.some(ref=>peer.sourceRefs!.some(other=>key(other)===key(ref)))));
    return difference?{...edge,sourceVariant:"document_conflict" as const,certainty:"unknown" as const}:edge;
  }) };
}
