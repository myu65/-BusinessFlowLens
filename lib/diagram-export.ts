import type { Confidence, ExtractionReview, LensGraph } from './graph';
import { inputCanvasEdge, inputCanvasLabel, inputCanvasLayout, inputConnectionCaption, inputConnectionDirection, inputStepMode, inputStepName } from './input-canvas';
import type { OverviewNode, OverviewRelation } from './relationship-overview';
import { overviewDiagramLayout, overviewEdgeGeometry } from './relationship-reading';

export type DiagramTone = 'human' | 'automatic' | 'mixed' | 'hold' | 'unknown' | 'group' | 'information' | 'return' | 'dependency';
export const diagramColors: Record<DiagramTone, { fill: string; stroke: string; text: string }> = {
  human: { fill: '#f3faf5', stroke: '#6c9b80', text: '#304e3d' },
  automatic: { fill: '#f0f7fd', stroke: '#7aabd0', text: '#315875' },
  mixed: { fill: '#f5f3fb', stroke: '#9784b8', text: '#554769' },
  hold: { fill: '#fff4f1', stroke: '#c58a82', text: '#85534d' },
  unknown: { fill: '#fafafa', stroke: '#929d99', text: '#52645b' },
  group: { fill: '#f2f7f3', stroke: '#789b82', text: '#304e3d' },
  information: { fill: '#f2f7fa', stroke: '#739bb4', text: '#315875' },
  return: { fill: '#f2f7fa', stroke: '#557c9e', text: '#315875' },
  dependency: { fill: '#f7f3ec', stroke: '#aa8a56', text: '#715a36' },
};

export type DiagramExport = {
  schema: 'businessflowlens.diagram'; version: 1; title: string;
  scope: { level: string; label: string; state: string; workflowId?: string; scenario?: string };
  // Meaning and references are independent from coordinates and drawing styles.
  semantic: {
    context?: unknown;
    nodes: Array<{ id: string; type: string; name: string; attributes: unknown; offPage?: boolean }>;
    connections: Array<{ id: string; source: string; target: string; type: string; certainty: Confidence; attributes: unknown }>;
    references?: Array<{ id: string; type: string; name: string }>;
  };
  view: {
    width: number; height: number;
    nodes: Array<{ id: string; x: number; y: number; width: number; height: number; title: string; lines: string[]; tone: DiagramTone; uncertain: boolean }>;
    connections: Array<{ id: string; path: string; label: string; x: number; y: number; tone: DiagramTone; uncertain: boolean }>;
  };
  annotations: string[];
  checks: Array<{ code: string; message: string; nodeId?: string }>;
};

const certaintyLabel = (value?: Confidence) => value === 'confirmed' ? '確認済み' : value === 'inferred' ? '推定' : '未確認';

/** Check structure without claiming the story is complete or inventing start/end events. */
export function workflowDiagramChecks(review: ExtractionReview) {
  const keys = new Set(review.steps.map(step => step.stepKey)), checks: DiagramExport['checks'] = [];
  for (const step of review.steps) {
    if (!step.name.trim()) checks.push({ code: 'missing-name', nodeId: step.stepKey, message: `手順${step.order}の名前が未記入です。` });
    const outgoing = review.transitions.filter(edge => edge.fromStepKey === step.stepKey);
    if (outgoing.length > 1 && outgoing.some(edge => !edge.condition?.trim())) checks.push({ code: 'branch-condition', nodeId: step.stepKey,
      message: `「${inputStepName(step)}」からの分岐・並行の進み方を確認してください。条件が書かれていない接続があります。` });
    for (const edge of outgoing) {
      if (!keys.has(edge.toStepKey)) checks.push({ code: 'missing-target', nodeId: step.stepKey, message: `「${inputStepName(step)}」の接続先が未登録です。` });
      if (edge.toStepKey === step.stepKey && !edge.condition?.trim()) checks.push({ code: 'retry-condition', nodeId: step.stepKey,
        message: `「${inputStepName(step)}」を繰り返す条件が未記入です。` });
    }
  }
  for (const edge of review.transitions.filter(edge => !keys.has(edge.fromStepKey))) checks.push({ code: 'missing-source', message: '接続元の手順が未登録の矢印があります。' });
  return checks;
}

