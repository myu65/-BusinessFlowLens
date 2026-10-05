import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceDocument, SourceImage } from "@/lib/source-document";
import { DOCUMENT_MAX_BYTES } from "@/lib/source-document";
import { ProjectChangedError, SourceDocumentChangedError, type BusinessFlowRepository, type NewWorkflowRevision, type ProjectSnapshot, type WorkflowRevision, type WorkflowRevisionSummary } from "./repository";
import { normalizeSnapshotGraph } from "./normalize";
import { SnowflakeClient, snowflakeStorageConfig, type SnowflakeSession, type SnowflakeStorageConfig } from "./snowflake-client";
import { snowflakeObjects, snowflakeSetupStatements } from "./snowflake-schema";
import { withStageDirectory } from "./temporary-stage";

type StoredImage = { path: string; sha256: string; width: number; height: number; byteSize: number };
type SourceRow = { DOCUMENT: SourceDocument; ORIGINAL_PATH: string; IMAGES: Record<string, StoredImage> };
function digest(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function key(value: string) { if (!value || value.length > 256) throw new Error("保存する項目のIDを確認してください。"); return value; }
function json<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T; }
function summary(revision: WorkflowRevision): WorkflowRevisionSummary {
  return { id: revision.id, projectId: revision.projectId, workflowId: revision.workflowId, revisionNumber: revision.revisionNumber, workflowName: revision.workflowName, summary: revision.summary, updatedBy: revision.updatedBy, createdAt: revision.createdAt };
}
function sqlString(value: string) { return `'${value.replace(/'/g,"''")}'`; }

export class SnowflakeBusinessFlowRepository implements BusinessFlowRepository {
  readonly client: SnowflakeClient;
  private initialized: Promise<void> | null = null;
  private readonly object: ReturnType<typeof snowflakeObjects>;
  constructor(readonly config: SnowflakeStorageConfig = snowflakeStorageConfig(), client = new SnowflakeClient(config)) {
    this.client = client; this.object = snowflakeObjects(config);
  }

  /** Setup is explicit in deployment; local integration tests can enable autoSetup. */
  async setup(): Promise<void> {
    await this.client.withSession(async session => {
      for (const sql of snowflakeSetupStatements(this.config)) await session.query(sql);
    });
    this.initialized = Promise.resolve();
  }
  private ready(): Promise<void> {
    if (!this.initialized) this.initialized = (this.config.autoSetup ? this.setup() : this.client.withSession(async session => {
      const locks = await session.query(`SELECT ID FROM ${this.object("WRITE_LOCK")} WHERE ID='writer'`);
      if (locks.length !== 1) throw new Error("Snowflakeの保存用テーブルを初期化してください。");
    })).catch(error => { this.initialized = null; throw error; });
    return this.initialized;
  }
  private async read<T>(work: (session: SnowflakeSession) => Promise<T>): Promise<T> { await this.ready(); return this.client.withSession(work); }

  /** Standard tables do not enforce primary keys. Every mutation acquires this DB lock before reading, including inserts and revision allocation. */
  private async write<T>(work: (session: SnowflakeSession) => Promise<T>): Promise<T> {
    return this.read(async session => {
      await session.query("BEGIN TRANSACTION");
      try {
        await session.query(`UPDATE ${this.object("WRITE_LOCK")} SET GENERATION=GENERATION+1 WHERE ID='writer'`);
        const locks = await session.query(`SELECT GENERATION FROM ${this.object("WRITE_LOCK")} WHERE ID='writer'`);
        if (locks.length !== 1) throw new Error("Snowflakeの更新ロックを確認できません。保存を停止しました。");
        const result = await work(session);
        await session.query("COMMIT"); return result;
      } catch (error) { await session.query("ROLLBACK").catch(() => undefined); throw error; }
    });
  }

  private async source(session: SnowflakeSession, projectId: string, documentId: string): Promise<SourceRow | null> {
    const rows = await session.query(`SELECT DOCUMENT, ORIGINAL_PATH, IMAGES FROM ${this.object("SOURCE_DOCUMENTS")} WHERE PROJECT_ID=? AND DOCUMENT_ID=? LIMIT 2`, [key(projectId), key(documentId)]);
    if (rows.length > 1) throw new Error("資料のIDが重複しています。保存データを確認してください。");
    return rows[0] ? { DOCUMENT: json(rows[0].DOCUMENT), ORIGINAL_PATH: String(rows[0].ORIGINAL_PATH), IMAGES: json(rows[0].IMAGES) } : null;
  }

