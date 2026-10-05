import type { LensGraph } from "./graph";
import type { FlowReadingPosition } from "./flow-context";
import type { KnowledgeScope } from "./knowledge";

export type ExplorationFocus = { kind: "company" | "systems" }
  | { kind: "activity" | "capability" | "workflow" | "process" | "asset"; id: string };
export type ActivityReadingPosition = { activityId: string; capabilityId: string; page: number; relationPage: number; systemPage: number };
export type CompanyReadingPosition = { activityId: string; page: number; relationPage: number; relationId: string };
export type SystemReadingPosition = { categoryId: string; systemId: string; page: number; relationId: string; relationPage: number; relationKind: "transfer" | "dependency" };
export type AssetReadingPosition = {
  assetId: string; section: "work" | "flows" | "processes" | "dependencies";
  rolesPage: number; activityPage: number; workPage: number; flowPage: number; processPage: number;
  dependencyPage: number; dependentPage: number; workKind: "direct" | "indirect" | "critical";
};
export type ExplorationPosition = Partial<FlowReadingPosition> & {
  focus: ExplorationFocus;
  scope: KnowledgeScope;
  query: string;
  department: string;
  category: string;
  activityReading?: ActivityReadingPosition;
  companyReading?: CompanyReadingPosition;
  systemReading?: SystemReadingPosition;
  assetReading?: AssetReadingPosition;
  listPage?: number;
};
export type KnowledgeExploration = ExplorationPosition & { history: ExplorationPosition[] };

// An explicit link from an input opens that saved story. Ordinary top navigation
// keeps the existing exploration instead; it must not reuse its old filters here.
export function exploreSavedStory(graph: LensGraph, workflowId: string, stepId?: string): KnowledgeExploration {
  const workflow = graph.workflows.find(w => w.id === workflowId);
  const scope = workflow?.scenario ?? "current";
  const root: ExplorationPosition = { focus: { kind: "company" }, scope, query: "", department: "", category: "" };
  if (!workflow) return { ...root, history: [] };
  const step = graph.nodes.find(n => n.id === stepId && n.kind === "process" && n.workflowId === workflowId);
  return { ...root, focus: { kind: "workflow", id: workflowId }, stepId: step?.id, history: [root] };
}
