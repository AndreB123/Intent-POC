# IDD Workflow Plan

This document defines the current implementation plan for introducing Intent-Driven Development (IDD) into the repo workflow.

IDD is the user-facing workflow contract. Existing stages such as prompt normalization, BDD planning, TDD planning, implementation, and QA verification remain in place underneath it, but they are internal execution machinery rather than the primary workflow the user must reason about.

## Goals

- Infer a stronger intent from sparse user prompts.
- Use bounded AI plus repo memory and source metadata to establish context during intent determination.
- Define adaptive boundaries based on source scope and repository guardrails.
- Define a summary-level minimum success contract before implementation starts.
- Stop after intent drafting so the user can review and edit the current intent before execution.
- Improve task decomposition so large efforts can expand into dependency-aware subtasks rather than a shallow flat list.
- Keep AI decision-making inside code-governed execution rules.

## Non-Goals

- Replace the single execution pipeline rooted in `src/orchestrator/run-intent.ts`.
- Introduce a second persistent artifact model or per-run durable review directories.
- Remove BDD, TDD, implementation, or QA verification from the runtime model.
- Bind the workflow to a fixed future tool list. The design should stay toolbelt-friendly.

## Workflow Summary

1. The user provides a prompt with minimal context.
2. The system builds an IDD draft from:
   - the raw prompt
   - repo memory
   - source planning metadata
   - source aliases, role, and summary
   - UI-state metadata and verification notes
   - safe workspace context already available during planning
3. The system produces an editable draft that includes:
   - intent statement
   - inferred repo context
   - source scope
   - adaptive boundaries
   - non-goals
   - minimum success
   - baseline summary
4. The workflow stops and shows the draft to the user.
5. The user edits the draft as needed and explicitly sends it when ready.
6. The first Studio draft is a scoping pass only. Approval requires a refresh into a full reviewed plan before the draft can be sent or run.
7. Local interactive Studio sessions default to the live Gemini example config so the first scoping draft uses real prompt normalization unless the user explicitly selects the deterministic config.
8. The reviewed draft must show whether prompt normalization came from live Gemini, deterministic rules, fallback, or a skipped stage so reviewers can judge how much of the draft is prompt-specific versus scaffolded.
9. When Gemini does not provide prompt-specific scoping details, the scoping draft should say that its repo context is scaffolded from repo heuristics rather than implying model-derived certainty.
10. Only after that reviewed intent is sent does the system derive internal acceptance criteria, BDD scenarios, TDD work items, verification bundles, and execution chunks.
11. Execution proceeds through the existing orchestrator loop with stronger decomposition and rule-governed AI decisions.
12. After verification passes, the system produces delivery documentation.

## Required IDD Outputs

Every reviewed intent should define the following before implementation starts:

- `intent`: the user-visible statement of what is being changed
- `context`: the inferred repository and source context used during planning
- `scope`: the selected source scope and any explicit exclusions
- `boundaries`: hard limits enforced by code
- `minimumSuccess`: the summary-level definition of done
- `baseline`: the current app or source state used as the starting reference
- `verificationObligations`: the checks and evidence required before completion
- `deliveryObligations`: the artifacts and documentation required at the end

In Studio, these fields are now the user-facing first-click artifact. Raw AC, BDD, TDD, and decomposition details stay internal until the reviewed draft has been refreshed and approved.

## Studio Planning Modes

Intent Studio now has two explicit planning modes that share the same review-first workflow:

- `scoping draft`: the first-click artifact that keeps the review surface lean and bounded to repo context, source scope, adaptive boundaries, minimum success, baseline, and verification obligations
- `full reviewed plan`: the refreshed reviewed artifact that exists before send/run and contains the deeper internal plan needed for execution

The Studio UI must show which mode is active and expose prompt-normalization provenance from `normalizedIntent.normalizationMeta.stages`.

- `llm`: live Gemini prompt normalization supplied bounded prompt-specific planning hints
- `rules`: deterministic repo/source heuristics produced the planning hints
- `fallback`: Gemini was configured but unavailable, so planning fell back to deterministic heuristics
- `skipped`: the planning stage was intentionally skipped

When prompt-specific scoping details are absent, the review artifact should call out that the resulting repo context is scaffolded from repo heuristics so it does not read like hard-coded AI context.

