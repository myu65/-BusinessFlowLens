import type { Connection, ConnectionOptions, Bind } from "snowflake-sdk";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export type SnowflakeStorageConfig = {
  host: string; account: string; accessUrl: string; user?: string; database: string; schema: string;
  warehouse: string; role?: string; tableKind: "standard" | "hybrid";
  authenticator: "PROGRAMMATIC_ACCESS_TOKEN" | "OAUTH";
  token?: string; tokenFilePath?: string; autoSetup: boolean;
};

export function snowflakeIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,254}$/.test(value)) throw new Error("Snowflakeのデータベース・スキーマ名を確認してください。");
  return `"${value.toUpperCase()}"`;
}

export function snowflakeStorageConfig(env: Readonly<Record<string, string | undefined>> = process.env, deployed = existsSync("/snowflake/session/token")): SnowflakeStorageConfig {
  const host = (env.SNOWFLAKE_HOST ?? "").trim().toLowerCase();
  const validHost = deployed ? /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/.test(host) : /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.snowflakecomputing\.com$/.test(host);
  if (!validHost) throw new Error("SNOWFLAKE_HOSTにSnowflakeのホスト名を設定してください。");
  const protocol = deployed ? env.SNOWFLAKE_PROTOCOL ?? "https" : "https", port = deployed ? env.SNOWFLAKE_PORT : undefined;
  if (!["https","http"].includes(protocol) || (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535))) throw new Error("App RuntimeのSnowflake接続先・ポートを確認してください。");
  const account = deployed ? env.SNOWFLAKE_ACCOUNT?.trim() : host.replace(/\.snowflakecomputing\.com$/, "");
  if (!account || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(account)) throw new Error("SNOWFLAKE_ACCOUNTを確認してください。");
  const database = (env.BUSINESS_FLOW_SNOWFLAKE_DATABASE ?? env.SNOWFLAKE_DATABASE)?.trim() ?? "", schema = (env.BUSINESS_FLOW_SNOWFLAKE_SCHEMA ?? env.SNOWFLAKE_SCHEMA)?.trim() ?? "", warehouse = env.SNOWFLAKE_WAREHOUSE?.trim() ?? "";
  for (const value of [database, schema, warehouse]) snowflakeIdentifier(value);
  const tableKind = env.SNOWFLAKE_TABLE_KIND ?? "standard";
  if (tableKind !== "standard" && tableKind !== "hybrid") throw new Error("SNOWFLAKE_TABLE_KINDにはstandardかhybridを設定してください。");
  const auth = deployed ? "oauth" : env.SNOWFLAKE_STORAGE_AUTH ?? "pat";
  if (auth !== "pat" && auth !== "oauth") throw new Error("SNOWFLAKE_STORAGE_AUTHにはpatかoauthを設定してください。");
  const tokenFilePath = deployed ? "/snowflake/session/token" : env.SNOWFLAKE_TOKEN_FILE?.trim();
  const token = tokenFilePath ? undefined : (auth === "oauth" ? env.SNOWFLAKE_OAUTH_TOKEN : env.SNOWFLAKE_PAT)?.trim();
  if (!token && !tokenFilePath) throw new Error("Snowflakeの保存用トークンをサーバーに設定してください。");
  if (auth === "pat" && !env.SNOWFLAKE_USER?.trim()) throw new Error("SNOWFLAKE_USERを設定してください。");
  if (env.SNOWFLAKE_ROLE) snowflakeIdentifier(env.SNOWFLAKE_ROLE);
  return { host, account, accessUrl: `${protocol}://${host}${port ? `:${port}` : ""}`, user: deployed ? undefined : env.SNOWFLAKE_USER?.trim(), database: database.toUpperCase(), schema: schema.toUpperCase(), warehouse: warehouse.toUpperCase(),
    role: deployed ? undefined : env.SNOWFLAKE_ROLE?.toUpperCase(), tableKind, authenticator: auth === "oauth" ? "OAUTH" : "PROGRAMMATIC_ACCESS_TOKEN", token, tokenFilePath, autoSetup: env.SNOWFLAKE_AUTO_SETUP === "1" };
}

export class SnowflakeStorageError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "SnowflakeStorageError"; }
}

