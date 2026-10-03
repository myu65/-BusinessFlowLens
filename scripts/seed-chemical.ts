import { createChemicalCompany } from "../lib/chemical-company";
import { getBusinessFlowRepository } from "../lib/storage";
const projectId =
  process.argv
    .find((arg) => arg.startsWith("--project-id="))
    ?.slice("--project-id=".length) || "chemical-demo";
const repo = getBusinessFlowRepository();
async function main() {
  if (
    (await repo.loadProject(projectId)) &&
    !process.argv.includes("--replace")
  )
    throw new Error(
      `${projectId} already exists. Choose a new --project-id to keep existing data.`,
    );
  const graph = createChemicalCompany();
  await repo.saveProject({
    projectId,
    projectName: graph.knowledge!.name,
    graph,
    transcripts: Object.fromEntries(
      graph.workflows.map((w) => [
        w.id,
        `${w.description}\n${graph.nodes
          .filter((n) => n.workflowId === w.id)
          .map((n) => n.label)
          .join("\n")}`,
      ]),
    ),
    updatedAt: new Date().toISOString(),
  });
  console.log(
    JSON.stringify({
      projectId,
      workflows: graph.workflows.length,
      systems: graph.knowledge!.systems.length,
      processes: graph.nodes.filter((n) => n.kind === "process").length,
      data: graph.nodes.filter((n) => n.kind === "data").length,
      handoffs: graph.knowledge!.handoffs?.length,
    }),
  );
}
void main();
