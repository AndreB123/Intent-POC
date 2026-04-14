# Canonical Prompt

## Prompt

Create a baseline screenshot library for the demo-catalog source. The plan must turn the request into acceptance-ready work for the built-in catalog experience. It should publish a reviewable evidence package for GitHub and documentation stakeholders. It needs to leave a visible business process gate for baseline review. Do this so that product and engineering leads can inspect the baseline without reading implementation details.

## Real CLI Commands

Dry run:

```bash
npm run dev -- run --config ./intent-poc.yaml --intent "Create a baseline screenshot library for the demo-catalog source. The plan must turn the request into acceptance-ready work for the built-in catalog experience. It should publish a reviewable evidence package for GitHub and documentation stakeholders. It needs to leave a visible business process gate for baseline review. Do this so that product and engineering leads can inspect the baseline without reading implementation details." --dry-run
```

Completed baseline run:

```bash
npm run dev -- run --config ./intent-poc.yaml --intent "Create a baseline screenshot library for the demo-catalog source. The plan must turn the request into acceptance-ready work for the built-in catalog experience. It should publish a reviewable evidence package for GitHub and documentation stakeholders. It needs to leave a visible business process gate for baseline review. Do this so that product and engineering leads can inspect the baseline without reading implementation details." --mode baseline
```

## Why This Prompt Is Canonical

- It names the source explicitly with the exact source id.
- It includes prompt-driven acceptance language through `must`, `should`, and `needs to`.
- It includes a `so that` business outcome.
- It exercises planned destinations beyond controller artifacts by mentioning GitHub, documentation, and process-level rollout.
- It stays on the shared `runIntent` path without relying on the tracked-baseline demo-components special case.