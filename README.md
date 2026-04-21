# Intent POC

CLI-driven proof of concept for intent-driven visual evidence capture, with a built-in demo UI for local testing.

The controller accepts a free-text intent, normalizes it into a bounded run plan, creates or updates Linear issues, attaches to one or more external source apps, runs Playwright screenshots, stores evidence artifacts, computes hashes, and compares against baselines.

For sources that opt into `capture.publishToLibrary: true`, screenshot PNGs now persist in one place only: `artifacts/library/<sourceId>/`. The source evidence lane still writes manifests, hashes, summaries, and other metadata under `artifacts/sources/<sourceId>/`, but it no longer keeps a second durable copy of the same screenshots under `artifacts/sources/<sourceId>/captures`.

Runtime entrypoints now share one run policy surface. `npm run dev -- run`, Intent Studio live runs, and `npm run library:refresh` all build `runIntent` options through the same runtime helper so tracked surface-library sources do not drift into different publish behavior depending on how the run was launched.

## Current Status

The initial implementation includes:
- single-file YAML configuration
- config validation and env expansion
- bounded intent normalization
- repo-context planning metadata derived from configured source shortlist
- multi-source execution planning
- Linear parent/child issue/comment/state integration
- explicit Linear resume support with planner-managed issue sections
- source workspace resolution for local and git sources
- app install/start/readiness handling
- Playwright capture pipeline
- business-run and per-source evidence output with manifest, hashes, comparison JSON, and markdown summary
- optional dual-destination artifact publishing (`controller` or `both`)

## Setup

1. Install dependencies.
2. Install the Chromium browser for Playwright.
3. Copy `.env.example` to `.env` and fill in required values.
4. Update `intent-poc.yaml` to point at a real source app.

```bash
npm install
npm run install:browsers
cp .env.example .env
```

To enable live Gemini planning, set `GEMINI_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY` in `.env` or the process environment and configure the `agent` block with `provider: gemini` plus per-stage models under `agent.stages`. The checked-in `intent-poc.yaml` intentionally stays rules-backed by default so dry runs, tests, and canonical snapshots remain deterministic. `intent-poc.local-no-linear.yaml` is the live Gemini example config in this repo, uses current `models/...` Gemini ids, and enables implementation plus QA for the built-in Intent Driven Development POC demo sources rather than `client-systems`.

The current Gemini stage split is:
- `promptNormalization`: bounded prompt interpretation, source scope hints, and capture hints. Default in this repo: `models/gemini-3.1-flash-lite-preview`. Alternate fast preview: `models/gemini-3-flash-preview`.
- `linearScoping`: issue and lane shaping before implementation planning expands. Default in this repo: `models/gemini-3.1-flash-lite-preview`.
- `bddPlanning`, `tddPlanning`, `implementation`, and `qaVerification`: deeper planning and execution passes. Default in this repo: `models/gemini-3.1-flash-lite-preview`. Alternate preview options: `models/gemini-3.1-pro-preview` and `models/gemini-3-pro-preview`.

This path uses the Gemini API key directly. A Google Cloud service account is not used for Gemini Developer API authentication.

The default config now includes an interim concrete source profile for:
- `client-systems-roach-admin` (git clone of `https://github.com/geniusmonkey/client-systems`)
- startup command: `docker compose up -d roach`
- captured endpoint: Cockroach admin UI on `http://127.0.0.1:8090`

If the repo is private in your environment, set `CLIENT_SYSTEMS_GIT_TOKEN`.

## Demo UI

Start the built-in Intent Studio UI:

```bash
npm run demo:serve
```

To run Studio with the live Gemini example config:

```bash
npm run demo:serve -- --config ./intent-poc.local-no-linear.yaml
```

Then open:

```text
http://127.0.0.1:6010/
```

The prompt screen now lets you:
- submit an intent prompt
- choose work scope from config-backed checkbox cards
- edit source labels and repo context directly in Studio
- open the active config in the editor when you need structural source changes
- override Gemini models per AI stage
- watch live orchestration status
- inspect Linear activity when enabled
- open summaries, manifests, logs, screenshots, and diff images

