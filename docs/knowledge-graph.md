# Business Knowledge Graph

The default company screen has two entry points: company activities and System Landscape. Activities contain configurable capabilities with explicit workflow assignments. Workflows own ordered Processes exposing Task details, departments, roles, manual/automatic/mixed execution, input/output Data, and executing System. Trigger, rule, and exception context describe meaningful automation without requiring a system design specification.

System, Tool, and Platform share canonical System identity. Configurable categories describe them without fixing the taxonomy in code. Profiles record purpose, owner, and declared dependencies. Groupware and Shadow IT have the same navigation as SAP, MES, LIMS, Snowflake, and infrastructure. SystemDataFlow records describe exports, email, APIs, and manual transcription. Workflow handoffs independently describe information/material and evidence.

## Explore the synthetic company

1. Choose **架空の化学メーカー300業務を開く**. The separate `chemical-demo` project preserves the default project. Choose Activity → Capability → factory Workflow → Process → Task.
2. Order registration shows SAP price, credit, ATP, MRP, and inventory rules with relevant inputs. Click a process to inspect Tasks or edit execution context.
3. Click Teams/SharePoint to inspect notification, judgment, collaborative editing, and file storage. Click Data to reverse the direction and find users and transfers.
4. System Landscape shows supported activities, departments, workflows, data, integration/export paths, and critical workflows. Network/identity/backup distinguish direct use from indirect impact through declared dependencies.
5. Current/Future comparison lists actual added/removed steps, manual transfers, and system changes. Three Future variants are available; order registration replaces three spreadsheet/manual steps with automatic API confirmation.
6. Search a factory/system and choose a department, then export the visible scope. Preview uses the in-memory model; downloadable Markdown uses the saved project. Wait for the saved indicator after edits. Back restores the prior focus and filters.

Large workflow/transfer lists are paginated. Data-flow diagrams group system pairs while preserving inspectable original transfers. Scenario projections separate Current/Future memberships.

## Persistence and interpretation

Optional `LensGraph.knowledge` is persisted in SQLite project `knowledge_json`; process context is in `details_json`. Older projects remain usable. Workflow replacement, scenario branching, canonical asset merging, and legacy normalization preserve/remap company relationships. Editors support company/activity/capability structure, assignments, criticality, handoffs, system categories, ownership, and dependencies. AI refinement preserves manually supplied execution context.

The fixture has 12 activities, 60 capabilities, 300 Current workflows plus three Future variants, 30 systems, 325 data assets, 3,002 processes (2,972 Current + 30 Future), and 310 workflow handoffs. The 300 workflows are factory/product implementations of 60 capabilities. Domain recipes differ across sales, procurement, manufacturing, quality, research, maintenance, accounting, HR, and IT. All evidence and dependencies are synthetic.

Impact counts follow registered relationships. Missing relationships do not demonstrate independence. The stored relationships support future analytics of duplication, manual boundaries, and groupware handoffs; automated scoring is not presented as a validated conclusion.

Seed manually with `npx tsx scripts/seed-chemical.ts`, then open `/?projectId=chemical-demo`. The seed refuses an existing sample; `--replace` explicitly resets only that synthetic project.
