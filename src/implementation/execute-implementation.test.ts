import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppConfig } from "../config/schema";
import { SourceRunPaths } from "../evidence/paths";
import { ResolvedAgentStageConfig } from "../intent/agent-stage-config";
import { NormalizedIntent } from "../intent/intent-types";
import { buildBehaviorTestConfig } from "../orchestrator/run-intent.test-support";
import { ExecuteImplementationStageInput } from "../orchestrator/run-intent";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import { executeImplementationStage } from "./execute-implementation";

function buildNormalizedIntent(sourceId: string): NormalizedIntent {
  return {
    intentId: "intent-1",
    receivedAt: "2026-01-01T00:00:00.000Z",
    rawPrompt: "Add the requested dashboard affordance.",
    summary: "Add the requested dashboard affordance.",
    intentType: "compare",
    businessIntent: {
      statement: "Add the requested dashboard affordance.",
      desiredOutcome: "Users can see the new dashboard affordance.",
      acceptanceCriteria: [
        {
          id: "ac-1",
          description: "The affordance renders on the dashboard.",
          origin: "prompt"
        }
      ],
      scenarios: [
        {
          id: "scenario-1",
          title: "Dashboard affordance visible",
          goal: "Render the affordance on page load.",
          given: ["the user opens the dashboard"],
          when: ["the page finishes rendering"],
          then: ["the affordance is visible"],
          applicableSourceIds: [sourceId]
        }
      ],
      workItems: [
        {
          id: "work-item-1",
          type: "playwright-spec",
          title: "Validate dashboard affordance",
          description: "Cover the new affordance with a generated Playwright spec.",
          scenarioIds: ["scenario-1"],
          sourceIds: [sourceId],
          userVisibleOutcome: "The affordance is visible on the dashboard.",
          verification: "Generated Playwright spec passes.",
          playwright: {
            generatedBy: "rules",
            specs: [
              {
                framework: "playwright",
                sourceId,
                relativeSpecPath: "tests/intent/generated/dashboard-affordance.spec.ts",
                suiteName: "Dashboard affordance",
                testName: "shows the affordance",
                scenarioIds: ["scenario-1"],
                checkpoints: []
              }
            ]
          }
        }
      ]
    },
    planning: {
      repoCandidates: [],
      plannerSections: [],
      reviewNotes: [],
      linearPlan: {
        mode: "new"
      }
    },
    executionPlan: {
      primarySourceId: sourceId,
      sources: [
        {
          sourceId,
          selectionReason: "Unit test source lane.",
          runMode: "compare",
          captureScope: {
            mode: "all",
            captureIds: []
          },
          warnings: []
        }
      ],
      destinations: [],
      tools: [],
      orchestrationStrategy: "single-source",
      reviewNotes: []
    },
    sourceId,
    captureScope: {
      mode: "all",
      captureIds: []
    },
    artifacts: {
      requireScreenshots: true,
      requireManifest: true,
      requireHashes: true,
      requireComparison: true
    },
    linear: {
      createIssue: false,
      issueTitle: ""
    },
    execution: {
      runMode: "compare",
      continueOnCaptureError: false
    },
    normalizationMeta: {
      source: "rules",
      warnings: [],
      stages: []
    }
  };
}

function buildImplementationStage(overrides: Partial<ResolvedAgentStageConfig> = {}): ResolvedAgentStageConfig {
  return {
    id: "implementation",
    label: "Implementation",
    description: "Apply bounded source changes.",
    enabled: true,
    provider: "gemini",
    model: "models/gemini-3.1-flash-lite-preview",
    temperature: 0.1,
    maxTokens: 8192,
    apiKeyEnv: "TEST_GEMINI_API_KEY",
    fallbackToRules: true,
    ...overrides
  };
}

function buildSourcePaths(rootDir: string, sourceId: string): SourceRunPaths {
  const sourceDir = path.join(rootDir, "artifacts", "runs", "run-1", "sources", sourceId);

  return {
    controllerRoot: rootDir,
    runId: "run-1",
    sourceId,
    sourceDir,
    attemptsDir: path.join(sourceDir, "attempts"),
    capturesDir: path.join(sourceDir, "captures"),
    diffsDir: path.join(sourceDir, "diffs"),
    logsDir: path.join(sourceDir, "logs"),
    manifestPath: path.join(sourceDir, "manifest.json"),
    hashesPath: path.join(sourceDir, "hashes.json"),
    comparisonPath: path.join(sourceDir, "comparison.json"),
    summaryPath: path.join(sourceDir, "summary.md"),
    appLogPath: path.join(sourceDir, "app.log"),
    baselineSourceDir: path.join(rootDir, "artifacts", "library", sourceId)
  };
}

function buildWorkspace(config: AppConfig, rootDir: string, sourceId: string): ResolvedSourceWorkspace {
  const source = config.sources[sourceId];
  if (!source) {
    throw new Error(`Missing test source '${sourceId}'.`);
  }

  return {
    sourceId,
    source,
    rootDir,
    appDir: rootDir,
    baseUrl: source.app.baseUrl,
    sourceType: source.source.type
  };
}