  async loadProject(projectId: string): Promise<ProjectSnapshot | null> {
    return this.read(async session => {
      const rows = await session.query(`SELECT SNAPSHOT FROM ${this.object("PROJECTS")} WHERE PROJECT_ID=? LIMIT 2`, [key(projectId)]);
      if (rows.length > 1) throw new Error("会社のIDが重複しています。保存データを確認してください。");
      return rows[0] ? json<ProjectSnapshot>(rows[0].SNAPSHOT) : null;
    });
  }
  async saveProject(snapshot: ProjectSnapshot, expectedUpdatedAt?: string): Promise<void> {
    key(snapshot.projectId);
    const next = { ...snapshot, graph: normalizeSnapshotGraph(snapshot.graph), updatedAt: snapshot.updatedAt || new Date().toISOString() };
    await this.write(async session => {
      const rows = await session.query(`SELECT UPDATED_AT FROM ${this.object("PROJECTS")} WHERE PROJECT_ID=? LIMIT 2`, [snapshot.projectId]);
      if (rows.length > 1) throw new Error("会社のIDが重複しています。保存を停止しました。");
      if (expectedUpdatedAt !== undefined && (!rows[0] || rows[0].UPDATED_AT !== expectedUpdatedAt)) throw new ProjectChangedError();
      if (expectedUpdatedAt !== undefined && next.updatedAt === expectedUpdatedAt) throw new Error("更新時刻が前の保存と同じです。もう一度保存してください。");
      if (rows.length) await session.query(`UPDATE ${this.object("PROJECTS")} SET SNAPSHOT=PARSE_JSON(?), UPDATED_AT=? WHERE PROJECT_ID=?`, [JSON.stringify(next), next.updatedAt, next.projectId]);
      else await session.query(`INSERT INTO ${this.object("PROJECTS")} (PROJECT_ID,SNAPSHOT,UPDATED_AT) SELECT ?,PARSE_JSON(?),?`, [next.projectId, JSON.stringify(next), next.updatedAt]);
    });
  }

