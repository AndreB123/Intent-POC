import { AppConfig } from "../config/schema";
import { LoadedConfig } from "../config/load-config";
import { CaptureOutcome } from "../capture/capture-target";
import { ComparisonStatus, ComparisonSummary } from "../compare/run-comparison";
import { NormalizedIntent } from "../intent/intent-types";
import { LinearIssueRef } from "../linear/linear-client";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import { writeJsonFile } from "../shared/fs";
import { RunPaths, SourceRunPaths, toRelativePath } from "./paths";

export interface SourceStageCommandRecord {
  label: string;
  command: string;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "completed" | "failed";
  exitCode?: number;
  timedOut?: boolean;
  error?: string;
  logPath?: string;
}

export interface SourceStageFileOperationRecord {
  operation: "create" | "replace" | "delete";
  filePath: string;
  rationale: string;
  status: "applied";
}

export interface SourceStageExecutionRecord {
  status: "skipped" | "completed" | "failed";
  summary: string;
  error?: string;
  targetedWorkItemIds: string[];
  completedWorkItemIds: string[];
  remainingWorkItemIds: string[];
  commands: SourceStageCommandRecord[];
  fileOperations: SourceStageFileOperationRecord[];
  stepMapping?: Record<string, string>;
  reversionState?: Record<string, unknown>;
}

export interface SourceRunAttemptRecord {
  attemptNumber: number;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "failed";
  failureStage?: "implementation" | "qaVerification";
  targetedWorkItemIds: string[];
  completedWorkItemIds: string[];
  remainingWorkItemIds: string[];
  implementation: SourceStageExecutionRecord;
  qaVerification: SourceStageExecutionRecord;
}

export interface SourceEvidenceRecord {
  sourceId: string;
  status: "planned" | "completed" | "failed";
  paths: SourceRunPaths;
  workspace?: ResolvedSourceWorkspace;
  captures: CaptureOutcome[];
  comparison?: ComparisonSummary;
  error?: string;
  linearIssue?: LinearIssueRef | null;
  publishedSourcePath?: string;
  generatedPlaywrightTests?: string[];
  attempts: SourceRunAttemptRecord[];
}

export interface BusinessLinearPublication {
  parentIssue: LinearIssueRef | null;
  sourceIssues: Record<string, LinearIssueRef>;
  errors: string[];
}

export interface PlanLifecycleRecord {
  version: AppConfig["version"];
  runId: string;
  updatedAt: string;
  intentId: string;
  summary: string;
  planning: NormalizedIntent["planning"];
  normalizationMeta: NormalizedIntent["normalizationMeta"];
  linear: BusinessLinearPublication | null;
  sources: Array<{
    sourceId: string;
    status: SourceEvidenceRecord["status"];
    selectionReason?: string;
    linearIssue?: LinearIssueRef | null;
    attemptCount?: number;
    attempts?: Array<{
      attemptNumber: number;
      status: SourceRunAttemptRecord["status"];
      failureStage?: SourceRunAttemptRecord["failureStage"];
      targetedWorkItemIds: string[];
      completedWorkItemIds: string[];
      remainingWorkItemIds: string[];
      implementation: SourceStageExecutionRecord["status"];
      qaVerification: SourceStageExecutionRecord["status"];
    }>;
  }>;
}

function serializeSourceStageCommand(controllerRoot: string, command: SourceStageCommandRecord): Record<string, unknown> {
  return {
    ...command,
    logPath: toRelativePath(controllerRoot, command.logPath)
  };
}

function serializeSourceStageExecution(controllerRoot: string, stage: SourceStageExecutionRecord): Record<string, unknown> {
  return {
    ...stage,
    commands: stage.commands.map((command) => serializeSourceStageCommand(controllerRoot, command)),
    fileOperations: stage.fileOperations.map((fileOperation) => ({
      ...fileOperation
    }))
  };
}

