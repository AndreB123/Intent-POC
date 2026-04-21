import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../../config/load-config";
import { toFileUrlPath } from "../../evidence/paths";
import { normalizeIntent } from "../../intent/normalize-intent";
import { RunIntentOptions, RunIntentResult } from "../../orchestrator/run-intent";
import { startIntentStudioServer } from "./start-intent-studio-server";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForState<T>(
  serverBaseUrl: string,
  predicate: (state: T) => boolean,
  timeoutMs = 2000
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${serverBaseUrl}/api/state`);
    assert.equal(response.status, 200);
    const state = (await response.json()) as T;
    if (predicate(state)) {
      return state;
    }
    await delay(20);
  }

  throw new Error(`Timed out waiting for studio state after ${timeoutMs}ms.`);
}

async function writeStudioConfig(configPath: string, tmpDir: string): Promise<void> {
  await fs.writeFile(
    configPath,
    [
      "version: 1",
      "linear:",
      "  enabled: false",
      "  apiKeyEnv: LINEAR_API_KEY",
      "  teamId: ENG",
      "  createIssueOnStart: false",
      "  commentOnProgress: false",
      "  commentOnCompletion: false",
      "agent:",
      "  mode: bounded-runner",
      "sources:",
      "  app:",
      "    planning:",
      "      repoId: intent-poc",
      "      repoLabel: Intent POC",
      "      role: current repo",
      "      summary: Current workspace scope.",
      "    studio:",
      "      displayName: Current app",
      "    source:",
      "      type: local",
      `      localPath: ${JSON.stringify(tmpDir)}`,
      "    workspace:",
      "      checkoutMode: existing",
      "    app:",
      "      workdir: .",
      "      startCommand: echo start",
      "      baseUrl: http://127.0.0.1:3000",
      "      readiness:",
      "        type: http",
      "        url: http://127.0.0.1:3000",
      "    capture:",
      "      items:",
      "        - id: home",
      "          path: /",
      "  screenshots:",
      "    planning:",
      "      repoId: intent-poc",
      "      repoLabel: Intent POC Surface Library",
      "      role: tracked screenshots",
      "      summary: Surface library screenshot maintenance source.",
      "    studio:",
      "      displayName: Tracked library screenshots",
      "    source:",
      "      type: local",
      `      localPath: ${JSON.stringify(tmpDir)}`,
      "    workspace:",
      "      checkoutMode: existing",
      "    app:",
      "      workdir: .",
      "      startCommand: echo start",
      "      baseUrl: http://127.0.0.1:3001",
      "      readiness:",
      "        type: http",
      "        url: http://127.0.0.1:3001",
      "    capture:",
      "      publishToLibrary: true",
      "      items:",
      "        - id: hidden",
      "          path: /hidden",
      "playwright:",
      "  browser: chromium",
      "artifacts:",
      "  storageMode: controller",
      "  root: ./artifacts",
      "comparison:",
      "  hashAlgorithm: sha256",
      "run:",
      "  sourceId: app",
      "  captureIds: []",
      "  continueOnCaptureError: false",
      "  metadata: {}",
      "  dryRun: true"
    ].join("\n"),
    "utf8"
  );
}

test("startIntentStudioServer exposes all configured sources and saves source metadata edits", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-studio-server-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");

  await writeStudioConfig(configPath, tmpDir);

  const server = await startIntentStudioServer({ configPath, port: 0 });

  t.after(async () => {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const stateResponse = await fetch(`${server.baseUrl}/api/state`);
  assert.equal(stateResponse.status, 200);

  const state = (await stateResponse.json()) as {
    configPath: string;
    configFileUrl?: string;
    configEditorUrl?: string;
    sources: Array<{
      id: string;
      label: string;
      repoLabel?: string;
      role?: string;
      defaultScope: boolean;
    }>;
  };
  const expectedRelativeConfigPath = path.relative(process.cwd(), configPath) || path.basename(configPath);

  assert.equal(state.configPath, expectedRelativeConfigPath);
  assert.equal(state.configFileUrl, toFileUrlPath(expectedRelativeConfigPath));
  assert.match(state.configEditorUrl ?? "", /^vscode:\/\/file\//);
  assert.equal(state.sources.length, 2);
  assert.equal(state.sources[0].id, "app");
  assert.equal(state.sources[0].label, "Current app");
  assert.equal(state.sources[0].repoLabel, "Intent POC");
  assert.equal(state.sources[0].role, "current repo");
  assert.equal(state.sources[0].defaultScope, true);
  assert.equal(state.sources[1].id, "screenshots");
  assert.equal(state.sources[1].label, "Tracked library screenshots");

  const saveResponse = await fetch(`${server.baseUrl}/api/source-metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sourceId: "screenshots",
      displayName: "Library surfaces",
      repoLabel: "Intent POC Surface Library",
      role: "shared surface library",
      summary: "Visible surface library source for tracked screenshots and library review."
    })
  });
  assert.equal(saveResponse.status, 200);

  const updatedStateResponse = await fetch(`${server.baseUrl}/api/state`);
  assert.equal(updatedStateResponse.status, 200);
  const updatedState = (await updatedStateResponse.json()) as typeof state;
  assert.equal(updatedState.sources[1].label, "Library surfaces");
  assert.equal(updatedState.sources[1].repoLabel, "Intent POC Surface Library");
  assert.equal(updatedState.sources[1].role, "shared surface library");

  const updatedConfig = await fs.readFile(configPath, "utf8");
  assert.match(updatedConfig, /displayName: Library surfaces/);
  assert.match(updatedConfig, /repoLabel: Intent POC Surface Library/);
  assert.match(updatedConfig, /role: shared surface library/);

  const pageResponse = await fetch(server.baseUrl);
  assert.equal(pageResponse.status, 200);
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /id="source-scope"/);
  assert.match(pageHtml, /id="source-editor-form"/);
  assert.match(pageHtml, /Open config in editor/);
  assert.match(pageHtml, /5\. Planned Execution/);
  assert.match(pageHtml, /id="plan-execution-note"/);
  assert.match(pageHtml, /class="lifecycle-step-status" id="step-plan-status" data-state="pending">Pending/);
  assert.doesNotMatch(pageHtml, /5\. Execution Plan/);

  const planningDocsResponse = await fetch(`${server.baseUrl}/library/planning-docs`);
  assert.equal(planningDocsResponse.status, 200);
  const planningDocsHtml = await planningDocsResponse.text();
  assert.match(planningDocsHtml, /data-testid="library-planning-docs"/);
  assert.match(planningDocsHtml, /id="step-bdd"/);
  assert.match(planningDocsHtml, /id="plan-criteria"/);
  assert.match(planningDocsHtml, /id="step-tdd"/);
  assert.match(planningDocsHtml, /id="plan-work-items"/);

  const removedAliasResponse = await fetch(`${server.baseUrl}/library/studio-planning-docs`);
  assert.equal(removedAliasResponse.status, 404);

  const architectureDocsResponse = await fetch(`${server.baseUrl}/library/architecture-docs`);
  assert.equal(architectureDocsResponse.status, 200);
  const architectureDocsHtml = await architectureDocsResponse.text();
  assert.match(architectureDocsHtml, /data-testid="library-architecture-docs"/);
  assert.match(architectureDocsHtml, /How Work Scope Works/);
  assert.doesNotMatch(architectureDocsHtml, /id="step-bdd"/);

  const libraryIndexResponse = await fetch(`${server.baseUrl}/library`);
  assert.equal(libraryIndexResponse.status, 200);
  const libraryIndexHtml = await libraryIndexResponse.text();
  assert.match(libraryIndexHtml, /Primitive\/Component\/View\/Page Library/);
  assert.match(libraryIndexHtml, /\/library\/planning-docs\?variant=v1/);
  assert.match(libraryIndexHtml, /\/library\/architecture-docs\?variant=v1/);
});

