import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PlanLifecycleRecord } from "../evidence/write-manifest";
import { buildSourceSummaryMarkdown } from "../evidence/write-summary";
import { INTENT_POC_BDD_SAMPLE } from "../intent/intent-poc-bdd-sample";
import { NormalizedIntent } from "../intent/intent-types";
import { readJsonFile } from "../shared/fs";
import { RunIntentEvent, createRunIntentRunner } from "./run-intent";
import {
  buildBehaviorTestLoadedConfig,
  buildCapturedOutcome,
  buildComparisonSummary,
  buildIntentPocAppBehaviorSource,
  buildSourceRunResult
} from "./run-intent.test-support";

const CANONICAL_SAMPLE_DIR = path.resolve(process.cwd(), "samples", "intent-poc-canonical-bdd");

function normalizeIntentSnapshot(normalizedIntent: NormalizedIntent): Record<string, unknown> {
  return {
    ...normalizedIntent,
    intentId: "<generated-intent-id>",
    receivedAt: "<generated-timestamp>"
  };
}

function normalizePlanLifecycleSnapshot(planLifecycle: PlanLifecycleRecord): Record<string, unknown> {
  return {
    ...planLifecycle,
    runId: "<generated-run-id>",
    updatedAt: "<generated-timestamp>",
    intentId: "<generated-intent-id>"
  };
}

function normalizeSummaryMarkdown(markdown: string): string {
  return markdown.replace(/- Run ID: .+/g, "- Run ID: <generated-run-id>");
}

function projectNormalizedIntentSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const normalizedIntent = snapshot as unknown as NormalizedIntent;

  return {
    intentId: normalizedIntent.intentId,
    receivedAt: normalizedIntent.receivedAt,
    rawPrompt: normalizedIntent.rawPrompt,
    summary: normalizedIntent.summary,
    intentType: normalizedIntent.intentType,
    codeSurface: normalizedIntent.codeSurface,
    sourceId: normalizedIntent.sourceId,
    captureScope: normalizedIntent.captureScope,
    artifacts: normalizedIntent.artifacts,
    linear: normalizedIntent.linear,
    planning: {
      repoCandidates: normalizedIntent.planning.repoCandidates.map((repo) => ({
        repoId: repo.repoId,
        selectionStatus: repo.selectionStatus,
        sourceIds: repo.sourceIds
      })),
      plannerSections: normalizedIntent.planning.plannerSections
    },
    executionPlan: {
      primarySourceId: normalizedIntent.executionPlan.primarySourceId,
      orchestrationStrategy: normalizedIntent.executionPlan.orchestrationStrategy,
      sources: normalizedIntent.executionPlan.sources.map((source) => ({
        sourceId: source.sourceId,
        captureScope: source.captureScope,
        uiStateRequirementIds: (source.uiStateRequirements ?? []).map((requirement) => requirement.stateId)
      })),
      destinations: normalizedIntent.executionPlan.destinations.map((destination) => ({
        label: destination.label,
        status: destination.status
      })),
      tools: normalizedIntent.executionPlan.tools.map((tool) => ({
        label: tool.label,
        enabled: tool.enabled
      }))
    },
    normalizationMeta: {
      requestedPlanningDepth: normalizedIntent.normalizationMeta.requestedPlanningDepth,
      effectivePlanningDepth: normalizedIntent.normalizationMeta.effectivePlanningDepth
    }
  };
}

function projectPlanLifecycleSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const planLifecycle = snapshot as unknown as PlanLifecycleRecord;

  return {
    version: planLifecycle.version,
    runId: planLifecycle.runId,
    updatedAt: planLifecycle.updatedAt,
    intentId: planLifecycle.intentId,
    summary: planLifecycle.summary,
    planning: {
      repoCandidates: planLifecycle.planning.repoCandidates.map((repo) => ({
        repoId: repo.repoId,
        selectionStatus: repo.selectionStatus,
        sourceIds: repo.sourceIds
      })),
      plannerSections: planLifecycle.planning.plannerSections
    },
    sources: planLifecycle.sources.map((source) => ({
      sourceId: source.sourceId,
      uiStateRequirementIds: (source.uiStateRequirements ?? []).map((requirement) => requirement.stateId)
    }))
  };
}

