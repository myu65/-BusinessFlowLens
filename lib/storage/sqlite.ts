import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Confidence,
  DataFlowAutomation,
  ExtractionReview,
  DataFlowDirection,
  DataFlowTransferType,
  LensEdge,
  LensGraph,
  LensNode,
  NodeKind,
  Relation,
  SystemDataFlow,
  Workflow,
} from "@/lib/graph";
import type {
  BusinessFlowRepository,
  NewWorkflowRevision,
  ProjectSnapshot,
  WorkflowRevision,
  WorkflowRevisionSummary,
} from "@/lib/storage/repository";

type SqliteRow = Record<string, unknown>;

function sqlitePath() {
  return resolve(
    process.env.BUSINESS_FLOW_SQLITE_PATH ??
      ".data/business-flow-lens.sqlite",
  );
}

function encodeArray(value: unknown): string {
  return JSON.stringify(value ?? []);
}

function parseArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeSnapshotGraph(graph: LensGraph): LensGraph {
  const workflowsById = new Map<string, Workflow>();
  for (const workflow of graph.workflows) {
    workflowsById.set(workflow.id, workflow);
  }

  const canonicalNodeByKey = new Map<string, LensNode>();
  const idRemap = new Map<string, string>();

  for (const node of graph.nodes) {
    const existing = canonicalNodeByKey.get(node.canonicalKey);
    if (!existing) {
      canonicalNodeByKey.set(node.canonicalKey, node);
      idRemap.set(node.id, node.id);
      continue;
    }

    // A canonical entity must have exactly one persisted node ID.
    // Keep the first node and remap every later reference to it.
    idRemap.set(node.id, existing.id);
  }

  const nodes = [...canonicalNodeByKey.values()];
  const validNodeIds = new Set(nodes.map((node) => node.id));

  const edgeById = new Map<string, LensEdge>();
  for (const edge of graph.edges) {
    const source = idRemap.get(edge.source) ?? edge.source;
    const target = idRemap.get(edge.target) ?? edge.target;
    if (!validNodeIds.has(source) || !validNodeIds.has(target)) continue;

    const id =
      source === edge.source && target === edge.target
        ? edge.id
        : `${source}--${edge.relation}--${target}`;

    const existing = edgeById.get(id);
    if (existing) {
      existing.workflowIds = [
        ...new Set([...existing.workflowIds, ...edge.workflowIds]),
      ];
      if (!existing.label && edge.label) existing.label = edge.label;
      continue;
    }

    edgeById.set(id, {
      ...edge,
      id,
      source,
      target,
      workflowIds: [...new Set(edge.workflowIds)],
    });
  }

  const flowById = new Map<string, SystemDataFlow>();
  for (const flow of graph.dataFlows ?? []) {
    const sourceSystemId =
      idRemap.get(flow.sourceSystemId) ?? flow.sourceSystemId;
    const targetSystemId =
      idRemap.get(flow.targetSystemId) ?? flow.targetSystemId;
    if (
      !validNodeIds.has(sourceSystemId) ||
      !validNodeIds.has(targetSystemId)
    ) {
      continue;
    }

    const dataIds = [
      ...new Set(
        flow.dataIds
          .map((id) => idRemap.get(id) ?? id)
          .filter((id) => validNodeIds.has(id)),
      ),
    ];
    const processIds = [
      ...new Set(
        flow.processIds
          .map((id) => idRemap.get(id) ?? id)
          .filter((id) => validNodeIds.has(id)),
      ),
    ];

    const id = [
      sourceSystemId,
      targetSystemId,
      flow.transferType,
      [...dataIds].sort().join(","),
    ].join("--");

    const existing = flowById.get(id);
    if (existing) {
      existing.workflowIds = [
        ...new Set([...existing.workflowIds, ...flow.workflowIds]),
      ];
      existing.processIds = [
        ...new Set([...existing.processIds, ...processIds]),
      ];
      continue;
    }

    flowById.set(id, {
      ...flow,
      id,
      sourceSystemId,
      targetSystemId,
      dataIds,
      processIds,
      workflowIds: [...new Set(flow.workflowIds)],
    });
  }

  return {
    workflows: [...workflowsById.values()],
    nodes,
    edges: [...edgeById.values()],
    dataFlows: [...flowById.values()],
  };
}