test("startIntentStudioServer rejects Studio requests that enable implementation without a provider", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-studio-server-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");

  await writeStudioConfig(configPath, tmpDir);

  const server = await startIntentStudioServer({ configPath, port: 0 });

  t.after(async () => {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const payload = {
    prompt: "Implement dark mode for the app.",
    agentOverrides: {
      stages: {
        implementation: {
          enabled: true
        }
      }
    }
  };

  const planResponse = await fetch(`${server.baseUrl}/api/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  assert.equal(planResponse.status, 400);
  const planBody = (await planResponse.json()) as { error?: string };
  assert.match(planBody.error ?? "", /Implementation stage requires an explicit provider/);
  assert.match(planBody.error ?? "", /intent-poc\.local-no-linear\.yaml/);

  const runResponse = await fetch(`${server.baseUrl}/api/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  assert.equal(runResponse.status, 400);
  const runBody = (await runResponse.json()) as { error?: string };
  assert.match(runBody.error ?? "", /Implementation stage requires an explicit provider/);
  assert.match(runBody.error ?? "", /agent.provider: gemini/);

  const stateResponse = await fetch(`${server.baseUrl}/api/state`);
  assert.equal(stateResponse.status, 200);
  const state = (await stateResponse.json()) as { currentRun: unknown };
  assert.equal(state.currentRun, null);
});

test("startIntentStudioServer exposes live implementation and QA lifecycle state during a mocked run", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-studio-server-lifecycle-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");

  await writeStudioConfig(configPath, tmpDir);
  const loaded = await loadConfig(configPath);
  const normalizedIntent = normalizeIntent({
    rawPrompt: "Add a dark mode button to the app header.",
    defaultSourceId: loaded.config.run.sourceId,
    continueOnCaptureError: loaded.config.run.continueOnCaptureError,
    availableSources: loaded.config.sources,
    linearEnabled: loaded.config.linear.enabled
  });

  const mockedRunIntent = async (options: RunIntentOptions): Promise<RunIntentResult> => {
    options.onEvent?.({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "intent",
      message: "Intent normalized.",
      details: {
        summary: normalizedIntent.summary,
        sourceId: normalizedIntent.sourceId,
        normalizedIntent
      }
    });

    await delay(100);

    options.onEvent?.({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "implementation",
      message: "Implementation attempt started.",
      details: {
        sourceId: "app"
      }
    });

    await delay(100);

    options.onEvent?.({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "implementation",
      message: "Implementation attempt completed.",
      details: {
        sourceId: "app",
        status: "completed",
        summary: "Added dark mode toggle in the app header.",
        targetedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
        completedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
        remainingWorkItemIds: ["work-2-wire-dark-mode-state"],
        fileOperations: [
          {
            operation: "replace",
            filePath: "src/demo-app/render/render-intent-studio-page.ts"
          }
        ]
      }
    });

    await delay(100);

    options.onEvent?.({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "qa-verification",
      message: "QA verification started.",
      details: {
        sourceId: "app"
      }
    });

    await delay(100);

    options.onEvent?.({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "qa-verification",
      message: "QA verification passed.",
      details: {
        sourceId: "app",
        status: "completed",
        summary: "Typecheck and focused verification passed.",
        targetedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
        completedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
        remainingWorkItemIds: ["work-2-wire-dark-mode-state"]
      }
    });

    await delay(100);

    return {
      status: "completed",
      sourceId: "app",
      dryRun: false,
      normalizedIntent,
      paths: {
        runId: "run-1",
        controllerRoot: tmpDir,
        runDir: path.join(tmpDir, "artifacts", "runs", "run-1"),
        sourcesDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources"),
        logsDir: path.join(tmpDir, "artifacts", "runs", "run-1", "logs"),
        normalizedIntentPath: path.join(tmpDir, "artifacts", "runs", "run-1", "normalized-intent.json"),
        linearPath: path.join(tmpDir, "artifacts", "runs", "run-1", "linear.json"),
        planLifecyclePath: path.join(tmpDir, "artifacts", "runs", "run-1", "plan-lifecycle.json"),
        summaryPath: path.join(tmpDir, "artifacts", "runs", "run-1", "summary.md"),
        manifestPath: path.join(tmpDir, "artifacts", "runs", "run-1", "manifest.json"),
        hashesPath: path.join(tmpDir, "artifacts", "runs", "run-1", "hashes.json"),
        comparisonPath: path.join(tmpDir, "artifacts", "runs", "run-1", "comparison.json"),
        sourceRuns: {
          app: {
            runId: "run-1",
            sourceId: "app",
            controllerRoot: tmpDir,
            sourceDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app"),
            attemptsDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "attempts"),
            capturesDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "captures"),
            diffsDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "diffs"),
            logsDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "logs"),
            baselineSourceDir: path.join(tmpDir, "artifacts", "library", "app"),
            appLogPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "logs", "app.log"),
            manifestPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "manifest.json"),
            hashesPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "hashes.json"),
            comparisonPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "comparison.json"),
            summaryPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "summary.md")
          }
        }
      },
      linearIssue: null,
      linearPublication: null,
      sourceRuns: [
        {
          sourceId: "app",
          status: "completed",
          paths: {
            runId: "run-1",
            sourceId: "app",
            controllerRoot: tmpDir,
            sourceDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app"),
            attemptsDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "attempts"),
            capturesDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "captures"),
            diffsDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "diffs"),
            logsDir: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "logs"),
            baselineSourceDir: path.join(tmpDir, "artifacts", "library", "app"),
            appLogPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "logs", "app.log"),
            manifestPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "manifest.json"),
            hashesPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "hashes.json"),
            comparisonPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "comparison.json"),
            summaryPath: path.join(tmpDir, "artifacts", "runs", "run-1", "sources", "app", "summary.md")
          },
          captures: [],
          error: undefined,
          linearIssue: null,
          generatedPlaywrightTests: [],
          attempts: [
            {
              attemptNumber: 1,
              startedAt: "2026-04-15T00:00:00.000Z",
              finishedAt: "2026-04-15T00:00:01.000Z",
              status: "completed",
              targetedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
              completedInAttemptWorkItemIds: ["work-1-enable-dark-mode-toggle"],
              pendingTargetedWorkItemIds: [],
              completedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
              remainingWorkItemIds: ["work-2-wire-dark-mode-state"],
              implementation: {
                status: "completed",
                summary: "Added dark mode toggle in the app header.",
                targetedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
                completedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
                remainingWorkItemIds: ["work-2-wire-dark-mode-state"],
                commands: [],
                fileOperations: [
                  {
                    operation: "replace",
                    filePath: "src/demo-app/render/render-intent-studio-page.ts",
                    rationale: "Mocked implementation result",
                    status: "applied"
                  }
                ]
              },
              qaVerification: {
                status: "completed",
                summary: "Typecheck and focused verification passed.",
                targetedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
                completedWorkItemIds: ["work-1-enable-dark-mode-toggle"],
                remainingWorkItemIds: ["work-2-wire-dark-mode-state"],
                commands: [],
                fileOperations: []
              }
            }
          ],
          summaryMarkdown: "# app"
        }
      ],
      captures: [],
      hasDrift: false,
      counts: {
        "baseline-written": 0,
        unchanged: 0,
        changed: 0,
        "missing-baseline": 0,
        "capture-failed": 0,
        "diff-error": 0
      },
      summaryMarkdown: "# run summary",
      errors: []
    };
  };

  const server = await startIntentStudioServer({ configPath, port: 0, runIntentFn: mockedRunIntent });

  t.after(async () => {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const runResponse = await fetch(`${server.baseUrl}/api/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: "Add a dark mode button to the app header."
    })
  });
  assert.equal(runResponse.status, 202);

  const runningState = await waitForState<{
    currentRun: {
      status: string;
      sourceRuns: Array<{
        sourceId: string;
        status: string;
        implementationStageStatus?: string;
        qaVerificationStageStatus?: string;
      }>;
    } | null;
  }>(server.baseUrl, (state) => state.currentRun?.sourceRuns?.[0]?.implementationStageStatus === "running");

  assert.equal(runningState.currentRun?.status, "running");
  assert.equal(runningState.currentRun?.sourceRuns[0]?.sourceId, "app");
  assert.equal(runningState.currentRun?.sourceRuns[0]?.status, "running");
  assert.equal(runningState.currentRun?.sourceRuns[0]?.implementationStageStatus, "running");

  const completedState = await waitForState<{
    currentRun: {
      status: string;
      sourceRuns: Array<{
        implementationStageStatus?: string;
        qaVerificationStageStatus?: string;
        latestImplementationSummary?: string;
        latestCompletedInAttemptWorkItemIds?: string[];
        latestPendingTargetedWorkItemIds?: string[];
        attemptSummaries?: Array<{
          completedInAttemptWorkItemIds: string[];
          pendingTargetedWorkItemIds: string[];
        }>;
      }>;
    } | null;
  }>(server.baseUrl, (state) => state.currentRun?.status === "completed");

  assert.equal(completedState.currentRun?.sourceRuns[0]?.implementationStageStatus, "completed");
  assert.equal(completedState.currentRun?.sourceRuns[0]?.qaVerificationStageStatus, "completed");
  assert.match(completedState.currentRun?.sourceRuns[0]?.latestImplementationSummary ?? "", /dark mode toggle/);
  assert.deepEqual(completedState.currentRun?.sourceRuns[0]?.latestCompletedInAttemptWorkItemIds, ["work-1-enable-dark-mode-toggle"]);
  assert.deepEqual(completedState.currentRun?.sourceRuns[0]?.latestPendingTargetedWorkItemIds, []);
  assert.deepEqual(
    completedState.currentRun?.sourceRuns[0]?.attemptSummaries?.[0]?.completedInAttemptWorkItemIds,
    ["work-1-enable-dark-mode-toggle"]
  );
});

test("startIntentStudioServer uses the shared runtime policy when launching tracked-library sources", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-studio-server-runtime-policy-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");
  let receivedOptions: RunIntentOptions | undefined;

  await writeStudioConfig(configPath, tmpDir);

  const loaded = await loadConfig(configPath);
  const normalizedIntent = normalizeIntent({
    rawPrompt: "Refresh tracked screenshots for the shared library source.",
    defaultSourceId: loaded.config.run.sourceId,
    continueOnCaptureError: loaded.config.run.continueOnCaptureError,
    availableSources: loaded.config.sources,
    linearEnabled: loaded.config.linear.enabled
  });

  const mockedRunIntent = async (options: RunIntentOptions): Promise<RunIntentResult> => {
    receivedOptions = options;

    return {
      status: "completed",
      sourceId: "screenshots",
      dryRun: false,
      normalizedIntent,
      paths: {
        runId: "run-1",
        controllerRoot: tmpDir,
        runDir: path.join(tmpDir, "artifacts", "business"),
        sourcesDir: path.join(tmpDir, "artifacts", "sources"),
        logsDir: path.join(tmpDir, "artifacts", "logs"),
        normalizedIntentPath: path.join(tmpDir, "artifacts", "business", "normalized-intent.json"),
        linearPath: path.join(tmpDir, "artifacts", "business", "linear.json"),
        planLifecyclePath: path.join(tmpDir, "artifacts", "business", "plan-lifecycle.json"),
        summaryPath: path.join(tmpDir, "artifacts", "business", "summary.md"),
        manifestPath: path.join(tmpDir, "artifacts", "business", "manifest.json"),
        hashesPath: path.join(tmpDir, "artifacts", "business", "hashes.json"),
        comparisonPath: path.join(tmpDir, "artifacts", "business", "comparison.json"),
        sourceRuns: {
          screenshots: {
            runId: "run-1",
            sourceId: "screenshots",
            controllerRoot: tmpDir,
            sourceDir: path.join(tmpDir, "artifacts", "sources", "screenshots"),
            attemptsDir: path.join(tmpDir, "artifacts", "sources", "screenshots", "attempts"),
            capturesDir: path.join(tmpDir, "artifacts", "sources", "screenshots", "captures"),
            diffsDir: path.join(tmpDir, "artifacts", "sources", "screenshots", "diffs"),
            logsDir: path.join(tmpDir, "artifacts", "sources", "screenshots", "logs"),
            baselineSourceDir: path.join(tmpDir, "artifacts", "library", "screenshots"),
            appLogPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "logs", "app.log"),
            manifestPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "manifest.json"),
            hashesPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "hashes.json"),
            comparisonPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "comparison.json"),
            summaryPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "summary.md")
          }
        }
      },
      linearIssue: null,
      linearPublication: null,
      sourceRuns: [
        {
          sourceId: "screenshots",
          status: "completed",
          paths: {
            runId: "run-1",
            sourceId: "screenshots",
            controllerRoot: tmpDir,
            sourceDir: path.join(tmpDir, "artifacts", "sources", "screenshots"),
            attemptsDir: path.join(tmpDir, "artifacts", "sources", "screenshots", "attempts"),
            capturesDir: path.join(tmpDir, "artifacts", "sources", "screenshots", "captures"),
            diffsDir: path.join(tmpDir, "artifacts", "sources", "screenshots", "diffs"),
            logsDir: path.join(tmpDir, "artifacts", "sources", "screenshots", "logs"),
            baselineSourceDir: path.join(tmpDir, "artifacts", "library", "screenshots"),
            appLogPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "logs", "app.log"),
            manifestPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "manifest.json"),
            hashesPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "hashes.json"),
            comparisonPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "comparison.json"),
            summaryPath: path.join(tmpDir, "artifacts", "sources", "screenshots", "summary.md")
          },
          captures: [],
          error: undefined,
          linearIssue: null,
          generatedPlaywrightTests: [],
          attempts: [],
          summaryMarkdown: "# screenshots"
        }
      ],
      captures: [],
      hasDrift: false,
      counts: {
        "baseline-written": 0,
        unchanged: 0,
        changed: 0,
        "missing-baseline": 0,
        "capture-failed": 0,
        "diff-error": 0
      },
      summaryMarkdown: "# run summary",
      errors: []
    };
  };

  const server = await startIntentStudioServer({ configPath, port: 0, runIntentFn: mockedRunIntent });

  t.after(async () => {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const runResponse = await fetch(`${server.baseUrl}/api/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: "Refresh tracked screenshots for the shared library source.",
      sourceIds: ["screenshots"]
    })
  });

  assert.equal(runResponse.status, 202);

  await waitForState<{ currentRun: { status: string } | null }>(
    server.baseUrl,
    (state) => state.currentRun?.status === "completed"
  );

  assert.equal(receivedOptions?.publishToLibrary, true);
  assert.deepEqual(receivedOptions?.sourceIds, ["screenshots"]);
});