/** Do not expose the driver's query, bindings, credentials or signed stage URLs. */
export function snowflakeStorageError(error: unknown): SnowflakeStorageError {
  if (error instanceof SnowflakeStorageError) return error;
  const code = String((error as { code?: unknown } | null)?.code ?? "connection");
  const messages: Record<string,string> = {
    "390432": "Snowflakeのネットワークポリシーに接続元の許可が必要です。",
    "391404": "このアカウントではHybrid Tablesを利用できません。標準テーブル版を選ぶか、利用できるアカウントで検証してください。",
    "390303": "Snowflakeのトークンを確認してください。",
    "390144": "Snowflakeのトークンを確認してください。",
  };
  return new SnowflakeStorageError(code, messages[code] ?? `Snowflakeで処理を完了できませんでした（${/^[0-9]+$/.test(code) ? code : "接続"}）。接続設定と権限を確認して再試行してください。`);
}

export type SnowflakeSession = { query(sql: string, binds?: readonly Bind[]): Promise<Record<string, unknown>[]> };

/** One exclusive session per repository; transactions cannot interleave with reads. */
export class SnowflakeClient {
  private connection: Promise<Connection> | null = null;
  private credentialFingerprint = "";
  private queue: Promise<void> = Promise.resolve();
  constructor(public readonly config: SnowflakeStorageConfig, private readonly openConnection?: (token: string) => Promise<Connection>) {}

  private async discard(conn: Connection): Promise<void> {
    this.connection = null;
    this.credentialFingerprint = "";
    await new Promise<void>(resolve => conn.destroy(() => resolve()));
  }

  private async connect(token: string): Promise<Connection> {
    const imported = await import("snowflake-sdk");
    const sdk = (imported.default ?? imported) as unknown as typeof import("snowflake-sdk");
    sdk.configure({ logLevel: "OFF" });
    const options: ConnectionOptions = { account: this.config.account, host: this.config.host, accessUrl: this.config.accessUrl, username: this.config.user,
      authenticator: this.config.authenticator, token,
      database: this.config.database, schema: this.config.schema, warehouse: this.config.warehouse, role: this.config.role,
      clientSessionKeepAlive: false, clientStoreTemporaryCredential: false, timeout: 60_000, application: "BusinessFlowLens", queryTag: "BusinessFlowLens-storage" };
    const conn = sdk.createConnection(options);
    try {
      await new Promise<void>((resolve, reject) => conn.connect(error => error ? reject(snowflakeStorageError(error)) : resolve()));
      await this.execute(conn, "ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS=60, LOCK_TIMEOUT=20, TRANSACTION_ABORT_ON_ERROR=TRUE");
    } catch (error) { await this.discard(conn); throw error; }
    return conn;
  }

  private execute(conn: Connection, sql: string, binds: readonly Bind[] = []): Promise<Record<string,unknown>[]> {
    return new Promise((resolve, reject) => {
      conn.execute({ sqlText: sql, binds, complete: (error, _statement, rows) => error ? reject(snowflakeStorageError(error)) : resolve(rows ?? []) });
    });
  }

  withSession<T>(work: (session: SnowflakeSession) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      // App Runtime rotates the service token. Read it for every operation, and reconnect when it changes.
      const token = this.config.tokenFilePath ? (await readFile(this.config.tokenFilePath,"utf8")).trim() : this.config.token ?? "";
      if (!token) throw new Error("Snowflakeの保存用トークンが空です。");
      const fingerprint = createHash("sha256").update(token).digest("hex");
      if (this.connection && fingerprint !== this.credentialFingerprint) await this.discard(await this.connection);
      this.credentialFingerprint = fingerprint;
      if (!this.connection) this.connection = (this.openConnection ? this.openConnection(token) : this.connect(token)).catch(error => { this.connection = null; throw error; });
      const conn = await this.connection;
      try { return await work({ query: (sql, binds) => this.execute(conn, sql, binds) }); }
      catch (error) { await this.discard(conn); throw error; }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async close(): Promise<void> {
    await this.queue;
    const pending = this.connection; this.connection = null;
    if (pending) { const conn = await pending; await new Promise<void>((resolve,reject) => conn.destroy(error => error ? reject(snowflakeStorageError(error)) : resolve())); }
  }
}
