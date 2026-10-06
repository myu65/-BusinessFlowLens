import type { LensGraph, WorkflowScenario } from './graph';
import type { ExplorationFocus, KnowledgeExploration, AssetReadingPosition } from './exploration';
import type { FlowReadingPosition } from './flow-context';
import { NEW_MEMO_ID, inputKeyForWorkflow, previewReviewGraph, type InputDraft } from './review-workbench';

export type WorkspaceSection = 'interviews' | 'company' | 'workflow' | 'dataflow' | 'assets' | 'overview';
export type ScreenPosition = {
  scope?: WorkflowScenario; department?: string; query?: string; category?: string;
  tab?: string; mode?: 'dialogue' | 'summary'; level?: 'overview' | 'business';
  stepId?: string; dataId?: string; depth?: FlowReadingPosition['depth']; lens?: FlowReadingPosition['lens'];
  workflowId?: string; flowId?: string; page?: number; kind?: string;
  selectedActivityId?: string; selectedSystemId?: string; selectedCategoryId?: string;
  relationId?: string; relationPage?: number;
  relationKind?: 'transfer' | 'dependency'; selectedCapabilityId?: string; workKind?: AssetReadingPosition['workKind'];
  rolesPage?: number; activityPage?: number; workPage?: number; flowPage?: number; processPage?: number; dependencyPage?: number; dependentPage?: number;
};
export type ScreenLocation = ScreenPosition & {
  projectId: string; view: WorkspaceSection; focus?: ExplorationFocus;
  assetId?: string; activityId?: string; capabilityId?: string; processId?: string;
};
export const screenParameters = ['view', 'workflowId', 'stepId', 'assetId', 'activityId', 'capabilityId', 'focus',
  'scope', 'department', 'q', 'query', 'category', 'tab', 'mode', 'level', 'dataId', 'depth', 'lens', 'flowId',
  'page', 'kind', 'selectedActivityId', 'selectedSystemId', 'selectedCategoryId', 'relationId', 'relationPage'] as const;
const assetPages = ['rolesPage', 'activityPage', 'workPage', 'flowPage', 'processPage', 'dependencyPage', 'dependentPage'] as const;
const extraParameters = ['processId', 'relationKind', 'selectedCapabilityId', 'workKind', ...assetPages] as const;
const scopes: WorkflowScenario[] = ['current', 'future', 'alternative'];
const sections: WorkspaceSection[] = ['interviews', 'company', 'workflow', 'dataflow', 'assets', 'overview'];
const assetTabs: AssetReadingPosition['section'][] = ['work', 'impact', 'flows', 'processes', 'dependencies'];
const number = (value: string | null) => value !== null && /^\d{1,5}$/.test(value) ? Number(value) : undefined;
const defined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== '')) as T;
const flowTokens = new Map<string, string>();

/** The legacy flow ID embeds evidence. Use an opaque locator; it is not an access credential. */
export function flowLinkId(id: string) {
  if (/^flow-[0-9a-f]{32}$/.test(id)) return id;
  const cached = flowTokens.get(id); if (cached) return cached;
  let hash = BigInt('0x6c62272e07bb014262b821756295c58d');
  const prime = BigInt('0x1000000000000000000013b'), mask = BigInt('0xffffffffffffffffffffffffffffffff');
  for (const byte of new TextEncoder().encode(id)) hash = ((hash ^ BigInt(byte)) * prime) & mask;
  const token = `flow-${hash.toString(16).padStart(32, '0')}`;
  if (flowTokens.size >= 10_000) flowTokens.clear();
  flowTokens.set(id, token); return token;
}

