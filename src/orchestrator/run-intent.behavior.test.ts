import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ComparisonSummary } from "../compare/run-comparison";
import { normalizeIntent } from "../intent/normalize-intent";
import { TDDWorkItem } from "../intent/intent-types";
import { readJsonFile } from "../shared/fs";
import {
  buildBehaviorTestLoadedConfig,
  buildDemoCatalogBehaviorSource,
  buildCapturedOutcome,
  buildComparisonSummary,
  buildSourceRunAttemptRecord,
  buildSourceRunResult
} from "./run-intent.test-support";
import {
  RunIntentEvent,
  buildQAVerificationExecutionPlan,
  canReuseRunningSourceApp,
  createRunIntentRunner,
  runSourceAttemptLoop,
  waitForSourceAppReady
} from "./run-intent";

function buildLoopWorkItem(id: string, order: number, dependsOnWorkItemIds: string[] = []): TDDWorkItem {
  return {
    id,
    type: "playwright-spec",
    title: id,
    description: `${id} description`,
    scenarioIds: [],
    sourceIds: ["demo-catalog"],
    userVisibleOutcome: `${id} outcome`,
    verification: `${id} verification`,
    execution: {
      order,
      dependsOnWorkItemIds
    },
    playwright: {
      generatedBy: "rules",
      specs: []
    }
  };
}

