# BusinessFlowLens

Turn business interviews into a reviewable map of **workflows, systems, and data**.

BusinessFlowLens opens with a memo. Write what you know, check the proposed flow, correct or add to it, and save what you have confirmed. A workflow name and complete understanding are not prerequisites.

The main navigation has three entry points:

1. **話を入力** — write business notes, preview the structure before saving, and correct the selected step's action, person and result. Original evidence, uncertainty and human changes remain visible.
2. **会社の全体像** — see the saved work and registered handoffs, then explore activities, types of work, workflows and the people, tools and information they involve. Unclassified stories are visible too.
3. **詳しく調べる** — read workflows and information flows, investigate system/data dependencies, or compare workflows in a bounded usage matrix. These views use the structure accumulated through input.

## Why this model

Large cross-business graphs become unreadable quickly. The canonical graph is still stored underneath, but each screen is a projection answering a different question.

```text
Business input / interview notes
   ↓
current business model
   ↕
AI-assisted update + human editing
   ↓
workflow-scoped process steps
   │
   ├── uses → canonical systems
   └── reads/writes → canonical data

Canonical graph
   ├── Workflow detail projection
   ├── System-to-system data-flow projection
   ├── Asset impact projection
   └── Cross-business matrix projection
```

Process nodes belong to one workflow. System and Data nodes are canonical project-wide assets and can be shared by many workflows.

## Extraction pipeline

The AI pipeline is deliberately two-stage.

### 1. Evidence-first workflow extraction

The first call extracts the workflow while also receiving a compact read-only set of existing System/Data/Workflow candidates for context. It extracts:

- meaningful business steps
- actor/role, department/team, responsible person, and action
- explicit/inferred certainty
- short evidence from the interview
- named systems/tools
- business data read/created/updated/sent
- branches/conditions
- explicit System → System data transfers (including manual transcription)
- transfer method, automation, frequency, and evidence when stated
- focused follow-up questions
- ambiguity and duplicate-entry warnings

The prompt explicitly avoids inventing a system just because an activity such as "check inventory" exists.

### Context-aware extraction

The extraction call also receives a compact read-only view of existing Systems, Data, and Workflows. This helps interpret shorthand such as `ERP`, `SAP`, `基幹`, or references such as "いつもの出荷処理".

Existing catalog entries are **reference candidates only** at this stage:
- extraction does not assign canonical IDs
- extraction does not merge entities
- ambiguous aliases remain warnings/questions
- canonical identity is still resolved only when the reviewed draft is applied

### Current-model editing and AI-assisted updates

For an existing workflow, the right pane is the **current saved business model**, not an empty AI draft. Persisted steps, owners, System/Data references, and Data Flows are reconstructed into the editor immediately.

Users can edit the current model directly, or update the source notes and ask AI to revise that current model. AI receives the current human-edited model as context rather than starting from scratch.

AI-generated follow-up questions are interactive. Users can answer them in the model editor and ask AI to refine the model again. The refinement call receives the source notes, current human-edited model, follow-up Q&A, and existing company context. Answered questions and answers are retained as revision evidence.

### 2. Precision-first entity resolution

Only after the user applies that corrected draft does a separate call compare its System/Data mentions with the existing canonical assets.

Each candidate is classified as:

- `reuse` — clearly the same logical asset
- `create` — clearly distinct/new
- `uncertain` — identity cannot safely be proven

The resolver prefers `uncertain` over a false merge. Uncertain assets remain visible for human review rather than silently collapsing two different concepts.

### Save semantics

`/api/extract` proposes an updated working model; it never modifies the canonical graph directly. When the user chooses **この流れを保存**, `/api/apply` performs canonical System/Data resolution, updates the workflow structure, persists current state, and appends a workflow Revision.

## UI

### 話を入力

This is the create/update workspace for business workflows.

- start with an unnamed, incomplete business memo
- return to a saved story or draft through the optional picker
- adjust its workflow name and scenario when needed
- edit or replace the source interview/business notes
- see the already-saved workflow structure immediately
- see three steps at a time and read one person's action, tools, evidence and information change
- correct the current structure directly, with technical fields behind a disclosure
- append a continuation after a step without rewriting the earlier source
- review added, corrected and excluded steps before saving
- ask AI to update the current structure from new notes
- answer follow-up questions and refine the current model
- save the result back to the same Workflow ID
- browse historical revisions with original notes, summary, structure, follow-up Q&A, update time, and updater

On narrow screens, writing and reviewing are separate tabs; the memo is preserved when switching. Unknown actors, outcomes and connections remain unconfirmed. Without an AI connection, the simple extractor's proposed flow and extraction limits are labelled explicitly. See [the novice experience validation](docs/novice-experience-validation.md) for the tested inputs, operations and limits.

Updating an existing workflow replaces that workflow's Process structure and workflow-scoped relationships while preserving shared canonical System/Data assets and other workflows.

### Workflow scenarios and effective dates

