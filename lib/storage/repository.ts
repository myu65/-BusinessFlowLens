import type { LensGraph } from "@/lib/graph";

export type ProjectSnapshot = {
  projectId: string;
  projectName: string;
  graph: LensGraph;
  transcripts: Record<string, string>;
  updatedAt: string;
};

export interface BusinessFlowRepository {
  loadProject(projectId: string): Promise<ProjectSnapshot | null>;
  saveProject(snapshot: ProjectSnapshot): Promise<void>;
}
