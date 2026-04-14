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
  buildSourceRunAttemptRecord,
  buildSourceRunResult
} from "./run-intent.test-support";
import {
  RunIntentEvent,
  createRunIntentRunner,
  runSourceAttemptLoop
} from "./run-intent";

test("runSourceAttemptLoop Given a retryable QA failure When a later attempt passes Then it records both attempts and returns the successful resource", async () => {
  const retries: number[] = [];

  const result = await runSourceAttemptLoop<string>({
    sourceId: "demo-catalog",
    maxAttempts: 3,
    retryEnabled: true,
    executeAttempt: async (attemptNumber) => {
      if (attemptNumber === 1) {
        return {
          implementation: {
            status: "completed",
            summary: "Implementation pass completed.",
            commands: []
          },
          qaVerification: {
            status: "failed",
            summary: "QA verification failed while running 'test-code'.",
            error: "Command failed (1).",
            commands: []
          }
        };
      }

      return {
        implementation: {
          status: "completed",
          summary: "Retry implementation pass completed.",
          commands: []
        },
        qaVerification: {
          status: "completed",
          summary: "QA verification passed 2 commands.",
          commands: []
        },
        resource: "ready-app"
      };
    },
    onRetry: ({ nextAttemptNumber }) => {
      retries.push(nextAttemptNumber);
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(retries, [2]);
  assert.equal(result.attempts[0]?.failureStage, "qaVerification");
  assert.equal(result.attempts[1]?.status, "completed");
  assert.equal(result.resource, "ready-app");
});

test("runSourceAttemptLoop Given repeated QA failures When retries are exhausted Then it returns the final failure and all attempts", async () => {
  const retries: number[] = [];

  const result = await runSourceAttemptLoop({
    sourceId: "demo-catalog",
    maxAttempts: 3,
    retryEnabled: true,
    executeAttempt: async () => ({
      implementation: {
        status: "completed",
        summary: "Implementation pass completed.",
        commands: []
      },
      qaVerification: {
        status: "failed",
        summary: "QA verification failed while running 'generated-playwright'.",
        error: "Command failed (1).",
        commands: []
      }
    }),
    onRetry: ({ nextAttemptNumber }) => {
      retries.push(nextAttemptNumber);
    }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(retries, [2, 3]);
  assert.equal(result.attempts.at(-1)?.failureStage, "qaVerification");
  assert.match(result.error ?? "", /QA verification failed for source 'demo-catalog' on attempt 3/);
});

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
      ["config", "linear", "intent", "artifacts", "run"]
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
          attempts: [
            buildSourceRunAttemptRecord({
              implementation: {
                status: "completed",
                summary: "Implementation completed.",
                commands: []
              },
              qaVerification: {
                status: "completed",
                summary: "QA verification passed 2 commands.",
                commands: []
              }
            })
          ],
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
      sources: Array<{ sourceId: string; status: string; attemptCount?: number }>;
    }>(result.paths.manifestPath);
    const planLifecycle = await readJsonFile<{
      sources: Array<{ sourceId: string; attemptCount?: number }>;
    }>(result.paths.planLifecyclePath);

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
    assert.equal(manifest?.sources[0]?.attemptCount, 1);
    assert.equal(planLifecycle?.sources[0]?.attemptCount, 1);
    assert.equal(result.summaryMarkdown?.includes("Intent POC Business Run Summary"), true);
    assert.deepEqual(
      events.map((event) => event.phase),
      ["config", "linear", "intent", "artifacts", "artifacts", "artifacts", "run"]
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
    allowLinearScoping: true,
    allowBDDPlanning: true,
    allowTDDPlanning: true,
    stages: {
      promptNormalization: {
        model: "gemini-3.1-flash"
      },
      linearScoping: {
        model: "gemini-3.1-flash"
      },
      bddPlanning: {
        model: "gemini-3.1"
      },
      tddPlanning: {
        model: "gemini-3.1"
      },
      implementation: {},
      qaVerification: {}
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
        capturedPlanningModel = input.agent?.stages?.bddPlanning.model;
        return normalizeIntent(input);
      }
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: "Compare drift only for cockroach statements on client-systems",
      agentOverrides: {
        stages: {
          bddPlanning: {
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

test("runIntent Given Linear issue creation on start When dry run executes Then Linear lanes are scoped before the full planner pass updates them", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-run-intent-linear-scope-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot, { linearEnabled: true });
  const normalizationPasses: string[] = [];
  const descriptionWrites = new Map<string, string[]>();
  const issues = new Map<string, {
    id: string;
    identifier: string;
    url: string;
    title?: string;
    description?: string;
    parentId?: string;
  }>();
  let issueCount = 0;

  loadedConfig.config.linear.createIssueOnStart = true;

  function recordDescription(issueId: string, description: string): void {
    const writes = descriptionWrites.get(issueId) ?? [];
    writes.push(description);
    descriptionWrites.set(issueId, writes);
  }

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig,
      createLinearClient: () => ({
        createIssue: async ({ title, description, parentId }) => {
          issueCount += 1;
          const issue = {
            id: `issue-${issueCount}`,
            identifier: `IDD-${issueCount}`,
            url: `https://linear.example/IDD-${issueCount}`,
            title,
            description,
            parentId
          };
          issues.set(issue.id, issue);
          recordDescription(issue.id, description);
          return issue;
        },
        fetchIssue: async () => null,
        listChildIssues: async (parentId) =>
          Array.from(issues.values()).filter((issue) => issue.parentId === parentId),
        updateIssueDescription: async (issueId, description) => {
          const issue = issues.get(issueId);
          if (issue) {
            issue.description = description;
          }
          recordDescription(issueId, description);
        },
        updateIssueTitle: async (issueId, title) => {
          const issue = issues.get(issueId);
          if (issue) {
            issue.title = title;
          }
        },
        createComment: async () => undefined,
        updateIssueState: async () => undefined
      }),
      normalizeIntent: async (input) => {
        normalizationPasses.push(input.planningDepth ?? "full");
        return normalizeIntent(input);
      }
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: "Compare drift only for cockroach statements on client-systems",
      dryRun: true
    });

    assert.deepEqual(normalizationPasses, ["scoping", "full"]);
    assert.ok(result.linearPublication);
    assert.ok(result.linearPublication.parentIssue);

    const linearPublication = result.linearPublication!;
    const parentDescriptionWrites = descriptionWrites.get(linearPublication.parentIssue!.id) ?? [];
    assert.equal(parentDescriptionWrites[0]?.includes("## Linear Scoping"), true);
    assert.equal(parentDescriptionWrites[0]?.includes("## BDD Scenarios"), false);
    assert.equal(parentDescriptionWrites.at(-1)?.includes("## BDD Scenarios"), true);
    assert.equal(parentDescriptionWrites.at(-1)?.includes("## TDD Work Items"), true);

    const sourceIssue = linearPublication.sourceIssues["client-systems-roach-admin"];
    assert.ok(sourceIssue);
    const sourceDescriptionWrites = descriptionWrites.get(sourceIssue!.id) ?? [];
    assert.equal(sourceDescriptionWrites[0]?.includes("## Linear Scope"), true);
    assert.equal(sourceDescriptionWrites[0]?.includes("## Relevant BDD Scenarios"), false);
    assert.equal(sourceDescriptionWrites.at(-1)?.includes("## Relevant BDD Scenarios"), true);
    assert.equal(sourceDescriptionWrites.at(-1)?.includes("## Relevant TDD Work Items"), true);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});