The asset library is still available at:

```text
http://127.0.0.1:6010/library
```

Intent Studio at `/` is the source of truth for shared demo-app UI. The `/library` catalog is a showcase and verification surface that should reuse shared render helpers/components from the app instead of growing a second parallel UI implementation.

You can switch demo library variants in the browser with:

```text
http://127.0.0.1:6010/library?variant=v2
```

The sample `intent-poc.yaml` now starts with one visible Studio scope source: `Current app`. Add more repos under `sources` when you want broader scope.

## Run

Out-of-the-box baseline run against the built-in demo source:

```bash
npm run dev -- run --config ./intent-poc.yaml
```

Dry run:

```bash
npm run dev -- run --config ./intent-poc.yaml --intent "Create and maintain a screenshot library for the configured source" --dry-run
```

Live Gemini dry run using the example local config:

```bash
npm run dev -- run --config ./intent-poc.local-no-linear.yaml --source intent-poc-app --intent "Prepare a lightweight visual evidence review for the intent-poc-app source in the Intent Driven Development POC so the current built-in demo experience is easy to inspect." --dry-run
```

`--source` now requests source scope rather than overriding a single source. Repeat the flag or pass a comma-separated list when the run should stay inside a specific set of configured sources.

Studio work scope cards are driven by YAML. The display name comes from `sources.<id>.studio`, while the contextual repo text comes from `sources.<id>.planning`. You can edit the user-facing label, repo label, role, and summary directly in the Studio Source Metadata panel.

```yaml
sources:
	intent-poc-app:
		planning:
			repoLabel: Intent POC
			summary: Current workspace used for intent planning and demo evidence flows.
		studio:
			displayName: Current app
```

Use the `Open config in editor` action in the Studio when you want to add, remove, or structurally change sources. Use the in-Studio editor when you only need to rename a source or improve its context.

Reusable UI-state verification context belongs on the source, not in prompt-specific planner rules. Use `planning.verificationNotes` for durable evidence caveats and `planning.uiStates` for states that verification may need to activate explicitly.

```yaml
sources:
	intent-poc-app:
		planning:
			verificationNotes:
				- Verify the requested UI state before trusting screenshot evidence.
			uiStates:
				- id: theme-mode
					label: Theme mode
					description: The demo app supports light and dark themes that affect screenshots.
					activation:
						- type: ui-control
							target: "[data-testid='theme-toggle']"
							values:
								light: "false"
								dark: "true"
					verificationStrategies:
						- ui-interaction-playwright
				- id: density-mode
					label: Density mode
					description: The demo app supports compact and comfortable spacing presets.
					activation:
						- type: query-param
							target: density
							values:
								compact: compact
								comfortable: comfortable
					verificationStrategies:
						- query-param-playwright
```

Stage-specific Gemini models live under `agent.stages` in YAML. Studio can override those per run without mutating the checked-in config, and custom Gemini model ids are allowed when you need something outside the curated list.

Resume an existing Linear plan explicitly by issue id or identifier:

```bash
npm run dev -- run --config ./intent-poc.yaml --resume-issue ENG-321 --intent "Continue the client-systems verification plan" --dry-run
```

Baseline run:

```bash
npm run dev -- run --config ./intent-poc.yaml --intent "Create a baseline screenshot library for the configured source"
```

Comparison run:

```bash
npm run dev -- run --config ./intent-poc.yaml --intent "Re-run the screenshot library and report visual drift"
```

Compare the built-in demo against variant `v2` after changing the source start command or app variant:

```bash
npm run dev -- run --config ./intent-poc.yaml --source intent-poc-app --intent "Re-run the surface library and report visual drift"
```

After adding another repo source to YAML, run a specific source scope:

```bash
npm run dev -- run --config ./intent-poc.yaml --source repo-a --intent "Create baseline evidence for repo-a"
```

