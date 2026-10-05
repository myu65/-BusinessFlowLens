import test from "node:test";
import assert from "node:assert/strict";
import { parseSourceDocument } from "../lib/source-document-parser";
import type { SourceImage } from "../lib/source-document";
import { PDF_RENDER_VERSION, needsSourceRendering, validateDocumentItems } from "../lib/source-document";
import { replaceSourceRendition } from "../lib/source-rendition";
import { japaneseGlyphPDF, assertJapaneseGlyphImage } from "./pdf-glyph-fixture.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceUnits } from "../components/DocumentInput";

process.env.DISABLE_SYSTEM_FONTS_LOAD = "1";
test("an unembedded Japanese CID character remains a real glyph without OS fonts", async () => {
  const images: SourceImage[] = [];
  const doc = await parseSourceDocument("glyph.pdf", japaneseGlyphPDF(), { onImage: image => images.push(image) });
  assert.equal(doc.units[0].text, "一");
  assert.equal(doc.rendering?.version, PDF_RENDER_VERSION);
  assert.equal(images.length, 1);
  await assertJapaneseGlyphImage(images[0].bytes);
});

test("replacing an old PDF rendition archives its interpretations while keeping the original identity", async () => {
  const parsed = await parseSourceDocument("glyph.pdf", japaneseGlyphPDF(), { onImage: () => {} });
  const previous = structuredClone(parsed);
  previous.id = "original";previous.createdAt = "2026-10-01T00:00:00Z";
  previous.rendering = { status: "ready" };
  previous.analysis = { method: "ai", provider: "mock", model: "old-model", completedAt: previous.createdAt };
  previous.units[0].visualReading = { ...previous.analysis, description: "以前の画像で読み取った内容", uncertainties: ["文字が見えない"] };
  previous.workItems = [{ id: "work-1", title: "以前の仕事の候補", unitIds: ["page-1"], contextUnitIds: [], scope: "current", site: "", note: "要確認" }];
  const original = JSON.stringify(previous);
  const refreshed = replaceSourceRendition(previous, parsed, { state: "active", generation: 1, changedAt: "2026-10-06T00:00:00Z" });
  assert.equal(refreshed.id, previous.id);assert.equal(refreshed.sha256, previous.sha256);
  assert.equal(refreshed.createdAt, previous.createdAt);
  assert.equal(refreshed.analysis, undefined);assert.equal(refreshed.workItems, undefined);
  assert.equal(refreshed.units[0].visualReading, undefined);
  assert.equal(refreshed.analysisHistory?.[0].workItems?.[0].id, "work-1");
  assert.equal(refreshed.analysisHistory?.[0].units[0].visualReading.description, previous.units[0].visualReading.description);
  const html=renderToStaticMarkup(React.createElement(SourceUnits,{document:refreshed,projectId:"isolated"}));
  assert.match(html,/このページはまだAIが読んでいません/);
  assert.match(html,/ページを作り直す前の読取り/);
  assert.match(html,/以前の画像で読み取った内容/);
  assert.ok(needsSourceRendering(previous));assert.ok(!needsSourceRendering(refreshed));
  assert.ok(!needsSourceRendering({ ...previous, format: "docx" }), "an existing Office rendition stays usable when Cloud cannot convert Office files");
  const [nextItem] = validateDocumentItems(refreshed, previous.workItems);
  assert.notEqual(nextItem.id, "work-1", "a new interpretation cannot impersonate a previously saved item by list position");
  assert.equal(JSON.stringify(previous), original);
});
