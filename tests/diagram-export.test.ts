import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { diagramDrawio, diagramFilename, diagramPathPoints, validateDiagramExport, workflowDiagramExport, relationshipDiagramExport } from '../lib/diagram-export';
import { renderDiagramExport } from '../lib/diagram-renderer';
import { POST } from '../app/api/diagram-export/route';
import { diagramReview, diagramStep } from './fixtures/diagram-export';
import { createChemicalCompany } from '../lib/chemical-company';
import { knowledgeIndex } from '../lib/knowledge';
import { activityRelationships, overviewWindow } from '../lib/relationship-overview';
import { InputFlowCanvas } from '../components/InputFlowCanvas';

const model = () => workflowDiagramExport(diagramReview, 0, { title: '検査から出荷可否の判定', state: '保存前の候補', workflowId: 'quality', scenario: 'current' });
const unescape = (text: string) => text.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('draft exports preserve source facts, human corrections, data changes, returns and uncertainty independently of geometry', () => {
  const before = JSON.stringify(diagramReview), output = model();
  validateDiagramExport(output);
  assert.match(output.scope.label, /^現在・/); assert.equal(output.scope.state, '保存前の候補');
  assert.deepEqual(output.semantic.nodes.find(node => node.id === 'check')!.attributes, diagramReview.steps[1]);
  assert.deepEqual(output.semantic.nodes.find(node => node.id === 'approve')!.attributes, diagramReview.steps[2]);
  assert.deepEqual((output.semantic.context as { dataFlows: unknown }).dataFlows, diagramReview.dataFlows);
  assert.equal(output.view.nodes.find(node => node.id === 'hold')!.uncertain, true);
  assert.equal(output.view.nodes.find(node => node.id === 'hold')!.tone, 'hold');
  assert.equal(output.view.connections.filter(edge => edge.tone === 'return').length, 1);
  assert.match(output.annotations.join('\n'), /再調整後に再判定/);
  assert.equal(output.semantic.connections.length, diagramReview.transitions.length);
  const xml = diagramDrawio(output), embedded = JSON.parse(unescape(xml.match(/bflModel="([^"]+)"/)![1]));
  assert.deepEqual(embedded, JSON.parse(JSON.stringify(output)));
  assert.equal((xml.match(/ edge="1"/g) ?? []).length, 6);
  assert.equal((xml.match(/source="node-/g) ?? []).length, 6, 'native edges retain movable endpoints');
  assert.equal(JSON.stringify(diagramReview), before);
  const html = renderToStaticMarkup(createElement(InputFlowCanvas, { review: diagramReview, selected: diagramReview.steps[0], page: 0, onPage: () => {}, choose: () => {}, exportTitle: output.title, exportState: output.scope.state }));
  assert.match(html, /この図を出力/); assert.match(html, /保存前の候補/); assert.match(html, /drawio.pngを保存/);
});

test('self loops and page boundaries keep conditions and off-page references without inventing a linear path', () => {
  const review = structuredClone(diagramReview);
  review.transitions.push({ fromStepKey: 'check', toStepKey: 'check', condition: '応答がない場合に再照合する', evidence: '応答がない場合に再照合する', certainty: 'inferred' });
  review.steps.push(diagramStep('next-page', 7, '倉庫担当が出荷を手配する'));
  review.transitions.push({ fromStepKey: 'ship', toStepKey: 'next-page', condition: '出荷可を受け取る', evidence: '出荷可を受け取って手配する', certainty: 'confirmed' });
  const output = workflowDiagramExport(review, 0, { title: '出荷の確認' });
  assert.equal(output.view.nodes.length, 6);
  assert.equal(output.semantic.nodes.find(node => node.id === 'next-page')!.offPage, true);
  assert.match(output.annotations.join('\n'), /別のページとの接続.*出荷可を受け取る/);
  const self = output.semantic.connections.find(edge => edge.source === 'check' && edge.target === 'check')!;
  const shape = output.view.connections.find(edge => edge.id === self.id)!;
  assert.equal(shape.tone, 'return'); assert.equal(shape.uncertain, true); assert.ok(diagramPathPoints(shape.path).length > 3);
  assert.match(output.annotations.join('\n'), /応答がない場合に再照合する/);
  const xml = diagramDrawio(output);
  assert.match(xml, /source="node-1" target="node-1"/); assert.match(xml, /orthogonalLoop=0/);
  assert.doesNotMatch(xml, /startEvent|endEvent|exclusiveGateway/);
  const secondPage = workflowDiagramExport(review, 1, { title: '出荷の確認' });
  for (const edge of secondPage.semantic.connections) {
    const first = output.semantic.connections.find(item => item.source === edge.source && item.target === edge.target);
    if (first) assert.equal(edge.id, first.id, 'the same transition keeps its key across display pages');
  }
});

test('structural questions and excluded evidence remain available without claiming the business explanation is complete', () => {
  const review = structuredClone(diagramReview);
  review.transitions[1].condition = null;
  review.transitions.push({ fromStepKey: 'hold', toStepKey: 'unregistered', condition: null, evidence: '保留後の再開先は不明', certainty: 'unknown' });
  review.excludedSteps = [diagramStep('excluded', 8, '業務の行為ではないメモ')];
  review.questions = [{ question: '保留を解除する担当は誰ですか？', reason: '原文に担当の記載がない', target: 'owner' }];
  const output = workflowDiagramExport(review, 0, { title: '確認途中の検査業務' });
  validateDiagramExport(output);
  assert.ok(output.checks.some(check => check.code === 'branch-condition'));
  assert.ok(output.checks.some(check => check.code === 'missing-target'));
  assert.equal(output.view.connections.length, diagramReview.transitions.length, 'an unregistered endpoint is recorded, never drawn as invented work');
  const context = output.semantic.context as { questions: unknown; excludedSteps: unknown };
  assert.deepEqual(context.questions, review.questions); assert.deepEqual(context.excludedSteps, review.excludedSteps);
  assert.doesNotMatch(diagramDrawio(output), /すべて確認済み|exclusiveGateway/);
});

test('303-workflow overview exports only the displayed relation page and preserves original relation evidence', () => {
  const graph = createChemicalCompany(), before = JSON.stringify(graph), view = knowledgeIndex(graph, 'current');
  assert.ok(graph.workflows.length >= 300);
  const ids = view.rows.map(row => row.workflow.id), relations = activityRelationships(graph, ids);
  const nodes = view.activities.map(a => ({ id: a.id, label: a.name, subtitle: `${a.rows.length}業務` }));
  const window = overviewWindow(nodes, relations, undefined, 0, 8, { relationPage: 1, relationLimit: 6 });
  const output = relationshipDiagramExport({ ...window, title: '会社の活動とつながり', scopeLabel: `現在・対象${ids.length}業務`, graph });
  validateDiagramExport(output);
  assert.ok(output.view.nodes.length <= 8); assert.ok(output.view.connections.length <= 6);
  assert.deepEqual(output.semantic.connections.map(edge => edge.id), window.edges.map(edge => edge.id));
  for (const edge of output.semantic.connections) assert.deepEqual(edge.attributes, window.edges.find(item => item.id === edge.id));
  assert.ok(output.semantic.references!.length > 0);
  assert.ok(output.semantic.references!.filter(ref => ref.type === 'workflow').every(ref => ids.includes(ref.id)));
  assert.equal(JSON.stringify(graph), before);
});

test('a descriptive group note is not misrepresented as uncertainty, while an unconfirmed group stays dashed', () => {
  const output = relationshipDiagramExport({ title: '道具のまとまり', nodes: [
    { id: 'known', label: 'データ・分析・連携', subtitle: '6道具', note: 'Snowflake・ETLなど', certainty: 'confirmed' },
    { id: 'unknown', label: '分類未登録', subtitle: '1道具', certainty: 'unknown' },
  ], edges: [] });
  assert.equal(output.view.nodes[0].uncertain, false); assert.equal(output.view.nodes[1].uncertain, true);
});

test('PNG, SVG and drawio.png render Japanese text and preserve an editable, exact embedded model', async () => {
  const output = model();
  const png = await renderDiagramExport(output, 'png'), drawio = await renderDiagramExport(output, 'drawio.png'), svg = await renderDiagramExport(output, 'svg');
  const pngMeta = await sharp(png.bytes).metadata(), drawioMeta = await sharp(drawio.bytes).metadata();
  assert.equal(png.mime, 'image/png'); assert.ok(pngMeta.width! >= 1600); assert.equal(drawioMeta.width, pngMeta.width);
  assert.deepEqual(await sharp(drawio.bytes).raw().toBuffer(), await sharp(png.bytes).raw().toBuffer(), 'editable metadata does not flatten or alter pixels');
  let position = 8, xml = '', imageDataSeen = false;
  while (position < drawio.bytes.length) {
    const size = drawio.bytes.readUInt32BE(position), kind = drawio.bytes.toString('ascii', position + 4, position + 8), data = drawio.bytes.subarray(position + 8, position + 8 + size);
    if (kind === 'IDAT') imageDataSeen = true;
    if (kind === 'tEXt' && data.toString('latin1').startsWith('mxfile\0')) { assert.equal(imageDataSeen, false, 'draw.io reads metadata before image data'); xml = decodeURIComponent(data.toString('latin1').slice(7)); }
    position += size + 12;
  }
  assert.equal(xml, diagramDrawio(output));
  assert.match(svg.bytes.toString(), /規格内/); assert.match(svg.bytes.toString(), /保存前の候補/); assert.match(svg.bytes.toString(), /Noto Sans JP/);
  assert.doesNotMatch(svg.bytes.toString(), /foreignObject|<script|<image/);
});

test('invalid or oversized geometry and escaped source text cannot inject SVG/XML or allocate unbounded images', async () => {
  const bad = model(); bad.view.nodes[0].x = 500000;
  assert.throws(() => validateDiagramExport(bad), /位置/);
  const duplicate = model(); duplicate.view.nodes.push(duplicate.view.nodes[0]); assert.throws(() => validateDiagramExport(duplicate), /重複/);
  const missing = model(); missing.semantic.connections[0].target = 'unregistered'; assert.throws(() => validateDiagramExport(missing), /接続先/);
  const huge = model(); huge.view.nodes[0].lines = ['a'.repeat(100_000)]; assert.throws(() => validateDiagramExport(huge), /位置/);
  const hostile = model(); hostile.title = '<script>alert("x")</script>'; hostile.view.nodes[0].title = '検査 < 値 & "根拠"';
  const svg = (await renderDiagramExport(hostile, 'svg')).bytes.toString();
  assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/); assert.match(svg, /&amp;/);
  assert.equal(diagramFilename('CON', 'drawio.png'), '業務-CON.drawio.png'); assert.equal(diagramFilename('価格/判定... ', 'svg'), '価格-判定.svg');
});

test('export endpoint returns portable downloads, rejects unsupported/oversized requests and never mutates input', async () => {
  const output = model(), before = JSON.stringify(output);
  const response = await POST(new Request('http://localhost/api/diagram-export', { method: 'POST', body: JSON.stringify({ model: output, format: 'json' }) }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-disposition')!, /filename\*=UTF-8''/); assert.deepEqual(await response.json(), JSON.parse(before));
  const unsupported = await POST(new Request('http://localhost/api/diagram-export', { method: 'POST', body: JSON.stringify({ model: output, format: 'bpmn' }) })); assert.equal(unsupported.status, 400);
  const oversized = await POST(new Request('http://localhost/api/diagram-export', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024 + 1) })); assert.equal(oversized.status, 413);
  assert.equal(JSON.stringify(output), before);
});
