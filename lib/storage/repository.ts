import type {
  ExtractionReview,
  LensGraph,
} from "@/lib/graph";

export type ProjectSnapshot = {
  projectId: string;
  projectName: string;
  graph: LensGraph;
  transcripts: Record<string, string>;
  updatedAt: string;
};

export type WorkflowRevisionSummary = {
  id: number;
  projectId: string;
  workflowId: string;
  revisionNumber: number;
  workflowName: string;
  summary: string;
  updatedBy: string;
  createdAt: string;
};

export type WorkflowRevision = WorkflowRevisionSummary & {
  workflowDescription?: string;
  familyId?: string;
  scenario?: string;
  scenarioLabel?: string;
  basedOnWorkflowId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceNotes: string;
  review: ExtractionReview;
};

export type NewWorkflowRevision = {
  projectId: string;
  workflowId: string;
  workflowName: string;
  workflowDescription?: string;
  familyId?: string;
  scenario?: string;
  scenarioLabel?: string;
  basedOnWorkflowId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceNotes: string;
  review: ExtractionReview;
  updatedBy: string;
  createdAt: string;
};

export interface BusinessFlowRepository {
  loadProject(projectId: string): Promise<ProjectSnapshot | null>;
  saveProject(snapshot: ProjectSnapshot): Promise<void>;

  appendWorkflowRevision(
    revision: NewWorkflowRevision,
  ): Promise<WorkflowRevisionSummary>;

  listWorkflowRevisions(
    projectId: string,
    workflowId: string,
  ): Promise<WorkflowRevisionSummary[]>;

  getWorkflowRevision(
    projectId: string,
    revisionId: number,
  ): Promise<WorkflowRevision | null>;
}