After adding multiple repos to YAML, run a constrained multi-source scope:

```bash
npm run dev -- run --config ./intent-poc.yaml --source repo-a --source repo-b --intent "Prepare reviewable evidence across repo-a and repo-b for the current release" --dry-run
```

## Tests

Run the full test workflow. This now runs the code test suite and then refreshes the tracked demo screenshot library:

```bash
npm test
```

Run only the code tests without refreshing tracked screenshots:

```bash
npm run test:code
```

Run one or more specific test files without accidentally expanding back to the full suite:

```bash
npm run test:code -- src/demo-app/server/start-intent-studio-server.test.ts
```

Run the full stack explicitly: full code suite plus tracked demo screenshot refresh:

```bash
npm run test:stack
```

Run the conservative local smart selector. It inspects Git-changed files and chooses between `npm run test:code` and the full `npm test` workflow. Theme, demo surface, capture, comparison, evidence, orchestrator, and tracked baseline changes escalate to the full run:

```bash
npm run test:changed
```

Print the decision without running the selected command:

```bash
npm run test:changed -- --print
```

If Playwright browsers are not installed yet:

```bash
npm run install:browsers
```

The Playwright integration tests validate:
- baseline screenshot library creation for component-like pages
- drift detection between baseline and comparison runs

The tracked demo screenshot workflow is also part of the default test command, so `npm test` can leave pending PNG diffs under `artifacts/library/intent-poc-app/` when rendered output changes.

`npm test` remains the authoritative full-coverage command. `npm run test:changed` is only a conservative local shortcut and defaults unknown paths to the full workflow.

## IDD Testing Standard

The IDD pipeline is developed in slices, and each slice starts with a failing test before the runner or helpers change.

- Behavior tests cover the user-visible orchestration path through `runIntent` and, over time, `executeSourceRun`; use Given/When/Then names, assert emitted event order, and verify the written business or source artifacts.
- Unit tests cover deterministic planning and runner helpers such as intent normalization, capture selection, source reuse matching, and count aggregation.
- Integration tests stay thin and real. Keep Playwright-backed coverage focused on the demo pipeline and screenshot behavior instead of rebuilding the full orchestration matrix in the browser.

For each IDD slice:
1. Add or update the failing scenario first.
2. Make the smallest production change that satisfies that scenario.
3. Run `npm run typecheck` and `npm test`.
4. If the slice changes tracked-baseline behavior or surface-library output, run `npm test`; use `npm run library:refresh` only when you want to force a direct refresh outside the normal test workflow.
5. Use `npm run test:changed` only as a local convenience when you want the repo to pick between deterministic code tests and the full screenshot-aware workflow for you.

## Canonical BDD Sample

The repo now includes a checked-in canonical BDD sample artifact set under `samples/intent-poc-canonical-bdd/`.

- `normalized-intent.json` is the machine-readable dry-run snapshot for the canonical `intent-poc-app` surface-library intent.
- `plan-lifecycle.json` is the corresponding dry-run lifecycle snapshot.
- `README.md` explains the sample prompt, the stable `artifacts/` contract, and how the sample is verified.

These files are intentionally checked in because they define the repo's canonical stable artifact shape. The executable sample suite in `src/orchestrator/run-intent.bdd-sample.behavior.test.ts` verifies that fresh dry-run outputs still match the checked-in snapshots.

## Output

### Persistent Artifacts

The workflow writes to one deterministic artifact tree under `artifacts/`:
- business-level evidence under `artifacts/business/`
	- `normalized-intent.json`
	- `plan-lifecycle.json`
	- `manifest.json`
	- `hashes.json`
	- `comparison.json`
	- `summary.md`
- per-source evidence under `artifacts/sources/<sourceId>/`
	- `manifest.json`
	- `hashes.json`
	- `comparison.json`
	- `summary.md`
	- `captures/*`
	- `diffs/*`
	- `logs/*`

### Deterministic Screenshot Library

Screenshot library is maintained at `artifacts/library/<sourceId>/` (Git-tracked):