test("runSourceAttemptLoop Given a retryable QA failure When a later attempt passes Then it records both attempts and returns the successful resource", async () => {
  const retries: number[] = [];

  const result = await runSourceAttemptLoop<string>({
    sourceId: "demo-catalog",
    workItems: [buildLoopWorkItem("work-1", 1)],
    maxAttempts: 3,
    retryEnabled: true,
    executeAttempt: async ({ attemptNumber, activeWorkItemIds, completedWorkItemIds, remainingWorkItemIds }) => {
      if (attemptNumber === 1) {
        return {
          targetedWorkItemIds: activeWorkItemIds,
          completedWorkItemIds,
          remainingWorkItemIds,
          implementation: {
            status: "completed",
            summary: "Implementation pass completed.",
            targetedWorkItemIds: activeWorkItemIds,
            completedWorkItemIds,
            remainingWorkItemIds,
            commands: [],
            fileOperations: []
          },
          qaVerification: {
            status: "failed",
            summary: "QA verification failed while running 'test-code'.",
            error: "Command failed (1).",
            targetedWorkItemIds: activeWorkItemIds,
            completedWorkItemIds,
            remainingWorkItemIds,
            commands: [],
            fileOperations: []
          }
        };
      }

      return {
        targetedWorkItemIds: activeWorkItemIds,
        completedWorkItemIds: [...completedWorkItemIds, ...activeWorkItemIds],
        remainingWorkItemIds: remainingWorkItemIds.filter((workItemId) => !activeWorkItemIds.includes(workItemId)),
        implementation: {
          status: "completed",
          summary: "Retry implementation pass completed.",
          targetedWorkItemIds: activeWorkItemIds,
          completedWorkItemIds: [...completedWorkItemIds, ...activeWorkItemIds],
          remainingWorkItemIds: remainingWorkItemIds.filter((workItemId) => !activeWorkItemIds.includes(workItemId)),
          commands: [],
          fileOperations: []
        },
        qaVerification: {
          status: "completed",
          summary: "QA verification passed 2 commands.",
          targetedWorkItemIds: activeWorkItemIds,
          completedWorkItemIds: [...completedWorkItemIds, ...activeWorkItemIds],
          remainingWorkItemIds: remainingWorkItemIds.filter((workItemId) => !activeWorkItemIds.includes(workItemId)),
          commands: [],
          fileOperations: []
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
    workItems: [buildLoopWorkItem("work-1", 1)],
    maxAttempts: 3,
    retryEnabled: true,
    executeAttempt: async ({ activeWorkItemIds, completedWorkItemIds, remainingWorkItemIds }) => ({
      targetedWorkItemIds: activeWorkItemIds,
      completedWorkItemIds,
      remainingWorkItemIds,
      implementation: {
        status: "completed",
        summary: "Implementation pass completed.",
        targetedWorkItemIds: activeWorkItemIds,
        completedWorkItemIds,
        remainingWorkItemIds,
        commands: [],
        fileOperations: []
      },
      qaVerification: {
        status: "failed",
        summary: "QA verification failed while running 'generated-playwright'.",
        error: "Command failed (1).",
        targetedWorkItemIds: activeWorkItemIds,
        completedWorkItemIds,
        remainingWorkItemIds,
        commands: [],
        fileOperations: []
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

test("runSourceAttemptLoop Given ordered work items When one batch passes QA Then it continues to the next batch before completing", async () => {
  const executedBatches: string[][] = [];

  const result = await runSourceAttemptLoop<string>({
    sourceId: "demo-catalog",
    workItems: [buildLoopWorkItem("work-1", 1), buildLoopWorkItem("work-2", 2, ["work-1"])],
    maxAttempts: 3,
    retryEnabled: true,
    executeAttempt: async ({ activeWorkItemIds, completedWorkItemIds, remainingWorkItemIds, attemptNumber }) => {
      executedBatches.push(activeWorkItemIds);

      return {
        targetedWorkItemIds: activeWorkItemIds,
        completedWorkItemIds: [...completedWorkItemIds, ...activeWorkItemIds],
        remainingWorkItemIds: remainingWorkItemIds.filter((workItemId) => !activeWorkItemIds.includes(workItemId)),
        implementation: {
          status: "completed",
          summary: `Implementation pass ${attemptNumber} completed.`,
          targetedWorkItemIds: activeWorkItemIds,
          completedWorkItemIds: [...completedWorkItemIds, ...activeWorkItemIds],
          remainingWorkItemIds: remainingWorkItemIds.filter((workItemId) => !activeWorkItemIds.includes(workItemId)),
          commands: [],
          fileOperations: []
        },
        qaVerification: {
          status: "completed",
          summary: `QA verification pass ${attemptNumber} completed.`,
          targetedWorkItemIds: activeWorkItemIds,
          completedWorkItemIds: [...completedWorkItemIds, ...activeWorkItemIds],
          remainingWorkItemIds: remainingWorkItemIds.filter((workItemId) => !activeWorkItemIds.includes(workItemId)),
          commands: [],
          fileOperations: []
        },
        resource: `ready-app-${attemptNumber}`
      };
    }
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(executedBatches, [["work-1"], ["work-2"]]);
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(result.attempts[0]?.remainingWorkItemIds, ["work-2"]);
  assert.deepEqual(result.attempts[1]?.completedWorkItemIds, ["work-1", "work-2"]);
  assert.equal(result.resource, "ready-app-2");
});

test("waitForSourceAppReady Given the launched app exits while another process already serves readiness When startup is checked Then it fails instead of accepting the stale server", async () => {
  const server = await import("node:http").then(({ createServer }) =>
    new Promise<import("node:http").Server>((resolve) => {
      const instance = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      });

      instance.listen(0, "127.0.0.1", () => resolve(instance));
    })
  );

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const port = address.port;

    await assert.rejects(
      waitForSourceAppReady({
        config: buildBehaviorTestLoadedConfig(os.tmpdir()).config,
        workspace: {
          sourceId: "demo-catalog",
          source: {
            app: {
              readiness: {
                type: "http",
                url: `http://127.0.0.1:${port}`,
                expectedStatus: 200,
                intervalMs: 25,
                timeoutMs: 1_000
              }
            }
          },
          baseUrl: `http://127.0.0.1:${port}`
        } as never,
        appHandle: {
          logPath: "/tmp/demo-app.log",
          waitForExit: async () => ({ exitCode: 1, signal: null })
        }
      }),
      /Source app exited before readiness check completed \(exit code 1\)/
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("canReuseRunningSourceApp Given a ready existing local dev server When reuse is enabled Then it returns true", async () => {
  const server = await import("node:http").then(({ createServer }) =>
    new Promise<import("node:http").Server>((resolve) => {
      const instance = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      });

      instance.listen(0, "127.0.0.1", () => resolve(instance));
    })
  );

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const port = address.port;

    const reusable = await canReuseRunningSourceApp({
      config: buildBehaviorTestLoadedConfig(os.tmpdir()).config,
      workspace: {
        sourceId: "demo-catalog",
        sourceType: "local",
        source: {
          workspace: {
            checkoutMode: "existing"
          },
          app: {
            reuseExistingServer: true,
            readiness: {
              type: "http",
              url: `http://127.0.0.1:${port}`,
              expectedStatus: 200,
              intervalMs: 50,
              timeoutMs: 1_000
            }
          }
        },
        rootDir: os.tmpdir(),
        appDir: os.tmpdir(),
        baseUrl: `http://127.0.0.1:${port}`
      } as never
    });

    assert.equal(reusable, true);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("buildQAVerificationExecutionPlan Given active Playwright work without generated specs When QA planning runs Then it raises a missing targeted test error", () => {
  const normalizedIntent = normalizeIntent({
    rawPrompt:
      "The space under the prompt run input box and instructions must be collapsable. All the optional config and setup should be collapsable.",
    defaultSourceId: "demo-catalog",
    continueOnCaptureError: false,
    availableSources: {
      "demo-catalog": buildDemoCatalogBehaviorSource("/tmp/intent-poc")
    }
  });

  const plan = buildQAVerificationExecutionPlan({
    normalizedIntent,
    sourceId: "demo-catalog",
    activeWorkItemIds: [normalizedIntent.businessIntent.workItems[0]!.id],
    generatedPlaywrightTests: [],
    implementationFileOperations: [{ operation: "replace", filePath: "src/demo-app/render/render-intent-studio-page.ts", rationale: "ui", status: "applied" }],
    workspaceRootDir: "/tmp/intent-poc"
  });

  assert.match(plan.error ?? "", /Missing targeted tracked Playwright specs/);
  assert.equal(plan.commands, undefined);
});

test("buildQAVerificationExecutionPlan Given active Playwright work with generated specs When QA planning runs Then it chooses focused generated Playwright regression", () => {
  const normalizedIntent = normalizeIntent({
    rawPrompt:
      "The space under the prompt run input box and instructions must be collapsable. All the optional config and setup should be collapsable.",
    defaultSourceId: "demo-catalog",
    continueOnCaptureError: false,
    availableSources: {
      "demo-catalog": buildDemoCatalogBehaviorSource("/tmp/intent-poc")
    }
  });

  const plan = buildQAVerificationExecutionPlan({
    normalizedIntent,
    sourceId: "demo-catalog",
    activeWorkItemIds: [normalizedIntent.businessIntent.workItems[0]!.id],
    generatedPlaywrightTests: ["/tmp/intent-poc/tests/intent/demo-catalog/work-1.spec.ts"],
    implementationFileOperations: [{ operation: "replace", filePath: "src/demo-app/render/render-intent-studio-page.ts", rationale: "ui", status: "applied" }],
    workspaceRootDir: "/tmp/intent-poc"
  });

  assert.equal(plan.error, undefined);
  assert.deepEqual(
    plan.commands?.map((command) => command.label),
    ["typecheck", "generated-playwright"]
  );
  assert.match(plan.commands?.[1]?.command ?? "", /npx playwright test/);
});

test("buildQAVerificationExecutionPlan Given active zero-spec behavior work When QA planning runs Then it falls back to targeted code regression", () => {
  const normalizedIntent = normalizeIntent({
    rawPrompt:
      "the planner needs to keep source-lane distribution summaries aligned with linear publishing without changing the Studio UI.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: {
      "intent-poc-app": buildDemoCatalogBehaviorSource("/tmp/intent-poc")
    }
  });

  const plan = buildQAVerificationExecutionPlan({
    normalizedIntent,
    sourceId: "intent-poc-app",
    activeWorkItemIds: [normalizedIntent.businessIntent.workItems[0]!.id],
    generatedPlaywrightTests: [],
    implementationFileOperations: [{ operation: "replace", filePath: "src/orchestrator/run-intent.ts", rationale: "qa", status: "applied" }],
    workspaceRootDir: "/tmp/intent-poc"
  });

  assert.equal(plan.error, undefined);
  assert.deepEqual(
    plan.commands?.map((command) => command.label),
    ["typecheck", "test-code-targeted"]
  );
  assert.equal(
    plan.commands?.[1]?.command,
    'npm run test:code -- "src/orchestrator/run-intent.behavior.test.ts"'
  );
});

test("buildQAVerificationExecutionPlan Given no active work items and demo app changes When QA planning runs Then it chooses targeted code regression", () => {
  const normalizedIntent = normalizeIntent({
    rawPrompt:
      "The space under the prompt run input box and instructions must be collapsable. All the optional config and setup should be collapsable.",
    defaultSourceId: "demo-catalog",
    continueOnCaptureError: false,
    availableSources: {
      "demo-catalog": buildDemoCatalogBehaviorSource("/tmp/intent-poc")
    }
  });

  const plan = buildQAVerificationExecutionPlan({
    normalizedIntent,
    sourceId: "demo-catalog",
    activeWorkItemIds: [],
    generatedPlaywrightTests: [],
    implementationFileOperations: [{ operation: "replace", filePath: "src/demo-app/render/render-intent-studio-page.ts", rationale: "ui", status: "applied" }],
    workspaceRootDir: "/tmp/intent-poc"
  });

  assert.equal(plan.error, undefined);
  assert.deepEqual(
    plan.commands?.map((command) => command.label),
    ["typecheck", "test-code-targeted"]
  );
  assert.equal(
    plan.commands?.[1]?.command,
    'npm run test:code -- "src/demo-app/server/start-intent-studio-server.test.ts"'
  );
});

test("buildQAVerificationExecutionPlan Given no active work items and orchestrator changes When QA planning runs Then it chooses targeted orchestrator regression", () => {
  const normalizedIntent = normalizeIntent({
    rawPrompt:
      "The space under the prompt run input box and instructions must be collapsable. All the optional config and setup should be collapsable.",
    defaultSourceId: "demo-catalog",
    continueOnCaptureError: false,
    availableSources: {
      "demo-catalog": buildDemoCatalogBehaviorSource("/tmp/intent-poc")
    }
  });

  const plan = buildQAVerificationExecutionPlan({
    normalizedIntent,
    sourceId: "demo-catalog",
    activeWorkItemIds: [],
    generatedPlaywrightTests: [],
    implementationFileOperations: [{ operation: "replace", filePath: "src/orchestrator/run-intent.ts", rationale: "qa", status: "applied" }],
    workspaceRootDir: "/tmp/intent-poc"
  });

  assert.equal(plan.error, undefined);
  assert.deepEqual(
    plan.commands?.map((command) => command.label),
    ["typecheck", "test-code-targeted"]
  );
  assert.equal(
    plan.commands?.[1]?.command,
    'npm run test:code -- "src/orchestrator/run-intent.behavior.test.ts"'
  );
});

test("buildQAVerificationExecutionPlan Given no active work items and config changes When QA planning runs Then it keeps the full workflow fallback", () => {
  const normalizedIntent = normalizeIntent({
    rawPrompt:
      "The space under the prompt run input box and instructions must be collapsable. All the optional config and setup should be collapsable.",
    defaultSourceId: "demo-catalog",
    continueOnCaptureError: false,
    availableSources: {
      "demo-catalog": buildDemoCatalogBehaviorSource("/tmp/intent-poc")
    }
  });

  const plan = buildQAVerificationExecutionPlan({
    normalizedIntent,
    sourceId: "demo-catalog",
    activeWorkItemIds: [],
    generatedPlaywrightTests: [],
    implementationFileOperations: [{ operation: "replace", filePath: "src/config/schema.ts", rationale: "config", status: "applied" }],
    workspaceRootDir: "/tmp/intent-poc"
  });

  assert.equal(plan.error, undefined);
  assert.deepEqual(
    plan.commands?.map((command) => command.label),
    ["typecheck", "test-full"]
  );
  assert.equal(plan.commands?.[1]?.command, "npm test");
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

        return buildSourceRunResult(input, {
          captures: [buildCapturedOutcome(tmpRoot, "roach-statements")],
          attempts: [
            buildSourceRunAttemptRecord({
              implementation: {
                status: "completed",
                summary: "Implementation completed.",
                commands: [],
                fileOperations: []
              },
              qaVerification: {
                status: "completed",
                summary: "QA verification passed 2 commands.",
                commands: [],
                fileOperations: []
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
        model: "models/gemini-3.1-flash-lite-preview"
      },
      linearScoping: {
        model: "models/gemini-3.1-flash-lite-preview"
      },
      bddPlanning: {
        model: "models/gemini-3.1-flash-lite-preview"
      },
      tddPlanning: {
        model: "models/gemini-3.1-flash-lite-preview"
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
            model: "models/gemini-3-pro-preview"
          }
        }
      },
      dryRun: true
    });

    assert.equal(result.status, "completed");
    assert.equal(capturedProvider, "gemini");
    assert.equal(capturedApiKeyEnv, "GEMINI_API_KEY");
    assert.equal(capturedPromptModel, "models/gemini-3.1-flash-lite-preview");
    assert.equal(capturedPlanningModel, "models/gemini-3-pro-preview");
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