/** IDs and viewing state only. Notes, candidates, edits and credentials never become URL fields. */
export function readScreenLocation(search: string) {
  const params = new URLSearchParams(search), value = (key: string) => params.get(key)?.trim() || undefined;
  const requested = value('view');
  const aliases: Record<string, WorkspaceSection> = { input: 'interviews', systems: 'company', activity: 'company',
    capability: 'company', process: 'company', report: 'company', system: 'assets', data: 'assets' };
  const fallback = value('assetId') ? 'assets' : value('activityId') || value('capabilityId') ? 'company' : value('workflowId') || value('stepId') ? 'workflow' : 'interviews';
  const view = requested ? aliases[requested] ?? (sections.includes(requested as WorkspaceSection) ? requested as WorkspaceSection : 'interviews') : fallback;
  let notice = requested && !aliases[requested] && !sections.includes(requested as WorkspaceSection) ? '指定された画面はありません。入力画面を開きました。' : '';
  const scope = value('scope');
  if (scope && !scopes.includes(scope as WorkflowScenario)) notice = '指定された表示範囲はありません。現在の仕事を表示します。';
  const assetId = value('assetId'), activityId = value('activityId'), capabilityId = value('capabilityId'), workflowId = value('workflowId'), stepId = value('stepId');
  const requestedFocus = value('focus') ?? (['systems', 'activity', 'capability', 'process'].includes(requested ?? '') ? requested : undefined);
  let focus: ExplorationFocus | undefined;
  if (view === 'company') {
    const kind = requestedFocus ?? (assetId ? 'asset' : activityId ? 'activity' : capabilityId ? 'capability' : value('processId') ? 'process' : workflowId ? 'workflow' : stepId ? 'process' : 'company');
    const id = { asset: assetId, activity: activityId, capability: capabilityId, workflow: workflowId, process: value('processId') ?? stepId }[kind];
    focus = kind === 'company' || kind === 'systems' ? { kind } : id && ['asset', 'activity', 'capability', 'workflow', 'process'].includes(kind) ? { kind: kind as 'asset' | 'activity' | 'capability' | 'workflow' | 'process', id } : { kind: 'company' };
  }
  const tab = requested === 'report' ? 'report' : value('tab');
  const mode = value('mode'), level = value('level'), depth = value('depth'), lens = value('lens');
  const location: ScreenLocation = defined({ projectId: value('projectId') ?? 'default', view, focus, assetId, activityId, capabilityId, workflowId, stepId,
    scope: scopes.includes(scope as WorkflowScenario) ? scope as WorkflowScenario : undefined,
    department: value('department'), query: value('q') ?? value('query'), category: value('category'),
    tab: tab && ((view === 'interviews' && ['flow', 'information', 'systems', 'history', 'documents'].includes(tab)) ||
      (view === 'assets' && assetTabs.includes(tab as AssetReadingPosition['section'])) ||
      (view === 'company' && (tab === 'report' || assetTabs.includes(tab as AssetReadingPosition['section']))) || (view === 'dataflow' && tab === 'systems')) ? tab : undefined,
    mode: mode === 'dialogue' || mode === 'summary' ? mode : undefined,
    level: level === 'overview' || level === 'business' ? level : undefined,
    depth: depth === 'summary' || depth === 'step' || depth === 'detail' ? depth : undefined,
    lens: lens === 'work' || lens === 'data' ? lens : undefined, dataId: value('dataId'), flowId: value('flowId'),
    page: number(params.get('page')), kind: ['all', 'system', 'data'].includes(value('kind') ?? '') ? value('kind') : requested === 'data' ? 'data' : requested === 'system' ? 'system' : undefined,
    selectedActivityId: value('selectedActivityId'), selectedSystemId: value('selectedSystemId'), selectedCategoryId: value('selectedCategoryId'),
    relationId: value('relationId'), relationPage: number(params.get('relationPage')) });
  if (value('relationKind') === 'transfer' || value('relationKind') === 'dependency') location.relationKind = value('relationKind') as 'transfer' | 'dependency';
  if (value('selectedCapabilityId')) location.selectedCapabilityId = value('selectedCapabilityId');
  if (value('processId')) location.processId = value('processId');
  if (['direct', 'indirect', 'critical'].includes(value('workKind') ?? '')) location.workKind = value('workKind') as AssetReadingPosition['workKind'];
  for (const key of assetPages) { const page = number(params.get(key)); if (page !== undefined) location[key] = page; }
  return { location, notice };
}

