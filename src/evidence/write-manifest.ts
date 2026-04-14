import { AppConfig } from "../config/schema";
import { LoadedConfig } from "../config/load-config";
import { CaptureOutcome } from "../capture/capture-target";
import { ComparisonStatus, ComparisonSummary } from "../compare/run-comparison";
import { NormalizedIntent } from "../intent/intent-types";
import { LinearIssueRef } from "../linear/linear-client";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import { writeJsonFile } from "../shared/fs";
import { RunPaths, SourceRunPaths, toRelativePath } from "./paths";

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
  mode: AppConfig["run"]["mode"];
  planning: NormalizedIntent["planning"];
  linear: BusinessLinearPublication | null;
  sources: Array<{
    sourceId: string;
    status: SourceEvidenceRecord["status"];
    selectionReason?: string;
    runMode?: AppConfig["run"]["mode"];
    linearIssue?: LinearIssueRef | null;
  }>;
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
}): Promise<void> {
  const sourcePlan = input.normalizedIntent.executionPlan.sources.find((source) => source.sourceId === input.paths.sourceId);
  const comparison = input.comparison;

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
      runMode: sourcePlan?.runMode,
      captureScope: sourcePlan?.captureScope,
      sourceType: input.workspace?.sourceType,
      rootDir: input.workspace?.rootDir,
      appDir: input.workspace?.appDir,
      baseUrl: input.workspace?.baseUrl,
      gitRef: input.workspace?.gitRef,
      gitCommit: input.workspace?.gitCommit,
      publishedSourcePath: input.publishedSourcePath
    },
    playwright: input.config.playwright,
    captures: input.captures,
    summary: comparison,
    warnings: sourcePlan?.warnings ?? []
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
    mode: comparison?.mode ?? input.normalizedIntent.execution.runMode,
    hasDrift: comparison?.hasDrift ?? false,
    counts: comparison?.counts ?? emptyComparisonCounts(),
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

  if (input.writeBaselineRecords !== false && comparison && (comparison.mode === "baseline" || comparison.mode === "approve-baseline")) {
    await writeJsonFile(input.paths.baselineManifestPath, manifest);
    await writeJsonFile(input.paths.baselineHashesPath, hashes);
  }
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
    mode: input.normalizedIntent.execution.runMode,
    status: input.status,
    errors: input.errors,
    hasDrift: input.hasDrift,
    counts: input.counts,
    sources: input.sourceRuns.map((sourceRun) => ({
      sourceId: sourceRun.sourceId,
      status: sourceRun.status,
      error: sourceRun.error,
      mode: sourceRun.comparison?.mode ?? input.normalizedIntent.execution.runMode,
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
    mode: input.normalizedIntent.execution.runMode,
    planning: input.normalizedIntent.planning,
    linear: input.linearPublication,
    sources: input.sourceRuns.map((sourceRun) => {
      const sourcePlan = input.normalizedIntent.executionPlan.sources.find((source) => source.sourceId === sourceRun.sourceId);

      return {
        sourceId: sourceRun.sourceId,
        status: sourceRun.status,
        selectionReason: sourcePlan?.selectionReason,
        runMode: sourcePlan?.runMode,
        linearIssue: sourceRun.linearIssue ?? input.linearPublication?.sourceIssues[sourceRun.sourceId] ?? null
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
}): Promise<void> {
  await writeSourceEvidenceFiles(input);
}