Workflow revisions and workflow scenarios are separate concepts:

- **Revision** — a historical edit of the same workflow scenario, with update time and updater.
- **Scenario branch** — a separate workflow variant derived from another workflow, such as an AS-IS workflow and a future TO-BE workflow.

A workflow can carry:

- `familyId`
- `scenario` = `current | future | alternative`
- `scenarioLabel`
- `basedOnWorkflowId`
- `effectiveFrom`
- `effectiveTo`

The Business Input screen can branch the current structure into a future scenario. Process nodes are copied into the new Workflow ID while canonical System/Data assets remain shared. This allows a future design such as "manual PDF → SAP entry becomes API integration from 2027-04-01" without overwriting the current process.

### 業務フロー

Only the selected workflow is diagrammed. Process steps remain the primary visual structure. System/Data are displayed inside the relevant step card instead of occupying global lanes.

### データフロー

System-to-System flows are a first-class model rather than generic graph edges. The dedicated view shows:

- source and target System
- transferred Data
- API / file / database / message / email / manual / unknown method
- automatic / manual / mixed / unknown automation
- frequency and evidence
- related workflow steps, departments, and people

Manual re-entry such as Excel → ERP is intentionally shown alongside automated integration.

### システム・データ

Search/select an asset and inspect its impact:

- workflows using it
- exact process steps touching it
- use / read / update / send relationship

### 横断ビュー

No all-business graph. The overview shows:

- shared-asset ranking
- workflow structure status
- unresolved assets
- workflow × asset matrix

This remains readable as the number of interviews grows.

## Persistence

The prototype now persists current state in SQLite using Node 22's built-in `node:sqlite`.

The application does not call SQLite directly from UI or business logic. Persistence is behind:

```ts
interface BusinessFlowRepository {
  loadProject(...)
  saveProject(...)
  appendWorkflowRevision(...)
  listWorkflowRevisions(...)
  getWorkflowRevision(...)
}
```

The default implementation is `SqliteBusinessFlowRepository`. The backend is selected by:

```bash
BUSINESS_FLOW_STORAGE=sqlite
BUSINESS_FLOW_SQLITE_PATH=.data/business-flow-lens.sqlite
```

Current state is stored in normalized tables for projects, workflows, graph nodes, graph edges, and system data flows. Workflow revisions are append-only snapshots containing source notes, final structured review, follow-up Q&A, scenario/effective-date metadata, updater, and update time.

This interface is intentionally the migration boundary for a future `SnowflakeHybridTableRepository`; UI and AI extraction code should not depend on the storage implementation.

## AI API compatibility

BusinessFlowLens uses standard structured-output HTTP APIs rather than a Snowflake-specific model SDK.

Supported protocol shapes:

- OpenAI-compatible Chat Completions
- Anthropic-compatible Messages

Snowflake Cortex REST supports structured output for both API shapes, and Cortex AI Gateway exposes standard OpenAI/Anthropic-compatible endpoints. The adapter intentionally sends a small portable parameter surface and does not set optional sampling parameters such as `temperature` by default.

### Environment

```bash
AI_PROTOCOL=openai
AI_TARGET=cortex
AI_MODEL=<model>

# Usually omitted in Snowflake App Runtime:
# AI_BASE_URL=...
# AI_API_KEY=...
```

`AI_TARGET` can be:

- `cortex` — Cortex REST
- `gateway` — Cortex AI Gateway

In Snowflake App Runtime, the adapter reads the rotating service token from:

```text
/snowflake/session/token
```

on each request. When `AI_BASE_URL` is omitted it derives the Snowflake account host from the runtime environment. For local or non-Snowflake development, set `AI_BASE_URL` and `AI_API_KEY`.

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Without AI configuration the application falls back to a deterministic local demo extractor so the UI can still be explored.

### Local AI through Codex