function assertIntentPocBddSamplePlan(normalizedIntent: NormalizedIntent): void {
  const expected = INTENT_POC_BDD_SAMPLE.expected;

  assert.equal(normalizedIntent.intentType, expected.intentType);
  assert.equal(normalizedIntent.sourceId, expected.sourceId);
  assert.equal(normalizedIntent.summary, expected.summary);
  assert.equal(normalizedIntent.businessIntent.desiredOutcome, expected.desiredOutcome);
  assert.deepEqual(normalizedIntent.captureScope, expected.captureScope);
  assert.equal(normalizedIntent.executionPlan.orchestrationStrategy, expected.orchestrationStrategy);
  assert.deepEqual(normalizedIntent.executionPlan.reviewNotes, expected.executionReviewNotes);
  assert.deepEqual(normalizedIntent.planning.reviewNotes, expected.planningReviewNotes);
  assert.deepEqual(
    normalizedIntent.planning.repoCandidates.map((repo) => ({
      repoId: repo.repoId,
      selectionStatus: repo.selectionStatus,
      sourceIds: repo.sourceIds
    })),
    expected.repoCandidates
  );
  assert.deepEqual(
    normalizedIntent.businessIntent.acceptanceCriteria.map((criterion) => criterion.description),
    expected.acceptanceCriteria
  );
  assert.deepEqual(
    normalizedIntent.businessIntent.scenarios.map((scenario) => scenario.title),
    expected.scenarioTitles
  );
  assert.deepEqual(
    normalizedIntent.businessIntent.workItems.map((workItem) => workItem.title),
    expected.workItemTitles
  );
  assert.deepEqual(
    normalizedIntent.executionPlan.sources.map((source) => ({
      sourceId: source.sourceId,
      selectionReason: source.selectionReason,
      captureScope: source.captureScope,
      uiStateRequirements: (source.uiStateRequirements ?? []).map((requirement) => ({
        stateId: requirement.stateId,
        requestedValue: requirement.requestedValue
      }))
    })),
    [
      {
        sourceId: expected.sourceId,
        selectionReason: expected.selectionReason,
        captureScope: expected.captureScope,
        uiStateRequirements: expected.uiStateRequirements
      }
    ]
  );
  assert.deepEqual(
    normalizedIntent.executionPlan.destinations.map((destination) => ({
      label: destination.label,
      status: destination.status
    })),
    expected.destinationStatuses
  );
  assert.deepEqual(
    normalizedIntent.executionPlan.tools.map((tool) => ({
      label: tool.label,
      enabled: tool.enabled
    })),
    expected.toolStates
  );
}

test("runIntent Given the canonical Intent POC BDD sample When the run is a dry run Then it matches the checked-in sample artifacts", async () => {
  const events: RunIntentEvent[] = [];
  const configPath = path.resolve(process.cwd(), "intent-poc.yaml");

  const runIntent = createRunIntentRunner();

  const result = await runIntent({
    configPath,
    intent: INTENT_POC_BDD_SAMPLE.prompt,
    dryRun: true,
    onEvent: (event) => events.push(event)
  });

  const normalizedIntent = await readJsonFile<NormalizedIntent>(result.paths.normalizedIntentPath);
  const planLifecycle = await readJsonFile<PlanLifecycleRecord>(result.paths.planLifecyclePath);
  const normalizedIntentSnapshot = await readJsonFile<Record<string, unknown>>(
    path.join(CANONICAL_SAMPLE_DIR, "normalized-intent.json")
  );
  const planLifecycleSnapshot = await readJsonFile<Record<string, unknown>>(
    path.join(CANONICAL_SAMPLE_DIR, "plan-lifecycle.json")
  );

  assert.equal(result.status, "completed");
  assert.equal(result.dryRun, true);
  assert.deepEqual(
    result.sourceRuns.map((sourceRun) => sourceRun.status),
    ["planned"]
  );
  assert.deepEqual(
    events.map((event) => event.phase),
    ["config", "linear", "intent", "artifacts", "run"]
  );
  assert.deepEqual(
    projectNormalizedIntentSnapshot(normalizeIntentSnapshot(normalizedIntent!)),
    projectNormalizedIntentSnapshot(normalizedIntentSnapshot!)
  );
  assert.deepEqual(
    projectPlanLifecycleSnapshot(normalizePlanLifecycleSnapshot(planLifecycle!)),
    projectPlanLifecycleSnapshot(planLifecycleSnapshot!)
  );
});

