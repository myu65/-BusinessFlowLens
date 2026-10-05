import type { SourceDocument } from "./source-document";

/** New page images retire AI interpretations; the original and saved business edits keep their identities. */
export function replaceSourceRendition(previous: SourceDocument, parsed: SourceDocument, lifecycle = previous.lifecycle): SourceDocument {
  const readings = previous.units.flatMap(unit => unit.visualReading ? [{ id: unit.id, visualReading: unit.visualReading }] : []);
  const history = [...(previous.analysisHistory ?? [])];
  if (previous.analysis || previous.workItems?.length || previous.findings?.length || readings.length) {
    history.push({ archivedAt: new Date().toISOString(), rendering: previous.rendering, analysis: previous.analysis,
      workItems: previous.workItems, findings: previous.findings, units: readings });
  }
  const units = parsed.units.map(unit => ({ ...previous.units.find(prior => prior.id === unit.id), ...unit, visualReading: undefined }));
  return { ...previous, ...parsed, units, id: previous.id, createdAt: previous.createdAt, lifecycle, analysisHistory: history,
    analysis: undefined, workItems: undefined, findings: undefined };
}