export function workflowDiagramExport(review: ExtractionReview, page: number, context: { title: string; state?: string; workflowId?: string; scenario?: string }): DiagramExport {
  const layout = inputCanvasLayout(review, page), visible = new Set(layout.nodes.map(node => node.step.stepKey));
  const related = review.transitions.filter(edge => visible.has(edge.fromStepKey) || visible.has(edge.toStepKey));
  const connectionId = (edge: ExtractionReview['transitions'][number]) => `connection-${review.transitions.indexOf(edge)}`;
  const referenced = new Set([...visible, ...related.flatMap(edge => [edge.fromStepKey, edge.toStepKey])]);
  const byKey = new Map(layout.nodes.map(node => [node.step.stepKey, node]));
  const name = (key: string) => { const step = review.steps.find(step => step.stepKey === key); return step ? `${step.order}. ${inputStepName(step)}` : '手順は未登録'; };
  const annotations = related.filter(edge => !visible.has(edge.fromStepKey) || !visible.has(edge.toStepKey)).map(edge =>
    `別のページとの接続：${name(edge.fromStepKey)} → ${name(edge.toStepKey)}${edge.condition ? `（${edge.condition}）` : ''}・${certaintyLabel(edge.certainty)}`);
  for (const edge of layout.edges) {
    const from = byKey.get(edge.fromStepKey)!.step, to = byKey.get(edge.toStepKey)!.step;
    if (edge.condition || edge.holdEffect || edge.sourceVariant || inputConnectionDirection(from, to) !== 'forward') annotations.push(
      `${name(edge.fromStepKey)} → ${name(edge.toStepKey)}：${inputConnectionCaption(edge, from, to) || '条件の記載なし'}・${certaintyLabel(edge.certainty)}`);
  }
  return {
    schema: 'businessflowlens.diagram', version: 1, title: context.title,
    scope: { level: 'workflow-steps', label: `${context.scenario ? `${context.scenario === 'current' ? '現在' : context.scenario === 'future' ? '将来案' : context.scenario === 'alternative' ? '別案' : context.scenario}・` : ''}表示中の手順 ${layout.total ? layout.page * 6 + 1 : 0}–${Math.min(layout.total, (layout.page + 1) * 6)} / 全${layout.total}手順${layout.nodes.some(n => n.context) ? '・前後の手順を含む' : ''}`,
      state: context.state ?? '表示中の構造', workflowId: context.workflowId, scenario: context.scenario },
    semantic: {
      context: { summary: review.summary, trigger: review.trigger, outcome: review.outcome, extraction: review.extraction, documentEvidence: review.documentEvidence,
        questions: review.questions, warnings: review.warnings, excludedSteps: review.excludedSteps, excludedTransitions: review.excludedTransitions,
        dataFlows: review.dataFlows.filter(flow => !flow.relatedStepKeys.length || flow.relatedStepKeys.some(key => visible.has(key))) },
      nodes: review.steps.filter(step => referenced.has(step.stepKey)).map(step => ({ id: step.stepKey, type: 'task', name: step.name, attributes: step, offPage: !visible.has(step.stepKey) })),
      connections: related.map(edge => ({ id: connectionId(edge), source: edge.fromStepKey, target: edge.toStepKey, type: 'sequence', certainty: edge.certainty ?? 'unknown', attributes: edge })),
    },
    view: { width: layout.width, height: layout.height,
      nodes: layout.nodes.map(({ step, x, y, isolated, context: neighbor }) => ({ id: step.stepKey, x, y, width: 140, height: 128,
        title: inputCanvasLabel(step), lines: [`${step.order}. ${neighbor ? '前後の手順' : isolated ? '前後は未確認' : step.humanEdits?.length ? '訂正を含む' : step.certainty === 'explicit' ? '原文に明示' : '推定・要確認'}`,
          step.actor || step.boundary?.party || step.executingSystem || '担当は未確認', step.meaning?.halt ? '停止・保留' : inputStepMode(step),
          [...new Set(step.systems.map(system => system.name))].join('・') || '道具は未確認',
          ...(step.data.length ? [`情報：${[...new Set(step.data.map(data => data.name))].join('・')}`] : [])],
        tone: step.meaning?.halt ? 'hold' : step.executionMode === 'manual' ? 'human' : step.executionMode === 'automatic' ? 'automatic' : step.executionMode === 'mixed' ? 'mixed' : 'unknown', uncertain: step.certainty !== 'explicit' || isolated })),
      connections: layout.edges.map(edge => {
        const from = byKey.get(edge.fromStepKey)!, to = byKey.get(edge.toStepKey)!;
        const shape = inputCanvasEdge(from, to, layout.nodes, layout.edges.indexOf(edge)), direction = inputConnectionDirection(from.step, to.step);
        const caption = direction === 'repeat' ? '同じ手順を繰り返す' : direction === 'return' ? `手順${to.step.order}へ戻る` : inputConnectionCaption(edge, from.step, to.step);
        return { id: connectionId(edge), path: shape.path,
          label: wrapDiagramText(caption, layout.edges.filter(item => item.fromStepKey === edge.fromStepKey).length > 2 ? 7 : 14, 1)[0] ?? '',
          x: shape.labelX ?? shape.x, y: shape.labelY ?? shape.y - 15,
          tone: direction !== 'forward' ? 'return' : to.step.meaning?.halt ? 'hold' : 'human', uncertain: edge.certainty !== 'confirmed' };
      }),
    }, annotations, checks: workflowDiagramChecks(review).filter(check => !check.nodeId || visible.has(check.nodeId)),
  };
}