An optional local transport uses the installed [Codex App Server](https://developers.openai.com/codex/app-server/) and its existing login. For a local developer machine with `codex` on PATH, check `codex login status`, then add to the ignored `.env.local`:

```bash
AI_RUNTIME=codex
AI_MODEL=gpt-6-luna
AI_REASONING_EFFORT=medium
AI_TIMEOUT_MS=120000
```

Restart the server after changing configuration. `AI_CODEX_COMMAND` can point to the installed executable if PATH does not contain it. This local transport requires that exact model to be available to the signed-in account; it stops if the model is unavailable, without choosing another model. It creates ephemeral inference sessions with tools and environment access disabled, and never reads or copies login credentials. It requires a local Node server and is not a Snowflake deployment configuration.

The input screen distinguishes configuration from a successful model response and records the model used for each extracted structure. An AI failure leaves the source and previous candidate intact; it does not silently replace the result with the simple extractor. Automated adapter tests use mocks; real AI input testing is recorded separately in [the input growth audit](docs/ai-input-growth-validation.md).

## Canonical model

Examples:

```text
process:order:receive-order
process:return:lookup-order

system:erp
system:email

data:order
data:inventory
```

Process nodes are workflow-scoped. System/Data identities are project-wide.

## Next important work

- explicit merge/split UI for uncertain shared assets
- add/reorder steps and System/Data mentions directly in the review
- Snowflake Hybrid Table repository implementation
- explicit restore/compare actions for historical revisions
- Snowflake metadata / lineage enrichment
- automatic suggestions such as duplicate entry, high-impact shared systems, and unclear data ownership

## Status

Current feature work is tracked in issue #2 / PR #3.


## Ownership and related-node navigation

Process steps can carry a department/team and responsible person separately from the generic actor/role. Workflow, Data Flow, Asset Impact, and Cross-business views can be filtered by those fields.

Clicking a Process/System/Data node opens a node-centered relationship explorer instead of expanding the entire company graph. The panel shows the immediate relevant neighborhood and lets users continue navigating through related nodes and data flows.


## Progressive understanding (Issue #6)

The Workflow screen opens at **鳥瞰**: select the scope and topic to inspect business classifications, product perspectives, common processes/site variants, material/data continuity, or business data usage. Select **手順を読む** to open **業務通常**, then switch to **詳細** to inspect the selected step's child operations, conditions and technical information. All three views read the same saved graph; changing the view does not edit it.

In Business Input, expand **詳細を補足する** on a step to record ordered child operations and optional SAP module, transaction/app, HANA area/schema, physical table/view and evidence. Multiple technical records can be attached to a step. Unknown fields remain empty; existing graphs migrate automatically through the SQLite `details_json` column. Revisions retain these details.

In System / Data, expand **同じシステム・データの表記を統合する**, choose a destination and inspect the affected workflows, steps and transfers. Confirm that the assets represent the same environment before applying. The original name is retained as a confirmed alias; subsequent extraction/application and search can reuse it. Different environments remain separate unless the user explicitly merges them. Individual workflows and recorded transfers are retained.

Without an AI endpoint, extraction segments the original notes and labels the result as a candidate requiring review. It does not invent domain-specific transactions, owners or integrations. Explicit technical labels such as `トランザクション: Z_ORDER、スキーマ: BUSINESS、ビュー: ORDER_VIEW` can be recorded locally. Local follow-up answers are retained as evidence; semantic refinement requires the AI connection. Human detail records are protected during AI refinement, with conflicts surfaced for review.

### Validation

```bash
npm test
npm run typecheck
npm run build
```

`tests/refinement.test.ts` covers ambiguous input, separate SAP environments, merge references and aliases, preservation of manual refinements, SQLite migration/revisions, and both supported AI protocol adapters using mock servers. CI runs these tests.

`tests/live-openrouter.ts` is an opt-in live check using synthetic notes. Set `AI_PROTOCOL=openai`, `AI_BASE_URL=https://openrouter.ai/api/v1`, `AI_MODEL=openai/gpt-6-luna` and `AI_API_KEY` in the process environment, then run `npx tsx tests/live-openrouter.ts`. Credentials are never logged or written to the results. Synthetic results are saved under the ignored `.data/qa-issue6/` directory.

## System-internal automation

Workflow Process steps distinguish *who/what executes the work* from who owns it.

```text
executionMode = manual | automatic | mixed | unknown
executingSystem = optional System mention
```

Examples:

- "営業がSAPへ入力" → manual Process using SAP.
- "SAPが自動で在庫を引き当てる" → automatic Process executed by SAP.
- "担当者が承認するとERPが自動計上する" → mixed or separate manual/automatic steps depending on the described business meaning.

System-internal automatic execution is intentionally different from System-to-System Data Flow. A System performing work internally is a Process execution concern; information moving between Systems is a Data Flow concern.

## Business Input UX

The working-model editor supports direct editing without requiring another AI pass:

- add/delete/reorder Process steps
- edit execution mode and executing System
- edit role, department, and responsible person
- add/edit/remove System references and interactions
- add/edit/remove Data references and operations
- edit step-to-step transitions and branch conditions
- add/edit/remove System-to-System Data Flows
- collapsible model sections and a wider editor layout
- confirmation for destructive edits
- execution-mode filtering in Workflow view


## Scoped business landscapes (Issue #7)

Register multiple business domains, site, product identity/perspective, common process identity, implementation differences and material handoffs in the overview editor. Filter the scope, follow direct relationships, and pin workflows of interest. Preferences are retained in the current browser. Material handoffs distinguish verified data correspondence, verified breaks, and unknown correspondence; missing records do not prove a break. Site implementations keep separate process steps linked by an explicit common-process ID.

See [overview design](docs/overview-design.md) and [landscape design](docs/landscape-design.md) for research, interpretation boundaries, persistence and examples. Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:regression` for local validation.

## Company knowledge graph

Choose **架空の化学メーカー300業務を開く** on the company screen to create/load the separate synthetic project. See [model and exploration guide](docs/knowledge-graph.md) and [actual browser validation](docs/knowledge-validation.md).
