# BusinessFlowLens

Turn interviews into a readable shared map of **business processes, systems, and data**.

This repository currently contains an interactive prototype built with Next.js and React Flow.

## What the prototype demonstrates

- Paste or edit an interview transcript.
- Extract business-process, system, and data nodes into one canonical graph.
- Show the graph as three readable layers.
- Switch between **All / Process / System / Data** views.
- Mark information as **confirmed / AI-inferred / unknown**.
- Select a node to inspect its description and evidence.
- Generate follow-up interview questions from missing or suspicious parts of the graph.

The current extractor is intentionally deterministic and local so the prototype works without credentials. The next step is to replace that adapter with a structured-output LLM implementation (Snowflake Cortex in App Runtime, or another provider in standalone deployments).

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Architecture direction

```text
Interview / notes
      |
      v
Graph extractor
      |
      v
Canonical graph
  nodes + edges + evidence
      |
      +---- Process view
      +---- System view
      +---- Data view
      +---- Combined view
```

The UI should never depend on an LLM-generated diagram layout. The model produces structured graph patches; the application owns identity resolution, rendering, editing, provenance, and later automatic layout.

## Planned adapters

- Snowflake App Runtime + Cortex structured output
- Standalone Next.js API provider
- Snowflake metadata / lineage enrichment
- Persistent graph repository
- ELK-based automatic layout for larger maps

## Status

Prototype branch: `prototype`

The current UI is a functional concept prototype, not yet a production application.
