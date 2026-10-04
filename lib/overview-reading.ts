import type { buildOverview } from "./overview";

export type OverviewView = ReturnType<typeof buildOverview>;
export const OVERVIEW_WORKFLOW_PAGE = 12;
export const OVERVIEW_DATA_PAGE = 20;

// A display window never changes the scope or the facts in the source view.
export function readingPage<T>(items: readonly T[], requested: number, size: number) {
  const last = Math.max(0, Math.ceil(items.length / size) - 1);
  const page = Number.isFinite(requested) ? Math.max(0, Math.min(Math.floor(requested), last)) : 0;
  return { items: items.slice(page * size, (page + 1) * size), page, total: items.length,
    start: items.length ? page * size + 1 : 0, end: Math.min(items.length, (page + 1) * size), last };
}

export function overviewDataWindow(view: OverviewView, workflowPage: number, dataPage: number,
  workflowQuery = "", dataQuery = "") {
  const matches = (name: string, query: string) => name.toLocaleLowerCase("ja").includes(query.trim().toLocaleLowerCase("ja"));
  return {
    workflows: readingPage(view.workflows.filter(w => matches(w.name, workflowQuery)), workflowPage, OVERVIEW_WORKFLOW_PAGE),
    data: readingPage(view.data.filter(d => matches(d.asset.label, dataQuery)), dataPage, OVERVIEW_DATA_PAGE),
  };
}
