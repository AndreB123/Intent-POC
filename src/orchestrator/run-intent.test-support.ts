import path from "node:path";
import { CaptureOutcome } from "../capture/capture-target";
import { ComparisonSummary } from "../compare/run-comparison";
import { LoadedConfig } from "../config/load-config";
import { AppConfig, RunMode, SourceConfig, configSchema } from "../config/schema";
import { SourceRunAttemptRecord, SourceStageExecutionRecord } from "../evidence/write-manifest";
import { ExecuteSourceRunInput, SourceRunResult } from "./run-intent";

interface BehaviorTestConfigOptions {
  sources?: AppConfig["sources"];
  defaultSourceId?: string;
  mode?: RunMode;
  linearEnabled?: boolean;
  storageMode?: AppConfig["artifacts"]["storageMode"];
}

interface BehaviorSourceInput {
  rootDir: string;
  aliases: string[];
  planning: SourceConfig["planning"];
  studio?: Partial<SourceConfig["studio"]>;
  startCommand: string;
  baseUrl: string;
  captureItems: SourceConfig["capture"]["items"];
  defaultFullPage?: boolean;
  waitAfterLoadMs?: number;
  injectCss?: string[];
  catalog?: SourceConfig["capture"]["catalog"];
  source?: SourceConfig["source"];
}

type CapturedOutcome = CaptureOutcome & {
  status: "captured";
  hash: string;
  width: number;
  height: number;
};

export function buildBehaviorSource(input: BehaviorSourceInput): SourceConfig {
  return {
    aliases: input.aliases,
    planning: input.planning,
    studio: {
      ...input.studio
    },
    testing: {
      playwright: {
        enabled: false,
        outputDir: "tests/intent/generated"
      }
    },
    source: input.source ?? {
      type: "local",
      localPath: input.rootDir
    },
    workspace: {
      checkoutMode: "existing",
      cloneRoot: path.join(input.rootDir, ".workdirs"),
      installTimeoutMs: 600_000,
      env: {}
    },
    app: {
      workdir: ".",
      startCommand: input.startCommand,
      baseUrl: input.baseUrl,
      startTimeoutMs: 120_000,
      env: {},
      readiness: {
        type: "http",
        url: input.baseUrl,
        expectedStatus: 200,
        timeoutMs: 1_000,
        intervalMs: 50
      }
    },
    capture: {
      catalog: input.catalog,
      basePathPrefix: "",
      waitAfterLoadMs: input.waitAfterLoadMs ?? 0,
      injectCss: input.injectCss ?? [],
      defaultFullPage: input.defaultFullPage ?? false,
      items: input.captureItems
    }
  };
}

export function buildClientSystemsRoachAdminBehaviorSource(rootDir: string): SourceConfig {
  return buildBehaviorSource({
    rootDir,
    aliases: ["client-systems", "roach"],
    planning: {
      repoId: "client-systems",
      repoLabel: "Client Systems",
      role: "primary product repo",
      notes: ["Primary IDD source lane."]
    },
    startCommand: "echo start",
    baseUrl: "http://127.0.0.1:3000",
    captureItems: [
      { id: "roach-overview", path: "/", maskSelectors: [], delayMs: 0 },
      { id: "roach-statements", path: "/sql-activity", maskSelectors: [], delayMs: 0 }
    ]
  });
}

export function buildDocsPortalBehaviorSource(rootDir: string): SourceConfig {
  return buildBehaviorSource({
    rootDir,
    aliases: ["docs", "documentation"],
    planning: {
      repoId: "docs-portal",
      repoLabel: "Docs Portal",
      role: "documentation",
      notes: ["Secondary IDD source lane."]
    },
    startCommand: "echo start",
    baseUrl: "http://127.0.0.1:3001",
    captureItems: [{ id: "docs-home", path: "/", maskSelectors: [], delayMs: 0 }]
  });
}

export function buildDemoCatalogBehaviorSource(rootDir: string): SourceConfig {
  return buildBehaviorSource({
    rootDir,
    aliases: ["demo", "demo-app", "demo-catalog"],
    planning: {
      repoId: "intent-poc",
      repoLabel: "Intent POC",
      role: "controller-and-demo-source",
      summary: "Current workspace used to bootstrap resumable IDD planning and demo evidence flows.",
      notes: ["Use this repo as the first concrete repo-context example while agent access is pending."]
    },
    studio: {
      displayName: "Current app"
    },
    startCommand: "npm run demo:serve -- --port 6006",
    baseUrl: "http://127.0.0.1:6006",
    defaultFullPage: true,
    waitAfterLoadMs: 300,
    injectCss: ["*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }"],
    captureItems: [
      {
        id: "library-index",
        name: "Demo Catalog Index",
        path: "/library",
        fullPage: true,
        maskSelectors: [],
        delayMs: 0
      },
      {
        id: "component-button-primary",
        name: "Demo Primary Button",
        path: "/library/component-button-primary",
        locator: "[data-testid='component-button-primary']",
        waitForSelector: "[data-testid='component-button-primary']",
        maskSelectors: [],
        delayMs: 0
      },
      {
        id: "page-analytics-overview",
        name: "Demo Analytics Overview",
        path: "/library/page-analytics-overview",
        fullPage: true,
        maskSelectors: [],
        delayMs: 0
      }
    ]
  });
}

