# Template Map

This file explains why the canonical sample is a template rather than just a captured run.

## Prompt To Plan Mapping

Prompt sentence:
`Create a baseline screenshot library for the demo-catalog source.`
Effect:
- sets the intent type to `baseline`
- selects `demo-catalog` as the execution source
- keeps capture scope at `all`

Prompt sentence:
`The plan must turn the request into acceptance-ready work for the built-in catalog experience.`
Effect:
- creates a prompt-origin acceptance criterion
- feeds the first scenario outcome and first scenario work item

Prompt sentence:
`It should publish a reviewable evidence package for GitHub and documentation stakeholders.`
Effect:
- creates a prompt-origin acceptance criterion
- activates planned GitHub and documentation destinations

Prompt sentence:
`It needs to leave a visible business process gate for baseline review.`
Effect:
- creates a prompt-origin acceptance criterion
- activates the planned business-process destination

Prompt sentence:
`Do this so that product and engineering leads can inspect the baseline without reading implementation details.`
Effect:
- becomes the desired outcome
- contributes a prompt-origin acceptance criterion
- propagates through BDD/TDD wording and summary output

## Stable Structural Pattern

This sample currently establishes a stable structural pattern for single-source baseline intents:

1. The full prompt becomes the business statement.
2. Prompt-origin acceptance criteria are extracted from `must`, `should`, `needs to`, and `so that` phrases.
3. Inferred acceptance criteria add execution and packaging guarantees.
4. BDD stays in a three-scenario frame:
   - translation into acceptance-ready work
   - executable evidence preparation
   - consistent distribution
5. TDD work items are generated as:
   - one work item per scenario
   - one visible-evidence work item per applicable source
6. Execution planning stays separate from the BDD/TDD narrative:
   - sources
   - destinations
   - tools

## What Future Samples Should Replace

- source id and source-specific stakeholder wording
- desired outcome
- prompt-origin acceptance criteria
- destination-driving keywords
- run mode where appropriate

## What Future Samples Should Preserve

- one prompt that reads like a business request, not a schema dump
- explicit acceptance language in the prompt
- a clear desired outcome
- verifiable BDD scenarios and TDD work items
- checked-in dry-run artifacts plus checked-in completed-run summaries
- executable tests that prove the sample still matches the live runner

## Minimum Quality Bar

A new sample should not be considered canonical unless it has all of the following:

- a prompt file
- dry-run planner snapshots
- completed-run summary snapshots
- an executable test that validates the snapshots
- at least one regression test for any bug the sample exposed while being built