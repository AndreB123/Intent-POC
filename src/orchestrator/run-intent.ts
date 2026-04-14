import { LoadedConfig, loadConfig } from "../config/load-config";
import { AppConfig, CaptureItemConfig, RunMode, SourceConfig } from "../config/schema";
import { CaptureOutcome } from "../capture/capture-target";
import { runCapture } from "../capture/run-capture";
import { ComparisonStatus, ComparisonSummary, runComparison } from "../compare/run-comparison";
import { RunPaths, SourceRunPaths, createRunPaths, retainRecentRuns, toRelativePath } from "../evidence/paths";
import { publishArtifactsToSourceIfConfigured } from "../evidence/publish-artifacts";
import { updateScreenshotLibrary } from "../evidence/screenshot-library";
import {
  BusinessLinearPublication,
  writePlanLifecycleFile,
  SourceEvidenceRecord,
  writeBusinessEvidenceFiles,
  writeSourceEvidenceFiles
} from "../evidence/write-manifest";
import { writeBusinessSummaryMarkdown, writeSourceSummaryMarkdown } from "../evidence/write-summary";
import { NormalizedIntent } from "../intent/intent-types";
import { normalizeIntentWithAgent } from "../intent/normalize-intent";
import { LinearClient, LinearIssueRef } from "../linear/linear-client";
import {
  BUSINESS_PLAN_SECTION_ID,
  getPlannerSectionStartMarker,
  sourceLaneSectionId,
  upsertPlannerSection
} from "../linear/planner-sections";
import { startApp } from "../runtime/start-app";
import { waitForReady } from "../runtime/wait-for-ready";
import { writeJsonFile } from "../shared/fs";
import { log } from "../shared/log";
import { prepareSourceWorkspace } from "../target/prepare-workspace";
import { ResolvedSourceWorkspace, resolveSourceWorkspace } from "../target/resolve-target";
import { upsertTrackedScreenshots } from "../demo-app/capture/upsert-tracked-screenshots";

export interface RunIntentEvent {
  timestamp: string;
  level: "info" | "warn" | "error";
  phase: "config" | "intent" | "linear" | "workspace" | "app" | "capture" | "comparison" | "artifacts" | "run";
  message: string;
  details?: unknown;
}

export interface SourceRunResult extends SourceEvidenceRecord {
  summaryMarkdown?: string;
}

export interface RunIntentResult {
  status: "completed" | "failed";
  sourceId: string;
  mode: RunMode;
  dryRun: boolean;
  normalizedIntent: NormalizedIntent;
  paths: RunPaths;
  linearIssue: LinearIssueRef | null;
  linearPublication: BusinessLinearPublication | null;
  sourceRuns: SourceRunResult[];
  captures: CaptureOutcome[];
  hasDrift: boolean;
  counts: Record<ComparisonStatus, number>;
  summaryMarkdown?: string;
  errors: string[];
}

export interface RunIntentOptions {
  configPath: string;
  intent?: string;
  mode?: RunMode;
  sourceId?: string;
  trackedBaseline?: boolean;
  resumeIssue?: string;
  dryRun?: boolean;
  onEvent?: (event: RunIntentEvent) => void;
}

export interface LinearClientLike {
  createIssue(issue: {
    title: string;
    description: string;
    parentId?: string;
  }): Promise<LinearIssueRef>;
  fetchIssue(issueReference: string): Promise<LinearIssueRef | null>;
  listChildIssues(parentId: string): Promise<LinearIssueRef[]>;
  updateIssueDescription(issueId: string, description: string): Promise<void>;
  updateIssueTitle(issueId: string, title: string): Promise<void>;
  createComment(issueId: string, body: string): Promise<void>;
  updateIssueState(issueId: string, stateId?: string): Promise<void>;
}

type ExecutionSourcePlan = NormalizedIntent["executionPlan"]["sources"][number];

export interface ExecuteSourceRunInput {
  config: AppConfig;
  normalizedIntent: NormalizedIntent;
  sourcePlan: ExecutionSourcePlan;
  runPaths: RunPaths;
  sourcePaths: SourceRunPaths;
  trackedBaseline: boolean;
  options: RunIntentOptions;
  linearClient: LinearClientLike | null;
  parentIssue: LinearIssueRef | null;
  sourceIssue: LinearIssueRef | null;
  linearErrors: string[];
}

export interface RunIntentDependencies {
  loadConfig: (configPathInput: string) => Promise<LoadedConfig>;
  normalizeIntent: typeof normalizeIntentWithAgent;
  createRunPaths: typeof createRunPaths;
  createLinearClient: (config: AppConfig["linear"]) => LinearClientLike;
  executeSourceRun: (input: ExecuteSourceRunInput) => Promise<SourceRunResult>;
  writeJsonFile: typeof writeJsonFile;
  writePlanLifecycleFile: typeof writePlanLifecycleFile;
  writeBusinessEvidenceFiles: typeof writeBusinessEvidenceFiles;
  writeBusinessSummaryMarkdown: typeof writeBusinessSummaryMarkdown;
  retainRecentRuns: typeof retainRecentRuns;
}

function buildTrackedBaselineSummary(mode: RunMode, captures: CaptureOutcome[]): ComparisonSummary {
  const counts = emptyComparisonCounts();
  const items = captures.map((capture) => {
    if (capture.status !== "captured") {
      counts["capture-failed"] += 1;
      return {
        captureId: capture.captureId,
        status: "capture-failed" as const,
        currentPath: capture.outputPath,
        note: capture.error
      };
    }

    counts["baseline-written"] += 1;
    return {
      captureId: capture.captureId,
      status: "baseline-written" as const,
      baselinePath: capture.outputPath,
      currentPath: capture.outputPath,
      baselineHash: capture.hash,
      currentHash: capture.hash,
      note: "Capture staged for tracked screenshot upsert."
    };
  });

  return {
    mode,
    hasDrift: false,
    counts,
    items
  };
}

function emitRunEvent(
  options: RunIntentOptions,
  phase: RunIntentEvent["phase"],
  message: string,
  details?: unknown,
  level: RunIntentEvent["level"] = "info"
): void {
  options.onEvent?.({
    timestamp: new Date().toISOString(),
    level,
    phase,
    message,
    details
  });
}