test("startIntentStudioServer exposes controller-relative capture paths for Studio preview links", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-studio-server-capture-path-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");

  await writeStudioConfig(configPath, tmpDir);
  const loaded = await loadConfig(configPath);
  const normalizedIntent = normalizeIntent({
    rawPrompt: "Verify that screenshots at the bottom of the results page link to the actual images.",
    defaultSourceId: loaded.config.run.sourceId,
    continueOnCaptureError: loaded.config.run.continueOnCaptureError,
    availableSources: loaded.config.sources,
    linearEnabled: loaded.config.linear.enabled
  });

  const runId = "run-1";
  const captureOutputPath = path.join(tmpDir, "artifacts", "sources", "app", "captures", "result.png");
  const expectedImagePath = path.join("artifacts", "sources", "app", "captures", "result.png");

  const mockedRunIntent = async (): Promise<RunIntentResult> => ({
    status: "completed",
    sourceId: "app",
    dryRun: false,
    normalizedIntent,
    paths: {
      runId,
      controllerRoot: tmpDir,
      runDir: path.join(tmpDir, "artifacts", "business"),
      sourcesDir: path.join(tmpDir, "artifacts", "sources"),
      logsDir: path.join(tmpDir, "artifacts", "logs"),
      normalizedIntentPath: path.join(tmpDir, "artifacts", "business", "normalized-intent.json"),
      linearPath: path.join(tmpDir, "artifacts", "business", "linear.json"),
      planLifecyclePath: path.join(tmpDir, "artifacts", "business", "plan-lifecycle.json"),
      summaryPath: path.join(tmpDir, "artifacts", "business", "summary.md"),
      manifestPath: path.join(tmpDir, "artifacts", "business", "manifest.json"),
      hashesPath: path.join(tmpDir, "artifacts", "business", "hashes.json"),
      comparisonPath: path.join(tmpDir, "artifacts", "business", "comparison.json"),
      sourceRuns: {
        app: {
          runId,
          sourceId: "app",
          controllerRoot: tmpDir,
          sourceDir: path.join(tmpDir, "artifacts", "sources", "app"),
          attemptsDir: path.join(tmpDir, "artifacts", "sources", "app", "attempts"),
          capturesDir: path.join(tmpDir, "artifacts", "sources", "app", "captures"),
          diffsDir: path.join(tmpDir, "artifacts", "sources", "app", "diffs"),
          logsDir: path.join(tmpDir, "artifacts", "sources", "app", "logs"),
          baselineSourceDir: path.join(tmpDir, "artifacts", "library", "app"),
          appLogPath: path.join(tmpDir, "artifacts", "sources", "app", "logs", "app.log"),
          manifestPath: path.join(tmpDir, "artifacts", "sources", "app", "manifest.json"),
          hashesPath: path.join(tmpDir, "artifacts", "sources", "app", "hashes.json"),
          comparisonPath: path.join(tmpDir, "artifacts", "sources", "app", "comparison.json"),
          summaryPath: path.join(tmpDir, "artifacts", "sources", "app", "summary.md")
        }
      }
    },
    linearIssue: null,
    linearPublication: null,
    sourceRuns: [
      {
        sourceId: "app",
        status: "completed",
        paths: {
          runId,
          sourceId: "app",
          controllerRoot: tmpDir,
          sourceDir: path.join(tmpDir, "artifacts", "sources", "app"),
          attemptsDir: path.join(tmpDir, "artifacts", "sources", "app", "attempts"),
          capturesDir: path.join(tmpDir, "artifacts", "sources", "app", "captures"),
          diffsDir: path.join(tmpDir, "artifacts", "sources", "app", "diffs"),
          logsDir: path.join(tmpDir, "artifacts", "sources", "app", "logs"),
          baselineSourceDir: path.join(tmpDir, "artifacts", "library", "app"),
          appLogPath: path.join(tmpDir, "artifacts", "sources", "app", "logs", "app.log"),
          manifestPath: path.join(tmpDir, "artifacts", "sources", "app", "manifest.json"),
          hashesPath: path.join(tmpDir, "artifacts", "sources", "app", "hashes.json"),
          comparisonPath: path.join(tmpDir, "artifacts", "sources", "app", "comparison.json"),
          summaryPath: path.join(tmpDir, "artifacts", "sources", "app", "summary.md")
        },
        captures: [
          {
            captureId: "result",
            path: "/results",
            url: "http://127.0.0.1:3000/results",
            kind: "page",
            outputPath: captureOutputPath,
            relativeOutputPath: "result.png",
            durationMs: 120,
            viewport: { width: 1440, height: 900 },
            status: "captured",
            warnings: []
          }
        ],
        error: undefined,
        linearIssue: null,
        generatedPlaywrightTests: [],
        attempts: []
      }
    ],
    captures: [
      {
        captureId: "result",
        path: "/results",
        url: "http://127.0.0.1:3000/results",
        kind: "page",
        outputPath: captureOutputPath,
        relativeOutputPath: "result.png",
        durationMs: 120,
        viewport: { width: 1440, height: 900 },
        status: "captured",
        warnings: []
      }
    ],
    hasDrift: false,
    counts: {
      "baseline-written": 0,
      unchanged: 1,
      changed: 0,
      "missing-baseline": 0,
      "capture-failed": 0,
      "diff-error": 0
    },
    summaryMarkdown: "# run summary",
    errors: []
  });

  const server = await startIntentStudioServer({ configPath, port: 0, runIntentFn: mockedRunIntent });

  t.after(async () => {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const runResponse = await fetch(`${server.baseUrl}/api/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: "Verify that screenshots at the bottom of the results page link to the actual images."
    })
  });
  assert.equal(runResponse.status, 202);

  const completedState = await waitForState<{
    currentRun: {
      status: string;
      captures: Array<{
        imagePath?: string;
      }>;
    } | null;
  }>(server.baseUrl, (state) => state.currentRun?.status === "completed" && Boolean(state.currentRun?.captures?.[0]?.imagePath));

  assert.equal(completedState.currentRun?.captures[0]?.imagePath, expectedImagePath);
});