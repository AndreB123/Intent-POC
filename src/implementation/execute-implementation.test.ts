import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppConfig } from "../config/schema";
import { SourceRunPaths } from "../evidence/paths";
import { ResolvedAgentStageConfig } from "../intent/agent-stage-config";
import { CodeSurfaceSelection } from "../intent/code-surface";
import { NormalizedIntent } from "../intent/intent-types";
import { buildBehaviorTestConfig } from "../orchestrator/run-intent.test-support";
import { ExecuteImplementationStageInput } from "../orchestrator/run-intent";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import {
  buildImplementationPromptContext,
  collectImplementationWorkspaceFiles,
  collectRelevantImplementationFiles,
  planImplementationChanges,
  readGeneratedSpecContexts,
  readWorkspacePackageContext
} from "./gemini-code-generator";
import { executeImplementationStage } from "./execute-implementation";

function buildNormalizedIntent(sourceId: string, codeSurface?: CodeSurfaceSelection): NormalizedIntent {
  return {
    intentId: "intent-1",
    receivedAt: "2026-01-01T00:00:00.000Z",
    rawPrompt: "Add the requested dashboard affordance.",
    summary: "Add the requested dashboard affordance.",
    intentType: "capture-evidence",
    codeSurface,
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
          execution: {
            order: 1,
            dependsOnWorkItemIds: []
          },
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
      requireHashes: true
    },
    linear: {
      createIssue: false,
      issueTitle: ""
    },
    execution: {
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
  await fs.mkdir(path.join(rootDir, "src", "demo-app", "theme"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "tests", "intent", "generated"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { typecheck: "tsc --noEmit" } }, null, 2)
  );
  await fs.writeFile(path.join(rootDir, "src", "existing.ts"), "export const value = 'before';\n");
  await fs.writeFile(path.join(rootDir, "src", "remove.ts"), "export const removed = true;\n");
  await fs.writeFile(
    path.join(rootDir, "src", "demo-app", "theme", "theme.ts"),
    "export const themeToggleLabel = 'Dark mode toggle';\n"
  );
  await fs.writeFile(
    path.join(rootDir, "src", "demo-app", "theme", "theme.test.ts"),
    "test('theme toggle', () => {});\n"
  );
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
      activeWorkItemIds: ["work-item-1"],
      completedWorkItemIds: [],
      remainingWorkItemIds: ["work-item-1"],
      options: {
        configPath: path.join(rootDir, "intent-poc.yaml")
      }
    }
  };
}

