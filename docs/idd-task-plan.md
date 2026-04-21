# IDD Task Plan

- [x] Document IDD workflow plan
- [x] Create task checklist
- [x] Add reviewed-intent draft types
- [x] Add deterministic draft artifact paths under `artifacts/business/intent-drafts/`
- [x] Persist Studio `/api/plan` previews as draft intent artifacts
- [x] Return draft metadata from `/api/plan`
- [x] Add Studio tests for draft preview persistence
- [x] Gate runs on send
- [x] Add reviewed-intent edit flow
- [x] Derive internal AC/BDD/TDD from reviewed intent
- [x] Improve decomposition into objectives/workstreams/tasks/subtasks
- [x] Add rule-governed AI next-task selection
- [x] Update docs/config samples for the new review-first workflow
- [x] Default Studio launcher and demo entrypoint to the live Gemini config
- [x] Fail Studio planning clearly when configured live Gemini stages are unavailable
- [x] Surface scoping-draft versus full-plan provenance in Studio
- [x] Mark heuristic scoping context as scaffolded when Gemini does not supply prompt-specific details
- [x] Add Studio prompt-normalization operations doc
- [x] Run `npm run typecheck`
- [x] Run focused code tests
- [x] Run full `npm test`

## Current Slice

- Reviewed intent draft types are in place.
- Draft preview artifacts are persisted from the Studio planning endpoint.
- Studio first-click preview now persists a compact IDD draft instead of rendering the full downstream AC/BDD/TDD bundle.
- `/api/plan` now returns draft metadata alongside the normalized plan and compact draft preview metadata.
- Reviewed drafts can now be edited in place and explicitly sent before run start.
- Studio now uses a scoping-only first pass for `/api/plan`, refreshes the reviewed draft into a full plan on edit/approval, and blocks direct send or run while the draft is still scoping-only.
- Studio run submission now uses reviewed `draftId` flow end-to-end.
- Local interactive Studio now defaults to the live Gemini example config instead of the deterministic sample config.
- Studio planning now validates provider-backed Gemini stages up front, so missing Gemini access fails clearly during planning preview instead of silently resembling a hard-coded draft.
- Studio preview notes and top-line status now distinguish the scoping draft from the full reviewed plan and surface prompt-normalization provenance directly from the existing stage metadata.
- Reviewed scoping drafts now mark repo-heuristic scaffolded context explicitly when Gemini did not provide prompt-specific scoping details.
- Server tests now cover review-first draft persistence, draft edit, and send transitions.
- Studio rendering now maps the first-click preview to repo context, scope, boundaries, minimum success, baseline, verification obligations, and delivery obligations instead of empty BDD/TDD panels.
- `runIntent` now accepts reviewed normalized intent directly, so execution reuses the reviewed plan instead of re-normalizing the raw prompt.
- Normalization now emits objective, workstream, task, subtask, and verification-task decomposition metadata linked to planned work items.
- The orchestrator now chooses the next dependency-ready chunk within a governed task group when hierarchy metadata is present, while preserving legacy batching when it is not.
- Business summaries, source summaries, and final Linear issue descriptions now surface the IDD decomposition instead of leaving hierarchy metadata buried in JSON.
- Intent Studio Step 4 now renders the reviewed decomposition hierarchy directly in the plan preview so users can inspect objectives, workstreams, tasks, and subtasks before sending.
- Canonical normalized-intent and summary snapshots were refreshed to reflect the decomposition-aware output contract.
- README guidance now documents the draft preview, edit, send, draft-backed run flow, and the live-versus-deterministic Studio planning split.