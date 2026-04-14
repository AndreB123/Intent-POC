import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ComparisonSummary } from "../compare/run-comparison";
import { normalizeIntent } from "../intent/normalize-intent";
import { readJsonFile } from "../shared/fs";
import {
  buildBehaviorTestLoadedConfig,
  buildCapturedOutcome,
  buildComparisonSummary,
  buildSourceRunResult
} from "./run-intent.test-support";
import {
  RunIntentEvent,
  createRunIntentRunner
} from "./run-intent";

test("runIntent Given a dry run When the plan is valid Then it writes plan lifecycle metadata and skips source execution", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-run-intent-dry-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);
  let executeSourceRunCalls = 0;
  const events: RunIntentEvent[] = [];

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig,
      executeSourceRun: async () => {
        executeSourceRunCalls += 1;
        throw new Error("Dry runs should not execute source lanes.");
      }
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: "Compare drift only for cockroach statements on client-systems",
      dryRun: true,
      onEvent: (event) => events.push(event)
    });

    const planLifecycle = await readJsonFile<{
      sources: Array<{ sourceId: string; status: string }>;
    }>(result.paths.planLifecyclePath);

    assert.equal(executeSourceRunCalls, 0);
    assert.equal(result.status, "completed");
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.sourceRuns.map((sourceRun) => sourceRun.status), ["planned"]);
    assert.equal(planLifecycle?.sources[0]?.sourceId, "client-systems-roach-admin");
    assert.equal(planLifecycle?.sources[0]?.status, "planned");
    assert.deepEqual(
      events.map((event) => event.phase),
      ["config", "intent", "artifacts", "linear", "run"]
    );
    assert.equal(events.at(-1)?.message, "Dry run complete.");
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("runIntent Given a successful source lane When compare execution finishes Then it aggregates counts and writes business artifacts", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-run-intent-success-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);
  const executedSources: string[] = [];
  const events: RunIntentEvent[] = [];

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig,
      executeSourceRun: async (input) => {
        executedSources.push(input.sourcePlan.sourceId);
        assert.equal(input.trackedBaseline, false);

        return buildSourceRunResult(input, {
          captures: [buildCapturedOutcome(tmpRoot, "roach-statements")],
          comparison: buildComparisonSummary({
            hasDrift: true,
            counts: { changed: 1 },
            items: [
              {
                captureId: "roach-statements",
                status: "changed",
                baselinePath: path.join(tmpRoot, "baseline", "roach-statements.png"),
                currentPath: path.join(tmpRoot, "captures", "roach-statements.png"),
                baselineHash: "baseline-hash",
                currentHash: "current-hash",
                diffImagePath: path.join(tmpRoot, "diffs", "roach-statements.png"),
                diffPixels: 42,
                diffRatio: 0.25
              }
            ]
          })
        });
      }
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: "Compare drift only for cockroach statements on client-systems",
      onEvent: (event) => events.push(event)
    });

    const manifest = await readJsonFile<{
      status: string;
      summary: { counts: ComparisonSummary["counts"] };
      sources: Array<{ sourceId: string; status: string }>;
    }>(result.paths.manifestPath);

    assert.deepEqual(executedSources, ["client-systems-roach-admin"]);
    assert.equal(result.status, "completed");
    assert.equal(result.hasDrift, true);
    assert.equal(result.counts.changed, 1);
    assert.equal(result.counts.unchanged, 0);
    assert.equal(result.captures.length, 1);
    assert.equal(manifest?.status, "completed");
    assert.equal(manifest?.summary.counts.changed, 1);
    assert.equal(manifest?.sources[0]?.sourceId, "client-systems-roach-admin");
    assert.equal(manifest?.sources[0]?.status, "completed");
    assert.equal(result.summaryMarkdown?.includes("Intent POC Business Run Summary"), true);
    assert.deepEqual(
      events.map((event) => event.phase),
      ["config", "intent", "artifacts", "linear", "artifacts", "artifacts", "run"]
    );
    assert.equal(events.at(-1)?.details && typeof events.at(-1)?.details === "object", true);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("runIntent Given a multi-source plan When one source lane fails Then it continues later lanes and returns a failed run", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-run-intent-multi-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);
  const executedSources: string[] = [];
  const events: RunIntentEvent[] = [];

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig,
      executeSourceRun: async (input) => {
        executedSources.push(input.sourcePlan.sourceId);

        if (input.sourcePlan.sourceId === "client-systems-roach-admin") {
          return buildSourceRunResult(input, {
            status: "failed",
            error: "One or more captures are missing a baseline image.",
            captures: [buildCapturedOutcome(tmpRoot, "roach-overview")],
            comparison: buildComparisonSummary({
              hasDrift: true,
              counts: { "missing-baseline": 1 },
              items: [
                {
                  captureId: "roach-overview",
                  status: "missing-baseline",
                  currentPath: path.join(tmpRoot, "captures", "roach-overview.png"),
                  currentHash: "roach-overview-hash",
                  note: "Baseline image not found."
                }
              ]
            })
          });
        }

        return buildSourceRunResult(input, {
          captures: [buildCapturedOutcome(tmpRoot, "docs-home")],
          comparison: buildComparisonSummary({
            counts: { unchanged: 1 },
            items: [
              {
                captureId: "docs-home",
                status: "unchanged",
                baselinePath: path.join(tmpRoot, "baseline", "docs-home.png"),
                currentPath: path.join(tmpRoot, "captures", "docs-home.png"),
                baselineHash: "docs-baseline-hash",
                currentHash: "docs-current-hash"
              }
            ]
          })
        });
      }
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: "Create a business-wide hard gate so evidence is visible across client-systems and docs.",
      onEvent: (event) => events.push(event)
    });

    const comparison = await readJsonFile<{
      status: string;
      counts: ComparisonSummary["counts"];
      sources: Array<{ sourceId: string; status: string; error?: string }>;
    }>(result.paths.comparisonPath);

    assert.deepEqual(executedSources, ["client-systems-roach-admin", "docs-portal"]);
    assert.equal(result.status, "failed");
    assert.equal(result.sourceRuns.length, 2);
    assert.equal(result.counts.unchanged, 1);
    assert.equal(result.counts["missing-baseline"], 1);
    assert.equal(result.errors.includes("One or more captures are missing a baseline image."), true);
    assert.equal(comparison?.status, "failed");
    assert.equal(comparison?.counts.unchanged, 1);
    assert.equal(comparison?.counts["missing-baseline"], 1);
    assert.deepEqual(
      comparison?.sources.map((source) => [source.sourceId, source.status]),
      [
        ["client-systems-roach-admin", "failed"],
        ["docs-portal", "completed"]
      ]
    );
    assert.equal(events.at(-1)?.phase, "run");
    assert.equal(events.at(-1)?.level, "error");
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("runIntent Given a requested source scope When dry run executes Then it plans only the requested source lanes", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-run-intent-scope-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: "Prepare reviewable evidence for the current release.",
      sourceIds: ["docs-portal", "client-systems-roach-admin"],
      dryRun: true
    });

    assert.deepEqual(
      result.normalizedIntent.executionPlan.sources.map((sourcePlan) => sourcePlan.sourceId),
      ["docs-portal", "client-systems-roach-admin"]
    );
    assert.equal(
      result.normalizedIntent.executionPlan.sources[0]?.selectionReason,
      "Source docs-portal was selected in the requested source scope."
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("runIntent Given tracked baseline output When the mode is not baseline Then it rejects the run before execution", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-run-intent-tracked-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig,
      executeSourceRun: async () => {
        throw new Error("Tracked baseline guard should stop the run before source execution.");
      }
    });

    await assert.rejects(
      async () =>
        await runIntent({
          configPath: loadedConfig.configPath,
          intent: "Compare drift only for cockroach statements on client-systems",
          trackedBaseline: true
        }),
      /Tracked baseline runs currently require baseline mode\./
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("runIntent Given Gemini stage config and runtime overrides When dry run executes Then the merged stage settings are passed into normalization", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-run-intent-agent-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);
  let capturedProvider: string | undefined;
  let capturedApiKeyEnv: string | undefined;
  let capturedPromptModel: string | undefined;
  let capturedPlanningModel: string | undefined;

  loadedConfig.config.agent = {
    ...loadedConfig.config.agent,
    provider: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    apiVersion: "v1alpha",
    allowPromptNormalization: true,
    allowIntentPlanning: true,
    stages: {
      promptNormalization: {
        model: "gemini-3.1-flash"
      },
      intentPlanning: {
        model: "gemini-3.1"
      }
    },
    fallbackToRules: true
  };

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig,
      normalizeIntent: async (input) => {
        capturedProvider = input.agent?.provider;
        capturedApiKeyEnv = input.agent?.apiKeyEnv;
        capturedPromptModel = input.agent?.stages?.promptNormalization.model;
        capturedPlanningModel = input.agent?.stages?.intentPlanning.model;
        return normalizeIntent(input);
      }
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: "Compare drift only for cockroach statements on client-systems",
      agentOverrides: {
        stages: {
          intentPlanning: {
            model: "gemini-3"
          }
        }
      },
      dryRun: true
    });

    assert.equal(result.status, "completed");
    assert.equal(capturedProvider, "gemini");
    assert.equal(capturedApiKeyEnv, "GEMINI_API_KEY");
    assert.equal(capturedPromptModel, "gemini-3.1-flash");
    assert.equal(capturedPlanningModel, "gemini-3");
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});