function emptyComparisonCounts(): Record<ComparisonStatus, number> {
  return {
    "baseline-written": 0,
    unchanged: 0,
    changed: 0,
    "missing-baseline": 0,
    "capture-failed": 0,
    "diff-error": 0
  };
}

function aggregateCounts(sourceRuns: Array<Pick<SourceRunResult, "comparison">>): Record<ComparisonStatus, number> {
  const counts = emptyComparisonCounts();

  for (const sourceRun of sourceRuns) {
    if (!sourceRun.comparison) {
      continue;
    }

    for (const [status, count] of Object.entries(sourceRun.comparison.counts) as Array<[ComparisonStatus, number]>) {
      counts[status] += count;
    }
  }

  return counts;
}

function captureErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildParentIssueDescription(input: {
  rawPrompt: string;
  normalizedIntent: NormalizedIntent;
}): string {
  const acceptanceCriteria = input.normalizedIntent.businessIntent.acceptanceCriteria
    .map((criterion) => `- ${criterion.description}`)
    .join("\n");
  const scenarios = input.normalizedIntent.businessIntent.scenarios
    .map(
      (scenario) =>
        [
          `### ${scenario.title}`,
          `- Sources: ${scenario.applicableSourceIds.join(", ")}`,
          ...scenario.given.map((entry) => `- Given ${entry}`),
          ...scenario.when.map((entry) => `- When ${entry}`),
          ...scenario.then.map((entry) => `- Then ${entry}`)
        ].join("\n")
    )
    .join("\n\n");
  const workItems = input.normalizedIntent.businessIntent.workItems
    .map(
      (workItem) =>
        [
          `- ${workItem.title}`,
          `  - Sources: ${workItem.sourceIds.join(", ")}`,
          `  - Outcome: ${workItem.userVisibleOutcome}`,
          `  - Verification: ${workItem.verification}`
        ].join("\n")
    )
    .join("\n");
  const repoContext = input.normalizedIntent.planning.repoCandidates
    .map((repo) => {
      const details = [
        `- ${repo.label} [${repo.selectionStatus}]`,
        `  - Repo ID: ${repo.repoId}`,
        `  - Sources: ${repo.sourceIds.join(", ")}`,
        `  - Capture count: ${repo.captureCount}`,
        `  - Reason: ${repo.reason}`
      ];

      if (repo.role) {
        details.push(`  - Role: ${repo.role}`);
      }

      if (repo.summary) {
        details.push(`  - Summary: ${repo.summary}`);
      }

      if (repo.locations.length > 0) {
        details.push(`  - Locations: ${repo.locations.join(", ")}`);
      }

      if (repo.refs.length > 0) {
        details.push(`  - Refs: ${repo.refs.join(", ")}`);
      }

      details.push(...repo.notes.map((note) => `  - Note: ${note}`));
      return details.join("\n");
    })
    .join("\n");
  const sources = input.normalizedIntent.executionPlan.sources
    .map(
      (source) =>
        `- ${source.sourceId} (${source.runMode}, ${source.captureScope.mode === "subset" ? source.captureScope.captureIds.join(", ") : "all captures"})`
    )
    .join("\n");
  const destinations = input.normalizedIntent.executionPlan.destinations
    .map((destination) => `- ${destination.label} [${destination.status}] - ${destination.reason}`)
    .join("\n");
  const tools = input.normalizedIntent.executionPlan.tools
    .map((tool) => `- ${tool.label} [${tool.enabled ? "enabled" : "planned"}] - ${tool.reason}`)
    .join("\n");
  const planningLifecycle = [
    `- Linear plan mode: ${input.normalizedIntent.planning.linearPlan.mode}`,
    input.normalizedIntent.planning.linearPlan.issueReference
      ? `- Resume issue: ${input.normalizedIntent.planning.linearPlan.issueReference}`
      : undefined,
    ...input.normalizedIntent.planning.reviewNotes.map((note) => `- ${note}`),
    ...input.normalizedIntent.planning.plannerSections.map(
      (section) => `- Managed section: ${section.title} - ${section.summary}`
    )
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return [
    `## Business Intent`,
    "",
    input.normalizedIntent.businessIntent.statement,
    "",
    `## Desired Outcome`,
    "",
    input.normalizedIntent.businessIntent.desiredOutcome,
    "",
    `## Acceptance Criteria`,
    "",
    acceptanceCriteria,
    "",
    `## BDD Scenarios`,
    "",
    scenarios,
    "",
    `## TDD Work Items`,
    "",
    workItems,
    "",
    `## Repo Context`,
    "",
    repoContext,
    "",
    `## Execution Sources`,
    "",
    sources,
    "",
    `## Destinations`,
    "",
    destinations,
    "",
    `## Tools`,
    "",
    tools,
    "",
    `## Plan Lifecycle`,
    "",
    planningLifecycle,
    "",
    `## Raw Intent`,
    "",
    input.rawPrompt,
    "",
    `## Normalized Plan`,
    "",
    JSON.stringify(input.normalizedIntent, null, 2),
    ""
  ].join("\n");
}

function buildSourceIssueTitle(normalizedIntent: NormalizedIntent, sourceId: string): string {
  return `IDD Source Lane: ${sourceId} · ${normalizedIntent.summary}`.slice(0, 120);
}

function buildSourceIssueDescription(input: {
  normalizedIntent: NormalizedIntent;
  sourceId: string;
}): string {
  const sourcePlan = input.normalizedIntent.executionPlan.sources.find((source) => source.sourceId === input.sourceId);
  const repoContext = input.normalizedIntent.planning.repoCandidates.find((repo) => repo.sourceIds.includes(input.sourceId));
  const scenarios = input.normalizedIntent.businessIntent.scenarios
    .filter((scenario) => scenario.applicableSourceIds.includes(input.sourceId))
    .map(
      (scenario) =>
        [
          `### ${scenario.title}`,
          ...scenario.given.map((entry) => `- Given ${entry}`),
          ...scenario.when.map((entry) => `- When ${entry}`),
          ...scenario.then.map((entry) => `- Then ${entry}`)
        ].join("\n")
    )
    .join("\n\n");
  const workItems = input.normalizedIntent.businessIntent.workItems
    .filter((workItem) => workItem.sourceIds.includes(input.sourceId))
    .map(
      (workItem) =>
        [
          `- ${workItem.title}`,
          `  - Outcome: ${workItem.userVisibleOutcome}`,
          `  - Verification: ${workItem.verification}`
        ].join("\n")
    )
    .join("\n");

  return [
    `## Source Lane`,
    "",
    `- Source: ${input.sourceId}`,
    `- Mode: ${sourcePlan?.runMode ?? input.normalizedIntent.execution.runMode}`,
    `- Capture scope: ${sourcePlan?.captureScope.mode === "subset" ? sourcePlan.captureScope.captureIds.join(", ") : "all configured captures"}`,
    `- Selection reason: ${sourcePlan?.selectionReason ?? "not recorded"}`,
    repoContext ? `- Repo context: ${repoContext.label} (${repoContext.repoId})` : `- Repo context: not linked`,
    "",
    `## Relevant BDD Scenarios`,
    "",
    scenarios || "- None",
    "",
    `## Relevant TDD Work Items`,
    "",
    workItems || "- None",
    "",
    `## Planner Warnings`,
    "",
    sourcePlan?.warnings.length ? sourcePlan.warnings.map((warning) => `- ${warning}`).join("\n") : "- None",
    "",
    `## Repo Notes`,
    "",
    repoContext?.notes.length ? repoContext.notes.map((note) => `- ${note}`).join("\n") : "- None",
    ""
  ].join("\n");
}

function buildManagedParentIssueDescription(existingDescription: string | undefined, input: {
  rawPrompt: string;
  normalizedIntent: NormalizedIntent;
}): string {
  return upsertPlannerSection(existingDescription, {
    id: BUSINESS_PLAN_SECTION_ID,
    title: "IDD Plan",
    body: buildParentIssueDescription(input)
  });
}

function buildManagedSourceIssueDescription(existingDescription: string | undefined, input: {
  normalizedIntent: NormalizedIntent;
  sourceId: string;
}): string {
  return upsertPlannerSection(existingDescription, {
    id: sourceLaneSectionId(input.sourceId),
    title: `IDD Source Lane: ${input.sourceId}`,
    body: buildSourceIssueDescription(input)
  });
}

function findReusableSourceIssue(existingIssues: LinearIssueRef[], sourceId: string): LinearIssueRef | undefined {
  const titlePrefix = `IDD Source Lane: ${sourceId} ·`;
  const sectionMarker = getPlannerSectionStartMarker(sourceLaneSectionId(sourceId));

  return existingIssues.find(
    (issue) => issue.title?.startsWith(titlePrefix) || issue.description?.includes(sectionMarker)
  );
}

function selectCaptureItems(allItems: CaptureItemConfig[], captureIds: string[]): CaptureItemConfig[] {
  if (captureIds.length === 0) {
    return allItems;
  }

  const selected = allItems.filter((item) => captureIds.includes(item.id));
  if (selected.length === 0) {
    throw new Error(`No configured captures matched the requested capture IDs: ${captureIds.join(", ")}`);
  }

  return selected;
}

async function safeLinearTask<T>(input: {
  enabled: boolean;
  options: RunIntentOptions;
  errors: string[];
  message: string;
  details?: unknown;
  task: () => Promise<T>;
}): Promise<T | undefined> {
  if (!input.enabled) {
    return undefined;
  }

  try {
    return await input.task();
  } catch (error) {
    const errorMessage = `${input.message}: ${captureErrorMessage(error)}`;
    input.errors.push(errorMessage);
    emitRunEvent(input.options, "linear", errorMessage, input.details, "error");
    return undefined;
  }
}

async function executeSourceRun(input: ExecuteSourceRunInput): Promise<SourceRunResult> {
  let workspace: ResolvedSourceWorkspace | undefined;
  let captures: CaptureOutcome[] = [];
  let comparison: ComparisonSummary | undefined;
  let summaryMarkdown: string | undefined;
  let publishedSourcePath: string | undefined;
  let appHandle: Awaited<ReturnType<typeof startApp>> | null = null;
  let trackedScreenshotRoot: string | undefined;

  try {
    emitRunEvent(input.options, "workspace", "Resolving source workspace.", {
      sourceId: input.sourcePlan.sourceId,
      sourceType: input.config.sources[input.sourcePlan.sourceId]?.source.type
    });

    workspace = await resolveSourceWorkspace(input.config, input.sourcePlan.sourceId);

    emitRunEvent(input.options, "workspace", "Source workspace resolved.", {
      sourceId: workspace.sourceId,
      rootDir: workspace.rootDir,
      appDir: workspace.appDir,
      baseUrl: workspace.baseUrl,
      sourceType: workspace.sourceType,
      gitRef: workspace.gitRef,
      gitCommit: workspace.gitCommit
    });

    await prepareSourceWorkspace(workspace);

    emitRunEvent(input.options, "workspace", "Source workspace prepared.", {
      sourceId: workspace.sourceId,
      installCommand: workspace.source.workspace.installCommand,
      checkoutMode: workspace.source.workspace.checkoutMode
    });

    await safeLinearTask({
      enabled: Boolean(input.linearClient && input.parentIssue && input.config.linear.commentOnProgress),
      options: input.options,
      errors: input.linearErrors,
      message: `Failed to post Linear start comment for ${input.sourcePlan.sourceId}`,
      details: { sourceId: input.sourcePlan.sourceId },
      task: async () => {
        await input.linearClient!.createComment(
          input.parentIssue!.id,
          `Source lane started for '${input.sourcePlan.sourceId}' in mode '${input.sourcePlan.runMode}'.`
        );
      }
    });

    emitRunEvent(input.options, "app", "Starting source app.", {
      sourceId: workspace.sourceId,
      baseUrl: workspace.baseUrl,
      startCommand: workspace.source.app.startCommand,
      workdir: workspace.source.app.workdir
    });

    appHandle = await startApp(workspace, input.sourcePaths.appLogPath);
    log.info("Source app started.", {
      sourceId: workspace.sourceId,
      pid: appHandle.pid,
      logPath: input.sourcePaths.appLogPath
    });

    emitRunEvent(input.options, "app", "Source app started.", {
      sourceId: workspace.sourceId,
      pid: appHandle.pid,
      appLogPath: toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.appLogPath)
    });

    emitRunEvent(input.options, "app", "Waiting for readiness check.", {
      sourceId: workspace.sourceId,
      readiness: workspace.source.app.readiness
    });

    await waitForReady(input.config, workspace);
    log.info("Source app is ready.", { sourceId: workspace.sourceId, baseUrl: workspace.baseUrl });

    emitRunEvent(input.options, "app", "Source app is ready.", {
      sourceId: workspace.sourceId,
      baseUrl: workspace.baseUrl
    });

    const selectedCaptureItems = selectCaptureItems(
      workspace.source.capture.items,
      input.sourcePlan.captureScope.mode === "subset"
        ? input.sourcePlan.captureScope.captureIds
        : input.config.run.captureIds
    );

    if (input.trackedBaseline) {
      trackedScreenshotRoot = workspace.source.capture.trackedRoot;

      if (input.sourcePlan.runMode !== "baseline") {
        throw new Error("Tracked baseline runs currently require baseline mode.");
      }

      if (!trackedScreenshotRoot) {
        throw new Error(
          `Source '${input.sourcePlan.sourceId}' does not define capture.trackedRoot for tracked baseline output.`
        );
      }

      emitRunEvent(input.options, "artifacts", "Tracked baseline output enabled.", {
        sourceId: input.sourcePlan.sourceId,
        trackedRoot: toRelativePath(input.runPaths.controllerRoot, trackedScreenshotRoot)
      });
    }

    const captureResult = await runCapture(
      input.config,
      workspace,
      selectedCaptureItems,
      input.sourcePaths.capturesDir,
      input.runPaths.controllerRoot,
      input.normalizedIntent.execution.continueOnCaptureError,
      {
        onCaptureStarted: (item) => {
          emitRunEvent(input.options, "capture", `Capturing '${item.id}'.`, {
            sourceId: input.sourcePlan.sourceId,
            captureId: item.id,
            path: item.path,
            locator: item.locator
          });
        },
        onCaptureCompleted: (outcome) => {
          emitRunEvent(input.options, "capture", `Captured '${outcome.captureId}'.`, {
            sourceId: input.sourcePlan.sourceId,
            captureId: outcome.captureId,
            outputPath: outcome.relativeOutputPath,
            durationMs: outcome.durationMs,
            width: outcome.width,
            height: outcome.height
          });
        },
        onCaptureFailed: (outcome) => {
          emitRunEvent(
            input.options,
            "capture",
            `Capture failed for '${outcome.captureId}'.`,
            {
              sourceId: input.sourcePlan.sourceId,
              captureId: outcome.captureId,
              error: outcome.error,
              outputPath: outcome.relativeOutputPath
            },
            "warn"
          );
        }
      }
    );

    captures = captureResult.outcomes;

    if (input.trackedBaseline) {
      comparison = buildTrackedBaselineSummary(input.sourcePlan.runMode, captures);

      emitRunEvent(input.options, "comparison", "Tracked baseline capture complete.", {
        sourceId: input.sourcePlan.sourceId,
        trackedRoot: toRelativePath(input.runPaths.controllerRoot, trackedScreenshotRoot),
        counts: comparison.counts
      });
    } else {
      emitRunEvent(input.options, "comparison", "Running comparison.", {
        sourceId: input.sourcePlan.sourceId,
        mode: input.sourcePlan.runMode,
        captureCount: captures.length
      });

      comparison = await runComparison(
        input.config,
        input.sourcePlan.runMode,
        captures,
        input.sourcePaths.baselineSourceDir,
        input.sourcePaths.diffsDir
      );

      emitRunEvent(input.options, "comparison", "Comparison complete.", {
        sourceId: input.sourcePlan.sourceId,
        hasDrift: comparison.hasDrift,
        counts: comparison.counts
      });
    }

    const sourceErrors: string[] = [];
    if (captureResult.abortedDueToError) {
      sourceErrors.push("Capture run stopped early because continueOnCaptureError is disabled.");
    }

    const failedCaptureCount = captures.filter((capture) => capture.status === "failed").length;
    if (input.trackedBaseline && failedCaptureCount > 0) {
      sourceErrors.push(
        `${failedCaptureCount} tracked screenshot capture${failedCaptureCount === 1 ? "" : "s"} failed; existing tracked screenshots were left untouched.`
      );
    }

    if (!input.trackedBaseline && comparison.counts["missing-baseline"] > 0 && input.config.comparison.onMissingBaseline === "error") {
      sourceErrors.push("One or more captures are missing a baseline image.");
    }

    if (!input.trackedBaseline && comparison.hasDrift && input.config.comparison.failOnChange) {
      sourceErrors.push("Visual drift detected and comparison.failOnChange is enabled.");
    }

    if (input.trackedBaseline) {
      if (sourceErrors.length === 0) {
        try {
          const updatedFiles = await upsertTrackedScreenshots({
            captures,
            captureItems: selectedCaptureItems,
            trackedRoot: trackedScreenshotRoot!
          });

          publishedSourcePath = toRelativePath(input.runPaths.controllerRoot, trackedScreenshotRoot);

          emitRunEvent(input.options, "artifacts", "Tracked screenshots upserted from staged captures.", {
            sourceId: input.sourcePlan.sourceId,
            trackedRoot: toRelativePath(input.runPaths.controllerRoot, trackedScreenshotRoot),
            stagedCapturesDir: toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.capturesDir),
            updatedCount: updatedFiles.length
          });
        } catch (error) {
          sourceErrors.push(`Failed to upsert tracked screenshots: ${captureErrorMessage(error)}`);
        }
      } else {
        emitRunEvent(
          input.options,
          "artifacts",
          "Tracked screenshots were not upserted because validation or capture failed.",
          {
            sourceId: input.sourcePlan.sourceId,
            trackedRoot: toRelativePath(input.runPaths.controllerRoot, trackedScreenshotRoot),
            errors: sourceErrors
          },
          "warn"
        );
      }
    } else {
      try {
        const libraryResult = await updateScreenshotLibrary({
          config: input.config,
          sourceId: input.sourcePlan.sourceId,
          runId: input.runPaths.runId,
          mode: input.sourcePlan.runMode,
          captures,
          comparison,
          normalizedIntent: input.normalizedIntent
        });

        emitRunEvent(input.options, "artifacts", "Screenshot library updated.", {
          sourceId: input.sourcePlan.sourceId,
          screenshotLibrary: toRelativePath(input.runPaths.controllerRoot, libraryResult.sourceLibraryRoot)
        });
      } catch (error) {
        sourceErrors.push(`Failed to update the screenshot library: ${captureErrorMessage(error)}`);
      }

      try {
        const publishResult = await publishArtifactsToSourceIfConfigured({
          config: input.config,
          workspace,
          paths: input.runPaths,
          sourcePaths: input.sourcePaths
        });

        if (publishResult) {
          publishedSourcePath = toRelativePath(input.runPaths.controllerRoot, publishResult.sourceOutputDir);
          emitRunEvent(input.options, "artifacts", "Artifacts published to source workspace.", {
            sourceId: input.sourcePlan.sourceId,
            sourceOutputDir: publishedSourcePath
          });
        }
      } catch (error) {
        sourceErrors.push(`Failed to publish artifacts to the source workspace: ${captureErrorMessage(error)}`);
      }
    }

    const status = sourceErrors.length > 0 ? "failed" : "completed";
    const error = sourceErrors.length > 0 ? sourceErrors.join(" ") : undefined;
    const completionCounts = comparison?.counts ?? emptyComparisonCounts();

    await writeSourceEvidenceFiles({
      loadedConfig: { config: input.config, configPath: "", configDir: input.runPaths.controllerRoot },
      config: input.config,
      paths: input.sourcePaths,
      normalizedIntent: input.normalizedIntent,
      workspace,
      linearIssue: input.sourceIssue,
      captures,
      comparison,
      writeBaselineRecords: !input.trackedBaseline,
      status,
      error,
      publishedSourcePath
    });

    emitRunEvent(input.options, "artifacts", "Source evidence files written.", {
      sourceId: input.sourcePlan.sourceId,
      manifestPath: toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.manifestPath),
      hashesPath: toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.hashesPath),
      comparisonPath: toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.comparisonPath)
    });

    summaryMarkdown = await writeSourceSummaryMarkdown({
      config: input.config,
      paths: input.sourcePaths,
      normalizedIntent: input.normalizedIntent,
      workspace,
      linearIssue: input.sourceIssue,
      captures,
      comparison,
      status,
      error
    });

    emitRunEvent(input.options, "artifacts", "Source summary written.", {
      sourceId: input.sourcePlan.sourceId,
      summaryPath: toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.summaryPath)
    });

    await safeLinearTask({
      enabled: Boolean(input.linearClient && input.sourceIssue),
      options: input.options,
      errors: input.linearErrors,
      message: `Failed to update Linear source lane for ${input.sourcePlan.sourceId}`,
      details: { sourceId: input.sourcePlan.sourceId },
      task: async () => {
        if (input.config.linear.commentOnCompletion) {
          await input.linearClient!.createComment(
            input.sourceIssue!.id,
            [
              `Source lane ${status} for '${input.sourcePlan.sourceId}'.`,
              `Changed: ${completionCounts.changed}`,
              `Unchanged: ${completionCounts.unchanged}`,
              `Missing baseline: ${completionCounts["missing-baseline"]}`,
              `Summary: ${toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.summaryPath)}`,
              error ? `Errors: ${error}` : "Errors: none"
            ].join("\n")
          );
        }

        await input.linearClient!.updateIssueState(
          input.sourceIssue!.id,
          status === "completed" ? input.config.linear.defaultStateIds.completed : input.config.linear.defaultStateIds.failed
        );
      }
    });

    await safeLinearTask({
      enabled: Boolean(input.linearClient && input.parentIssue && input.config.linear.commentOnProgress),
      options: input.options,
      errors: input.linearErrors,
      message: `Failed to post Linear parent status comment for ${input.sourcePlan.sourceId}`,
      details: { sourceId: input.sourcePlan.sourceId },
      task: async () => {
        await input.linearClient!.createComment(
          input.parentIssue!.id,
          [
            `Source lane ${status}: ${input.sourcePlan.sourceId}`,
            `Changed: ${completionCounts.changed}`,
            `Unchanged: ${completionCounts.unchanged}`,
            `Summary: ${toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.summaryPath)}`,
            error ? `Errors: ${error}` : "Errors: none"
          ].join("\n")
        );
      }
    });

    emitRunEvent(
      input.options,
      "run",
      status === "completed" ? "Source lane complete." : "Source lane completed with failures.",
      {
        sourceId: input.sourcePlan.sourceId,
        status,
        summaryPath: toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.summaryPath),
        hasDrift: comparison.hasDrift,
        counts: comparison.counts,
        error
      },
      status === "completed" ? "info" : "error"
    );

    return {
      sourceId: input.sourcePlan.sourceId,
      status,
      paths: input.sourcePaths,
      workspace,
      captures,
      comparison,
      error,
      linearIssue: input.sourceIssue,
      publishedSourcePath,
      summaryMarkdown
    };
  } catch (error) {
    const errorMessage = captureErrorMessage(error);

    await writeSourceEvidenceFiles({
      loadedConfig: { config: input.config, configPath: "", configDir: input.runPaths.controllerRoot },
      config: input.config,
      paths: input.sourcePaths,
      normalizedIntent: input.normalizedIntent,
      workspace,
      linearIssue: input.sourceIssue,
      captures,
      comparison,
      status: "failed",
      error: errorMessage,
      publishedSourcePath
    });

    summaryMarkdown = await writeSourceSummaryMarkdown({
      config: input.config,
      paths: input.sourcePaths,
      normalizedIntent: input.normalizedIntent,
      workspace,
      linearIssue: input.sourceIssue,
      captures,
      comparison,
      status: "failed",
      error: errorMessage
    });

    await safeLinearTask({
      enabled: Boolean(input.linearClient && input.sourceIssue),
      options: input.options,
      errors: input.linearErrors,
      message: `Failed to update Linear failure state for ${input.sourcePlan.sourceId}`,
      details: { sourceId: input.sourcePlan.sourceId },
      task: async () => {
        if (input.config.linear.commentOnCompletion) {
          await input.linearClient!.createComment(input.sourceIssue!.id, `Source lane failed: ${errorMessage}`);
        }
        await input.linearClient!.updateIssueState(input.sourceIssue!.id, input.config.linear.defaultStateIds.failed);
      }
    });

    await safeLinearTask({
      enabled: Boolean(input.linearClient && input.parentIssue && input.config.linear.commentOnProgress),
      options: input.options,
      errors: input.linearErrors,
      message: `Failed to post Linear parent failure comment for ${input.sourcePlan.sourceId}`,
      details: { sourceId: input.sourcePlan.sourceId },
      task: async () => {
        await input.linearClient!.createComment(input.parentIssue!.id, `Source lane failed for '${input.sourcePlan.sourceId}': ${errorMessage}`);
      }
    });

    emitRunEvent(input.options, "run", "Source lane failed.", {
      sourceId: input.sourcePlan.sourceId,
      error: errorMessage,
      summaryPath: toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.summaryPath)
    }, "error");

    return {
      sourceId: input.sourcePlan.sourceId,
      status: "failed",
      paths: input.sourcePaths,
      workspace,
      captures,
      comparison,
      error: errorMessage,
      linearIssue: input.sourceIssue,
      publishedSourcePath,
      summaryMarkdown
    };
  } finally {
    if (appHandle) {
      await appHandle.stop();
    }
  }
}

