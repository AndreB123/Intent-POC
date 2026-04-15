# Project Guidelines

## Architecture
`src/orchestrator/run-intent.ts` is the single execution pipeline for intent runs. Prefer extending that runner over creating parallel capture or comparison flows.

The current wrappers are intentional:
- `src/cli.ts run` calls `runIntent` directly for generic artifact-based runs.
- `src/demo-app/server/start-intent-studio-server.ts` previews or launches runs through `runIntent`.
- `src/demo-app/generate-demo-library.ts` is a convenience wrapper that now routes tracked demo screenshot regeneration through `runIntent` instead of maintaining a separate implementation.

## Screenshot Workflows
There are two screenshot storage contracts in this repo.

Generic sources use the artifact pipeline:
- captures under `artifacts/runs/<runId>/sources/<sourceId>/captures`
- comparison output under the same run directory
- screenshot library under `artifacts/library/<sourceId>/`
- approved baselines under `artifacts/library/<sourceId>/{components,views,pages,bdd,userflows}`

The built-in demo surface catalog uses a tracked screenshot contract:
- source id: `demo-components`
- tracked root: `artifacts/library/demo-components/{components,views,pages}`
- review happens through Git image diffs, not generated demo diff PNGs
- captures are staged under the run artifacts first and then upserted into the tracked root only after validation succeeds

Do not introduce another screenshot pipeline for demo surfaces. If the behavior needs to change, extend the tracked-baseline branch in `runIntent` or promote that behavior into a reusable generic capability.
Do not delete `artifacts/library/demo-components/` before regeneration. Preserve existing tracked screenshots until staged captures and validation have succeeded.

## Config Conventions
The sample config in `intent-poc.yaml` is the source of truth for runnable sources. If a built-in demo source needs many captures, prefer a config-declared catalog or helper-backed expansion over copying large inline capture lists into scripts.

`demo-components` intentionally uses the built-in `demo-surface-catalog` capture catalog and a tracked screenshot root. Keep that source aligned with `src/demo-app/model/catalog.ts`, `src/demo-app/capture/build-capture-items.ts`, and `src/demo-app/capture/screenshot-paths.ts`.

## Guardrails
Treat `src/capture/capture-target.ts`, `src/compare/run-comparison.ts`, and `src/evidence/screenshot-library.ts` as shared infrastructure. Avoid adding demo-only behavior there unless it is explicitly modeled as a generic option.

When changing the demo surface catalog or screenshot path mapping:
- run `npm run typecheck` and `npm test` after each meaningful code change, not only at the end
- update the catalog-driven helpers first
- remember that `npm test` now refreshes the tracked demo screenshot set; use `npm run demo:library` when you want to force the refresh directly
- use `npm run test:changed` only as a conservative local shortcut; it must escalate demo, theme, capture, evidence, config, and orchestrator changes to the full `npm test` workflow
- verify Git shows the PNG changes under `artifacts/library/demo-components/`
- treat screenshot refresh as an upsert workflow: existing tracked screenshots should survive failed validation or failed captures

## Verification
Use these commands after relevant changes:
- `npm run typecheck`
- `npm test`
- `npm run demo:library` when changing demo surfaces or tracked screenshot behavior and you want a direct refresh; the command runs `npm run typecheck` and `npm run test:code` before updating tracked screenshots