export function buildBehaviorTestSources(rootDir: string): AppConfig["sources"] {
  return {
    "client-systems-roach-admin": buildClientSystemsRoachAdminBehaviorSource(rootDir),
    "docs-portal": buildDocsPortalBehaviorSource(rootDir)
  };
}

export function buildBehaviorTestConfig(rootDir: string, options: BehaviorTestConfigOptions = {}): AppConfig {
  const sources = options.sources ?? buildBehaviorTestSources(rootDir);
  const defaultSourceId = options.defaultSourceId ?? Object.keys(sources)[0] ?? "client-systems-roach-admin";

  return configSchema.parse({
    version: 1,
    linear: {
      enabled: options.linearEnabled ?? false,
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
    sources,
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
      storageMode: options.storageMode ?? "controller",
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
      sourceId: defaultSourceId,
      mode: options.mode ?? "compare",
      captureIds: [],
      continueOnCaptureError: false,
      allowBaselinePromotion: false,
      metadata: {},
      dryRun: false
    }
  });
}

export function buildBehaviorTestLoadedConfig(rootDir: string, options: BehaviorTestConfigOptions = {}): LoadedConfig {
  return {
    config: buildBehaviorTestConfig(rootDir, options),
    configDir: rootDir,
    configPath: path.join(rootDir, "intent-poc.yaml")
  };
}

function buildComparisonCounts(overrides: Partial<ComparisonSummary["counts"]> = {}): ComparisonSummary["counts"] {
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

export function buildComparisonSummary(input: {
  mode?: RunMode;
  hasDrift?: boolean;
  counts?: Partial<ComparisonSummary["counts"]>;
  items?: ComparisonSummary["items"];
} = {}): ComparisonSummary {
  return {
    mode: input.mode ?? "compare",
    hasDrift: input.hasDrift ?? false,
    counts: buildComparisonCounts(input.counts),
    items: input.items ?? []
  };
}

export function buildCapturedOutcome(
  rootDir: string,
  captureId: string,
  overrides: Partial<CapturedOutcome> = {}
): CapturedOutcome {
  const outputPath = overrides.outputPath ?? path.join(rootDir, "captures", `${captureId}.png`);

  return {
    captureId,
    path: `/${captureId}`,
    url: `http://127.0.0.1:3000/${captureId}`,
    kind: "page",
    outputPath,
    relativeOutputPath: overrides.relativeOutputPath ?? path.relative(rootDir, outputPath),
    durationMs: 10,
    viewport: { width: 1280, height: 720 },
    status: "captured",
    hash: `${captureId}-hash`,
    width: 1280,
    height: 720,
    warnings: [],
    ...overrides
  };
}

export function buildSourceStageExecutionRecord(
  overrides: Partial<SourceStageExecutionRecord> = {}
): SourceStageExecutionRecord {
  return {
    status: "skipped",
    summary: "Stage skipped.",
    commands: [],
    fileOperations: [],
    ...overrides
  };
}

export function buildSourceRunAttemptRecord(
  overrides: Partial<SourceRunAttemptRecord> = {}
): SourceRunAttemptRecord {
  return {
    attemptNumber: overrides.attemptNumber ?? 1,
    startedAt: overrides.startedAt ?? "2026-01-01T00:00:00.000Z",
    finishedAt: overrides.finishedAt ?? "2026-01-01T00:00:01.000Z",
    status: overrides.status ?? "completed",
    failureStage: overrides.failureStage,
    implementation: buildSourceStageExecutionRecord(overrides.implementation),
    qaVerification: buildSourceStageExecutionRecord(overrides.qaVerification),
    ...overrides
  };
}

export function buildSourceRunResult(
  input: ExecuteSourceRunInput,
  overrides: {
    status?: SourceRunResult["status"];
    captures?: SourceRunResult["captures"];
    comparison?: SourceRunResult["comparison"];
    error?: string;
    attempts?: SourceRunResult["attempts"];
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
    generatedPlaywrightTests: [],
    attempts: overrides.attempts ?? [],
    summaryMarkdown: `# ${input.sourcePlan.sourceId}`
  };
}