function createDefaultRunIntentDependencies(): RunIntentDependencies {
  return {
    loadConfig,
    normalizeIntent: normalizeIntentWithAgent,
    createRunPaths,
    createLinearClient: (config) => new LinearClient(config),
    executeSourceRun,
    writeJsonFile,
    writePlanLifecycleFile,
    writeBusinessEvidenceFiles,
    writeBusinessSummaryMarkdown,
    retainRecentRuns
  };
}

export function createRunIntentRunner(overrides: Partial<RunIntentDependencies> = {}) {
  const dependencies: RunIntentDependencies = {
    ...createDefaultRunIntentDependencies(),
    ...overrides
  };

  return async function runIntent(options: RunIntentOptions): Promise<RunIntentResult> {
    const loadedConfig = await dependencies.loadConfig(options.configPath);
    const config = loadedConfig.config;
    const sourceIdOverride = options.sourceId;
    const sourceId = options.sourceId ?? config.run.sourceId;
    const mode = options.mode ?? config.run.mode;
    const rawPrompt = options.intent ?? config.run.intent;
    const trackedBaseline = options.trackedBaseline ?? config.run.trackedBaseline;
    const resumeIssue = options.resumeIssue ?? config.run.resumeIssue;
    const dryRun = options.dryRun ?? config.run.dryRun;

    emitRunEvent(options, "config", "Configuration loaded.", {
      configPath: loadedConfig.configPath,
      defaultSourceId: config.run.sourceId,
      linearEnabled: config.linear.enabled,
      sourceCount: Object.keys(config.sources).length,
      trackedBaseline,
      resumeIssue
    });

    if (trackedBaseline && mode !== "baseline") {
      throw new Error("Tracked baseline runs currently require baseline mode.");
    }

    if (!rawPrompt || rawPrompt.trim().length === 0) {
      throw new Error("A free-text intent is required. Pass --intent or set run.intent in the config.");
    }

    const availableSources = Object.fromEntries(
      Object.entries(config.sources).map(([id, source]) => [
        id,
        {
          aliases: source.aliases,
          capture: source.capture,
          planning: source.planning,
          source: source.source
        } satisfies Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">
      ])
    );

    const normalizedIntent = await dependencies.normalizeIntent({
      rawPrompt,
      runMode: mode,
      defaultSourceId: config.run.sourceId,
      continueOnCaptureError: config.run.continueOnCaptureError,
      agent: config.agent,
      sourceIdOverride,
      modeOverride: options.mode,
      resumeIssue,
      linearEnabled: config.linear.enabled,
      publishToSourceWorkspace: config.artifacts.storageMode === "both" && Boolean(config.artifacts.copyToSourcePath),
      availableSources
    });

    const sourceIds = normalizedIntent.executionPlan.sources.map((sourcePlan) => sourcePlan.sourceId);
    const paths = await dependencies.createRunPaths(loadedConfig, sourceIds, normalizedIntent.execution.runMode);
    await dependencies.writeJsonFile(paths.normalizedIntentPath, normalizedIntent);

    emitRunEvent(options, "intent", "Intent normalized.", {
      rawPrompt,
      summary: normalizedIntent.summary,
      sourceId: normalizedIntent.executionPlan.primarySourceId,
      sourceIds,
      runMode: normalizedIntent.execution.runMode,
      normalizedIntent,
      businessIntent: normalizedIntent.businessIntent,
      executionPlan: normalizedIntent.executionPlan
    });

    emitRunEvent(options, "artifacts", "Business run workspace prepared.", {
      runId: paths.runId,
      normalizedIntentPath: toRelativePath(paths.controllerRoot, paths.normalizedIntentPath),
      sourceDirs: sourceIds.map((currentSourceId) => ({
        sourceId: currentSourceId,
        sourceDir: toRelativePath(paths.controllerRoot, paths.sourceRuns[currentSourceId]?.sourceDir)
      }))
    });

    const linearClient = config.linear.enabled ? dependencies.createLinearClient(config.linear) : null;
    const linearErrors: string[] = [];
    const linearPublication: BusinessLinearPublication = {
      parentIssue: null,
      sourceIssues: {},
      errors: linearErrors
    };

    emitRunEvent(options, "linear", config.linear.enabled ? "Linear integration enabled." : "Linear integration disabled.", {
      enabled: config.linear.enabled,
      createIssueOnStart: config.linear.createIssueOnStart,
      commentOnProgress: config.linear.commentOnProgress,
      commentOnCompletion: config.linear.commentOnCompletion,
      trackedBaseline,
      resumeIssue
    });

    const shouldManageLinearPlan = Boolean(!trackedBaseline && linearClient && (config.linear.createIssueOnStart || resumeIssue));

    if (linearClient && shouldManageLinearPlan) {
      if (resumeIssue) {
        emitRunEvent(options, "linear", "Resolving existing Linear parent issue.", {
          issueReference: resumeIssue
        });

        linearPublication.parentIssue = await safeLinearTask({
          enabled: true,
          options,
          errors: linearErrors,
          message: `Failed to resolve the Linear resume issue '${resumeIssue}'`,
          task: async () => {
            const existingIssue = await linearClient.fetchIssue(resumeIssue);
            if (!existingIssue) {
              throw new Error(`Linear issue '${resumeIssue}' was not found.`);
            }

            const description = buildManagedParentIssueDescription(existingIssue.description, {
              rawPrompt,
              normalizedIntent
            });

            await linearClient.updateIssueDescription(existingIssue.id, description);

            return {
              ...existingIssue,
              description
            };
          }
        }) ?? null;

        if (!linearPublication.parentIssue) {
          throw new Error(`Configured resume issue '${resumeIssue}' could not be resolved in Linear.`);
        }

        emitRunEvent(options, "linear", "Linear parent issue resumed.", {
          issueReference: resumeIssue,
          identifier: linearPublication.parentIssue.identifier,
          url: linearPublication.parentIssue.url
        });
      } else {
        emitRunEvent(options, "linear", "Creating Linear parent issue.", {
          teamId: config.linear.teamId,
          projectId: config.linear.projectId,
          title: normalizedIntent.linear.issueTitle
        });

        linearPublication.parentIssue = await safeLinearTask({
          enabled: true,
          options,
          errors: linearErrors,
          message: "Failed to create the Linear parent issue",
          task: async () =>
            await linearClient.createIssue({
              title: normalizedIntent.linear.issueTitle,
              description: buildManagedParentIssueDescription(undefined, {
                rawPrompt,
                normalizedIntent
              })
            })
        }) ?? null;

        if (linearPublication.parentIssue) {
          emitRunEvent(options, "linear", "Linear parent issue created.", {
            identifier: linearPublication.parentIssue.identifier,
            url: linearPublication.parentIssue.url
          });
        }
      }

      if (linearPublication.parentIssue) {
        const existingSourceIssues = resumeIssue
          ? await safeLinearTask({
              enabled: true,
              options,
              errors: linearErrors,
              message: `Failed to list existing Linear child issues for '${resumeIssue}'`,
              task: async () => await linearClient.listChildIssues(linearPublication.parentIssue!.id)
            }) ?? []
          : [];

        for (const sourcePlan of normalizedIntent.executionPlan.sources) {
          const issueTitle = buildSourceIssueTitle(normalizedIntent, sourcePlan.sourceId);
          const existingSourceIssue = findReusableSourceIssue(existingSourceIssues, sourcePlan.sourceId);
          const issueDescription = buildManagedSourceIssueDescription(existingSourceIssue?.description, {
            normalizedIntent,
            sourceId: sourcePlan.sourceId
          });

          const sourceIssue = existingSourceIssue
            ? await safeLinearTask({
                enabled: true,
                options,
                errors: linearErrors,
                message: `Failed to update the Linear source issue for ${sourcePlan.sourceId}`,
                details: { sourceId: sourcePlan.sourceId },
                task: async () => {
                  await linearClient.updateIssueTitle(existingSourceIssue.id, issueTitle);
                  await linearClient.updateIssueDescription(existingSourceIssue.id, issueDescription);

                  return {
                    ...existingSourceIssue,
                    title: issueTitle,
                    description: issueDescription
                  };
                }
              })
            : await safeLinearTask({
                enabled: true,
                options,
                errors: linearErrors,
                message: `Failed to create the Linear source issue for ${sourcePlan.sourceId}`,
                details: { sourceId: sourcePlan.sourceId },
                task: async () =>
                  await linearClient.createIssue({
                    title: issueTitle,
                    description: issueDescription,
                    parentId: linearPublication.parentIssue!.id
                  })
              });

          if (sourceIssue) {
            linearPublication.sourceIssues[sourcePlan.sourceId] = sourceIssue;
            emitRunEvent(options, "linear", existingSourceIssue ? "Linear source issue updated." : "Linear source issue created.", {
              sourceId: sourcePlan.sourceId,
              identifier: sourceIssue.identifier,
              url: sourceIssue.url,
              parentId: linearPublication.parentIssue.id
            });
          }
        }
      }

      await dependencies.writeJsonFile(paths.linearPath, linearPublication);
    }

    if (dryRun) {
      const sourceRuns: SourceRunResult[] = sourceIds.map((currentSourceId) => ({
        sourceId: currentSourceId,
        status: "planned",
        paths: paths.sourceRuns[currentSourceId],
        captures: [],
        linearIssue: linearPublication.sourceIssues[currentSourceId] ?? null
      }));

      await dependencies.writePlanLifecycleFile({
        config,
        paths,
        normalizedIntent,
        linearPublication,
        sourceRuns
      });

      emitRunEvent(options, "run", "Dry run complete.", {
        sourceId: normalizedIntent.executionPlan.primarySourceId,
        sourceIds,
        mode: normalizedIntent.execution.runMode,
        normalizedIntentPath: toRelativePath(paths.controllerRoot, paths.normalizedIntentPath),
        planLifecyclePath: toRelativePath(paths.controllerRoot, paths.planLifecyclePath)
      });

      log.info("Dry run complete.", {
        sourceId: normalizedIntent.executionPlan.primarySourceId,
        sourceIds,
        mode: normalizedIntent.execution.runMode,
        normalizedIntentPath: toRelativePath(paths.controllerRoot, paths.normalizedIntentPath),
        planLifecyclePath: toRelativePath(paths.controllerRoot, paths.planLifecyclePath)
      });

      await dependencies.retainRecentRuns(config.artifacts.runRoot, config.artifacts.retainRuns);
      return {
        status: "completed",
        sourceId: normalizedIntent.executionPlan.primarySourceId,
        mode: normalizedIntent.execution.runMode,
        dryRun: true,
        normalizedIntent,
        paths,
        linearIssue: linearPublication.parentIssue,
        linearPublication,
        sourceRuns,
        captures: [],
        hasDrift: false,
        counts: emptyComparisonCounts(),
        errors: linearErrors
      };
    }

    const sourceRuns: SourceRunResult[] = [];
    for (const sourcePlan of normalizedIntent.executionPlan.sources) {
      const sourceRun = await dependencies.executeSourceRun({
        config,
        normalizedIntent,
        sourcePlan,
        runPaths: paths,
        sourcePaths: paths.sourceRuns[sourcePlan.sourceId],
        trackedBaseline,
        options,
        linearClient,
        parentIssue: linearPublication.parentIssue,
        sourceIssue: linearPublication.sourceIssues[sourcePlan.sourceId] ?? null,
        linearErrors
      });
      sourceRuns.push(sourceRun);
    }

    const counts = aggregateCounts(sourceRuns);
    const hasDrift = sourceRuns.some((sourceRun) => sourceRun.comparison?.hasDrift ?? false);
    const errors = [
      ...sourceRuns.filter((sourceRun) => sourceRun.error).map((sourceRun) => sourceRun.error as string),
      ...linearErrors
    ];
    const status: RunIntentResult["status"] = errors.length > 0 || sourceRuns.some((sourceRun) => sourceRun.status === "failed")
      ? "failed"
      : "completed";

    await dependencies.writeBusinessEvidenceFiles({
      loadedConfig,
      config,
      paths,
      normalizedIntent,
      sourceRuns,
      linearPublication,
      status,
      hasDrift,
      counts,
      errors
    });

    await dependencies.writePlanLifecycleFile({
      config,
      paths,
      normalizedIntent,
      linearPublication,
      sourceRuns
    });

    emitRunEvent(options, "artifacts", "Business evidence files written.", {
      manifestPath: toRelativePath(paths.controllerRoot, paths.manifestPath),
      hashesPath: toRelativePath(paths.controllerRoot, paths.hashesPath),
      comparisonPath: toRelativePath(paths.controllerRoot, paths.comparisonPath),
      planLifecyclePath: toRelativePath(paths.controllerRoot, paths.planLifecyclePath)
    });

    const summaryMarkdown = await dependencies.writeBusinessSummaryMarkdown({
      config,
      paths,
      normalizedIntent,
      sourceRuns,
      linearPublication,
      status,
      hasDrift,
      counts,
      errors
    });

    emitRunEvent(options, "artifacts", "Business summary written.", {
      summaryPath: toRelativePath(paths.controllerRoot, paths.summaryPath)
    });

    if (linearClient && linearPublication.parentIssue) {
      await safeLinearTask({
        enabled: true,
        options,
        errors: linearErrors,
        message: "Failed to finalize the Linear parent issue",
        task: async () => {
          if (config.linear.commentOnCompletion) {
            await linearClient.createComment(
              linearPublication.parentIssue!.id,
              [
                `Business run ${status}.`,
                `Completed sources: ${sourceRuns.filter((sourceRun) => sourceRun.status === "completed").map((sourceRun) => sourceRun.sourceId).join(", ") || "none"}`,
                `Failed sources: ${sourceRuns.filter((sourceRun) => sourceRun.status === "failed").map((sourceRun) => sourceRun.sourceId).join(", ") || "none"}`,
                `Changed: ${counts.changed}`,
                `Unchanged: ${counts.unchanged}`,
                `Missing baseline: ${counts["missing-baseline"]}`,
                `Summary: ${toRelativePath(paths.controllerRoot, paths.summaryPath)}`,
                errors.length > 0 ? `Errors: ${errors.join(" | ")}` : "Errors: none"
              ].join("\n")
            );
          }

          await linearClient.updateIssueState(
            linearPublication.parentIssue!.id,
            status === "completed" ? config.linear.defaultStateIds.completed : config.linear.defaultStateIds.failed
          );
        }
      });

      await dependencies.writeJsonFile(paths.linearPath, linearPublication);
    }

    log.info(status === "completed" ? "Run complete." : "Run complete with failures.", {
      runId: paths.runId,
      summaryPath: toRelativePath(paths.controllerRoot, paths.summaryPath),
      manifestPath: toRelativePath(paths.controllerRoot, paths.manifestPath),
      sourceRuns: sourceRuns.map((sourceRun) => ({
        sourceId: sourceRun.sourceId,
        status: sourceRun.status,
        summaryPath: toRelativePath(paths.controllerRoot, sourceRun.paths.summaryPath),
        publishedSourcePath: sourceRun.publishedSourcePath
      })),
      hasDrift,
      counts,
      errors: errors.length > 0 ? errors : undefined
    });

    emitRunEvent(options, "run", status === "completed" ? "Business run complete." : "Business run complete with failures.", {
      runId: paths.runId,
      sourceId: normalizedIntent.executionPlan.primarySourceId,
      sourceIds,
      mode: normalizedIntent.execution.runMode,
      summaryPath: toRelativePath(paths.controllerRoot, paths.summaryPath),
      manifestPath: toRelativePath(paths.controllerRoot, paths.manifestPath),
      hasDrift,
      counts,
      errors,
      linearIssueUrl: linearPublication.parentIssue?.url
    }, status === "completed" ? "info" : "error");

    await dependencies.retainRecentRuns(config.artifacts.runRoot, config.artifacts.retainRuns);

    return {
      status,
      sourceId: normalizedIntent.executionPlan.primarySourceId,
      mode: normalizedIntent.execution.runMode,
      dryRun: false,
      normalizedIntent,
      paths,
      linearIssue: linearPublication.parentIssue,
      linearPublication,
      sourceRuns,
      captures: sourceRuns.flatMap((sourceRun) => sourceRun.captures),
      hasDrift,
      counts,
      summaryMarkdown,
      errors
    };
  };
}

export const runIntent = createRunIntentRunner();