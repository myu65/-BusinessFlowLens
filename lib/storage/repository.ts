import type {
  ExtractionReview,
  FollowUpAnswer,
  LensGraph,
} from "@/lib/graph";
import type { SourceDocument, SourceImage } from "@/lib/source-document";

export type ProjectSnapshot = {
  projectId: string;
  projectName: string;
  graph: LensGraph;
  transcripts: Record<string, string>;
  updatedAt: string;
};

export class ProjectChangedError extends Error {
  constructor() { super("保存済みの内容が変わりました。最新の業務を読み直して、統合を確認してください。"); }
}

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
  saveSourceDocument(projectId: string, document: SourceDocument, bytes: Uint8Array, images?: SourceImage[]): Promise<void>;
  getSourceImage(projectId: string, documentId: string, unitId: string): Promise<SourceImage | null>;
  setSourceDocumentState(projectId: string, documentId: string, state: "active" | "withdrawn"): Promise<SourceDocument | null>;
  listSourceDocuments(projectId: string): Promise<Array<Pick<SourceDocument, "id" | "name" | "format" | "createdAt">>>;
  getSourceDocument(projectId: string, documentId: string): Promise<{ document: SourceDocument; bytes: Uint8Array } | null>;
  findSourceDocument(projectId: string, sha256: string): Promise<SourceDocument | null>;
  loadProject(projectId: string): Promise<ProjectSnapshot | null>;
  saveProject(snapshot: ProjectSnapshot, expectedUpdatedAt?: string): Promise<void>;

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
