# Intent POC Canonical BDD Sample

This directory is the checked-in sample artifact set for the canonical single-source Intent POC flow.

## Why This Exists

The live workflow now writes to stable paths under `artifacts/business/` and `artifacts/sources/<sourceId>/`. This sample directory keeps the canonical planning and completion artifacts in version control so AI and humans have a stable template to read.

The bundle is split into two parts:

- dry-run planner artifacts generated from the real repo config and CLI path
- completion summaries generated from the executable canonical sample suite and sanitized for dynamic run ids

The checked-in artifacts are:

- `normalized-intent.json`
- `plan-lifecycle.json`
- `business-summary.md`
- `source-summary.md`
- `prompt.md`
- `template-map.md`

The JSON snapshots are derived from the real CLI dry-run for the canonical prompt and normalized only where values are intentionally dynamic:

- `intentId`
- `receivedAt`
- `runId`
- `updatedAt`

The markdown summary snapshots are normalized only where audit-only dynamic values appear:

- `Run ID`

Everything else is kept as the real structured sample output that the runner currently produces.

## Canonical Prompt

Create a baseline screenshot library for the surface library source. The plan must turn the request into acceptance-ready work for the built-in surface library. It should publish a reviewable evidence package for GitHub and documentation stakeholders. It needs to leave a visible business process gate for baseline review. Do this so that product and engineering leads can inspect the baseline without reading implementation details.

The prompt intentionally uses the legacy `surface library` wording. The live runner resolves that alias onto the single configured app source, `intent-poc-app`, while preserving the historical three-capture baseline scope.

## What To Read

- `normalized-intent.json` is the machine-readable sample AI should build from.
- `plan-lifecycle.json` shows the dry-run orchestration artifact the real CLI writes before execution.
- `business-summary.md` shows the full completed-run business summary shape.
- `source-summary.md` shows the full completed-run per-source summary shape.
- `prompt.md` is the canonical prompt with exact run commands.
- `template-map.md` explains how prompt wording maps into acceptance criteria, BDD scenarios, TDD work items, sources, destinations, and tools.

## Why We Know It Is Good

1. `src/orchestrator/run-intent.bdd-sample.behavior.test.ts` runs the canonical prompt through the shared runner and verifies the expected BDD/TDD plan and business summary behavior.
2. The same suite runs a dry run against the real repo config and compares the live `normalized-intent.json` and `plan-lifecycle.json` outputs against the checked-in snapshots in this directory.
3. The completed-run sample test compares the generated business summary and generated source summary against the checked-in markdown snapshots in this directory.
4. `src/intent/normalize-intent.test.ts` contains a regression test for the overlapping-alias bug that initially caused this prompt to select the wrong sources.
5. The canonical prompt has been verified through the real CLI entrypoint with `npm run dev -- run --config ./intent-poc.yaml --intent "<prompt>" --dry-run`.

## Refresh Workflow

When the intended canonical sample structure changes:

1. Update the canonical prompt or expectations in `src/intent/intent-poc-bdd-sample.ts`.
2. Run the canonical dry-run command through the real CLI.
3. Update the sanitized snapshots in this directory.
4. Run `npm run typecheck` and `npm test`.