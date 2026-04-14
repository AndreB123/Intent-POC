# Intent POC

CLI-driven proof of concept for intent-driven visual evidence capture, with a built-in demo UI for local testing.

The controller accepts a free-text intent, normalizes it into a bounded run plan, creates or updates Linear issues, attaches to one or more external source apps, runs Playwright screenshots, stores evidence artifacts, computes hashes, and compares against baselines.

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

Then open:

```text
http://127.0.0.1:6010/
```

The prompt screen now lets you:
- submit an intent prompt
- choose source and mode
- watch live orchestration status
- inspect Linear activity when enabled
- open summaries, manifests, logs, screenshots, and diff images

The asset library is still available at:

```text
http://127.0.0.1:6010/library
```

You can switch demo library variants in the browser with:

```text
http://127.0.0.1:6010/library?variant=v2
```

The sample `intent-poc.yaml` still defaults to the built-in demo source, so the repo works without needing a separate Storybook app, Docker source, or Linear credentials.

## Run

Out-of-the-box baseline run against the built-in demo source:

```bash
npm run dev -- run --config ./intent-poc.yaml
```

Dry run:

```bash
npm run dev -- run --config ./intent-poc.yaml --intent "Create and maintain a screenshot library for the configured source" --dry-run
```

Resume an existing Linear plan explicitly by issue id or identifier:

```bash
npm run dev -- run --config ./intent-poc.yaml --resume-issue ENG-321 --intent "Continue the client-systems verification plan" --dry-run
```

Baseline run:

```bash
npm run dev -- run --config ./intent-poc.yaml --intent "Create a baseline screenshot library for the configured source" --mode baseline
```

Comparison run:

```bash
npm run dev -- run --config ./intent-poc.yaml --intent "Re-run the screenshot library and report visual drift" --mode compare
```

Compare the built-in demo against variant `v2` after changing the source start command or app variant:

```bash
npm run dev -- run --config ./intent-poc.yaml --source demo-catalog --intent "Re-run the demo catalog and report visual drift" --mode compare
```

Run a specific source:

```bash
npm run dev -- run --config ./intent-poc.yaml --source client-systems-roach-admin --intent "Create baseline evidence for client-systems roach admin" --mode baseline
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

The tracked demo screenshot workflow is also part of the default test command, so `npm test` can leave pending PNG diffs under `evidence/baselines/demo-components/` when rendered output changes.

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
4. If the slice changes tracked-baseline behavior or demo surface catalog output, run `npm test`; use `npm run demo:library` only when you want to force a direct refresh outside the normal test workflow.
5. Use `npm run test:changed` only as a local convenience when you want the repo to pick between deterministic code tests and the full screenshot-aware workflow for you.

## Output

- run bundles are written to `artifacts/runs/<runId>/`
- per-source evidence is written to `artifacts/runs/<runId>/sources/<sourceId>/`
- plan lifecycle metadata is written to `artifacts/runs/<runId>/plan-lifecycle.json`
- screenshot library is maintained at `artifacts/library/<sourceId>/`
	- `baseline/images/*.png`
	- `latest/images/*.png`
	- `latest/diffs/*.png` (for changed captures)
	- manifests and hash indexes under both baseline/latest folders
- approved baselines are written to `evidence/baselines/<sourceId>/`
- `npm test` now includes the tracked demo refresh workflow, and `npm run demo:library` remains the direct command that rewrites screenshots under `evidence/baselines/demo-components/`
	- `primitives/*.png`
	- `components/*.png`
	- `views/*.png`
	- `pages/*.png`
	- run manifests and hashes stay in `artifacts/runs/<runId>/` rather than cluttering the tracked screenshot tree
	- the workflow stages captures in the run artifacts and upserts tracked screenshots only after validation succeeds; it does not clear the tracked screenshot tree up front
	- the command does not generate demo diff PNGs; review image changes through Git
- summaries are written as markdown and JSON artifacts

To publish artifacts into the source repo as well:
1. Set `artifacts.storageMode: both`
2. Set `artifacts.copyToSourcePath` (already set to `.intent-poc/artifacts` in sample config)

## Notes

- Artifacts are controller-owned by default. The source repo is not modified unless storage mode is configured to publish back into the source workspace.
- Multiple source repos are supported through multiple `sources` profiles in one config.
- Each source can now carry `planning` metadata so the planner can describe repo identity, role, and notes separately from capture/runtime settings.
- `demo:library` now routes through the shared `runIntent` pipeline using the `demo-components` source profile plus tracked baseline output, instead of maintaining a separate capture implementation.
- `demo:library` runs `npm run typecheck` and `npm run test:code` before it upserts tracked screenshots, and `npm test` runs the code tests before invoking the tracked refresh directly.
- `run.resumeIssue` or `--resume-issue` lets the planner attach to an existing Linear parent issue and update only planner-managed IDD sections.
- `run.trackedBaseline` or `--tracked-baseline` stages captures under the run artifacts and upserts them into a configured source `capture.trackedRoot`; this is currently used by the built-in `demo-components` source.
- The prompt entrypoint is intentionally unstructured. The runner converts it into a bounded internal plan.
- The implementation currently uses a rules-based normalizer and deterministic runner logic.

Generate the tracked demo screenshot library with real images:

```bash
npm run demo:library
```

The demo library currently regenerates 46 tracked screenshots from the internal demo app under `src/demo-app`:
- 10 primitives
- 16 components
- 12 views
- 8 pages

Each screenshot is written into the matching layer folder under `evidence/baselines/demo-components/`, so relationships stay obvious and Git can review the PNG changes directly.

All styling is driven by a single theme token file at `src/demo-app/theme/theme.ts`, so one edit to token values can restyle every surface in one commit.