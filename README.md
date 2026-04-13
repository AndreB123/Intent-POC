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

Run all tests (unit + Playwright integration):

```bash
npm test
```

If Playwright browsers are not installed yet:

```bash
npm run install:browsers
```

The Playwright integration tests validate:
- baseline screenshot library creation for component-like pages
- drift detection between baseline and comparison runs

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
- summaries are written as markdown and JSON artifacts

To publish artifacts into the source repo as well:
1. Set `artifacts.storageMode: both`
2. Set `artifacts.copyToSourcePath` (already set to `.intent-poc/artifacts` in sample config)

## Notes

- Artifacts are controller-owned by default. The source repo is not modified unless storage mode is configured to publish back into the source workspace.
- Multiple source repos are supported through multiple `sources` profiles in one config.
- Each source can now carry `planning` metadata so the planner can describe repo identity, role, and notes separately from capture/runtime settings.
- `run.resumeIssue` or `--resume-issue` lets the planner attach to an existing Linear parent issue and update only planner-managed IDD sections.
- The prompt entrypoint is intentionally unstructured. The runner converts it into a bounded internal plan.
- The implementation currently uses a rules-based normalizer and deterministic runner logic.

Generate a local demo screenshot library with real images and drift artifacts:

```bash
npm run demo:library
```

The demo library currently generates 46 captures per run from the internal demo app under `src/demo-app`:
- 10 primitives
- 16 components
- 12 views
- 8 pages

All styling is driven by a single theme token file at `src/demo-app/theme/theme.ts`, so one edit to token values can restyle every surface in one commit.