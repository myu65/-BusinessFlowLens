const compact = (text: string) => text.normalize("NFKC").replace(/[\s「」『』]/g, "");

// A model may abbreviate a literal quote. Expand only ordered fragments in one
// source sentence; never bridge a negation, condition, stop or unknown fact.
export function sourceEvidence(source: string, evidence: string): string | null {
  const quote = compact(evidence);
  if (!quote) return null;
  if (!/(?:…|⋯|\.{3})/.test(quote)) return compact(source).includes(quote) ? evidence : null;
  const parts = quote.split(/(?:…+|⋯+|\.{3,})/).filter(Boolean);
  if (parts.length < 2 || parts.some(part => part.length < 3) || parts.join("").length < 10) return null;
  const matches: string[] = [];
  const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
  for (const sentence of source.split(/(?<=[。！？\n])/)) {
    let normalized = "";
    const positions: Array<{ start: number; end: number }> = [];
    for (const { segment, index } of segmenter.segment(sentence)) {
      const clean = compact(segment);
      normalized += clean;
      for (let i = 0; i < clean.length; i++) positions.push({ start: index, end: index + segment.length });
    }
    let cursor = 0, start = -1, valid = true;
    for (const [i, part] of parts.entries()) {
      const at = normalized.indexOf(part, cursor);
      if (at < 0) { valid = false; break; }
      const gap = normalized.slice(cursor, at);
      if (i && (gap.length > 150 || /不明|分から|未確認|未定|ない|とは限ら|ただし|場合|なら|とき|保留|停止|不可|否認/.test(gap))) {
        valid = false; break;
      }
      if (!i) start = at;
      cursor = at + part.length;
    }
    if (valid && start >= 0) matches.push(sentence.slice(positions[start].start, positions[cursor - 1].end));
  }
  // The same statement may be repeated in a follow-up with different commas
  // or spacing. Keep its literal first quote, but not a different subject.
  const unique = new Map<string, string>();
  matches.forEach(match => {
    const key = compact(match).replace(/[、,]/g, "");
    if (!unique.has(key)) unique.set(key, match);
  });
  return unique.size === 1 ? [...unique.values()][0] : null;
}
