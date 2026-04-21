# Studio Prompt Normalization

This document explains how Intent Studio chooses prompt-normalization behavior, how the review-first draft flow works, and how to troubleshoot live Gemini planning.

## Config Modes

Intent Studio now has two operational modes:

- live Gemini planning: `intent-poc.local-no-linear.yaml`
- deterministic planning: `intent-poc.yaml`

Local interactive Studio entrypoints default to the live Gemini config:

- `./start-studio.sh`
- `npm run demo:serve`

Use the deterministic config explicitly when you want a rules-backed Studio session:

```bash
npm run demo:serve -- --config ./intent-poc.yaml
INTENT_STUDIO_CONFIG=./intent-poc.yaml ./start-studio.sh
```

## Review-First Flow

Studio keeps the existing two-pass review-first contract.

1. First click:
   Studio calls `POST /api/plan`.
   The server runs prompt normalization with `planningDepth: "scoping"`.
   The result is a scoping draft that persists under `artifacts/business/intent-drafts/`.

2. Second click:
   Studio patches the same reviewed draft.
   The server refreshes it with `planningDepth: "full"`.
   Studio then sends the reviewed draft and starts execution from `draftId`.

3. Send/run guard:
   Studio refuses to send or run a draft that is still scoping-only.

## What The UI Shows

Studio now labels the current review artifact as either:

- `scoping draft`
- `full reviewed plan`

It also surfaces prompt-normalization provenance from `normalizedIntent.normalizationMeta.stages`.

- `llm`: live Gemini supplied the bounded prompt-normalization hints
- `rules`: deterministic repo/source heuristics built the draft
- `fallback`: Gemini was configured but unavailable, so the draft fell back to deterministic heuristics
- `skipped`: the prompt-normalization stage was skipped

When prompt-specific scoping details are absent, the draft marks repo context as scaffolded from repo heuristics. That wording is intentional and means the draft is a bounded starting point, not proof that the model found prompt-specific repo knowledge.

## Planning Readiness

Studio planning now validates provider-backed Gemini stages before running planning endpoints.

- scoping draft preview validates `promptNormalization` when it is configured with a provider
- full reviewed plan refresh validates `promptNormalization`, `bddPlanning`, and `tddPlanning` when they are configured with a provider
- implementation readiness checks still validate the `implementation` stage separately

If a live Gemini config is selected but the configured Gemini API key environment variable is missing, Studio returns a planning error instead of silently producing a deterministic-looking draft.

## Troubleshooting

### Planning preview fails with Gemini access errors

Check one of these environment variables:

- `GEMINI_KEY`
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- the explicit `agent.apiKeyEnv` or stage-level `apiKeyEnv` configured in YAML

### The draft says it is rules-backed or scaffolded

That means Studio is using the deterministic config or Gemini planning was not active for that stage. Confirm:

1. the active config path shown in Studio
2. `agent.provider: gemini` is present in the selected config when live planning is expected
3. the required Gemini env var is set in the shell that launched Studio

### I want deterministic Studio behavior

Use `intent-poc.yaml` explicitly. The repo keeps that config deterministic so tests, dry runs, and canonical snapshots stay stable.

## Code Surfaces

The main implementation surfaces for this workflow are:

- `src/demo-app/server/start-intent-studio-server.ts`
- `src/demo-app/render/render-intent-studio-page.ts`
- `src/intent/normalize-intent.ts`
- `src/intent/reviewed-intent-markdown.ts`
- `start-studio.sh`
- `src/cli.ts`

Keep the workflow rooted in the existing `runIntent` pipeline. The goal is clearer provenance and operational behavior, not a parallel planning system.