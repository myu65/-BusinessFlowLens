# BusinessFlowLens

Turn interviews into a readable shared map of **business processes, systems, and data**.

The core idea is that each business workflow has its own process nodes, while **systems and data are canonical shared entities across workflows**. That makes it possible to see not only one flow, but also questions such as:

- Which workflows depend on this ERP?
- Which teams read or update the same customer/order/inventory data?
- Where are spreadsheets duplicating data already held in a core system?
- Which system or data object is becoming a cross-business dependency?

## Prototype

The current prototype is built with Next.js and React Flow.

It demonstrates:

- Interview text per workflow.
- A canonical project graph shared across workflows.
- Business / System / Data layers.
- Cross-workflow reuse of System and Data nodes.
- "Shared" view for assets used by multiple workflows.
- Confirmed / AI-inferred / unknown states.
- Evidence shown per node.
- Follow-up questions generated from gaps and duplication.
- OpenAI Chat Completions compatible and Anthropic Messages compatible AI adapters.
- A local deterministic extractor when no AI endpoint is configured.

Two demo workflows are preloaded (order processing and returns) so shared ERP, email, order, and inventory concepts are visible immediately.

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Without AI environment variables the app uses the local demo extractor.

## AI endpoint configuration

BusinessFlowLens intentionally does not depend on a Snowflake-specific model SDK. The server adapter speaks either:

- OpenAI-compatible Chat Completions
- Anthropic-compatible Messages

Both use JSON Schema structured output.

The adapter deliberately omits optional sampling parameters such as `temperature` by default. OpenAI-compatible and Anthropic-compatible endpoints are not perfectly identical across every model family, and Snowflake may ignore or reject options that a specific routed model does not support. The prototype therefore sends the smallest portable request surface first.

Copy `.env.example` and configure:

```bash
AI_PROTOCOL=openai
AI_TARGET=cortex
AI_MODEL=...
# AI_BASE_URL=...   # optional in App Runtime
# AI_API_KEY=...    # local / non-Snowflake provider only
AI_AUTH_MODE=bearer
```

### Snowflake Cortex REST

For the OpenAI-compatible Cortex REST endpoint, the base URL is:

```text
https://<account>.snowflakecomputing.com/api/v2/cortex/v1
```

The adapter appends `/chat/completions`.

For the Anthropic-compatible Messages endpoint, use the corresponding base path before `/messages`.

### Snowflake Cortex AI Gateway

The gateway base path is:

```text
https://<account-host>/api/v2/aigateways/SNOWFLAKE/v1
```

The adapter appends either `/chat/completions` or `/messages`.

Current Snowflake behavior matters when choosing the protocol: Cortex REST Chat Completions can front multiple model families, while Cortex AI Gateway's Chat Completions route is for non-Claude models and its Messages route is for Claude models.

In Snowflake App Runtime, the adapter automatically reads the rotating OAuth service token from `/snowflake/session/token` for each request and derives the account host from `SNOWFLAKE_HOST` when `AI_BASE_URL` is omitted. That keeps Snowflake credentials out of source and environment files. `AI_API_KEY` remains only as a local/standalone fallback.

Set `AI_TARGET=cortex` for Cortex REST or `AI_TARGET=gateway` for Cortex AI Gateway. If your gateway uses a custom/private host, set `AI_BASE_URL` explicitly to the endpoint returned for that account.

## Canonical graph model

```text
Workflow A processes ─┐
                      ├──> Shared ERP ───> Shared order data
Workflow B processes ─┘          │
                                 └────> Shared customer data
```

Process nodes are workflow-scoped:

```text
process:order:check-inventory
process:return:lookup-order
```

System and Data nodes are global canonical identities:

```text
system:erp
system:email
data:order
data:inventory
```

Edges carry `workflowIds`. This is what allows several workflows to reuse the same system or data entity without duplicating that node.

## AI extraction contract

The model does **not** generate a diagram.

It returns a structured graph patch:

```text
interview
   ↓
OpenAI / Anthropic compatible structured output
   ↓
nodes + edges + questions
   ↓
canonical entity resolution / merge
   ↓
React Flow projection
```

The prompt includes existing canonical system/data nodes so the model can reuse identities such as `system:erp` instead of creating one ERP node per interview.

## Direction

Next steps:

- Runtime-native Snowflake auth/token resolver.
- Persistent graph repository.
- Human merge/split controls when entity resolution is ambiguous.
- ELK-based layout for larger graphs.
- Snowflake lineage and metadata enrichment.
- System/Data impact view ("show every workflow that touches this").
- Graph versioning and interview evidence history.

## Status

Prototype branch: `prototype`

The current UI is a functional concept prototype, not yet a production application.