export class SqliteBusinessFlowRepository
  implements BusinessFlowRepository
{
  private readonly db: DatabaseSync;

  constructor(path = sqlitePath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS projects (",
      "  id TEXT PRIMARY KEY,",
      "  name TEXT NOT NULL,",
      "  updated_at TEXT NOT NULL",
      ");",
      "CREATE TABLE IF NOT EXISTS workflows (",
      "  project_id TEXT NOT NULL,",
      "  id TEXT NOT NULL,",
      "  name TEXT NOT NULL,",
      "  description TEXT,",
      "  family_id TEXT,",
      "  scenario TEXT,",
      "  scenario_label TEXT,",
      "  based_on_workflow_id TEXT,",
      "  effective_from TEXT,",
      "  effective_to TEXT,",
      "  source_notes TEXT NOT NULL DEFAULT '',",
      "  PRIMARY KEY (project_id, id),",
      "  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE",
      ");",
      "CREATE TABLE IF NOT EXISTS graph_nodes (",
      "  project_id TEXT NOT NULL,",
      "  id TEXT NOT NULL,",
      "  canonical_key TEXT NOT NULL,",
      "  kind TEXT NOT NULL,",
      "  label TEXT NOT NULL,",
      "  description TEXT NOT NULL,",
      "  status TEXT NOT NULL,",
      "  workflow_id TEXT,",
      "  actor TEXT,",
      "  department TEXT,",
      "  responsible_person TEXT,",
      "  evidence TEXT,",
      "  step_order INTEGER,",
      "  action TEXT,",
      "  PRIMARY KEY (project_id, id),",
      "  UNIQUE (project_id, canonical_key),",
      "  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE",
      ");",
      "CREATE TABLE IF NOT EXISTS graph_edges (",
      "  project_id TEXT NOT NULL,",
      "  id TEXT NOT NULL,",
      "  source_id TEXT NOT NULL,",
      "  target_id TEXT NOT NULL,",
      "  label TEXT,",
      "  relation TEXT NOT NULL,",
      "  workflow_ids_json TEXT NOT NULL,",
      "  PRIMARY KEY (project_id, id),",
      "  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE",
      ");",
      "CREATE TABLE IF NOT EXISTS data_flows (",
      "  project_id TEXT NOT NULL,",
      "  id TEXT NOT NULL,",
      "  source_system_id TEXT NOT NULL,",
      "  target_system_id TEXT NOT NULL,",
      "  data_ids_json TEXT NOT NULL,",
      "  transfer_type TEXT NOT NULL,",
      "  direction TEXT NOT NULL,",
      "  automation TEXT NOT NULL,",
      "  frequency TEXT,",
      "  evidence TEXT,",
      "  status TEXT NOT NULL,",
      "  workflow_ids_json TEXT NOT NULL,",
      "  process_ids_json TEXT NOT NULL,",
      "  PRIMARY KEY (project_id, id),",
      "  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE",
      ");",
      "CREATE TABLE IF NOT EXISTS workflow_revisions (",
      "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
      "  project_id TEXT NOT NULL,",
      "  workflow_id TEXT NOT NULL,",
      "  revision_number INTEGER NOT NULL,",
      "  workflow_name TEXT NOT NULL,",
      "  workflow_description TEXT,",
      "  family_id TEXT,",
      "  scenario TEXT,",
      "  scenario_label TEXT,",
      "  based_on_workflow_id TEXT,",
      "  effective_from TEXT,",
      "  effective_to TEXT,",
      "  source_notes TEXT NOT NULL,",
      "  follow_up_answers_json TEXT NOT NULL DEFAULT '[]',",
      "  summary TEXT NOT NULL,",
      "  review_json TEXT NOT NULL,",
      "  updated_by TEXT NOT NULL,",
      "  created_at TEXT NOT NULL,",
      "  UNIQUE (project_id, workflow_id, revision_number),",
      "  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);",
      "CREATE INDEX IF NOT EXISTS idx_nodes_project_kind ON graph_nodes(project_id, kind);",
      "CREATE INDEX IF NOT EXISTS idx_nodes_project_workflow ON graph_nodes(project_id, workflow_id);",
      "CREATE INDEX IF NOT EXISTS idx_edges_project_source ON graph_edges(project_id, source_id);",
      "CREATE INDEX IF NOT EXISTS idx_edges_project_target ON graph_edges(project_id, target_id);",
      "CREATE INDEX IF NOT EXISTS idx_data_flows_project_source ON data_flows(project_id, source_system_id);",
      "CREATE INDEX IF NOT EXISTS idx_data_flows_project_target ON data_flows(project_id, target_system_id);",
      "CREATE INDEX IF NOT EXISTS idx_workflow_revisions_lookup ON workflow_revisions(project_id, workflow_id, revision_number DESC);",
    ].join("\n"));

    this.ensureColumn("workflows", "family_id", "TEXT");
    this.ensureColumn("workflows", "scenario", "TEXT");
    this.ensureColumn("workflows", "scenario_label", "TEXT");
    this.ensureColumn("workflows", "based_on_workflow_id", "TEXT");
    this.ensureColumn("workflows", "effective_from", "TEXT");
    this.ensureColumn("workflows", "effective_to", "TEXT");

    this.ensureColumn("workflow_revisions", "family_id", "TEXT");
    this.ensureColumn("workflow_revisions", "scenario", "TEXT");
    this.ensureColumn("workflow_revisions", "scenario_label", "TEXT");
    this.ensureColumn(
      "workflow_revisions",
      "based_on_workflow_id",
      "TEXT",
    );
    this.ensureColumn("workflow_revisions", "effective_from", "TEXT");
    this.ensureColumn("workflow_revisions", "effective_to", "TEXT");
    this.ensureColumn(
      "workflow_revisions",
      "follow_up_answers_json",
      "TEXT NOT NULL DEFAULT '[]'",
    );
  }

  private ensureColumn(
    table: string,
    column: string,
    definition: string,
  ) {
    const rows = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as SqliteRow[];
    const exists = rows.some((row) => String(row.name) === column);

    if (!exists) {
      this.db.exec(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
      );
    }
  }

  async loadProject(projectId: string): Promise<ProjectSnapshot | null> {
    const project = this.db
      .prepare("SELECT id, name, updated_at FROM projects WHERE id = ?")
      .get(projectId) as SqliteRow | undefined;

    if (!project) return null;

    const workflowRows = this.db
      .prepare(
        "SELECT * FROM workflows WHERE project_id = ? ORDER BY rowid",
      )
      .all(projectId) as SqliteRow[];

    const nodeRows = this.db
      .prepare("SELECT * FROM graph_nodes WHERE project_id = ? ORDER BY rowid")
      .all(projectId) as SqliteRow[];

    const edgeRows = this.db
      .prepare("SELECT * FROM graph_edges WHERE project_id = ? ORDER BY rowid")
      .all(projectId) as SqliteRow[];

    const flowRows = this.db
      .prepare("SELECT * FROM data_flows WHERE project_id = ? ORDER BY rowid")
      .all(projectId) as SqliteRow[];

    const workflows: Workflow[] = workflowRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description:
        row.description == null ? undefined : String(row.description),
      familyId:
        row.family_id == null ? undefined : String(row.family_id),
      scenario:
        row.scenario == null
          ? undefined
          : (String(row.scenario) as Workflow["scenario"]),
      scenarioLabel:
        row.scenario_label == null
          ? undefined
          : String(row.scenario_label),
      basedOnWorkflowId:
        row.based_on_workflow_id == null
          ? undefined
          : String(row.based_on_workflow_id),
      effectiveFrom:
        row.effective_from == null
          ? undefined
          : String(row.effective_from),
      effectiveTo:
        row.effective_to == null
          ? undefined
          : String(row.effective_to),
    }));

    const transcripts = Object.fromEntries(
      workflowRows.map((row) => [
        String(row.id),
        String(row.source_notes ?? ""),
      ]),
    );

    const nodes: LensNode[] = nodeRows.map((row) => ({
      id: String(row.id),
      canonicalKey: String(row.canonical_key),
      kind: String(row.kind) as NodeKind,
      label: String(row.label),
      description: String(row.description),
      status: String(row.status) as Confidence,
      workflowId:
        row.workflow_id == null ? undefined : String(row.workflow_id),
      actor: row.actor == null ? undefined : String(row.actor),
      department:
        row.department == null ? undefined : String(row.department),
      responsiblePerson:
        row.responsible_person == null
          ? undefined
          : String(row.responsible_person),
      evidence: row.evidence == null ? undefined : String(row.evidence),
      stepOrder:
        row.step_order == null ? undefined : Number(row.step_order),
      action: row.action == null ? undefined : String(row.action),
    }));

    const edges: LensEdge[] = edgeRows.map((row) => ({
      id: String(row.id),
      source: String(row.source_id),
      target: String(row.target_id),
      label: row.label == null ? undefined : String(row.label),
      relation: String(row.relation) as Relation,
      workflowIds: parseArray(row.workflow_ids_json),
    }));

    const dataFlows: SystemDataFlow[] = flowRows.map((row) => ({
      id: String(row.id),
      sourceSystemId: String(row.source_system_id),
      targetSystemId: String(row.target_system_id),
      dataIds: parseArray(row.data_ids_json),
      transferType: String(row.transfer_type) as DataFlowTransferType,
      direction: String(row.direction) as DataFlowDirection,
      automation: String(row.automation) as DataFlowAutomation,
      frequency:
        row.frequency == null ? undefined : String(row.frequency),
      evidence: row.evidence == null ? undefined : String(row.evidence),
      status: String(row.status) as Confidence,
      workflowIds: parseArray(row.workflow_ids_json),
      processIds: parseArray(row.process_ids_json),
    }));

    return {
      projectId: String(project.id),
      projectName: String(project.name),
      graph: {
        workflows,
        nodes,
        edges,
        dataFlows,
      },
      transcripts,
      updatedAt: String(project.updated_at),
    };
  }


  async appendWorkflowRevision(
    revision: NewWorkflowRevision,
  ): Promise<WorkflowRevisionSummary> {
    // Serialize revision-number allocation with the insert itself.
    // This avoids two concurrent apply requests both choosing MAX+1.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db
        .prepare(
          "SELECT COALESCE(MAX(revision_number), 0) AS max_revision FROM workflow_revisions WHERE project_id = ? AND workflow_id = ?",
        )
        .get(revision.projectId, revision.workflowId) as SqliteRow;

      const revisionNumber = Number(current.max_revision ?? 0) + 1;

      const result = this.db
        .prepare(
          [
            "INSERT INTO workflow_revisions (",
            "  project_id, workflow_id, revision_number, workflow_name, workflow_description,",
            "  family_id, scenario, scenario_label, based_on_workflow_id, effective_from, effective_to,",
            "  source_notes, follow_up_answers_json, summary, review_json, updated_by, created_at",
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ].join("\n"),
        )
        .run(
          revision.projectId,
          revision.workflowId,
          revisionNumber,
          revision.workflowName,
          revision.workflowDescription ?? null,
          revision.familyId ?? null,
          revision.scenario ?? null,
          revision.scenarioLabel ?? null,
          revision.basedOnWorkflowId ?? null,
          revision.effectiveFrom ?? null,
          revision.effectiveTo ?? null,
          revision.sourceNotes,
          JSON.stringify(revision.followUpAnswers ?? []),
          revision.review.summary,
          JSON.stringify(revision.review),
          revision.updatedBy,
          revision.createdAt,
        );

      this.db.exec("COMMIT");

      return {
        id: Number(result.lastInsertRowid),
        projectId: revision.projectId,
        workflowId: revision.workflowId,
        revisionNumber,
        workflowName: revision.workflowName,
        summary: revision.review.summary,
        updatedBy: revision.updatedBy,
        createdAt: revision.createdAt,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async listWorkflowRevisions(
    projectId: string,
    workflowId: string,
  ): Promise<WorkflowRevisionSummary[]> {
    const rows = this.db
      .prepare(
        [
          "SELECT id, project_id, workflow_id, revision_number, workflow_name,",
          "       summary, updated_by, created_at",
          "  FROM workflow_revisions",
          " WHERE project_id = ? AND workflow_id = ?",
          " ORDER BY revision_number DESC",
        ].join("\n"),
      )
      .all(projectId, workflowId) as SqliteRow[];

    return rows.map((row) => ({
      id: Number(row.id),
      projectId: String(row.project_id),
      workflowId: String(row.workflow_id),
      revisionNumber: Number(row.revision_number),
      workflowName: String(row.workflow_name),
      summary: String(row.summary ?? ""),
      updatedBy: String(row.updated_by),
      createdAt: String(row.created_at),
    }));
  }

  async getWorkflowRevision(
    projectId: string,
    revisionId: number,
  ): Promise<WorkflowRevision | null> {
    const row = this.db
      .prepare(
        [
          "SELECT id, project_id, workflow_id, revision_number, workflow_name,",
          "       workflow_description, family_id, scenario, scenario_label,",
          "       based_on_workflow_id, effective_from, effective_to,",
          "       source_notes, follow_up_answers_json, summary, review_json, updated_by, created_at",
          "  FROM workflow_revisions",
          " WHERE project_id = ? AND id = ?",
        ].join("\n"),
      )
      .get(projectId, revisionId) as SqliteRow | undefined;

    if (!row) return null;

    let review: ExtractionReview;
    try {
      review = JSON.parse(String(row.review_json)) as ExtractionReview;
    } catch {
      throw new Error(
        `Revision ${revisionId} contains invalid review JSON.`,
      );
    }

    return {
      id: Number(row.id),
      projectId: String(row.project_id),
      workflowId: String(row.workflow_id),
      revisionNumber: Number(row.revision_number),
      workflowName: String(row.workflow_name),
      workflowDescription:
        row.workflow_description == null
          ? undefined
          : String(row.workflow_description),
      familyId:
        row.family_id == null ? undefined : String(row.family_id),
      scenario:
        row.scenario == null ? undefined : String(row.scenario),
      scenarioLabel:
        row.scenario_label == null
          ? undefined
          : String(row.scenario_label),
      basedOnWorkflowId:
        row.based_on_workflow_id == null
          ? undefined
          : String(row.based_on_workflow_id),
      effectiveFrom:
        row.effective_from == null
          ? undefined
          : String(row.effective_from),
      effectiveTo:
        row.effective_to == null
          ? undefined
          : String(row.effective_to),
      sourceNotes: String(row.source_notes ?? ""),
      followUpAnswers: (() => {
        try {
          const parsed = JSON.parse(
            String(row.follow_up_answers_json ?? "[]"),
          );
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })(),
      summary: String(row.summary ?? ""),
      review,
      updatedBy: String(row.updated_by),
      createdAt: String(row.created_at),
    };
  }

  async saveProject(snapshot: ProjectSnapshot): Promise<void> {
    const now = snapshot.updatedAt || new Date().toISOString();
    const graph = normalizeSnapshotGraph(snapshot.graph);

    const upsertProject = this.db.prepare([
      "INSERT INTO projects (id, name, updated_at)",
      "VALUES (?, ?, ?)",
      "ON CONFLICT(id) DO UPDATE SET",
      "  name = excluded.name,",
      "  updated_at = excluded.updated_at",
    ].join("\n"));

    const insertWorkflow = this.db.prepare([
      "INSERT INTO workflows (",
      "  project_id, id, name, description, family_id, scenario, scenario_label,",
      "  based_on_workflow_id, effective_from, effective_to, source_notes",
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join("\n"));

    const insertNode = this.db.prepare([
      "INSERT INTO graph_nodes (",
      "  project_id, id, canonical_key, kind, label, description, status,",
      "  workflow_id, actor, department, responsible_person, evidence, step_order, action",
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join("\n"));

    const insertEdge = this.db.prepare([
      "INSERT INTO graph_edges (",
      "  project_id, id, source_id, target_id, label, relation, workflow_ids_json",
      ") VALUES (?, ?, ?, ?, ?, ?, ?)",
    ].join("\n"));

    const insertFlow = this.db.prepare([
      "INSERT INTO data_flows (",
      "  project_id, id, source_system_id, target_system_id, data_ids_json,",
      "  transfer_type, direction, automation, frequency, evidence, status,",
      "  workflow_ids_json, process_ids_json",
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ].join("\n"));

    this.db.exec("BEGIN IMMEDIATE");
    try {
      upsertProject.run(snapshot.projectId, snapshot.projectName, now);

      this.db
        .prepare("DELETE FROM data_flows WHERE project_id = ?")
        .run(snapshot.projectId);
      this.db
        .prepare("DELETE FROM graph_edges WHERE project_id = ?")
        .run(snapshot.projectId);
      this.db
        .prepare("DELETE FROM graph_nodes WHERE project_id = ?")
        .run(snapshot.projectId);
      this.db
        .prepare("DELETE FROM workflows WHERE project_id = ?")
        .run(snapshot.projectId);

      for (const workflow of graph.workflows) {
        insertWorkflow.run(
          snapshot.projectId,
          workflow.id,
          workflow.name,
          workflow.description ?? null,
          workflow.familyId ?? workflow.id,
          workflow.scenario ?? "current",
          workflow.scenarioLabel ?? null,
          workflow.basedOnWorkflowId ?? null,
          workflow.effectiveFrom ?? null,
          workflow.effectiveTo ?? null,
          snapshot.transcripts[workflow.id] ?? "",
        );
      }

      for (const node of graph.nodes) {
        insertNode.run(
          snapshot.projectId,
          node.id,
          node.canonicalKey,
          node.kind,
          node.label,
          node.description,
          node.status,
          node.workflowId ?? null,
          node.actor ?? null,
          node.department ?? null,
          node.responsiblePerson ?? null,
          node.evidence ?? null,
          node.stepOrder ?? null,
          node.action ?? null,
        );
      }

      for (const edge of graph.edges) {
        insertEdge.run(
          snapshot.projectId,
          edge.id,
          edge.source,
          edge.target,
          edge.label ?? null,
          edge.relation,
          encodeArray(edge.workflowIds),
        );
      }

      for (const flow of graph.dataFlows ?? []) {
        insertFlow.run(
          snapshot.projectId,
          flow.id,
          flow.sourceSystemId,
          flow.targetSystemId,
          encodeArray(flow.dataIds),
          flow.transferType,
          flow.direction,
          flow.automation,
          flow.frequency ?? null,
          flow.evidence ?? null,
          flow.status,
          encodeArray(flow.workflowIds),
          encodeArray(flow.processIds),
        );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