function serializeSourceRunAttempts(controllerRoot: string, attempts: SourceRunAttemptRecord[]): Array<Record<string, unknown>> {
  return attempts.map((attempt) => ({
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    status: attempt.status,
    failureStage: attempt.failureStage,
    targetedWorkItemIds: attempt.targetedWorkItemIds,
    completedWorkItemIds: attempt.completedWorkItemIds,
    remainingWorkItemIds: attempt.remainingWorkItemIds,
    implementation: serializeSourceStageExecution(controllerRoot, attempt.implementation),
    qaVerification: serializeSourceStageExecution(controllerRoot, attempt.qaVerification)
  }));
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

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function buildComparisonIssues(input: { comparison?: ComparisonSummary; error?: string }): string[] {
  return dedupeStrings([
    ...(input.error && /baseline/i.test(input.error) ? [input.error] : []),
    ...((input.comparison?.items ?? [])
      .filter((item) => item.status === "missing-baseline")
      .map((item) => `Missing baseline for ${item.captureId}: ${item.note ?? "Baseline image not found."}`))
  ]);
}

export async function writeSourceEvidenceFiles(input: {
  loadedConfig: LoadedConfig;
  config: AppConfig;
  paths: SourceRunPaths;
  normalizedIntent: NormalizedIntent;
  workspace?: ResolvedSourceWorkspace;
  linearIssue: LinearIssueRef | null;
  captures: CaptureOutcome[];
  comparison?: ComparisonSummary;
  writeBaselineRecords?: boolean;
  status: "planned" | "completed" | "failed";
  error?: string;
  publishedSourcePath?: string;
  generatedPlaywrightTests?: string[];
  attempts: SourceRunAttemptRecord[];
}): Promise<void> {
  const sourcePlan = input.normalizedIntent.executionPlan.sources.find((source) => source.sourceId === input.paths.sourceId);
  const comparison = input.comparison;
  const configuredCaptureCount = input.config.sources[input.paths.sourceId]?.capture.items.length ?? 0;
  const executedCaptureCount = input.captures.length;
  const comparisonIssues = buildComparisonIssues({ comparison, error: input.error });

  const manifest = {
    version: input.config.version,
    runId: input.paths.runId,
    timestamp: new Date().toISOString(),
    status: input.status,
    error: input.error,
    intent: input.normalizedIntent,
    businessIntent: input.normalizedIntent.businessIntent,
    executionPlan: input.normalizedIntent.executionPlan,
    linear: input.linearIssue,
    source: {
      id: input.paths.sourceId,
      purpose: sourcePlan?.selectionReason,
      captureScope: sourcePlan?.captureScope,
      configuredCaptureCount,
      executedCaptureCount,
      sourceType: input.workspace?.sourceType,
      rootDir: input.workspace?.rootDir,
      appDir: input.workspace?.appDir,
      baseUrl: input.workspace?.baseUrl,
      gitRef: input.workspace?.gitRef,
      gitCommit: input.workspace?.gitCommit,
      publishedSourcePath: input.publishedSourcePath,
      generatedPlaywrightTests: input.generatedPlaywrightTests?.map((filePath) =>
        toRelativePath(input.paths.controllerRoot, filePath)
      )
    },
    attempts: serializeSourceRunAttempts(input.paths.controllerRoot, input.attempts),
    playwright: input.config.playwright,
    captures: input.captures,
    summary: comparison,
    warnings: sourcePlan?.warnings ?? [],
    comparisonIssues
  };

  const hashes = {
    version: input.config.version,
    algorithm: input.config.comparison.hashAlgorithm,
    generatedAt: new Date().toISOString(),
    items: input.captures
      .filter((capture) => capture.status === "captured" && capture.hash)
      .map((capture) => ({
        sourceId: input.paths.sourceId,
        captureId: capture.captureId,
        relativePath: capture.relativeOutputPath,
        sha256: capture.hash
      }))
  };

  const comparisonJson = {
    runId: input.paths.runId,
    sourceId: input.paths.sourceId,
    status: input.status,
    error: input.error,
    businessIntent: {
      statement: input.normalizedIntent.businessIntent.statement,
      desiredOutcome: input.normalizedIntent.businessIntent.desiredOutcome,
      sourceIds: input.normalizedIntent.executionPlan.sources.map((source) => source.sourceId),
      destinationIds: input.normalizedIntent.executionPlan.destinations.map((destination) => destination.id)
    },
    hasDrift: comparison?.hasDrift ?? false,
    counts: comparison?.counts ?? emptyComparisonCounts(),
    captureCoverage: {
      configuredCaptureCount,
      executedCaptureCount,
      scopeMode: sourcePlan?.captureScope.mode ?? "all",
      scopeCaptureIds: sourcePlan?.captureScope.captureIds ?? []
    },
    warnings: sourcePlan?.warnings ?? [],
    comparisonIssues,
    items: (comparison?.items ?? []).map((item) => ({
      ...item,
      baselinePath: toRelativePath(input.paths.controllerRoot, item.baselinePath),
      currentPath: toRelativePath(input.paths.controllerRoot, item.currentPath),
      diffImagePath: toRelativePath(input.paths.controllerRoot, item.diffImagePath)
    }))
  };

  await writeJsonFile(input.paths.manifestPath, manifest);
  await writeJsonFile(input.paths.hashesPath, hashes);
  await writeJsonFile(input.paths.comparisonPath, comparisonJson);
}

export async function writeBusinessEvidenceFiles(input: {
  loadedConfig: LoadedConfig;
  config: AppConfig;
  paths: RunPaths;
  normalizedIntent: NormalizedIntent;
  sourceRuns: SourceEvidenceRecord[];
  linearPublication: BusinessLinearPublication | null;
  status: "completed" | "failed";
  hasDrift: boolean;
  counts: Record<ComparisonStatus, number>;
  errors: string[];
}): Promise<void> {
  const manifest = {
    version: input.config.version,
    runId: input.paths.runId,
    timestamp: new Date().toISOString(),
    status: input.status,
    errors: input.errors,
    intent: input.normalizedIntent,
    businessIntent: input.normalizedIntent.businessIntent,
    executionPlan: input.normalizedIntent.executionPlan,
    linear: input.linearPublication,
    sources: input.sourceRuns.map((sourceRun) => ({
      sourceId: sourceRun.sourceId,
      status: sourceRun.status,
      error: sourceRun.error,
      linearIssue: sourceRun.linearIssue,
      publishedSourcePath: sourceRun.publishedSourcePath,
      generatedPlaywrightTests: sourceRun.generatedPlaywrightTests?.map((filePath) =>
        toRelativePath(input.paths.controllerRoot, filePath)
      ),
      attemptCount: sourceRun.attempts.length,
      attempts: serializeSourceRunAttempts(input.paths.controllerRoot, sourceRun.attempts),
      workspace: sourceRun.workspace
        ? {
            sourceType: sourceRun.workspace.sourceType,
            rootDir: sourceRun.workspace.rootDir,
            appDir: sourceRun.workspace.appDir,
            baseUrl: sourceRun.workspace.baseUrl,
            gitRef: sourceRun.workspace.gitRef,
            gitCommit: sourceRun.workspace.gitCommit
          }
        : undefined,
      comparison: sourceRun.comparison
        ? {
            hasDrift: sourceRun.comparison.hasDrift,
            counts: sourceRun.comparison.counts
          }
        : undefined,
      artifacts: {
        manifestPath: toRelativePath(input.paths.controllerRoot, sourceRun.paths.manifestPath),
        hashesPath: toRelativePath(input.paths.controllerRoot, sourceRun.paths.hashesPath),
        comparisonPath: toRelativePath(input.paths.controllerRoot, sourceRun.paths.comparisonPath),
        summaryPath: toRelativePath(input.paths.controllerRoot, sourceRun.paths.summaryPath),
        appLogPath: toRelativePath(input.paths.controllerRoot, sourceRun.paths.appLogPath),
        attemptsDir: toRelativePath(input.paths.controllerRoot, sourceRun.paths.attemptsDir),
        capturesDir: toRelativePath(input.paths.controllerRoot, sourceRun.paths.capturesDir),
        diffsDir: toRelativePath(input.paths.controllerRoot, sourceRun.paths.diffsDir)
      }
    })),
    summary: {
      hasDrift: input.hasDrift,
      counts: input.counts
    },
    artifacts: {
      planLifecyclePath: toRelativePath(input.paths.controllerRoot, input.paths.planLifecyclePath)
    }
  };

  const hashes = {
    version: input.config.version,
    algorithm: input.config.comparison.hashAlgorithm,
    generatedAt: new Date().toISOString(),
    items: input.sourceRuns.flatMap((sourceRun) =>
      sourceRun.captures
        .filter((capture) => capture.status === "captured" && capture.hash)
        .map((capture) => ({
          sourceId: sourceRun.sourceId,
          captureId: capture.captureId,
          relativePath: capture.relativeOutputPath,
          sha256: capture.hash
        }))
    )
  };

  const comparisonJson = {
    runId: input.paths.runId,
    status: input.status,
    errors: input.errors,
    hasDrift: input.hasDrift,
    counts: input.counts,
    sources: input.sourceRuns.map((sourceRun) => ({
      sourceId: sourceRun.sourceId,
      status: sourceRun.status,
      error: sourceRun.error,
      hasDrift: sourceRun.comparison?.hasDrift ?? false,
      counts: sourceRun.comparison?.counts ?? emptyComparisonCounts(),
      items: (sourceRun.comparison?.items ?? []).map((item) => ({
        ...item,
        baselinePath: toRelativePath(input.paths.controllerRoot, item.baselinePath),
        currentPath: toRelativePath(input.paths.controllerRoot, item.currentPath),
        diffImagePath: toRelativePath(input.paths.controllerRoot, item.diffImagePath)
      }))
    }))
  };

  await writeJsonFile(input.paths.manifestPath, manifest);
  await writeJsonFile(input.paths.hashesPath, hashes);
  await writeJsonFile(input.paths.comparisonPath, comparisonJson);
}

export async function writePlanLifecycleFile(input: {
  config: AppConfig;
  paths: RunPaths;
  normalizedIntent: NormalizedIntent;
  linearPublication: BusinessLinearPublication | null;
  sourceRuns: SourceEvidenceRecord[];
}): Promise<void> {
  const record: PlanLifecycleRecord = {
    version: input.config.version,
    runId: input.paths.runId,
    updatedAt: new Date().toISOString(),
    intentId: input.normalizedIntent.intentId,
    summary: input.normalizedIntent.summary,
    planning: input.normalizedIntent.planning,
    normalizationMeta: input.normalizedIntent.normalizationMeta,
    linear: input.linearPublication,
    sources: input.sourceRuns.map((sourceRun) => {
      const sourcePlan = input.normalizedIntent.executionPlan.sources.find((source) => source.sourceId === sourceRun.sourceId);

      return {
        sourceId: sourceRun.sourceId,
        status: sourceRun.status,
        selectionReason: sourcePlan?.selectionReason,
        linearIssue: sourceRun.linearIssue ?? input.linearPublication?.sourceIssues[sourceRun.sourceId] ?? null,
        attemptCount: sourceRun.attempts.length,
        attempts: sourceRun.attempts.map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          failureStage: attempt.failureStage,
          targetedWorkItemIds: attempt.targetedWorkItemIds,
          completedWorkItemIds: attempt.completedWorkItemIds,
          remainingWorkItemIds: attempt.remainingWorkItemIds,
          implementation: attempt.implementation.status,
          qaVerification: attempt.qaVerification.status
        }))
      };
    })
  };

  await writeJsonFile(input.paths.planLifecyclePath, record);
}

export async function writeEvidenceFiles(input: {
  loadedConfig: LoadedConfig;
  config: AppConfig;
  paths: SourceRunPaths;
  normalizedIntent: NormalizedIntent;
  workspace?: ResolvedSourceWorkspace;
  linearIssue: LinearIssueRef | null;
  captures: CaptureOutcome[];
  comparison?: ComparisonSummary;
  status: "planned" | "completed" | "failed";
  error?: string;
  publishedSourcePath?: string;
  attempts: SourceRunAttemptRecord[];
}): Promise<void> {
  await writeSourceEvidenceFiles(input);
}