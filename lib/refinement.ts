import type { ExtractionReview, LensGraph, LensNode } from "./graph";
import { preserveSystemDependencies } from "./system-dependencies";

export { normalizeAssetName, findConfirmedAsset } from "./asset-identity";

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
    next.id =
      next.relation === "next"
        ? edge.id
        : `${next.source}--${next.relation}--${next.target}`;
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
    knowledge: graph.knowledge
      ? {
          ...graph.knowledge,
          handoffs: graph.knowledge.handoffs?.map((h) => ({
            ...h,
            dataIds: [...new Set(h.dataIds.map(remap))],
          })),
          systems: graph.knowledge.systems
            .filter(
              (s) =>
                s.systemId !== sourceId ||
                !graph.knowledge!.systems.some((t) => t.systemId === targetId),
            )
            .map((s) => ({
              ...s,
              systemId: remap(s.systemId),
              dependsOn: [
                ...new Map(
                  [
                    ...s.dependsOn,
                    ...(s.systemId === targetId
                      ? (graph.knowledge!.systems.find(
                          (t) => t.systemId === sourceId,
                        )?.dependsOn ?? [])
                      : []),
                  ]
                    .filter((d) => remap(d.systemId) !== remap(s.systemId))
                    .map((d) => [
                      remap(d.systemId),
                      { ...d, systemId: remap(d.systemId) },
                    ]),
                ).values(),
              ],
            })),
        }
      : undefined,
    workflows: graph.workflows.map((workflow) =>
      workflow.landscape
        ? {
            ...workflow,
            landscape: {
              ...workflow.landscape,
              materialHandoffs: workflow.landscape.materialHandoffs.map(
                (handoff) => ({
                  ...handoff,
                  dataIds: [...new Set(handoff.dataIds.map(remap))],
                }),
              ),
            },
          }
        : workflow,
    ),
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
  const protectedDetails = new Map(
    (previous.protectedDetails ?? []).map((item) => [
      item.stepKey,
      item.fields,
    ]),
  );
  // Older snapshots did not record extraction origin. Protect those details
  // conservatively, and carry that reason into later AI revisions.
  if (!previous.extraction)
    for (const step of previous.steps) {
      const fields: NonNullable<
        ExtractionReview["protectedDetails"]
      >[number]["fields"] = [];
      if (step.technicalDetails?.length) fields.push("technicalDetails");
      if (step.detailSteps?.length) fields.push("detailSteps");
      if (step.executionContext) fields.push("executionContext");
      if (fields.length)
        protectedDetails.set(step.stepKey, [
          ...new Set([
            ...(protectedDetails.get(step.stepKey) ?? []),
            ...fields,
          ]),
        ]);
    }
  const protects = (
    step: ExtractionReview["steps"][number],
    field: "technicalDetails" | "detailSteps" | "executionContext",
  ) =>
    protectedDetails.get(step.stepKey)?.includes(field) ||
    step.humanEdits?.some(
      (edit) => edit.field === field || edit.field.startsWith(`${field}.`),
    );
  const retains = (step: ExtractionReview["steps"][number]) =>
    !!step.humanEdits?.length || !!protectedDetails.get(step.stepKey)?.length;
  const excludedSteps = previous.excludedSteps ?? [];
  const steps = review.steps
    .filter((step) => {
      const excluded = excludedSteps.some(
        (p) => p.evidence === step.evidence || p.action === step.action,
      );
      if (excluded)
        warnings.push(
          `${step.name}: 利用者が除外した手順です。原文は保持し、候補への除外を維持しました。`,
        );
      return !excluded;
    })
    .map((step) => {
      const prior =
        previous.steps.find((item) => item.stepKey === step.stepKey) ??
        previous.steps.find((item) => item.name === step.name);
      if (!prior) return step;
      if (prior.stepKey !== step.stepKey && protectedDetails.has(prior.stepKey))
        protectedDetails.set(
          step.stepKey,
          protectedDetails.get(prior.stepKey)!,
        );
      const technicalDetails = [...(step.technicalDetails ?? [])];
      for (const detail of protects(prior, "technicalDetails")
        ? (prior.technicalDetails ?? [])
        : []) {
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
      for (const detail of protects(prior, "detailSteps")
        ? (prior.detailSteps ?? [])
        : []) {
        const updated = detailSteps.find((item) => item.id === detail.id);
        if (updated && JSON.stringify(updated) !== JSON.stringify(detail)) {
          warnings.push(
            `${step.name}: 詳細手順「${detail.action}」への変更案があります。既存の手順を保持しました。`,
          );
          detailSteps[detailSteps.indexOf(updated)] = { ...detail };
        } else if (!updated) detailSteps.push(detail);
      }
      const edited = {
        ...step,
        technicalDetails,
        detailSteps,
        executionContext: protects(prior, "executionContext")
          ? (prior.executionContext ?? step.executionContext)
          : step.executionContext,
        humanEdits: prior.humanEdits,
      };
      for (const edit of new Map(
        (prior.humanEdits ?? []).map((edit) => [edit.field, edit]),
      ).values()) {
        if (edit.field.startsWith("meaning.")) {
          const field = edit.field.slice("meaning.".length);
          const meaning = {
            purpose: "",
            basis: "",
            result: "",
            next: "",
            condition: "",
            halt: false,
            certainty: "unknown" as const,
            evidence: "",
            ...edited.meaning,
          };
          if (
            JSON.stringify(meaning[field as keyof typeof meaning]) !==
            JSON.stringify(edit.after)
          )
            warnings.push(
              `${step.name}: 利用者が訂正した「${edit.field}」と再抽出に差があります。利用者の訂正を保持しました。`,
            );
          edited.meaning = {
            ...meaning,
            [field]: edit.after,
            certainty: "confirmed",
            evidence: prior.meaning?.evidence ?? "利用者が構造の確認中に補足",
          };
          continue;
        }
        const field = edit.field as keyof typeof edited;
        if (JSON.stringify(edited[field]) !== JSON.stringify(edit.after))
          warnings.push(
            `${step.name}: 利用者が訂正した「${field}」と再抽出に差があります。利用者の訂正を保持しました。`,
          );
        Object.assign(edited, { [field]: edit.after });
      }
      return edited;
    });
  const omitted = previous.steps.filter(
    (step) =>
      !steps.some(
        (item) => item.stepKey === step.stepKey || item.name === step.name,
      ),
  );
  for (const step of omitted) {
    if (retains(step)) {
      steps.push(step);
      warnings.push(
        `${step.name}: 詳細がある既存ステップを保持しました。不要なら手動で除外してください。`,
      );
    }
  }
  const retainedKeys = new Set(
    omitted.filter((step) => retains(step)).map((step) => step.stepKey),
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
  const keys = new Set(steps.map((s) => s.stepKey));
  const handoffs = [...(review.handoffs ?? [])];
  for (const confirmed of previous.handoffs ?? []) {
    if (
      confirmed.certainty !== "confirmed" ||
      (previous.extraction && confirmed.origin !== "human") ||
      !keys.has(confirmed.fromStepKey)
    )
      continue;
    const proposed = handoffs.findIndex(
      (h) =>
        h.fromStepKey === confirmed.fromStepKey &&
        h.targetWorkflowId === confirmed.targetWorkflowId,
    );
    if (proposed >= 0) {
      if (JSON.stringify(handoffs[proposed]) !== JSON.stringify(confirmed))
        warnings.push(
          "利用者が確認した業務間の受渡しと再抽出に差があります。確認した接続を保持しました。",
        );
      handoffs[proposed] = confirmed;
    } else {
      handoffs.push(confirmed);
      warnings.push(
        "再抽出に含まれなかった、利用者が確認した業務間の受渡しを保持しました。",
      );
    }
  }
  const incomingHandoffs = [...(review.incomingHandoffs ?? [])];
  for (const handoff of previous.incomingHandoffs ?? []) {
    if (handoff.origin !== "human" || !keys.has(handoff.toStepKey)) continue;
    const index = incomingHandoffs.findIndex(
      (h) =>
        h.sourceWorkflowId === handoff.sourceWorkflowId &&
        h.toStepKey === handoff.toStepKey,
    );
    if (index >= 0) incomingHandoffs[index] = handoff;
    else incomingHandoffs.push(handoff);
  }
  const organization = ["human", "existing"].includes(
    previous.organization?.origin ?? "",
  )
    ? previous.organization
    : review.organization;
  if (
    ["human", "existing"].includes(previous.organization?.origin ?? "") &&
    JSON.stringify(previous.organization) !==
      JSON.stringify(review.organization)
  )
    warnings.push(
      "登録された話のまとまりを保持しました。最新の説明と合うか確認できます。",
    );
  return {
    ...review,
    organization,
    systemDependencies: preserveSystemDependencies(review, previous),
    incomingHandoffs: incomingHandoffs.filter((h) => keys.has(h.toStepKey)),
    steps: [...steps]
      .sort((a, b) => a.order - b.order)
      .map((s, i) => ({ ...s, order: i + 1 })),
    excludedSteps,
    protectedDetails: [...protectedDetails]
      .filter(([stepKey]) => keys.has(stepKey))
      .map(([stepKey, fields]) => ({ stepKey, fields })),
    transitions: transitions.filter(
      (t) => keys.has(t.fromStepKey) && keys.has(t.toStepKey),
    ),
    dataFlows: review.dataFlows
      .filter(
        (f) =>
          !f.relatedStepKeys.length ||
          f.relatedStepKeys.some((k) => keys.has(k)),
      )
      .map((f) => ({
        ...f,
        relatedStepKeys: f.relatedStepKeys.filter((k) => keys.has(k)),
      })),
    handoffs: handoffs.filter((h) => keys.has(h.fromStepKey)),
    warnings: [...new Set(warnings)],
  };
}
