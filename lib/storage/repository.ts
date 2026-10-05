import type {
  ExtractionReview,
  FollowUpAnswer,
  LensGraph,
} from "@/lib/graph";
import type { SourceDocument } from "@/lib/source-document";

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
  followUpAnswers: FollowUpAnswer[];
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
  followUpAnswers: FollowUpAnswer[];
  review: ExtractionReview;
  updatedBy: string;
  createdAt: string;
};

export interface BusinessFlowRepository {
  saveSourceDocument(projectId: string, document: SourceDocument, bytes: Uint8Array): Promise<void>;
  listSourceDocuments(projectId: string): Promise<Array<Pick<SourceDocument, "id" | "name" | "format" | "createdAt">>>;
  getSourceDocument(projectId: string, documentId: string): Promise<{ document: SourceDocument; bytes: Uint8Array } | null>;
  findSourceDocument(projectId: string, sha256: string): Promise<SourceDocument | null>;
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