test("runIntent Given the canonical Intent POC BDD sample When baseline execution completes Then the prompt-to-plan contract is preserved in artifacts", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-bdd-sample-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot, {
    sources: {
      "intent-poc-app": buildIntentPocAppBehaviorSource(tmpRoot)
    },
    defaultSourceId: "intent-poc-app"
  });
  const executedSources: string[] = [];
  const events: RunIntentEvent[] = [];

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig,
      executeSourceRun: async (input) => {
        executedSources.push(input.sourcePlan.sourceId);
        assertIntentPocBddSamplePlan(input.normalizedIntent);
        assert.equal(input.sourcePlan.selectionReason, INTENT_POC_BDD_SAMPLE.expected.selectionReason);

        return buildSourceRunResult(input, {
          captures: [
            buildCapturedOutcome(tmpRoot, "library-index", {
              path: "/library",
              url: "http://127.0.0.1:6006/library"
            })
          ],
          comparison: buildComparisonSummary({
            mode: "baseline",
            counts: { "baseline-written": 1 },
            items: [
              {
                captureId: "library-index",
                status: "baseline-written",
                baselinePath: path.join(tmpRoot, "baseline", "library-index.png"),
                currentPath: path.join(tmpRoot, "captures", "library-index.png"),
                baselineHash: "library-index-hash",
                currentHash: "library-index-hash"
              }
            ]
          })
        });
      }
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: INTENT_POC_BDD_SAMPLE.prompt,
      onEvent: (event) => events.push(event)
    });

    const planLifecycle = await readJsonFile<{
      summary: string;
      planning: {
        repoCandidates: Array<{ repoId: string; selectionStatus: string }>;
      };
      sources: Array<{
        sourceId: string;
        selectionReason?: string;
        uiStateRequirements?: Array<{ stateId: string; requestedValue?: string }>;
      }>;
    }>(result.paths.planLifecyclePath);
    const manifest = await readJsonFile<{
      status: string;
      businessIntent: {
        statement: string;
        acceptanceCriteria: Array<{ description: string }>;
      };
      executionPlan: {
        destinations: Array<{ label: string; status: string }>;
        tools: Array<{ label: string; enabled: boolean }>;
      };
      summary: {
        counts: Record<string, number>;
      };
    }>(result.paths.manifestPath);
    const summaryMarkdown = await fs.readFile(result.paths.summaryPath, "utf8");
    const sourceSummaryMarkdown = buildSourceSummaryMarkdown({
      config: loadedConfig.config,
      paths: result.sourceRuns[0]!.paths,
      normalizedIntent: result.normalizedIntent,
      linearIssue: result.sourceRuns[0]!.linearIssue ?? null,
      captures: result.sourceRuns[0]!.captures,
      comparison: result.sourceRuns[0]!.comparison,
      status: result.sourceRuns[0]!.status,
      error: result.sourceRuns[0]!.error,
      attempts: result.sourceRuns[0]!.attempts
    });

    assert.deepEqual(executedSources, ["intent-poc-app"]);
    assert.equal(result.status, "completed");
    assert.equal(result.hasDrift, false);
    assert.equal(result.sourceRuns.length, 1);
    assert.equal(result.counts["baseline-written"], 1);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(
      events.map((event) => event.phase),
      ["config", "linear", "intent", "artifacts", "artifacts", "artifacts", "run"]
    );
    assertIntentPocBddSamplePlan(result.normalizedIntent);
    assert.equal(planLifecycle?.summary, INTENT_POC_BDD_SAMPLE.expected.summary);
    assert.equal(planLifecycle?.sources[0]?.sourceId, "intent-poc-app");
    assert.equal(planLifecycle?.sources[0]?.selectionReason, INTENT_POC_BDD_SAMPLE.expected.selectionReason);
    assert.deepEqual(
      planLifecycle?.sources[0]?.uiStateRequirements?.map((requirement) => ({
        stateId: requirement.stateId,
        requestedValue: requirement.requestedValue
      })),
      INTENT_POC_BDD_SAMPLE.expected.uiStateRequirements
    );
    assert.deepEqual(
      planLifecycle?.planning.repoCandidates.map((repo) => ({
        repoId: repo.repoId,
        selectionStatus: repo.selectionStatus
      })),
      [{ repoId: "intent-poc", selectionStatus: "selected" }]
    );
    assert.equal(manifest?.status, "completed");
    assert.equal(manifest?.businessIntent.statement, INTENT_POC_BDD_SAMPLE.prompt);
    assert.deepEqual(
      manifest?.businessIntent.acceptanceCriteria.map((criterion) => criterion.description),
      INTENT_POC_BDD_SAMPLE.expected.acceptanceCriteria
    );
    assert.deepEqual(
      manifest?.executionPlan.destinations.map((destination) => ({
        label: destination.label,
        status: destination.status
      })),
      INTENT_POC_BDD_SAMPLE.expected.destinationStatuses
    );
    assert.deepEqual(
      manifest?.executionPlan.tools.map((tool) => ({
        label: tool.label,
        enabled: tool.enabled
      })),
      INTENT_POC_BDD_SAMPLE.expected.toolStates
    );
    assert.equal(manifest?.summary.counts["baseline-written"], 1);
    assert.equal(summaryMarkdown, result.summaryMarkdown);

    for (const fragment of INTENT_POC_BDD_SAMPLE.expected.businessSummaryFragments) {
      assert.equal(summaryMarkdown.includes(fragment), true, `Expected business summary to include '${fragment}'.`);
    }

    for (const fragment of [
      "# Intent POC Source Run Summary",
      "- Source: intent-poc-app",
      "- Status: completed"
    ]) {
      assert.equal(sourceSummaryMarkdown.includes(fragment), true, `Expected source summary to include '${fragment}'.`);
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});