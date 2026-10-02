import type { ExtractionReview, LensGraph, LensNode } from "./graph";

export function normalizeAssetName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function findConfirmedAsset(
  graph: LensGraph,
  kind: "system" | "data",
  name: string,
) {
  const matches = graph.nodes.filter(
    (node) =>
      node.kind === kind &&
      [node.label, ...(node.aliases ?? [])].some(
        (label) => normalizeAssetName(label) === normalizeAssetName(name),
      ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function mergeAssets(
  graph: LensGraph,
  sourceId: string,
  targetId: string,
): LensGraph {
  const source = graph.nodes.find((node) => node.id === sourceId);
  const target = graph.nodes.find((node) => node.id === targetId);
  if (
    !source ||
    !target ||
    source.id === target.id ||
    source.kind === "process" ||
    source.kind !== target.kind
  ) {
    throw new Error("同じ種類の異なる共有資産を選択してください。");
  }
  const remap = (id: string) => (id === sourceId ? targetId : id);
  const edges = new Map<string, LensGraph["edges"][number]>();
  for (const edge of graph.edges) {
    const next = {
      ...edge,
      source: remap(edge.source),
      target: remap(edge.target),
      workflowIds: [...edge.workflowIds],
    };
    next.id = `${next.source}--${next.relation}--${next.target}`;
    const prior = edges.get(next.id);
    if (prior) {
      prior.workflowIds = [
        ...new Set([...prior.workflowIds, ...next.workflowIds]),
      ];
      prior.label =
        [...new Set([prior.label, next.label].filter(Boolean))].join(" / ") ||
        undefined;
    } else edges.set(next.id, next);
  }
  return {
    ...graph,
    workflows: graph.workflows.map(workflow => workflow.landscape ? {
      ...workflow,
      landscape: {
        ...workflow.landscape,
        materialHandoffs: workflow.landscape.materialHandoffs.map(handoff => ({
          ...handoff,
          dataIds: [...new Set(handoff.dataIds.map(remap))],
        })),
      },
    } : workflow),
    nodes: graph.nodes
      .filter((node) => node.id !== sourceId)
      .map((node): LensNode =>
        node.id === targetId
          ? {
              ...node,
              aliases: [
                ...new Set([
                  ...(node.aliases ?? []),
                  source.label,
                  ...(source.aliases ?? []),
                ]),
              ].filter((label) => label !== node.label),
              evidence: [
                node.evidence,
                `利用者が同一資産と確認: ${source.label}`,
                source.evidence,
              ]
                .filter(Boolean)
                .join(" / "),
            }
          : node,
      ),
    edges: [...edges.values()],
    // Keep individual transfers (including newly internal transfers) and their evidence.
    dataFlows: graph.dataFlows.map((flow) => ({
      ...flow,
      sourceSystemId: remap(flow.sourceSystemId),
      targetSystemId: remap(flow.targetSystemId),
      dataIds: [...new Set(flow.dataIds.map(remap))],
    })),
  };
}

export function preserveRefinements(
  review: ExtractionReview,
  previous?: ExtractionReview | null,
): ExtractionReview {
  if (!previous) return review;
  const warnings = [...review.warnings];
  const steps = review.steps.map((step) => {
    const prior =
      previous.steps.find((item) => item.stepKey === step.stepKey) ??
      previous.steps.find((item) => item.name === step.name);
    if (!prior) return step;
    const technicalDetails = [...(step.technicalDetails ?? [])];
    for (const detail of prior.technicalDetails ?? []) {
      if (
        !technicalDetails.some(
          (item) => JSON.stringify(item) === JSON.stringify(detail),
        )
      ) {
        if (technicalDetails.some((item) => item.system === detail.system))
          warnings.push(
            `${step.name}: 既存の技術詳細と追加情報を併記しました。矛盾がないか確認してください。`,
          );
        technicalDetails.push(detail);
      }
    }
    const detailSteps = [...(step.detailSteps ?? [])];
    for (const detail of prior.detailSteps ?? []) {
      const updated = detailSteps.find((item) => item.id === detail.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(detail)) {
        warnings.push(
          `${step.name}: 詳細手順「${detail.action}」への変更案があります。既存の手順を保持しました。`,
        );
        detailSteps[detailSteps.indexOf(updated)] = { ...detail };
      } else if (!updated) detailSteps.push(detail);
    }
    return { ...step, technicalDetails, detailSteps };
  });
  const omitted = previous.steps.filter(
    (step) =>
      !steps.some(
        (item) => item.stepKey === step.stepKey || item.name === step.name,
      ),
  );
  for (const step of omitted) {
    if (step.technicalDetails?.length || step.detailSteps?.length) {
      steps.push(step);
      warnings.push(
        `${step.name}: 詳細がある既存ステップを保持しました。不要なら手動で除外してください。`,
      );
    }
  }
  const retainedKeys = new Set(
    omitted
      .filter(
        (step) => step.technicalDetails?.length || step.detailSteps?.length,
      )
      .map((step) => step.stepKey),
  );
  const transitions = [...review.transitions];
  for (const transition of previous.transitions) {
    if (
      (retainedKeys.has(transition.fromStepKey) ||
        retainedKeys.has(transition.toStepKey)) &&
      steps.some((step) => step.stepKey === transition.fromStepKey) &&
      steps.some((step) => step.stepKey === transition.toStepKey) &&
      !transitions.some(
        (item) =>
          item.fromStepKey === transition.fromStepKey &&
          item.toStepKey === transition.toStepKey &&
          item.condition === transition.condition,
      )
    )
      transitions.push(transition);
  }
  return { ...review, steps, transitions, warnings: [...new Set(warnings)] };
}
