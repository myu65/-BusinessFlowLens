import { normalizeAssetName } from "./asset-identity";
import { getProcessAssetLinks, getWorkflowProcesses, type HandoffDataBinding, type LensGraph } from "./graph";

export function handoffSourceInformation(graph: LensGraph, workflowId: string, stepKey?: string) {
  const items = getWorkflowProcesses(graph, workflowId)
    .filter(step => !stepKey || step.canonicalKey.split(":").at(-1) === stepKey)
    .flatMap(step => getProcessAssetLinks(graph, step.id)
      .filter(link => link.asset.kind === "data" && ["writes", "sends"].includes(link.relation))
      .map(link => ({ data: link.asset, step })));
  return [...new Map(items.map(item => [item.data.id, item])).values()];
}

export function resolveHandoffInformation(graph: LensGraph, sourceWorkflowId: string, sourceStepKey: string | undefined,
  names: string[], bindings: HandoffDataBinding[] = []) {
  const available = handoffSourceInformation(graph, sourceWorkflowId, sourceStepKey);
  const availableIds = new Set(available.map(item => item.data.id));
  const resolved = names.flatMap<{ name: string; dataId: string; binding?: HandoffDataBinding }>(name => {
    const binding = bindings.find(item => item.name === name);
    if (binding) return availableIds.has(binding.dataId) ? [{ name, dataId: binding.dataId, binding }] : [];
    const matches = available.filter(item => [item.data.label, ...(item.data.aliases ?? [])]
      .some(label => normalizeAssetName(label) === normalizeAssetName(name)));
    return matches.length === 1 ? [{ name, dataId: matches[0].data.id }] : [];
  });
  return { available, resolved, dataIds: [...new Set(resolved.map(item => item.dataId))],
    unresolved: names.filter(name => !resolved.some(item => item.name === name)) };
}

export function confirmHandoffInformation(graph: LensGraph, sourceWorkflowId: string, sourceStepKey: string | undefined,
  names: string[], bindings: HandoffDataBinding[] | undefined, name: string, dataId: string) {
  if (names.includes(name) && !dataId) return [...(bindings ?? []).filter(binding => binding.name !== name),
    { name, dataId: "", evidence: `利用者が情報の対応を未確認に戻した：${name}` }];
  const item = handoffSourceInformation(graph, sourceWorkflowId, sourceStepKey).find(item => item.data.id === dataId);
  if (!names.includes(name) || !item) return bindings ?? [];
  return [...(bindings ?? []).filter(binding => binding.name !== name),
    { name, dataId, evidence: `利用者が情報の対応を確認：${name} → ${item.data.label}（${item.step.label}）` }];
}

export function handoffInformationText(graph: LensGraph, handoff: { dataIds: string[]; dataNames?: string[]; dataBindings?: HandoffDataBinding[] }) {
  const byId = new Map(graph.nodes.filter(node => node.kind === "data").map(node => [node.id, node]));
  const nodes = handoff.dataIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  const labels = nodes.map(node => node.label);
  const names = handoff.dataNames ?? labels;
  const pending = names.filter(name => {
    const binding = handoff.dataBindings?.find(binding => binding.name === name);
    return binding ? !handoff.dataIds.includes(binding.dataId)
      : !nodes.some(node => [node.label, ...(node.aliases ?? [])].some(label => normalizeAssetName(label) === normalizeAssetName(name)));
  });
  const confirmed = (handoff.dataBindings ?? []).filter(binding => handoff.dataIds.includes(binding.dataId))
    .map(binding => `${binding.name} → ${byId.get(binding.dataId)?.label ?? "情報は未確認"}（利用者が確認）`);
  const boundIds = new Set((handoff.dataBindings ?? []).map(binding => binding.dataId));
  return [...confirmed, ...nodes.filter(node => !boundIds.has(node.id)).map(node => node.label),
    ...(pending.length ? [`候補名：${pending.join(" / ")}・情報の対応は要確認`] : [])].join(" / ") || "情報名は未確認";
}