async function buildPlanningContext(rootDir: string, input: ExecuteImplementationStageInput) {
  const workspaceFiles = await collectImplementationWorkspaceFiles(rootDir);
  const generatedSpecs = await readGeneratedSpecContexts({
    rootDir,
    generatedPlaywrightTests: input.generatedPlaywrightTests
  });
  const packageContext = await readWorkspacePackageContext({ rootDir });
  const scenarios = input.normalizedIntent.businessIntent.scenarios.filter((scenario) =>
    scenario.applicableSourceIds.includes(input.sourcePlan.sourceId)
  );
  const sourceWorkItems = input.normalizedIntent.businessIntent.workItems.filter((workItem) =>
    workItem.sourceIds.includes(input.sourcePlan.sourceId)
  );
  const activeWorkItems = sourceWorkItems.filter((workItem) => input.activeWorkItemIds.includes(workItem.id));
  const backlogWorkItems = sourceWorkItems.filter(
    (workItem) => input.remainingWorkItemIds.includes(workItem.id) && !input.activeWorkItemIds.includes(workItem.id)
  );
  const relevantFiles = await collectRelevantImplementationFiles({
    rootDir,
    rawPrompt: input.normalizedIntent.rawPrompt,
    summary: input.normalizedIntent.summary,
    sourceId: input.sourcePlan.sourceId,
    codeSurface: input.normalizedIntent.codeSurface,
    desiredOutcome: input.normalizedIntent.businessIntent.desiredOutcome,
    acceptanceCriteria: input.normalizedIntent.businessIntent.acceptanceCriteria.map((criterion) => criterion.description),
    scenarios,
    workItems: activeWorkItems,
    workspaceFiles,
    generatedSpecs
  });

  return buildImplementationPromptContext({
    rawPrompt: input.normalizedIntent.rawPrompt,
    summary: input.normalizedIntent.summary,
    sourceId: input.sourcePlan.sourceId,
    codeSurface: input.normalizedIntent.codeSurface,
    desiredOutcome: input.normalizedIntent.businessIntent.desiredOutcome,
    acceptanceCriteria: input.normalizedIntent.businessIntent.acceptanceCriteria.map((criterion) => criterion.description),
    scenarios,
    activeWorkItems,
    backlogWorkItems,
    workspaceFiles,
    generatedSpecs,
    relevantFiles,
    packageContext
  });
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

test("planImplementationChanges Given generated specs When planning is requested Then the prompt keeps them read-only and path-only", async () => {
  const { rootDir, input } = await createImplementationInput();
  let capturedPrompt = "";

  try {
    const context = await buildPlanningContext(rootDir, input);

    await planImplementationChanges(
      {
        stage: input.stage,
        context
      },
      {
        generateStructuredGeminiContent: async ({ prompt }) => {
          capturedPrompt = prompt;
          return JSON.stringify({ operations: [], warnings: [] });
        }
      }
    );

    assert.match(capturedPrompt, /Generated Playwright specs \(read-only verification inputs\):/);
    assert.match(capturedPrompt, /Active work items to implement in this pass:/);
    assert.match(capturedPrompt, /dashboard-affordance\.spec\.ts/);
    assert.match(capturedPrompt, /Prefer existing source files under src\/ and src\/demo-app\//);
    assert.equal(capturedPrompt.includes('"specPaths"'), false);
    assert.equal(capturedPrompt.includes("test('dashboard affordance'"), false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("executeImplementationStage Given active work items and zero planned operations When execution runs Then it fails instead of completing early", async () => {
  const { rootDir, input } = await createImplementationInput();
  const previousApiKey = process.env.TEST_GEMINI_API_KEY;
  process.env.TEST_GEMINI_API_KEY = "test-key";

  try {
    const result = await executeImplementationStage(input, {
      planChanges: async () => ({
        operations: [],
        warnings: []
      })
    });

    assert.equal(result.status, "failed");
    assert.match(result.summary, /planned no source file changes/);
    assert.match(result.error ?? "", /zero operations/);
    assert.deepEqual(result.targetedWorkItemIds, ["work-item-1"]);
    assert.deepEqual(result.completedWorkItemIds, []);
    assert.deepEqual(result.remainingWorkItemIds, ["work-item-1"]);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.TEST_GEMINI_API_KEY;
    } else {
      process.env.TEST_GEMINI_API_KEY = previousApiKey;
    }

    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("collectRelevantImplementationFiles Given matching source and test files When source files exist Then it prefers source files", async () => {
  const { rootDir } = await createImplementationInput();

  try {
    const workspaceFiles = await collectImplementationWorkspaceFiles(rootDir);
    const relevantFiles = await collectRelevantImplementationFiles({
      rootDir,
      rawPrompt: "Add a dark mode toggle to the theme frame.",
      summary: "Add a dark mode toggle to the theme frame.",
      sourceId: "demo-catalog",
      desiredOutcome: "Users can see a dark mode toggle in the theme frame.",
      acceptanceCriteria: ["The dark mode toggle appears in the theme frame."],
      scenarios: [],
      workItems: [],
      workspaceFiles,
      generatedSpecs: []
    });

    assert.equal(relevantFiles.at(0)?.relativePath, "src/demo-app/theme/theme.ts");
    assert.equal(relevantFiles.some((file) => file.relativePath === "src/demo-app/theme/theme.ts"), true);
    assert.equal(relevantFiles.some((file) => file.relativePath === "src/demo-app/theme/theme.test.ts"), false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("collectRelevantImplementationFiles Given an intent studio surface When library and studio files compete Then it prefers the studio render surface", async () => {
  const { rootDir } = await createImplementationInput();

  try {
    await fs.mkdir(path.join(rootDir, "src", "demo-app", "render"), { recursive: true });
    await fs.mkdir(path.join(rootDir, "src", "demo-app", "server"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "src", "demo-app", "render", "render-intent-studio-page.ts"),
      "export function renderIntentStudioPage() { return '<section>studio</section>'; }\n"
    );
    await fs.writeFile(
      path.join(rootDir, "src", "demo-app", "render", "render-surface-frame.ts"),
      "export function renderSurfaceFrame() { return '<section>library</section>'; }\n"
    );
    await fs.writeFile(
      path.join(rootDir, "src", "demo-app", "server", "start-intent-studio-server.ts"),
      "export async function startIntentStudioServer() { return { close: async () => {} }; }\n"
    );

    const workspaceFiles = await collectImplementationWorkspaceFiles(rootDir);
    const relevantFiles = await collectRelevantImplementationFiles({
      rootDir,
      rawPrompt: "Add a dark mode button to the intent studio screen, not the library.",
      summary: "Add the dark mode button to Intent Studio.",
      sourceId: "demo-catalog",
      codeSurface: {
        sourceId: "demo-catalog",
        id: "intent-studio",
        label: "Intent Studio",
        confidence: "high",
        rationale: "The prompt explicitly names Intent Studio.",
        alternatives: []
      },
      desiredOutcome: "Users can use a dark mode button in Intent Studio.",
      acceptanceCriteria: ["The button is visible in the Intent Studio header."],
      scenarios: [],
      workItems: [],
      workspaceFiles,
      generatedSpecs: []
    });

    assert.equal(relevantFiles.at(0)?.relativePath, "src/demo-app/render/render-intent-studio-page.ts");
    assert.equal(relevantFiles.some((file) => file.relativePath === "src/demo-app/server/start-intent-studio-server.ts"), true);
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

test("executeImplementationStage Given a real source file omitted from sampled workspace files When planning replaces it Then validation uses filesystem existence", async () => {
  const { rootDir, input } = await createImplementationInput();
  const previousApiKey = process.env.TEST_GEMINI_API_KEY;
  process.env.TEST_GEMINI_API_KEY = "test-key";

  try {
    await fs.mkdir(path.join(rootDir, "src", "demo-app", "render"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "src", "demo-app", "render", "render-intent-studio-page.ts"),
      "export function renderIntentStudioPage() { return '<div>before</div>'; }\n"
    );

    const result = await executeImplementationStage(input, {
      collectWorkspaceFiles: async () => [
        {
          relativePath: "src/existing.ts",
          bytes: 29,
          lineCount: 1
        }
      ],
      readGeneratedSpecs: async () => [],
      readPackageContext: async () => ({ scripts: {} }),
      collectRelevantFiles: async () => [
        {
          relativePath: "src/demo-app/render/render-intent-studio-page.ts",
          content: "export function renderIntentStudioPage() { return '<div>before</div>'; }\n",
          reason: "The intended Studio surface implementation lives here."
        }
      ],
      planChanges: async () => ({
        operations: [
          {
            operation: "replace",
            filePath: "src/demo-app/render/render-intent-studio-page.ts",
            rationale: "Update the Intent Studio surface."
          }
        ],
        warnings: []
      }),
      materializeChanges: async () => ({
        files: [
          {
            filePath: "src/demo-app/render/render-intent-studio-page.ts",
            content: "export function renderIntentStudioPage() { return '<div>after</div>'; }\n"
          }
        ],
        warnings: []
      })
    });

    assert.equal(result.status, "completed");
    const updatedContent = await fs.readFile(
      path.join(rootDir, "src", "demo-app", "render", "render-intent-studio-page.ts"),
      "utf8"
    );
    assert.equal(updatedContent, "export function renderIntentStudioPage() { return '<div>after</div>'; }\n");
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.TEST_GEMINI_API_KEY;
    } else {
      process.env.TEST_GEMINI_API_KEY = previousApiKey;
    }
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("executeImplementationStage Given a planned ad hoc spec target When validation runs Then it fails before materialization", async () => {
  const { rootDir, input } = await createImplementationInput();
  const previousApiKey = process.env.TEST_GEMINI_API_KEY;
  process.env.TEST_GEMINI_API_KEY = "test-key";
  let materializeCalls = 0;

  try {
    const result = await executeImplementationStage(input, {
      planChanges: async () => ({
        operations: [
          {
            operation: "create",
            filePath: "demo-catalog/work-1-verify-dark-mode-toggle-appearance-in-demo-catalog.spec.ts",
            rationale: "Add a verification spec for the requested UI change."
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
    assert.match(result.error ?? "", /outside approved checked-in test roots/);
    assert.match(result.error ?? "", /Update application\/source files instead/);
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

test("executeImplementationStage Given an existing rogue spec file When validation runs Then it still rejects the replace target", async () => {
  const { rootDir, input } = await createImplementationInput();
  const previousApiKey = process.env.TEST_GEMINI_API_KEY;
  process.env.TEST_GEMINI_API_KEY = "test-key";
  let materializeCalls = 0;

  try {
    await fs.mkdir(path.join(rootDir, "demo-catalog"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "demo-catalog", "work-1-verify-dark-mode-toggle-appearance-in-demo-catalog.spec.ts"),
      "test('rogue spec', () => {});\n"
    );

    const result = await executeImplementationStage(input, {
      planChanges: async () => ({
        operations: [
          {
            operation: "replace",
            filePath: "demo-catalog/work-1-verify-dark-mode-toggle-appearance-in-demo-catalog.spec.ts",
            rationale: "Update the verification spec content."
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
    assert.match(result.error ?? "", /outside approved checked-in test roots/);
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

test("executeImplementationStage Given a planned write to generated Playwright output When validation runs Then it fails before materialization", async () => {
  const { rootDir, input } = await createImplementationInput();
  const previousApiKey = process.env.TEST_GEMINI_API_KEY;
  process.env.TEST_GEMINI_API_KEY = "test-key";
  let materializeCalls = 0;

  try {
    const result = await executeImplementationStage(input, {
      planChanges: async () => ({
        operations: [
          {
            operation: "create",
            filePath: "tests/intent/generated/new-dashboard-affordance.spec.ts",
            rationale: "Add a generated Playwright verification spec."
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
    assert.match(result.error ?? "", /controller-owned generated Playwright output root/);
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

test("executeImplementationStage Given a planned checked-in test target When validation runs Then it allows approved test directories", async () => {
  const { rootDir, input } = await createImplementationInput();
  const previousApiKey = process.env.TEST_GEMINI_API_KEY;
  process.env.TEST_GEMINI_API_KEY = "test-key";

  try {
    const result = await executeImplementationStage(input, {
      planChanges: async () => ({
        operations: [
          {
            operation: "create",
            filePath: "src/demo-app/theme/theme-contrast.test.ts",
            rationale: "Add a checked-in regression test beside the existing theme tests."
          }
        ],
        warnings: []
      }),
      materializeChanges: async () => ({
        files: [
          {
            filePath: "src/demo-app/theme/theme-contrast.test.ts",
            content: "test('theme contrast', () => {});\n"
          }
        ],
        warnings: []
      })
    });

    assert.equal(result.status, "completed");
    const createdContent = await fs.readFile(path.join(rootDir, "src", "demo-app", "theme", "theme-contrast.test.ts"), "utf8");
    assert.equal(createdContent, "test('theme contrast', () => {});\n");
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