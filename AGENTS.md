# Project Guidelines

## Architecture
`src/orchestrator/run-intent.ts` is the single execution pipeline for intent runs. Prefer extending that runner over creating parallel capture or comparison flows.

The current wrappers are intentional:
- `src/cli.ts run` calls `runIntent` directly for generic artifact-based runs.
- `src/demo-app/server/start-intent-studio-server.ts` previews or launches runs through `runIntent`.
- `src/demo-app/generate-surface-library.ts` is a convenience wrapper that now routes tracked surface-library screenshot regeneration through `runIntent` instead of maintaining a separate implementation.

All runtime wrappers must build `runIntent` options through the shared runtime policy helper in `src/runtime/build-runtime-run-intent-options.ts`. Do not let Studio, CLI, or tracked-library refresh drift into entrypoint-specific publish behavior for the same source.

## Screenshot Workflows
There is one persistent artifact contract in this repo, rooted under `artifacts/`.

Persistent artifacts use fixed deterministic paths:
- business-level artifacts under `artifacts/business/`
- per-source artifacts under `artifacts/sources/<sourceId>/`
- tracked screenshots under `artifacts/library/<sourceId>/`
- approved baselines under `artifacts/library/<sourceId>/{components,views,pages,bdd,userflows}`

For sources with `capture.publishToLibrary: true`, screenshot PNGs should have one durable home only: `artifacts/library/<sourceId>/`. Do not keep a second persisted copy under `artifacts/sources/<sourceId>/captures` for those runs.

Do not introduce per-run artifact directories as a durable output model. `runId` may exist as audit metadata inside files, but it must not control persistent folder naming or file locations.

The built-in demo surface catalog uses the same persistent contract:
- source id: `intent-poc-app`
- tracked root: `artifacts/library/intent-poc-app/{components,views,pages}`
- review happens through Git image diffs, not generated demo diff PNGs

Do not introduce another screenshot pipeline for demo surfaces. If the behavior needs to change, extend `runIntent` or promote that behavior into a reusable generic capability.
Do not delete `artifacts/library/intent-poc-app/` before regeneration. Preserve existing tracked screenshots until replacement output has been written successfully.
`cleanBeforeRun` is transient-only cleanup: remove legacy `artifacts/runs` output plus per-source `attempts` and `logs`, preserve durable outputs under `artifacts/business/`, preserve `artifacts/sources/<sourceId>/captures` for non-library sources, and preserve `artifacts/library/<sourceId>/` for tracked-library sources.

## Config Conventions
The sample config in `intent-poc.yaml` is the source of truth for runnable sources. If a built-in demo source needs many captures, prefer a config-declared catalog or helper-backed expansion over copying large inline capture lists into scripts.

`intent-poc-app` intentionally uses the built-in `surface-library` capture set and the tracked screenshot root. Keep that source aligned with `src/demo-app/model/catalog.ts`, `src/demo-app/capture/build-capture-items.ts`, and `src/demo-app/capture/screenshot-paths.ts`.

Reusable UI-state verification context belongs in `sources.<id>.planning`, not in prompt-specific routing rules. Prefer `planning.verificationNotes` plus `planning.uiStates` for states such as theme, density, mocked app state, or route-driven modes that need explicit activation during verification.
For theme-sensitive UI bugs, treat dark-mode evidence as paired evidence: capture both a light-mode reference screenshot and a dark-mode target screenshot in the tracked Playwright `bdd/` or `userflows/` outputs instead of trusting a dark-only capture set.

## Demo UI Architecture
Intent Studio at `/` is the source of truth for reusable demo-app UI. The `/library` catalog must stay a stable showcase and screenshot surface, but it should be backed by shared app render helpers/components rather than a second parallel mock UI tree.

When editing demo-app rendering:
- extract shared UI from `src/demo-app/render/render-intent-studio-page.ts` first
- keep `/library`, current surface ids, and tracked screenshot paths stable while migrating internals
- treat `src/demo-app/primitives/render-primitive.ts`, `src/demo-app/components/render-component.ts`, `src/demo-app/views/render-view.ts`, and `src/demo-app/pages/render-page.ts` as compatibility adapters during migration, not the long-term source of truth

## Guardrails
Treat `src/capture/capture-target.ts`, `src/compare/run-comparison.ts`, and `src/evidence/screenshot-library.ts` as shared infrastructure. Avoid adding demo-only behavior there unless it is explicitly modeled as a generic option.

When changing the demo surface catalog or screenshot path mapping:
- run `npm run typecheck` and `npm test` after each meaningful code change, not only at the end
- update the catalog-driven helpers first
- remember that `npm test` now refreshes the tracked surface-library screenshot set; use `npm run library:refresh` when you want to force the refresh directly
- use `npm run test:changed` only as a conservative local shortcut; it must escalate demo, theme, capture, evidence, config, and orchestrator changes to the full `npm test` workflow
- verify Git shows the PNG changes under `artifacts/library/intent-poc-app/`
- treat screenshot refresh as an upsert workflow: existing tracked screenshots should survive failed validation or failed captures

## Verification
Use these commands after relevant changes:
- `npm run typecheck`
- `npm test`
- `npm run library:refresh` when changing demo surfaces or tracked screenshot behavior and you want a direct refresh; the command runs `npm run typecheck` and `npm run test:code` before updating tracked screenshots