**Source-of-truth images** (deterministic category folders):
- `artifacts/library/<sourceId>/components/*.png`
- `artifacts/library/<sourceId>/views/*.png`
- `artifacts/library/<sourceId>/pages/*.png`
- `artifacts/library/<sourceId>/bdd/<behavior-id>/*.png`
- `artifacts/library/<sourceId>/userflows/<flow-id>/*.png`
- `artifacts/library/<sourceId>/manifest.json` — lightweight metadata: capture count, drift summary, intent

Tracked screenshots are upserted in place. Component, view, and page captures keep their catalog-derived file names. BDD and userflow captures use stable human-readable file names within a stable behavior or flow directory, and the next run overwrites the same PNG paths so Git image diff remains the review surface.

The library manifests are lightweight metadata for potential future UI consumption. Business and source manifests, hashes, and comparison outputs live in the same stable tree so downstream tooling can rely on fixed locations.

### Demo Tracked Screenshots  

Built-in library surfaces now write to the canonical source-of-truth root under `artifacts/library/intent-poc-app/`. These are updated by `npm test` and `npm run library:refresh`:


- `artifacts/library/intent-poc-app/components/*.png`
- `artifacts/library/intent-poc-app/views/*.png`
- `artifacts/library/intent-poc-app/pages/*.png`

- business and source manifests stay under `artifacts/business/` and `artifacts/sources/intent-poc-app/`
- the command does not generate demo diff PNGs for review; image review happens through Git
- summaries are written as markdown and JSON artifacts

To publish artifacts into the source repo as well:
1. Set `artifacts.storageMode: both`
2. Set `artifacts.copyToSourcePath` (already set to `.intent-poc/artifacts` in sample config)

## Notes

- Artifacts are controller-owned by default. The source repo is not modified unless storage mode is configured to publish back into the source workspace.
- Multiple source repos are supported through multiple `sources` profiles in one config.
- Each source can now carry `planning` metadata so the planner can describe repo identity, role, and notes separately from capture/runtime settings.
- `library:refresh` now routes through the shared `runIntent` pipeline using the `intent-poc-app` source profile plus tracked baseline output, instead of maintaining a separate capture implementation.
- `library:refresh` runs `npm run typecheck` and `npm run test:code` before it upserts tracked screenshots, and `npm test` runs the code tests before invoking the tracked refresh directly.
- `run.resumeIssue` or `--resume-issue` lets the planner attach to an existing Linear parent issue and update only planner-managed IDD sections.
- The persistent artifact contract does not use per-run directories. Captures, summaries, manifests, and comparison output are written to stable business/source paths, and tracked screenshots are upserted into the matching library tree.
- `artifacts.cleanBeforeRun` is transient-only cleanup. It removes legacy `artifacts/runs` output plus per-source `attempts` and `logs`, but it must not delete durable files under `artifacts/business/`, `artifacts/sources/<sourceId>/captures`, or `artifacts/library/<sourceId>/`.
- The prompt entrypoint is intentionally unstructured. The runner converts it into a bounded internal plan.
- The implementation now supports an optional Gemini-backed prompt interpretation stage and an optional Gemini-backed intent-planning stage; execution, capture, comparison, and artifact publishing remain deterministic.

Generate the tracked demo screenshot library with real images:

```bash
npm run library:refresh
```

The demo library currently regenerates 46 tracked screenshots from the internal demo app under `src/demo-app`:
- 10 primitives
- 16 components
- 12 views
- 8 pages

Each screenshot is written into the matching layer folder under `artifacts/library/intent-poc-app/`, so relationships stay obvious and Git can review the PNG changes directly.

When editing demo-app UI, extract reusable render helpers/components from Intent Studio first and adapt the `/library` surfaces onto that shared layer. Do not treat the primitive/component/view/page catalog renderers as an independent source of truth.

All styling is driven by a single theme token file at `src/demo-app/theme/theme.ts`, so one edit to token values can restyle every surface in one commit.