export function screenURL(base: string, location: ScreenLocation) {
  const url = new URL(base, 'http://local.invalid');
  screenParameters.forEach(key => url.searchParams.delete(key));
  extraParameters.forEach(key => url.searchParams.delete(key));
  url.searchParams.set('projectId', location.projectId);
  url.searchParams.set('view', location.view === 'interviews' ? 'input' : location.view);
  const fields = { ...location };
  delete fields.focus;
  if (location.view === 'company' && location.focus) {
    const f = location.focus;
    // Company map selection is separate from opening an activity or system's detail.
    for (const key of ['assetId', 'activityId', 'capabilityId', 'workflowId'] as const) delete fields[key];
    if (f.kind !== 'company') url.searchParams.set('focus', f.kind);
    if ('id' in f) {
      const key = { asset: 'assetId', activity: 'activityId', capability: 'capabilityId', workflow: 'workflowId', process: 'processId' }[f.kind];
      url.searchParams.set(key, f.id);
      if (f.kind === 'process' && location.workflowId) url.searchParams.set('workflowId', location.workflowId);
    }
  }
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'view' || key === 'projectId' || value === undefined || value === '' || key === 'query') continue;
    if ((key === 'page' || key === 'relationPage') && value === 0) continue;
    if (assetPages.includes(key as typeof assetPages[number]) && value === 0) continue;
    if (screenParameters.includes(key as typeof screenParameters[number]) || extraParameters.includes(key as typeof extraParameters[number])) url.searchParams.set(key, key === 'flowId' ? flowLinkId(String(value)) : String(value));
  }
  if (location.query) url.searchParams.set('q', location.query);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Automatic initial selection updates the entry, so one Back press returns to the preceding screen. */
export function shouldPushScreenHistory(previous: ScreenLocation, next: ScreenLocation) {
  if (previous.projectId !== next.projectId || previous.view !== next.view) return true;
  if (JSON.stringify(previous.focus) !== JSON.stringify(next.focus)) return true;
  const defaultTab = next.view === 'interviews' ? 'flow' : next.view === 'assets' ? 'impact' : next.focus?.kind === 'asset' ? 'work' : undefined;
  if ((previous.tab ?? defaultTab) !== (next.tab ?? defaultTab)) return true;
  if ((previous.scope ?? 'current') !== (next.scope ?? 'current')) return true;
  if ((previous.level ?? 'business') !== (next.level ?? 'business')) return true;
  if (previous.mode && next.mode && previous.mode !== next.mode) return true;
  if ((previous.relationKind ?? 'transfer') !== (next.relationKind ?? 'transfer')) return true;
  if ((previous.workKind ?? 'direct') !== (next.workKind ?? 'direct')) return true;
  if (next.view === 'assets' && (previous.workflowId || '') !== (next.workflowId || '')) return true;
  for (const key of ['workflowId', 'assetId', 'activityId', 'capabilityId'] as const)
    if (previous[key] && previous[key] !== next[key]) return true;
  if ((previous.flowId ? flowLinkId(previous.flowId) : '') !== (next.flowId ? flowLinkId(next.flowId) : '')) return true;
  for (const key of ['selectedActivityId', 'selectedSystemId', 'selectedCategoryId', 'selectedCapabilityId', 'relationId'] as const)
    if ((previous[key] || '') !== (next[key] || '')) return true;
  return false;
}