  private stagePath(path: string): string {
    if (!/^projects\/[a-f0-9]{64}\/[a-f0-9]{64}\/(?:original|images\/[a-f0-9]{64})\/[a-f0-9]{64}\/(?:original\.(?:xlsx|pdf|docx|pptx|png|jpeg|webp)|page\.jpeg)$/.test(path)) throw new Error("元資料の保存位置を確認できません。");
    return `@${this.object("SOURCES")}/${path}`;
  }
  private async put(session: SnowflakeSession, path: string, bytes: Uint8Array): Promise<void> {
    this.stagePath(path);
    await withStageDirectory(async folder => {
      const filename = path.split("/").at(-1)!, file = join(folder,filename);
      await writeFile(file,bytes,{mode:0o600});
      const rows = await session.query(`PUT ${sqlString(`file://${file.replace(/\\/g,"/")}`)} @${this.object("SOURCES")}/${path.slice(0,path.lastIndexOf("/"))} AUTO_COMPRESS=FALSE OVERWRITE=FALSE`);
      if (rows.length !== 1 || !["UPLOADED","SKIPPED"].includes(String(rows[0].status ?? rows[0].STATUS))) throw new Error("元資料をステージへ保存できませんでした。読み取りを再試行できます。");
    });
  }
  private async get(session: SnowflakeSession, path: string, sha256: string, byteSize: number): Promise<Uint8Array> {
    return withStageDirectory(async folder => {
      const rows = await session.query(`GET ${this.stagePath(path)} ${sqlString(`file://${folder.replace(/\\/g,"/")}/`)} PARALLEL=1`);
      if (rows.length !== 1 || String(rows[0].status ?? rows[0].STATUS) !== "DOWNLOADED") throw new Error("元資料をステージから開けませんでした。再試行できます。");
      const bytes = await readFile(join(folder,path.split("/").at(-1)!));
      if (bytes.length !== byteSize || digest(bytes) !== sha256) throw new Error("ステージの元資料が保存時と一致しません。読み取りを停止しました。");
      return bytes;
    });
  }

  async saveSourceDocument(projectId: string, document: SourceDocument, bytes: Uint8Array, images: SourceImage[] = []): Promise<void> {
    key(projectId); key(document.id);
    if (bytes.length > DOCUMENT_MAX_BYTES || bytes.length !== document.byteSize || digest(bytes) !== document.sha256) throw new Error("元資料のサイズ・内容が読み取り時と一致しません。");
    for (const image of images) if (!document.units.some(unit => unit.id === image.unitId && unit.image) || image.bytes.length > DOCUMENT_MAX_BYTES || image.mimeType !== "image/jpeg" || image.width <= 0 || image.height <= 0) throw new Error("元資料の画像位置を確認できません。");
    const root = `projects/${digest(projectId)}/${digest(document.id)}`;
    const originalPath = `${root}/original/${document.sha256}/original.${document.format}`;
    // Uploads precede metadata publication; a cancelled analysis cannot revive the document.
    const prepared = await this.read(async session => {
      const prior = await this.source(session,projectId,document.id);
      this.validateSourceUpdate(prior?.DOCUMENT,document);
      if (!prior) await this.put(session,originalPath,bytes);
      const stored: Record<string,StoredImage> = {};
      for (const image of images) {
        const sha256 = digest(image.bytes), path = `${root}/images/${digest(image.unitId)}/${sha256}/page.jpeg`;
        await this.put(session,path,image.bytes);
        stored[image.unitId] = {path,sha256,width:image.width,height:image.height,byteSize:image.bytes.length};
      }
      return {stored};
    });
    await this.write(async session => {
      const prior = await this.source(session,projectId,document.id);
      this.validateSourceUpdate(prior?.DOCUMENT,document);
      const original = prior?.ORIGINAL_PATH ?? originalPath, stored = {...prior?.IMAGES,...prepared.stored};
      if (prior) await session.query(`UPDATE ${this.object("SOURCE_DOCUMENTS")} SET DOCUMENT=PARSE_JSON(?), IMAGES=PARSE_JSON(?) WHERE PROJECT_ID=? AND DOCUMENT_ID=?`, [JSON.stringify(document),JSON.stringify(stored),projectId,document.id]);
      else await session.query(`INSERT INTO ${this.object("SOURCE_DOCUMENTS")} (PROJECT_ID,DOCUMENT_ID,DOCUMENT,ORIGINAL_PATH,IMAGES) SELECT ?,?,PARSE_JSON(?),?,PARSE_JSON(?)`, [projectId,document.id,JSON.stringify(document),original,JSON.stringify(stored)]);
    });
  }
  private validateSourceUpdate(prior: SourceDocument | undefined, next: SourceDocument) {
    if (prior && (prior.lifecycle?.state === "withdrawn" || (prior.lifecycle?.generation ?? 0) !== (next.lifecycle?.generation ?? 0))) throw new Error("資料の読取りは取り消されています。遅れて届いた結果は反映していません。");
    if (prior && (prior.sha256 !== next.sha256 || prior.byteSize !== next.byteSize || prior.format !== next.format)) throw new Error("資料のIDが異なる元ファイルを指しています。原本は上書きしていません。");
  }
  async getSourceDocument(projectId: string, documentId: string): Promise<{document: SourceDocument; bytes: Uint8Array} | null> {
    return this.read(async session => { const row = await this.source(session,projectId,documentId); return row ? {document:row.DOCUMENT,bytes:await this.get(session,row.ORIGINAL_PATH,row.DOCUMENT.sha256,row.DOCUMENT.byteSize)} : null; });
  }
  async getSourceImage(projectId: string, documentId: string, unitId: string): Promise<SourceImage | null> {
    return this.read(async session => { const row = await this.source(session,projectId,documentId), image = row?.IMAGES[unitId]; return image ? {unitId,mimeType:"image/jpeg",width:image.width,height:image.height,bytes:await this.get(session,image.path,image.sha256,image.byteSize)} : null; });
  }
  async setSourceDocumentState(projectId: string, documentId: string, state: "active" | "withdrawn", expectedActiveGeneration?: number): Promise<SourceDocument | null> {
    return this.write(async session => {
      const row = await this.source(session,projectId,documentId); if (!row) return null;
      if (expectedActiveGeneration !== undefined && (row.DOCUMENT.lifecycle?.state === "withdrawn" || (row.DOCUMENT.lifecycle?.generation ?? 0) !== expectedActiveGeneration)) throw new SourceDocumentChangedError();
      const document: SourceDocument = {...row.DOCUMENT,lifecycle:{state,generation:(row.DOCUMENT.lifecycle?.generation ?? 0)+1,changedAt:new Date().toISOString()}};
      await session.query(`UPDATE ${this.object("SOURCE_DOCUMENTS")} SET DOCUMENT=PARSE_JSON(?) WHERE PROJECT_ID=? AND DOCUMENT_ID=?`, [JSON.stringify(document),projectId,documentId]);
      return document;
    });
  }
  async listSourceDocuments(projectId: string): Promise<Array<Pick<SourceDocument,"id"|"name"|"format"|"createdAt">>> {
    return this.read(async session => (await session.query(`SELECT DOCUMENT FROM ${this.object("SOURCE_DOCUMENTS")} WHERE PROJECT_ID=? ORDER BY DOCUMENT:createdAt::VARCHAR DESC LIMIT 20`,[key(projectId)])).map(row => { const d = json<SourceDocument>(row.DOCUMENT); return {id:d.id,name:d.name,format:d.format,createdAt:d.createdAt}; }));
  }
  async findSourceDocument(projectId: string, sha256: string): Promise<SourceDocument | null> {
    return this.read(async session => { const rows = await session.query(`SELECT DOCUMENT FROM ${this.object("SOURCE_DOCUMENTS")} WHERE PROJECT_ID=? AND DOCUMENT:sha256::VARCHAR=? ORDER BY DOCUMENT:createdAt::VARCHAR LIMIT 1`,[key(projectId),sha256]); return rows[0] ? json(rows[0].DOCUMENT) : null; });
  }

  async appendWorkflowRevision(revision: NewWorkflowRevision): Promise<WorkflowRevisionSummary> {
    key(revision.projectId); key(revision.workflowId);
    return this.write(async session => {
      await session.query(`UPDATE ${this.object("WRITE_LOCK")} SET REVISION_COUNTER=REVISION_COUNTER+1 WHERE ID='writer'`);
      const counter = await session.query(`SELECT REVISION_COUNTER FROM ${this.object("WRITE_LOCK")} WHERE ID='writer'`);
      const current = await session.query(`SELECT COALESCE(MAX(REVISION_NUMBER),0) AS MAX_REVISION FROM ${this.object("REVISIONS")} WHERE PROJECT_ID=? AND WORKFLOW_ID=?`,[revision.projectId,revision.workflowId]);
      const saved: WorkflowRevision = {...revision,id:Number(counter[0].REVISION_COUNTER),revisionNumber:Number(current[0].MAX_REVISION)+1,summary:revision.review.summary};
      await session.query(`INSERT INTO ${this.object("REVISIONS")} (ID,PROJECT_ID,WORKFLOW_ID,REVISION_NUMBER,REVISION) SELECT ?,?,?,?,PARSE_JSON(?)`,[saved.id,saved.projectId,saved.workflowId,saved.revisionNumber,JSON.stringify(saved)]);
      return summary(saved);
    });
  }
  async listWorkflowRevisions(projectId: string, workflowId: string): Promise<WorkflowRevisionSummary[]> {
    return this.read(async session => (await session.query(`SELECT REVISION FROM ${this.object("REVISIONS")} WHERE PROJECT_ID=? AND WORKFLOW_ID=? ORDER BY REVISION_NUMBER DESC`,[key(projectId),key(workflowId)])).map(row => summary(json(row.REVISION))));
  }
  async getWorkflowRevision(projectId: string, revisionId: number): Promise<WorkflowRevision | null> {
    return this.read(async session => { const rows = await session.query(`SELECT REVISION FROM ${this.object("REVISIONS")} WHERE PROJECT_ID=? AND ID=? LIMIT 2`,[key(projectId),revisionId]); if (rows.length > 1) throw new Error("履歴のIDが重複しています。"); return rows[0] ? json(rows[0].REVISION) : null; });
  }
  async close() { await this.client.close(); }
}
