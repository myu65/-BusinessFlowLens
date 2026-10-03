import type {
  CompanyKnowledge,
  ExtractionReview,
  LensGraph,
  Workflow,
} from "./graph";
import { findConfirmedAsset } from "./refinement";

const key = (text: string) => text.normalize("NFKC").trim().toLowerCase();
const same = (a: string, b: string) => key(a) === key(b);
const id = (kind: string, name: string) =>
  `input-${kind}:${encodeURIComponent(key(name))}`;

export function emptyInputKnowledge(): CompanyKnowledge {
  return {
    name: "入力から育つ会社のしくみ",
    description: "入力された話と、その整理案・確認された関係",
    activities: [],
    categories: [],
    systems: [],
    criticalWorkflows: [],
  };
}

export function reviewedWorkflowName(
  workflow: Workflow,
  review: ExtractionReview,
  previousTitle = workflow.reviewContext?.organization?.title,
) {
  const title = review.organization?.title.trim();
  return title &&
    (workflow.name.startsWith("入力した話：") ||
      workflow.name === previousTitle)
    ? title
    : workflow.name;
}

export function retainRegisteredGrouping(
  review: ExtractionReview,
  graph: LensGraph,
  workflow: Workflow,
): ExtractionReview {
  const previous = graph.workflows.find((w) => w.id === workflow.id)
    ?.reviewContext?.organization;
  const memberships = (graph.knowledge?.activities ?? []).flatMap((a) =>
    a.capabilities
      .filter((c) => c.workflowIds.includes(workflow.id))
      .map((c) => ({ a, c })),
  );
  if (!memberships.length || review.organization?.origin === "human")
    return review;
  const independent = memberships.find(
    ({ a, c }) =>
      !previous ||
      !same(a.name, previous.activity) ||
      !same(c.name, previous.capability),
  );
  if (!independent) return review;
  return {
    ...review,
    organization: {
      title: workflow.name,
      activity: independent.a.name,
      capability: independent.c.name,
      certainty: independent.c.certainty ?? "unknown",
      evidence:
        independent.c.evidence ||
        "既存の会社の活動・仕事の種類への登録を保持。入力本文で新たに確定した事実ではありません。",
      origin: "existing",
    },
    warnings: [
      ...review.warnings,
      "既存の活動分類を保持しました。まとまりを変える場合は、確認画面で訂正できます。",
    ],
  };
}

export function inputSystemRoles(
  graph: LensGraph,
  systemId: string,
  workflowIds: readonly string[],
) {
  const identities = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    if (node.kind !== "system") continue;
    for (const name of [node.label, ...(node.aliases ?? [])]) {
      const ids = identities.get(key(name)) ?? new Set<string>();
      ids.add(node.id);
      identities.set(key(name), ids);
    }
  }
  const scope = new Set(workflowIds);
  const system = graph.nodes.find(
    (n) => n.id === systemId && n.kind === "system",
  );
  if (!system) return [];
  return graph.workflows
    .filter((w) => scope.has(w.id))
    .flatMap((w) =>
      (w.reviewContext?.systemProfiles ?? []).flatMap((profile) => {
        const ids = identities.get(key(profile.name));
        if (
          ids?.size !== 1 ||
          !ids.has(systemId) ||
          !profile.purpose.trim() ||
          !profile.evidence.trim()
        )
          return [];
        return [
          {
            ...profile,
            certainty:
              system.status === "unknown"
                ? ("unknown" as const)
                : profile.certainty,
            workflowId: w.id,
            workflowName: w.name,
          },
        ];
      }),
    );
}