export function resolveScreenLocation(location: ScreenLocation, graph: LensGraph, drafts: Record<string, InputDraft> = {}, fallbackInputId = NEW_MEMO_ID) {
  let next = { ...location }, notice = '';
  const draftKey = location.workflowId ? inputKeyForWorkflow(drafts, location.workflowId) : undefined;
  const draft = draftKey ? drafts[draftKey] : undefined;
  const visibleGraph = draft ? previewReviewGraph(graph, draft.workflow, draft.review) : graph;
  let workflow = visibleGraph.workflows.find(w => w.id === (draft?.workflow.id ?? next.workflowId));
  const focusProcessId = next.focus?.kind === 'process' ? next.focus.id : undefined;
  const focusProcess = focusProcessId ? visibleGraph.nodes.find(n=>n.id===focusProcessId&&n.kind==='process') : undefined;
  const step = visibleGraph.nodes.find(n => n.kind === 'process' && n.id === next.stepId);
  if (focusProcess && workflow && workflow.id !== focusProcess.workflowId) {
    workflow = visibleGraph.workflows.find(w=>w.id===focusProcess.workflowId); next.workflowId = workflow?.id;
    notice = '指定された手順が属する業務で開きました。';
  }
  if (!workflow && focusProcess) workflow = visibleGraph.workflows.find(w=>w.id===focusProcess.workflowId);
  if (next.stepId && !next.workflowId && step) workflow = visibleGraph.workflows.find(w => w.id === step.workflowId);
  if (next.workflowId && !workflow && next.workflowId !== NEW_MEMO_ID) {
    notice = '指定された業務が見つかりません。保存前の候補は、入力したタブにだけ残っている場合があります。会社の全体像を開きました。';
    next = { projectId: next.projectId, view: 'company', focus: { kind: 'company' } };
  } else if (workflow) {
    next.workflowId = workflow.id;
    if (next.scope && next.scope !== (workflow.scenario ?? 'current')) notice = '指定された業務が属する表示範囲で開きました。';
    next.scope = workflow.scenario ?? 'current';
  } else if (next.view === 'workflow') {
    workflow = graph.workflows.find(w => (w.scenario ?? 'current') === (next.scope ?? 'current'));
    if (workflow) { next.workflowId = workflow.id; next.scope = workflow.scenario ?? 'current'; }
  }
  const matchingFlows = next.flowId ? visibleGraph.dataFlows.filter(f => f.id === next.flowId || flowLinkId(f.id) === next.flowId) : [];
  const flow = matchingFlows.length === 1 ? matchingFlows[0] : undefined;
  if (next.flowId) {
    if (flow) next.flowId = flow.id;
    else { notice = matchingFlows.length > 1 ? '情報の受渡しのリンクを一つの対象に特定できません。業務の流れから選び直してください。' : '指定された情報の受渡しが見つかりません。業務の流れから選び直してください。'; delete next.flowId; }
  }
  if (flow && workflow && !flow.workflowIds.includes(workflow.id)) {
    notice = '指定された情報の受渡しは、この業務に含まれていません。業務の流れを開きました。'; delete next.flowId;
  } else if (flow && !workflow) {
    const relatedWorkflow = visibleGraph.workflows.find(w => flow.workflowIds.includes(w.id));
    const scenario = relatedWorkflow?.scenario ?? 'current';
    if (next.scope && next.scope !== scenario) notice = '指定された情報の受渡しが属する表示範囲で開きました。';
    next.scope = scenario;
    if (next.view === 'dataflow' && relatedWorkflow) next.workflowId = relatedWorkflow.id;
  }
  if (next.stepId && (!step || (workflow && step.workflowId !== workflow.id))) {
    notice = '指定された手順がこの業務に見つかりません。業務全体を開きました。';
    delete next.stepId; next.depth = 'summary'; next.level = 'overview';
    if (next.focus?.kind === 'process') next.focus = workflow ? { kind: 'workflow', id: workflow.id } : { kind: 'company' };
  }
  const targets: Array<[keyof ScreenLocation, boolean]> = [
    ['assetId', !!graph.nodes.find(n => n.id === next.assetId && n.kind !== 'process')],
    ['dataId', !!visibleGraph.nodes.find(n => n.id === next.dataId && n.kind === 'data')],
    ['processId', !!visibleGraph.nodes.find(n=>n.id===next.processId&&n.kind==='process')],
    ['activityId', !!graph.knowledge?.activities.some(a => a.id === next.activityId)],
    ['capabilityId', !!graph.knowledge?.activities.some(a => a.capabilities.some(c => c.id === next.capabilityId))],
  ];
  for (const [key, exists] of targets) if (next[key] && !exists) {
    notice = '指定された対象が見つかりません。リンクの対象が統合・変更されていないか確認してください。';
    if (['assetId', 'activityId', 'capabilityId', 'processId'].includes(key)) next = { projectId: next.projectId, view: 'company', focus: { kind: 'company' } };
    else delete next[key];
  }
  if (next.focus && 'id' in next.focus && next.focus.kind === 'workflow' && workflow) next.focus = { kind: 'workflow', id: workflow.id };
  if (!next.scope) next.scope = 'current';
  if (next.view === 'workflow' && !next.level) next.level = 'business';
  const selectedId = next.workflowId ? inputKeyForWorkflow(drafts, next.workflowId) : next.view === 'interviews' ? fallbackInputId : '';
  return { location: next, selectedId, notice };
}