## Boundary Rules

AI may help determine the shape of the work, but the following boundaries must be enforced by code:

- Source scope must remain bounded to configured sources and approved source metadata.
- Screenshot behavior must stay inside the repo screenshot contract.
- UI-state verification must use source planning metadata rather than prompt-specific one-off routing.
- New code should fit the repo structure and prefer refactor-before-add over additive legacy paths.
- Documentation requirements must be explicit when behavior or functionality changes.
- Verification requirements must stay aligned with source type and configured capabilities.

## Minimum Success Contract

Minimum success replaces the current user-facing dependence on raw AC, BDD, and TDD detail. It is a summary-level contract describing what must be true for the work to count as complete.

Minimum success should include, when applicable:

- documentation updated to reflect the change
- end-to-end tests created and passing for new logic
- Playwright tests created and capturing screenshots according to the repo pattern
- screenshot evidence for UI changes
- code integrated through refactor-first changes rather than additive parallel legacy paths
- documentation added for new functionality or features
- final delivery documentation generated after tests pass

Internal acceptance criteria, BDD scenarios, and TDD work items are still derived after approval so the runtime can execute and verify the work.

## Baseline Requirement

The reviewed intent must describe the current baseline before implementation starts. The baseline is the current state of the app or source relevant to the requested change and is used to anchor verification and delivery.

Examples include:

- current route or screen state
- current theme or UI state
- current screenshot baseline
- current test coverage related to the requested behavior
- current documentation state for the affected area

## Task Decomposition Plan

The repo currently supports bounded work-item execution and retry loops, but large efforts still need deeper decomposition.

The target model is:

1. objective
2. workstream
3. task
4. subtask
5. verification task

The execution loop should be able to consume this hierarchy incrementally, preserving dependency order and existing retry semantics while giving AI more room to choose the next actionable unit within coded rules.

## Governance Plan

AI can help with planning and next-step choice, but code must govern:

- allowed tools and stage capabilities
- retry behavior
- re-planning triggers
- completion checks
- escalation conditions that require user intervention

The intended model is not unconstrained autonomy. The intended model is bounded autonomy with explicit runtime rules.

## Initial Implementation Milestones

### Milestone 1: IDD Contract And Draft Shape

- add IDD-level types for context pack, boundaries, minimum success, baseline, and reviewed intent
- extend planning so sparse prompts can produce an IDD draft using repo memory and source metadata
- keep BDD and TDD as internal stages

### Milestone 2: Review And Send Gate

- persist the reviewed intent in a deterministic artifact path
- expose edit and send behavior in Intent Studio
- prevent direct execution from raw prompt submission in Studio once the review flow is active

### Milestone 3: Reviewed Intent To Execution Plan

- derive internal AC, BDD, TDD, baseline checks, and verification bundles from the reviewed intent
- keep execution in the existing `runIntent` pipeline

### Milestone 4: Scaled Decomposition And Governed Loop

- introduce deeper task decomposition for large work
- let AI choose next tasks from a bounded candidate set
- preserve retry and verification guarantees

### Milestone 5: Delivery And Docs

- update docs and config examples
- capture delivery documentation after verification passes

## Files Expected To Change

- `src/intent/intent-types.ts`
- `src/intent/normalize-intent.ts`
- `src/intent/gemini-prompt-normalizer.ts`
- `src/intent/gemini-intent-planner.ts`
- `src/orchestrator/run-intent.ts`
- `src/runtime/build-runtime-run-intent-options.ts`
- `src/demo-app/server/start-intent-studio-server.ts`
- `src/demo-app/render/render-intent-studio-page.ts`
- `src/evidence/paths.ts`
- `src/config/schema.ts`
- `AGENTS.md`
- `README.md`

## Verification Expectations

Implementation of this plan should add or update tests for:

- repo-memory-backed intent drafting
- bounded source-aware context inference
- reviewed-intent persistence and revision history
- Studio review and send gating
- reviewed-intent to internal-plan transformation
- deeper hierarchical decomposition
- rule-governed AI next-step selection
- documentation, test, and screenshot obligation enforcement

The normal repo verification rules still apply:

- `npm run typecheck`
- `npm run test:code`
- `npm test` when orchestrator, demo-app, capture, evidence, config, or tracked screenshot behavior changes