// Classification is a reviewable grouping. It never fabricates a process,
// system, department, dependency, or workflow sequence.
export function applyInputOrganization(
  graph: LensGraph,
  workflow: Workflow,
  review: ExtractionReview,
  previousGraph: LensGraph = graph,
): LensGraph {
  const knowledge = graph.knowledge ?? emptyInputKnowledge();
  const proposal = review.organization;
  let activities = knowledge.activities;
  const previous = previousGraph.workflows.find((w) => w.id === workflow.id)
    ?.reviewContext?.organization;
  const memberships = activities.flatMap((a) =>
    a.capabilities
      .filter((c) => c.workflowIds.includes(workflow.id))
      .map((c) => ({ a, c })),
  );
  // A manual change to the taxonomy wins over a later organizing proposal.
  const manuallyPlaced = memberships.some(
    ({ a, c }) =>
      !previous ||
      !same(a.name, previous.activity) ||
      !same(c.name, previous.capability),
  );
  if (
    proposal?.origin === "human" &&
    (!proposal.activity.trim() || !proposal.capability.trim()) &&
    previous
  )
    activities = activities.map((a) => ({
      ...a,
      capabilities: a.capabilities.map((c) => ({
        ...c,
        workflowIds:
          same(a.name, previous.activity) && same(c.name, previous.capability)
            ? c.workflowIds.filter((w) => w !== workflow.id)
            : c.workflowIds,
      })),
    }));
  if (
    proposal?.activity.trim() &&
    proposal.capability.trim() &&
    proposal.evidence.trim() &&
    (!manuallyPlaced || proposal.origin === "human")
  ) {
    activities = activities.map((a) => ({
      ...a,
      capabilities: a.capabilities.map((c) => ({
        ...c,
        workflowIds:
          previous &&
          same(a.name, previous.activity) &&
          same(c.name, previous.capability)
            ? c.workflowIds.filter((w) => w !== workflow.id)
            : c.workflowIds,
      })),
    }));
    let activity = activities.find((a) => same(a.name, proposal.activity));
    if (!activity) {
      activity = {
        id: id("activity", proposal.activity),
        name: proposal.activity.trim(),
        description: "入力された話をまとめる整理案",
        certainty: proposal.certainty,
        evidence: proposal.evidence,
        capabilities: [],
      };
      activities = [...activities, activity];
    }
    let capability = activity.capabilities.find((c) =>
      same(c.name, proposal.capability),
    );
    if (!capability)
      capability = {
        id: id("capability", `${activity.name}/${proposal.capability}`),
        name: proposal.capability.trim(),
        description: "入力された話の仕事の種類",
        workflowIds: [],
        certainty: proposal.certainty,
        evidence: proposal.evidence,
      };
    const updated = {
      ...capability,
      workflowIds: [...new Set([...capability.workflowIds, workflow.id])],
    };
    activities = activities.map((a) =>
      a.id === activity!.id
        ? {
            ...a,
            capabilities: [
              ...a.capabilities.filter((c) => c.id !== updated.id),
              updated,
            ],
          }
        : a,
    );
  }
  let categories = knowledge.categories;
  let systems = knowledge.systems;
  const mentioned = new Set(
    review.steps.flatMap((s) => [
      ...s.systems.map((t) => key(t.name)),
      ...(s.executingSystem ? [key(s.executingSystem)] : []),
    ]),
  );
  for (const profile of review.systemProfiles ?? []) {
    if (
      !mentioned.has(key(profile.name)) ||
      (!profile.category.trim() && !profile.purpose.trim()) ||
      !profile.evidence.trim()
    )
      continue;
    const system = findConfirmedAsset(graph, "system", profile.name);
    if (!system || system.status === "unknown") continue; // Uncertain identity is not a permission to assign a profile.
    const existing = systems.find((s) => s.systemId === system.id);
    if (
      existing &&
      (!existing.sourceWorkflowId || existing.sourceWorkflowId !== workflow.id)
    )
      continue;
    let category = categories.find((c) => same(c.name, profile.category));
    if (!category && profile.category.trim()) {
      category = {
        id: id("category", profile.category),
        name: profile.category.trim(),
        description: "入力された道具の整理分類（変更・追加できます）",
      };
      categories = [...categories, category];
    }
    systems = [
      ...systems.filter((s) => s.systemId !== system.id),
      {
        systemId: system.id,
        categoryId: category?.id ?? "",
        owner: existing?.owner ?? "",
        purpose: profile.purpose,
        dependsOn: existing?.dependsOn ?? [],
        certainty: profile.certainty,
        evidence: profile.evidence,
        sourceWorkflowId: workflow.id,
      },
    ];
  }
  return {
    ...graph,
    knowledge: { ...knowledge, activities, categories, systems },
  };
}