export function relationshipDiagramExport(args: { nodes: OverviewNode[]; edges: OverviewRelation[]; layoutEdges?: OverviewRelation[]; selectedId?: string; title: string; scopeLabel?: string; level?: string; graph?: LensGraph }): DiagramExport {
  const layout = overviewDiagramLayout(args.nodes, args.layoutEdges ?? args.edges, args.selectedId);
  const dataNames = new Map(args.graph?.nodes.filter(node => node.kind === 'data').map(node => [node.id, node.label]) ?? []);
  const geometry = overviewEdgeGeometry(layout.positions, args.layoutEdges ?? args.edges, dataNames);
  const typeOf = (node: OverviewNode) => args.graph?.nodes.find(item => item.id === node.id)?.kind
    ?? (args.graph?.knowledge?.activities.some(item => item.id === node.id) ? 'activity'
      : args.graph?.knowledge?.activities.some(item => item.capabilities.some(capability => capability.id === node.id)) ? 'capability' : 'group');
  return { schema: 'businessflowlens.diagram', version: 1, title: args.title,
    scope: { level: args.level ?? 'relationships', label: args.scopeLabel ?? `表示中の${args.nodes.length}要素・${args.edges.length}関係`, state: '表示中の構造' },
    semantic: { nodes: args.nodes.map(node => ({ id: node.id, type: typeOf(node), name: node.label, attributes: node })),
      connections: args.edges.map(edge => ({ id: edge.id, type: edge.kind, source: edge.source, target: edge.target, certainty: edge.certainty, attributes: edge })),
      references: [...new Set(args.edges.flatMap(edge => edge.references.flatMap(reference => [reference.source, reference.target, ...reference.workflowIds, ...reference.processIds, ...reference.dataIds])))].map(id => {
        const node = args.graph?.nodes.find(item => item.id === id), workflow = args.graph?.workflows.find(item => item.id === id);
        return { id, type: node?.kind ?? (workflow ? 'workflow' : 'reference'), name: node?.label ?? workflow?.name ?? id };
      }) },
    view: { width: layout.width, height: layout.height,
      nodes: args.nodes.map(node => { const point = layout.positions.get(node.id)!;
        return { id: node.id, x: point.x - 97, y: point.y - 52, width: 194, height: 104, title: node.label,
          lines: [node.kindLabel ?? '', node.subtitle, ...(node.note ? [node.note] : [])], tone: typeOf(node) === 'system' ? 'automatic' : typeOf(node) === 'data' ? 'information' : 'group', uncertain: !!node.certainty && node.certainty !== 'confirmed' }; }),
      connections: args.edges.flatMap(edge => { const shape = geometry.get(edge.id); return shape ? [{ id: edge.id, path: shape.path, label: shape.caption.text,
        x: shape.lx, y: shape.ly, tone: edge.kind === 'dependency' ? 'dependency' as const : 'information' as const, uncertain: edge.certainty !== 'confirmed' }] : []; }),
    }, annotations: args.edges.map(edge => { const shape = geometry.get(edge.id); return `${args.nodes.find(node => node.id === edge.source)?.label} → ${args.nodes.find(node => node.id === edge.target)?.label}：${shape?.caption.type ?? edge.kind}${shape?.caption.information ? `・${shape.caption.information}` : ''}・${edge.references.length}件・${certaintyLabel(edge.certainty)}`; }),
    checks: [],
  };
}

