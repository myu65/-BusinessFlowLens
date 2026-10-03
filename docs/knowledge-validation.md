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

## Continuous flow and incremental notes

Repeated actual production-browser addition/reading cycles on Chiba order registration:

1. Added a one-sentence manual Excel → Teams transfer of **納期差異確認リスト** after the existing adjustment step. Read the process inputs/action/output and traced its data.
2. Added Teams → SharePoint manually. The same data asset was reused, and both processes appeared in order with their department, person and tools.
3. Added SharePoint → Snowflake automatic execution. Verified the explicit executing system and three transfer paths, then expanded to rules/tasks without changing the selected data or process.
4. Added the preceding Excel creation action to make the information origin visible. The final trace has creation → manual transfer → manual sharing → automatic integration. No asset IDs or canvas drawing were entered in these cycles.

A temporary confirmation step was added and undone between cycles 3 and 4; the three earlier additions and their references survived. SQLite reload and comparison to the saved pre-edit graph verified preservation of every original node (apart from step order), all workflow/company metadata, the three Future workflows, and the default project's two workflows. Final sample: 300 Current + 3 Future workflows, 3,006 processes, 326 data assets, and 18 steps in the enriched workflow. The four new steps share one new data asset and three explicit transfers; all added facts are inferred synthetic notes, with no invented protocol, frequency or decision rules. A saved one-workflow report contains the creation and automatic notes, their data, and the original credit rule.

Observed problems and repairs: Teams was matched as the embedded acronym EAM and received a wrong equipment explanation; Latin acronym boundaries and groupware explanations now prevent this. Data-flow navigation initially reopened the first catalog workflow instead of the explored order workflow; focus now carries across that navigation. Repeated system/data labels made the trace bulky; the trace now displays compact transfer paths and puts protocol/evidence behind disclosure. Automatic steps name the executing system directly. A tool selected from a trace also selects its related process before showing its explanation.

Browser journeys also verified Current/Future isolation, data-flow transfer → business process → tool purpose, zoom out/in with the same information selected, and original SAP credit-limit input → rule/hold exception → two individual tasks. The final reader exposes at most five groups, three neighboring steps, or five data-related steps at a time. Group summaries include their registered first input and last output. Full diagrams and technical fields are optional.

Verification: 50 unit tests, 27 production API/persistence checks, typecheck and production build pass. New tests cover append/reuse/reload, references and scenario isolation, unknown facts, ambiguous aliases and punctuation, conditional route preservation, and rejection of branching notes. Browser extraction used the local grounded parser; live external AI credentials were not part of this exercise. Screenshots and before/after snapshots are saved locally under `.data/qa-knowledge/`.
