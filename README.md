# BusinessFlowLens

Turn business interviews into a reviewable map of **workflows, systems, and data**.

BusinessFlowLens is not intended to be a "put every node on one giant canvas" diagramming tool. The prototype is organized around four concrete jobs:

1. **Business input** — create a new workflow or edit an existing workflow's name, description, source notes, and AI-derived structure.
2. **Workflow** — understand one business workflow step-by-step, including department, responsible person, systems, and data touched at each step.
3. **Data flow** — understand what business data moves between systems, how it moves, and whether the transfer is automatic or manual.
4. **System / Data impact** — select a shared asset and see which workflows, departments, people, and steps depend on it.
5. **Cross-business overview** — compare workflows through shared assets and a workflow × asset usage matrix instead of a spaghetti graph.

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

`/api/extract` proposes an updated working model; it never modifies the canonical graph directly. When the user chooses **業務構造を保存**, `/api/apply` performs canonical System/Data resolution, updates the workflow structure, persists current state, and appends a workflow Revision.

## UI

### 業務入力

This is the create/update workspace for business workflows.

- create a new workflow
- select an existing workflow
- edit its workflow name and description
- edit or replace the source interview/business notes
- see the already-saved workflow structure immediately
- edit the current structure directly
- ask AI to update the current structure from new notes
- answer follow-up questions and refine the current model
- save the result back to the same Workflow ID
- browse historical revisions with original notes, summary, structure, follow-up Q&A, update time, and updater

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
