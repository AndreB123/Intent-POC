import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ComparisonSummary } from "../compare/run-comparison";
import { LoadedConfig } from "../config/load-config";
import { AppConfig, RunMode, configSchema } from "../config/schema";
import { readJsonFile } from "../shared/fs";
import {
  ExecuteSourceRunInput,
  RunIntentEvent,
  SourceRunResult,
  createRunIntentRunner
} from "./run-intent";

function buildConfig(rootDir: string): AppConfig {
  return configSchema.parse({
    version: 1,
    linear: {
      enabled: false,
      apiKeyEnv: "LINEAR_API_KEY",
      teamId: "ENG",
      createIssueOnStart: false,
      commentOnProgress: false,
      commentOnCompletion: false,
      defaultStateIds: {}
    },
    agent: {
      mode: "bounded-runner"
    },
    sources: {
      "client-systems-roach-admin": {
        aliases: ["client-systems", "roach"],
        planning: {
          repoId: "client-systems",
          repoLabel: "Client Systems",
          role: "primary product repo",
          notes: ["Primary IDD source lane."]
        },
        source: {
          type: "local",
          localPath: rootDir
        },
        workspace: {
          checkoutMode: "existing"
        },
        app: {
          workdir: ".",
          startCommand: "echo start",
          baseUrl: "http://127.0.0.1:3000",
          readiness: {
            type: "http",
            url: "http://127.0.0.1:3000",
            expectedStatus: 200,
            timeoutMs: 1_000,
            intervalMs: 50
          }
        },
        capture: {
          waitAfterLoadMs: 0,
          injectCss: [],
          defaultFullPage: false,
          items: [
            { id: "roach-overview", path: "/", maskSelectors: [], delayMs: 0 },
            { id: "roach-statements", path: "/sql-activity", maskSelectors: [], delayMs: 0 }
          ]
        }
      },
      "docs-portal": {
        aliases: ["docs", "documentation"],
        planning: {
          repoId: "docs-portal",
          repoLabel: "Docs Portal",
          role: "documentation",
          notes: ["Secondary IDD source lane."]
        },
        source: {
          type: "local",
          localPath: rootDir
        },
        workspace: {
          checkoutMode: "existing"
        },
        app: {
          workdir: ".",
          startCommand: "echo start",
          baseUrl: "http://127.0.0.1:3001",
          readiness: {
            type: "http",
            url: "http://127.0.0.1:3001",
            expectedStatus: 200,
            timeoutMs: 1_000,
            intervalMs: 50
          }
        },
        capture: {
          waitAfterLoadMs: 0,
          injectCss: [],
          defaultFullPage: false,
          items: [{ id: "docs-home", path: "/", maskSelectors: [], delayMs: 0 }]
        }
      }
    },
    playwright: {
      browser: "chromium",
      headless: true,
      viewport: {
        width: 1280,
        height: 720
      },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      disableAnimations: true,
      extraHTTPHeaders: {}
    },
    artifacts: {
      storageMode: "controller",
      runRoot: path.join(rootDir, "artifacts", "runs"),
      libraryRoot: path.join(rootDir, "artifacts", "library"),
      baselineRoot: path.join(rootDir, "evidence", "baselines"),
      writeMarkdownSummary: true,
      writeJsonSummary: true,
      retainRuns: 20,
      cleanBeforeRun: false
    },
    comparison: {
      enabled: true,
      hashAlgorithm: "sha256",
      diffMethod: "pixelmatch",
      pixelThreshold: 0.01,
      failOnChange: false,
      onMissingBaseline: "error",
      writeDiffImages: true
    },
    run: {
      sourceId: "client-systems-roach-admin",
      mode: "compare",
      captureIds: [],
      continueOnCaptureError: false,
      allowBaselinePromotion: false,
      metadata: {},
      dryRun: false,
      trackedBaseline: false
    }
  });
}

function buildLoadedConfig(rootDir: string): LoadedConfig {
  return {
    config: buildConfig(rootDir),
    configDir: rootDir,
    configPath: path.join(rootDir, "intent-poc.yaml")
  };
}

function buildCounts(overrides: Partial<ComparisonSummary["counts"]> = {}): ComparisonSummary["counts"] {
  return {
    "baseline-written": 0,
    unchanged: 0,
    changed: 0,
    "missing-baseline": 0,
    "capture-failed": 0,
    "diff-error": 0,
    ...overrides
  };
}

function buildComparisonSummary(input: {
  mode?: RunMode;
  hasDrift?: boolean;
  counts?: Partial<ComparisonSummary["counts"]>;
  items?: ComparisonSummary["items"];
} = {}): ComparisonSummary {
  return {
    mode: input.mode ?? "compare",
    hasDrift: input.hasDrift ?? false,
    counts: buildCounts(input.counts),
    items: input.items ?? []
  };
}

function buildCapturedOutcome(rootDir: string, captureId: string) {
  const outputPath = path.join(rootDir, "captures", `${captureId}.png`);

  return {
    captureId,
    path: `/${captureId}`,
    url: `http://127.0.0.1:3000/${captureId}`,
    kind: "page" as const,
    outputPath,
    relativeOutputPath: path.relative(rootDir, outputPath),
    durationMs: 10,
    viewport: { width: 1280, height: 720 },
    status: "captured" as const,
    hash: `${captureId}-hash`,
    width: 1280,
    height: 720,
    warnings: []
  };
}

function buildSourceRunResult(
  input: ExecuteSourceRunInput,
  overrides: {
    status?: SourceRunResult["status"];
    captures?: SourceRunResult["captures"];
    comparison?: SourceRunResult["comparison"];
    error?: string;
  } = {}
): SourceRunResult {
  return {
    sourceId: input.sourcePlan.sourceId,
    status: overrides.status ?? "completed",
    paths: input.sourcePaths,
    captures: overrides.captures ?? [],
    comparison: overrides.comparison,
    error: overrides.error,
    linearIssue: input.sourceIssue,
    summaryMarkdown: `# ${input.sourcePlan.sourceId}`
  };
}

test("runIntent Given a dry run When the plan is valid Then it writes plan lifecycle metadata and skips source execution", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-run-intent-dry-"));
  const loadedConfig = buildLoadedConfig(tmpRoot);
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
  const loadedConfig = buildLoadedConfig(tmpRoot);
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
  const loadedConfig = buildLoadedConfig(tmpRoot);
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

test("runIntent Given tracked baseline output When the mode is not baseline Then it rejects the run before execution", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-run-intent-tracked-"));
  const loadedConfig = buildLoadedConfig(tmpRoot);

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
          trackedBaseline: true,
          mode: "compare"
        }),
      /Tracked baseline runs currently require baseline mode\./
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});