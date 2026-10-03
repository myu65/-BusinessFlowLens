# Validation record — 2026-10-03

Validated the production build in the Codex in-app browser at `http://localhost:3106/?projectId=chemical-demo`. This is an agent-operated exploration exercise, not an independent human usability study.

## Actual browser journeys

- Company → order-to-cash Activity → order-registration Capability → Chiba resin Workflow → credit-check Process → two Tasks. Verified SAP, order and credit-limit/debt inputs, trigger, rule, and hold/escalation exception.
- Edited the credit-check exception, verified saved SQLite API value, reloaded and navigated back to verify persistence, then restored the original text. Default project retained its original two workflows.
- Current → order-registration Future: verified added API confirmation and three removed spreadsheet steps, manual transfers 5 → 1. Back restored Current scope and workflow.
- Opened the workflow diagram and searched the large workflow picker. Data-flow navigation retained the selected workflow and showed nine original transfers, five manual, and SAP/groupware/ETL/Snowflake/BI paths.
- SAP reverse impact under Chiba / order-management filters returned five workflows. Teams and SharePoint showed departments, notification/judgment and collaboration/storage processes, data, and neighboring systems. Data reverse navigation showed process users and eight transfer paths.
- Snowflake showed activity, departments, inbound ETL and outbound BI. Network with cleared filters showed all twelve activities, zero direct workflows, and 300 indirect workflows through declared system dependencies.
- Scoped company report contained five workflows and their rules, inputs, transfers, and handoffs. Downloaded Markdown through the UI and checked the original credit exception and credit-limit data.

## Problems found and repaired

- Hundreds of horizontal workflow tabs: searchable selector for large catalogs.
- Missing company metadata after persistence: repaired SQLite project load/save and tested roundtrip.
- Mixed Current/Future relationships: scoped graph/transfer projections with regression coverage.
- Hundreds of parallel data-flow edges: grouped system pairs, original transfer details, and pagination.
- Lost focus/filter history: preserved company exploration and back navigation.
- Human confirmation marked automatic and fake SAP-to-SAP API: explicit automatic recipe markers and real inter-system API records.
- Added concrete SAP decision inputs and cross-department handoffs so workflows connect as company structure.

## Automated verification

- `npm test`: 40 passing tests, including six semantic knowledge tests for fixture integrity, automation/groupware impact, transitive/cyclic dependencies, scoped reports/comparison, flow aggregation, persistence, replacement, branching, and merges.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run test:regression`: 24 passing API/persistence checks, including report scope, invalid scenario, missing project, and empty workflow selection.

CI runs the same checks on Node 22 / Ubuntu. Local checks used Node 24 / Windows. Implementation PR tracks CI and merge results.

## First-time reading revision

The company entry now explains the reading path and provides a concrete first-workflow example. The bird view focuses on one activity with incoming handoffs, responsible departments, and outgoing handoffs, instead of presenting every edge at once. Selecting a neighboring activity continues the exploration. Only registered handoffs inside the current scope are shown.

The company and workflow pages share a reader that groups consecutive steps by execution mode and department. It initially exposes at most five groups and one selected step. That step shows information received → action/tools → information produced, alongside its explicit system transfers. Additional data items, full diagrams, comparison and technical details are disclosed on demand. Business acronyms receive plain Japanese explanations.

Production browser verification confirmed company bird-view selection, incoming delivery records and outgoing planning/accounting handoffs, order registration's five groups, credit inputs and rule explanation, detail → return to the same step, SAP impact → return to the same step, workflow-page integrated reading, and SAP → Excel manual transfer displayed beside the selected adjustment step. The workflow bird-view toggle showed the same activity-centered view. Narrow in-app layout rendered the three information regions vertically in readable order. No independent human usability study is claimed.

The revised suite has 43 passing tests, including ordered-step preservation in groups, scope-safe cross-activity aggregation, and acronym explanation. Typecheck, production build and all 24 API regressions pass.