export function xmlEscape(text: string) { return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!)).replace(/\r?\n/g, '&#10;'); }

export function diagramJson(model: unknown) { return JSON.stringify(model).replace(/[\ufffe\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`); }

export function diagramLegend(model: DiagramExport) {
  return model.scope.level === 'workflow-steps'
    ? '人の作業 / システム自動 / 停止・保留 / 戻り・繰り返し　点線は推定・未確認'
    : '矢印は受渡し・参照、または稼働の依存　点線は推定・未確認';
}

export function diagramNodeText(node: DiagramExport['view']['nodes'][number]) {
  const title = wrapDiagramText(node.title, Math.max(1, Math.floor((node.width - 20) / 12)), 2);
  return [...title.map((text, i) => ({ text, y: 20 + i * 17, size: 12, bold: true })),
    ...node.lines.filter(Boolean).slice(0, node.height >= 128 ? 5 : 3).map((text, i) => ({ text: wrapDiagramText(text, Math.max(1, Math.floor((node.width - 20) / 10)), 1)[0] ?? '', y: 25 + title.length * 17 + i * 14, size: 10, bold: false }))]
    .filter(line => line.y < node.height - 5);
}

/** The same title, scope and note area is used by images and native draw.io cells. */
export function diagramPage(model: DiagramExport) {
  const width = Math.max(800, model.view.width + 48), x = (width - model.view.width) / 2, y = 106;
  const footY = model.view.height + y + 20;
  const notes = [...model.checks.map(check => `確認する点：${check.message}`), ...model.annotations];
  const shown = notes.slice(0, 12).flatMap(note => wrapDiagramText(note, Math.floor((width - 56) / 11)));
  if (notes.length > 12) shown.push(`ほか${notes.length - 12}件の説明は、編集用の図と構造データに記録しています。`);
  return { width, height: footY + Math.max(50, shown.length * 17 + 28), x, y, footY, notes: shown };
}

export function wrapDiagramText(text: string, count: number, maxLines = Infinity) {
  const chars = [...text.replace(/\s+/g, ' ').trim()], lines: string[] = [];
  while (chars.length && lines.length < maxLines) lines.push(chars.splice(0, count).join(''));
  if (chars.length && lines.length) lines[lines.length - 1] = `${[...lines.at(-1)!].slice(0, -1).join('')}…`;
  return lines;
}

/** Native draw.io cells retain semantic IDs and editable connectors, never a flattened screenshot. */
export function diagramDrawio(model: DiagramExport) {
  const page = diagramPage(model);
  const ids = new Map(model.view.nodes.map((node, index) => [node.id, `node-${index}`]));
  const vertices = model.view.nodes.map(node => {
    const semantic = model.semantic.nodes.find(item => item.id === node.id)!, color = diagramColors[node.tone];
    const evidence = (semantic.attributes as { evidence?: unknown } | null)?.evidence;
    const tooltip = [semantic.name, ...node.lines, ...(typeof evidence === 'string' && evidence ? [`根拠：${evidence}`] : [])].join('\n');
    return `<object id="${ids.get(node.id)}" label="${xmlEscape(diagramNodeText(node).map(line => line.text).join('\n'))}" tooltip="${xmlEscape(tooltip)}" bflId="${xmlEscape(node.id)}" bflType="${xmlEscape(semantic.type)}"><mxCell vertex="1" parent="1" style="rounded=1;whiteSpace=wrap;html=0;align=left;verticalAlign=top;spacing=10;fontSize=11;fillColor=${color.fill};strokeColor=${color.stroke};fontColor=${color.text};${node.uncertain ? 'dashed=1;' : ''}"><mxGeometry x="${node.x + page.x}" y="${node.y + page.y}" width="${node.width}" height="${node.height}" as="geometry"/></mxCell></object>`;
  });
  const edges = model.view.connections.map((edge, index) => {
    const semantic = model.semantic.connections.find(item => item.id === edge.id)!, color = diagramColors[edge.tone];
    const points = diagramPathPoints(edge.path), start = points[0], end = points.at(-1)!;
    const from = model.view.nodes.find(node => node.id === semantic.source)!, to = model.view.nodes.find(node => node.id === semantic.target)!;
    const port = `exitX=${(start.x - from.x) / from.width};exitY=${(start.y - from.y) / from.height};entryX=${(end.x - to.x) / to.width};entryY=${(end.y - to.y) / to.height};exitPerimeter=0;entryPerimeter=0;`;
    const details = semantic.attributes as { condition?: string; evidence?: string } | null;
    const tooltip = [model.semantic.nodes.find(node => node.id === semantic.source)?.name, '→', model.semantic.nodes.find(node => node.id === semantic.target)?.name,
      details?.condition, certaintyLabel(semantic.certainty), details?.evidence].filter(Boolean).join('\n');
    return `<object id="edge-${index}" label="${xmlEscape(wrapDiagramText(edge.label, 12, 1)[0] ?? '')}" tooltip="${xmlEscape(tooltip)}" bflId="${xmlEscape(edge.id)}" bflType="${xmlEscape(semantic.type)}"><mxCell edge="1" parent="1" source="${ids.get(semantic.source)}" target="${ids.get(semantic.target)}" style="edgeStyle=none;noEdgeStyle=1;orthogonalLoop=0;html=0;fontSize=10;endArrow=block;endFill=1;strokeColor=${color.stroke};fontColor=${color.text};labelBackgroundColor=#ffffff;${port}${edge.uncertain ? 'dashed=1;' : ''}"><mxGeometry x="-1" relative="1" as="geometry"><Array as="points">${points.slice(1, -1).map(point => `<mxPoint x="${point.x + page.x}" y="${point.y + page.y}"/>`).join('')}</Array><mxPoint x="${edge.x - start.x}" y="${edge.y - start.y}" as="offset"/></mxGeometry></mxCell></object>`;
  });
  const caption = (id: string, text: string, y: number, height: number, size: number) => `<mxCell id="${id}" value="${xmlEscape(text)}" vertex="1" parent="1" style="text;html=0;whiteSpace=wrap;align=left;verticalAlign=top;fontSize=${size};fontColor=#304e3d;"><mxGeometry x="24" y="${y}" width="${page.width - 48}" height="${height}" as="geometry"/></mxCell>`;
  return `<?xml version="1.0" encoding="UTF-8"?><mxfile host="BusinessFlowLens" compressed="false"><diagram id="businessflowlens" name="${xmlEscape(model.title)}"><mxGraphModel bflSchema="businessflowlens.diagram" bflVersion="1" bflModel="${xmlEscape(diagramJson(model))}" page="0" pageWidth="${page.width}" pageHeight="${page.height}"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${caption('title', model.title, 16, 28, 18)}${caption('scope', `${model.scope.label}・${model.scope.state}`, 48, 36, 11)}${caption('legend', diagramLegend(model), 84, 18, 10)}${vertices.join('')}${edges.join('')}${caption('notes', page.notes.join('\n'), page.footY, page.height - page.footY, 11)}</root></mxGraphModel></diagram></mxfile>`;
}

/** Sample quadratic overview curves for native, movable draw.io waypoints. */
export function diagramPathPoints(path: string) {
  const tokens = path.match(/[MLHVQ]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  let current = { x: 0, y: 0 }, cursor = 0;
  while (cursor < tokens.length) {
    const command = tokens[cursor++].toUpperCase(), number = () => Number(tokens[cursor++]);
    if (command === 'M' || command === 'L') { current = { x: number(), y: number() }; points.push(current); }
    else if (command === 'H' || command === 'V') { current = { x: command === 'H' ? number() : current.x, y: command === 'V' ? number() : current.y }; points.push(current); }
    else if (command === 'Q') { const start = current, control = { x: number(), y: number() }, end = { x: number(), y: number() };
      for (const t of [.25, .5, .75, 1]) points.push({ x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x, y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y }); current = end; }
    else throw new Error('矢印の形を出力できません。');
  }
  return points;
}

export function diagramFilename(title: string, extension: string) {
  let name = [...title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').trim()].slice(0, 80).join('').replace(/[. ]+$/, '') || '業務の図';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `業務-${name}`;
  return `${name}.${extension}`;
}

export function validateDiagramExport(value: unknown): asserts value is DiagramExport {
  if (!value || typeof value !== 'object') throw new Error('出力する図を指定してください。');
  const model = value as DiagramExport;
  const text = (value: unknown, max = 2000) => typeof value === 'string' && value.length <= max;
  if (model.schema !== 'businessflowlens.diagram' || model.version !== 1 || !text(model.title, 200) || !model.scope ||
      !['label', 'level', 'state'].every(key => text(model.scope[key as keyof typeof model.scope], 1000)) ||
      !['workflowId', 'scenario'].every(key => model.scope[key as keyof typeof model.scope] === undefined || text(model.scope[key as keyof typeof model.scope], 500)) || !model.semantic || !model.view ||
      !Array.isArray(model.semantic.nodes) || !Array.isArray(model.semantic.connections) || !Array.isArray(model.view.nodes) || !Array.isArray(model.view.connections) ||
      !Array.isArray(model.annotations) || !model.annotations.every(note => text(note, 4000)) || !Array.isArray(model.checks) || !model.checks.every(check => text(check?.message, 4000) && text(check?.code, 100)) ||
      model.view.nodes.length > 24 || model.view.connections.length > 72 || model.semantic.nodes.length > 500 || model.semantic.connections.length > 1000 || model.annotations.length > 1000 || model.checks.length > 1000 ||
      ![model.view.width, model.view.height].every(number => Number.isFinite(number) && number > 0 && number <= 4000)) throw new Error('図の範囲や内容を読み取れません。表示範囲を小さくして出力してください。');
  if (!model.semantic.nodes.every(node => text(node?.id, 500) && text(node?.type, 100) && text(node?.name, 4000) && (node.offPage === undefined || typeof node.offPage === 'boolean')) ||
      !model.semantic.connections.every(edge => text(edge?.id, 500) && text(edge?.source, 500) && text(edge?.target, 500) && text(edge?.type, 100) && ['confirmed', 'inferred', 'unknown'].includes(edge?.certainty)) ||
      (model.semantic.references !== undefined && (!Array.isArray(model.semantic.references) || model.semantic.references.length > 10000 || !model.semantic.references.every(ref => text(ref?.id, 500) && text(ref?.type, 100) && text(ref?.name, 4000))))) throw new Error('図の要素や根拠を読み取れません。');
  const nodes = new Map(model.semantic.nodes.map(node => [node.id, node])), edges = new Map(model.semantic.connections.map(edge => [edge.id, edge]));
  if (nodes.size !== model.semantic.nodes.length || edges.size !== model.semantic.connections.length) throw new Error('図の要素のIDが重複しています。');
  if (new Set(model.view.nodes.map(node => node?.id)).size !== model.view.nodes.length || new Set(model.view.connections.map(edge => edge?.id)).size !== model.view.connections.length) throw new Error('表示する図の要素のIDが重複しています。');
  for (const node of model.view.nodes) if (!node || !nodes.has(node.id) || !text(node.title) || !Array.isArray(node.lines) || node.lines.length > 10 || !node.lines.every(line => text(line, 1000)) || typeof node.uncertain !== 'boolean' ||
      !Object.hasOwn(diagramColors, node.tone) || ![node.x, node.y, node.width, node.height].every(number => Number.isFinite(number) && number >= 0 && number <= 5000) || !node.width || !node.height || node.x + node.width > model.view.width || node.y + node.height > model.view.height)
    throw new Error('手順やまとまりの位置を読み取れません。');
  const shown = new Set(model.view.nodes.map(node => node.id));
  for (const edge of model.view.connections) {
    if (!edge) throw new Error('矢印の内容を読み取れません。');
    const semantic = edges.get(edge.id);
    if (!semantic || !shown.has(semantic.source) || !shown.has(semantic.target) || typeof edge.path !== 'string' || edge.path.length > 3000 || !/^[MLHVQ0-9.,eE+\-\s]+$/.test(edge.path) ||
        !text(edge.label) || typeof edge.uncertain !== 'boolean' || !Object.hasOwn(diagramColors, edge.tone) || ![edge.x, edge.y].every(number => Number.isFinite(number) && number >= 0 && number <= 5000) || edge.x > model.view.width || edge.y > model.view.height) throw new Error('矢印と接続先を読み取れません。');
    const points = diagramPathPoints(edge.path);
    if (points.length < 2 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > model.view.width || point.y > model.view.height)) throw new Error('矢印の位置を読み取れません。');
  }
}