async function createImplementationInput(): Promise<{
  rootDir: string;
  input: ExecuteImplementationStageInput;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-execute-implementation-"));
  const config = buildBehaviorTestConfig(rootDir);
  const sourceId = "client-systems-roach-admin";
  const sourcePaths = buildSourcePaths(rootDir, sourceId);

  await fs.mkdir(sourcePaths.attemptsDir, { recursive: true });
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "tests", "intent", "generated"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { typecheck: "tsc --noEmit" } }, null, 2)
  );
  await fs.writeFile(path.join(rootDir, "src", "existing.ts"), "export const value = 'before';\n");
  await fs.writeFile(path.join(rootDir, "src", "remove.ts"), "export const removed = true;\n");
  await fs.writeFile(
    path.join(rootDir, "tests", "intent", "generated", "dashboard-affordance.spec.ts"),
    "test('dashboard affordance', async () => {});\n"
  );

  return {
    rootDir,
    input: {
      config,
      stage: buildImplementationStage(),
      normalizedIntent: buildNormalizedIntent(sourceId),
      sourcePlan: {
        sourceId,
        selectionReason: "Unit test source lane.",
        runMode: "compare",
        captureScope: {
          mode: "all",
          captureIds: []
        },
        warnings: []
      },
      sourcePaths,
      workspace: buildWorkspace(config, rootDir, sourceId),
      generatedPlaywrightTests: [
        path.join(rootDir, "tests", "intent", "generated", "dashboard-affordance.spec.ts")
      ],
      attemptNumber: 1,
      options: {
        configPath: path.join(rootDir, "intent-poc.yaml")
      }
    }
  };
}

test("executeImplementationStage Given a missing provider When the stage is enabled Then it fails before planning", async () => {
  const { rootDir, input } = await createImplementationInput();
  let plannerCalls = 0;

  try {
    const result = await executeImplementationStage(
      {
        ...input,
        stage: buildImplementationStage({ provider: undefined, apiKeyEnv: undefined })
      },
      {
        planChanges: async () => {
          plannerCalls += 1;
          return { operations: [], warnings: [] };
        }
      }
    );

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /requires an explicit provider/);
    assert.equal(plannerCalls, 0);
    assert.deepEqual(result.fileOperations, []);
    assert.equal(result.commands.at(-1)?.status, "failed");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("executeImplementationStage Given a planned bounded change set When generation succeeds Then it applies create replace and delete operations", async () => {
  const { rootDir, input } = await createImplementationInput();
  const previousApiKey = process.env.TEST_GEMINI_API_KEY;
  process.env.TEST_GEMINI_API_KEY = "test-key";

  try {
    const result = await executeImplementationStage(input, {
      planChanges: async () => ({
        operations: [
          {
            operation: "replace",
            filePath: "src/existing.ts",
            rationale: "Update the existing dashboard implementation."
          },
          {
            operation: "create",
            filePath: "src/new.ts",
            rationale: "Add a small helper for the affordance."
          },
          {
            operation: "delete",
            filePath: "src/remove.ts",
            rationale: "Drop the obsolete implementation file."
          }
        ],
        warnings: []
      }),
      materializeChanges: async () => ({
        files: [
          {
            filePath: "src/existing.ts",
            content: "export const value = 'after';\n"
          },
          {
            filePath: "src/new.ts",
            content: "export const created = true;\n"
          }
        ],
        warnings: []
      })
    });

    assert.equal(result.status, "completed");
    assert.equal(result.commands.length, 3);
    assert.equal(result.fileOperations.length, 3);
    assert.match(result.summary, /Applied 3 file operations/);

    const existingContent = await fs.readFile(path.join(rootDir, "src", "existing.ts"), "utf8");
    const newContent = await fs.readFile(path.join(rootDir, "src", "new.ts"), "utf8");
    const removedExists = await fs.stat(path.join(rootDir, "src", "remove.ts")).then(() => true).catch(() => false);

    assert.equal(existingContent, "export const value = 'after';\n");
    assert.equal(newContent, "export const created = true;\n");
    assert.equal(removedExists, false);
    assert.equal(result.commands.every((command) => command.logPath && command.status === "completed"), true);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.TEST_GEMINI_API_KEY;
    } else {
      process.env.TEST_GEMINI_API_KEY = previousApiKey;
    }

    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("executeImplementationStage Given a hallucinated replace target When the file does not exist Then it fails before materialization", async () => {
  const { rootDir, input } = await createImplementationInput();
  const previousApiKey = process.env.TEST_GEMINI_API_KEY;
  process.env.TEST_GEMINI_API_KEY = "test-key";
  let materializeCalls = 0;

  try {
    const result = await executeImplementationStage(input, {
      planChanges: async () => ({
        operations: [
          {
            operation: "replace",
            filePath: "src/demo-app/library/page-analytics-overview.tsx",
            rationale: "Update the rendered analytics page."
          }
        ],
        warnings: []
      }),
      materializeChanges: async () => {
        materializeCalls += 1;
        return {
          files: [],
          warnings: []
        };
      }
    });

    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /does not exist/);
    assert.equal(materializeCalls, 0);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.TEST_GEMINI_API_KEY;
    } else {
      process.env.TEST_GEMINI_API_KEY = previousApiKey;
    }

    await fs.rm(rootDir, { recursive: true, force: true });
  }
});