export function knowledgeLocation(projectId: string, position?: KnowledgeExploration): ScreenLocation {
  const p = position;
  const readsWorkflow = p?.focus.kind === 'workflow' || p?.focus.kind === 'process';
  const assetReading = p?.focus.kind === 'asset' && p.assetReading?.assetId === p.focus.id ? p.assetReading : undefined;
  return defined({ projectId, view: 'company', focus: p?.focus ?? { kind: 'company' }, scope: p?.scope,
    department: p?.department, query: p?.query, category: p?.category, stepId: readsWorkflow ? p?.stepId : undefined,
    dataId: readsWorkflow ? p?.dataId : undefined, depth: readsWorkflow ? p?.depth : undefined, lens: readsWorkflow ? p?.lens : undefined, page: p?.focus.kind === 'company' ? p.companyReading?.page : p?.focus.kind === 'systems' ? p.systemReading?.page : p?.focus.kind === 'activity' ? p.activityReading?.page : p?.listPage,
    ...assetReading, tab: p?.reportOpen ? 'report' : assetReading?.section,
    selectedActivityId: p?.focus.kind === 'company' ? p.companyReading?.activityId : undefined,
    selectedSystemId: p?.focus.kind === 'systems' ? p.systemReading?.systemId : undefined,
    selectedCategoryId: p?.focus.kind === 'systems' ? p.systemReading?.categoryId : undefined,
    relationKind: p?.focus.kind === 'systems' ? p.systemReading?.relationKind : undefined,
    selectedCapabilityId: p?.focus.kind === 'activity' ? p.activityReading?.capabilityId : undefined,
    relationId: p?.focus.kind === 'company' ? p.companyReading?.relationId : p?.focus.kind === 'systems' ? p.systemReading?.relationId : undefined,
    relationPage: p?.focus.kind === 'company' ? p.companyReading?.relationPage : p?.focus.kind === 'systems' ? p.systemReading?.relationPage : p?.focus.kind === 'activity' ? p.activityReading?.relationPage : undefined,
  });
}

export function knowledgePosition(location: ScreenLocation): KnowledgeExploration {
  const { focus = { kind: 'company' }, scope = 'current', query = '', department = '', category = '' } = location;
  return { focus, scope, query, department, category, history: [], stepId: location.stepId,
    dataId: location.dataId, depth: location.depth, lens: location.lens, listPage: location.page, reportOpen: location.tab === 'report',
    companyReading: { activityId: location.selectedActivityId ?? '', page: location.page ?? 0, relationId: location.relationId ?? '', relationPage: location.relationPage ?? 0 },
    systemReading: { systemId: location.selectedSystemId ?? '', categoryId: location.selectedCategoryId ?? '', page: location.page ?? 0,
      relationId: location.relationId ?? '', relationPage: location.relationPage ?? 0, relationKind: location.relationKind ?? 'transfer' },
    activityReading: focus.kind === 'activity' ? { activityId:focus.id,capabilityId:location.selectedCapabilityId??'',page:location.page??0,relationPage:location.relationPage??0,systemPage:0 } : undefined,
    assetReading: location.assetId ? assetPosition(location.assetId, location.tab ?? 'work', location) : undefined };
}

export function assetPosition(assetId: string, tab?: string, position: ScreenPosition = {}): AssetReadingPosition {
  return { assetId, section: assetTabs.includes(tab as AssetReadingPosition['section']) ? tab as AssetReadingPosition['section'] : 'impact',
    rolesPage: position.rolesPage??0, activityPage: position.activityPage??0, workPage: position.workPage??0, flowPage: position.flowPage??0,
    processPage: position.processPage??0, dependencyPage: position.dependencyPage??0, dependentPage: position.dependentPage??0, workKind: position.workKind??'direct' };
}
