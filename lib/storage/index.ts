import type { BusinessFlowRepository } from "@/lib/storage/repository";
import { SqliteBusinessFlowRepository } from "@/lib/storage/sqlite";
import { SnowflakeBusinessFlowRepository } from "@/lib/storage/snowflake";

let repository: BusinessFlowRepository | null = null;

export function getBusinessFlowRepository(): BusinessFlowRepository {
  if (repository) return repository;

  const backend = process.env.BUSINESS_FLOW_STORAGE ?? "sqlite";

  switch (backend) {
    case "sqlite":
      repository = new SqliteBusinessFlowRepository();
      return repository;

    case "snowflake":
      repository = new SnowflakeBusinessFlowRepository();
      return repository;

    default:
      throw new Error(
        `Unsupported BUSINESS_FLOW_STORAGE="${backend}". Implement BusinessFlowRepository for the target backend and register it in lib/storage/index.ts.`,
      );
  }
}
