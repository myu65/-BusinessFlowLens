# BusinessFlowLens

Turn business interviews into a reviewable map of **workflows, systems, and data**.

BusinessFlowLens is not intended to be a "put every node on one giant canvas" diagramming tool. The prototype is organized around four concrete jobs:

1. **Interview** — capture what people say and review the AI extraction before it changes the model.
2. **Workflow** — understand one business workflow step-by-step, including department, responsible person, systems, and data touched at each step.
3. **Data flow** — understand what business data moves between systems, how it moves, and whether the transfer is automatic or manual.
4. **System / Data impact** — select a shared asset and see which workflows, departments, people, and steps depend on it.
5. **Cross-business overview** — compare workflows through shared assets and a workflow × asset usage matrix instead of a spaghetti graph.

## Why this model

Large cross-business graphs become unreadable quickly. The canonical graph is still stored underneath, but each screen is a projection answering a different question.

```text
Interview
   ↓
evidence-first AI draft
   ↓
human review
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

The first call does **not** see the existing canonical asset catalog. It extracts:

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

### Human review and correction

The first call returns only a draft. Before any canonical resolution happens, the user can edit the summary, start/end conditions, step name, actor, and action, and remove incorrectly extracted steps or System/Data mentions.

### 2. Precision-first entity resolution

Only after the user applies that corrected draft does a separate call compare its System/Data mentions with the existing canonical assets.

Each candidate is classified as:

- `reuse` — clearly the same logical asset
- `create` — clearly distinct/new
- `uncertain` — identity cannot safely be proven

The resolver prefers `uncertain` over a false merge. Uncertain assets remain visible for human review rather than silently collapsing two different concepts.

### Review before apply

`/api/extract` returns the editable review draft only. It does not modify or even resolve against the canonical graph. When the user chooses **修正内容を反映**, `/api/apply` performs asset resolution against the corrected draft and then updates the canonical graph.

## UI

### ヒアリング

Create/select a workflow, paste rough interview notes, run structured extraction, and review the AI draft.

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
- persistence and graph version history
- evidence history across repeated interviews
- Snowflake metadata / lineage enrichment
- automatic suggestions such as duplicate entry, high-impact shared systems, and unclear data ownership

## Status

Prototype work is on the `prototype` branch / PR #1.


## Ownership and related-node navigation

Process steps can carry a department/team and responsible person separately from the generic actor/role. Workflow, Data Flow, Asset Impact, and Cross-business views can be filtered by those fields.

Clicking a Process/System/Data node opens a node-centered relationship explorer instead of expanding the entire company graph. The panel shows the immediate relevant neighborhood and lets users continue navigating through related nodes and data flows.
