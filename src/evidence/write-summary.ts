import { AppConfig } from "../config/schema";
import { CaptureOutcome } from "../capture/capture-target";
import { ComparisonStatus, ComparisonSummary } from "../compare/run-comparison";
import { buildIntentDecompositionMarkdown } from "../intent/decomposition-markdown";
import { NormalizedIntent } from "../intent/intent-types";
import { LinearIssueRef } from "../linear/linear-client";
import { writeTextFile } from "../shared/fs";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import { RunPaths, SourceRunPaths, toRelativePath } from "./paths";
import {
  BusinessLinearPublication,
  SourceEvidenceRecord,
  SourceRunAttemptRecord,
  SourceStageExecutionRecord
} from "./write-manifest";
import { formatCompactUiStateList } from "../intent/ui-state-requirements";

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

function buildAgentStageMarkdown(stages: NormalizedIntent["normalizationMeta"]["stages"]): string {
  if (stages.length === 0) {
    return "- None";
  }

  return stages
    .map((stage) => {
      const executionSource = stage.provider ? `${stage.provider} / ${stage.model ?? "default-model"}` : "deterministic";
      const warnings = stage.warnings.length > 0 ? ` — ${stage.warnings.join(" ")}` : "";
      return `- ${stage.label}: ${stage.status} [${executionSource}]${warnings}`;
    })
    .join("\n");
}

function buildStageExecutionMarkdown(
  label: string,
  stage: SourceStageExecutionRecord,
  controllerRoot: string
): string[] {
  const lines = [`- ${label}: ${stage.status} - ${stage.summary}`];

  if (stage.targetedWorkItemIds.length > 0) {
    lines.push(`  - Targeted work items: ${stage.targetedWorkItemIds.join(", ")}`);
  }

  if (stage.completedWorkItemIds.length > 0) {
    lines.push(`  - Completed work items: ${stage.completedWorkItemIds.join(", ")}`);
  }

  if (stage.remainingWorkItemIds.length > 0) {
    lines.push(`  - Remaining work items: ${stage.remainingWorkItemIds.join(", ")}`);
  }

  if (stage.error) {
    lines.push(`  - Error: ${stage.error}`);
  }

  if (stage.commands.length === 0) {
    lines.push(`  - Commands: none`);
  } else {
    for (const command of stage.commands) {
      const details = [command.label, `[${command.status}]`];

      if (command.logPath) {
        details.push(toRelativePath(controllerRoot, command.logPath) ?? command.logPath);
      }

      if (command.error) {
        details.push(command.error);
      }

      lines.push(`  - ${details.join(" - ")}`);
    }
  }

  if (stage.fileOperations.length === 0) {
    lines.push(`  - File operations: none`);
    return lines;
  }

  for (const fileOperation of stage.fileOperations) {
    lines.push(`  - File: ${fileOperation.operation} ${fileOperation.filePath} - ${fileOperation.rationale}`);
  }

  return lines;
}

function buildRuntimeAttemptsMarkdown(controllerRoot: string, attempts: SourceRunAttemptRecord[]): string {
  if (attempts.length === 0) {
    return "- None";
  }

  return attempts
    .map((attempt) => {
      const lines = [
        `### Attempt ${attempt.attemptNumber}`,
        `- Status: ${attempt.status}`,
        `- Failure stage: ${attempt.failureStage ?? "none"}`,
        `- Targeted work items: ${attempt.targetedWorkItemIds.length > 0 ? attempt.targetedWorkItemIds.join(", ") : "none"}`,
        `- Completed in attempt: ${attempt.completedInAttemptWorkItemIds.length > 0 ? attempt.completedInAttemptWorkItemIds.join(", ") : "none"}`,
        `- Pending targeted work items: ${attempt.pendingTargetedWorkItemIds.length > 0 ? attempt.pendingTargetedWorkItemIds.join(", ") : "none"}`,
        `- Completed work items: ${attempt.completedWorkItemIds.length > 0 ? attempt.completedWorkItemIds.join(", ") : "none"}`,
        `- Remaining work items: ${attempt.remainingWorkItemIds.length > 0 ? attempt.remainingWorkItemIds.join(", ") : "none"}`,
        ...buildStageExecutionMarkdown("Implementation", attempt.implementation, controllerRoot),
        ...buildStageExecutionMarkdown("QA verification", attempt.qaVerification, controllerRoot)
      ];

      return lines.join("\n");
    })
    .join("\n\n");
}

function describeWorkItemType(workItem: NormalizedIntent["businessIntent"]["workItems"][number]): string {
  switch (workItem.verificationMode) {
    case "mocked-state-playwright":
      return "QA-runnable Playwright spec with mocked Studio app state";
    case "targeted-code-validation":
      return "Targeted code validation work item";
    default:
      return "QA-runnable Playwright screenshot spec";
  }
}

export function buildSourceSummaryMarkdown(input: {
  config: AppConfig;
  paths: SourceRunPaths;
  normalizedIntent: NormalizedIntent;
  workspace?: ResolvedSourceWorkspace;
  linearIssue: LinearIssueRef | null;
  captures: CaptureOutcome[];
  comparison?: ComparisonSummary;
  status: "planned" | "completed" | "failed";
  error?: string;
  generatedPlaywrightTests?: string[];
  attempts: SourceRunAttemptRecord[];
}): string {
  const comparison = input.comparison;
  const changedItems = comparison ? comparison.items.filter((item) => item.status === "changed") : [];
  const failedCaptures = input.captures.filter((capture) => capture.status === "failed");
  const currentSourcePlan = input.normalizedIntent.executionPlan.sources.find(
    (source) => source.sourceId === input.paths.sourceId
  );
  const counts = comparison?.counts ?? emptyComparisonCounts();
  const configuredCaptureCount = input.config.sources[input.paths.sourceId]?.capture.items.length ?? 0;
  const executedCaptureCount = input.captures.length;
  const comparisonIssues = buildComparisonIssues({ comparison, error: input.error });

  return [
    `# Intent POC Source Run Summary`,
    "",
    `- Run ID: ${input.paths.runId}`,
    `- Source: ${input.paths.sourceId}`,
    `- Status: ${input.status}`,
    `- Intent: ${input.normalizedIntent.rawPrompt}`,
    `- Normalized summary: ${input.normalizedIntent.summary}`,
    `- Verification workflow: active`,
    `- Linear issue: ${input.linearIssue?.url ?? input.linearIssue?.identifier ?? "not created"}`,
    `- Has drift: ${comparison?.hasDrift ? "yes" : "no"}`,
    `- Desired outcome: ${input.normalizedIntent.businessIntent.desiredOutcome}`,
    input.error ? `- Error: ${input.error}` : `- Error: none`,
    "",
    `## AI Stages`,
    "",
    buildAgentStageMarkdown(input.normalizedIntent.normalizationMeta.stages),
    "",
    `## Source Plan`,
    "",
    `- Selection reason: ${currentSourcePlan?.selectionReason ?? "not recorded"}`,
    `- Configured captures: ${configuredCaptureCount}`,
    `- Executed captures: ${executedCaptureCount}`,
    `- Capture scope: ${currentSourcePlan?.captureScope.mode === "subset" ? currentSourcePlan.captureScope.captureIds.join(", ") : "all configured captures"}`,
    `- UI state requirements: ${currentSourcePlan?.uiStateRequirements?.length ? formatCompactUiStateList(currentSourcePlan.uiStateRequirements) : "none"}`,
    `- Warnings: ${currentSourcePlan?.warnings.length ? currentSourcePlan.warnings.join(" ") : "none"}`,
    "",
    `## Business Intent`,
    "",
    input.normalizedIntent.businessIntent.statement,
    "",
    `## Acceptance Criteria`,
    "",
    input.normalizedIntent.businessIntent.acceptanceCriteria.map((criterion) => `- ${criterion.description}`).join("\n"),
    "",
    `## BDD Scenarios`,
    "",
    input.normalizedIntent.businessIntent.scenarios
      .filter((scenario) => scenario.applicableSourceIds.includes(input.paths.sourceId))
      .map(
        (scenario) =>
          [
            `### ${scenario.title}`,
            ...scenario.given.map((entry) => `- Given ${entry}`),
            ...scenario.when.map((entry) => `- When ${entry}`),
            ...scenario.then.map((entry) => `- Then ${entry}`)
          ].join("\n")
      )
      .join("\n\n") || "- None",
    "",
    `## IDD Decomposition`,
    "",
    buildIntentDecompositionMarkdown({
      normalizedIntent: input.normalizedIntent,
      sourceId: input.paths.sourceId
    }),
    "",
    `## TDD Work Items`,
    "",
    input.normalizedIntent.businessIntent.workItems
      .filter((workItem) => workItem.sourceIds.includes(input.paths.sourceId))
      .map(
        (workItem) =>
          [
            `- ${workItem.title}`,
            `  - Type: ${describeWorkItemType(workItem)}`,
            `  - Outcome: ${workItem.userVisibleOutcome}`,
            `  - Verification: ${workItem.verification}`,
            `  - Order: ${workItem.execution.order}`,
            `  - Depends on: ${workItem.execution.dependsOnWorkItemIds.length > 0 ? workItem.execution.dependsOnWorkItemIds.join(", ") : "none"}`,
            `  - Playwright specs: ${workItem.playwright.specs.length}`,
            `  - Checkpoints: ${workItem.playwright.specs.reduce((count, spec) => count + spec.checkpoints.length, 0)}`
          ].join("\n")
      )
      .join("\n") || "- None",
    "",
    `## Generated Playwright Specs`,
    "",
    input.generatedPlaywrightTests && input.generatedPlaywrightTests.length > 0
      ? input.generatedPlaywrightTests.map((filePath) => `- ${toRelativePath(input.paths.controllerRoot, filePath)}`).join("\n")
      : "- None",
    "",
    `## Runtime Attempts`,
    "",
    buildRuntimeAttemptsMarkdown(input.paths.controllerRoot, input.attempts),
    "",
    `## Counts`,
    "",
    `- Baseline written: ${counts["baseline-written"]}`,
    `- Unchanged: ${counts.unchanged}`,
    `- Changed: ${counts.changed}`,
    `- Missing baseline: ${counts["missing-baseline"]}`,
    `- Capture failed: ${counts["capture-failed"]}`,
    `- Diff error: ${counts["diff-error"]}`,
    "",
    `## Comparison Issues`,
    "",
    comparisonIssues.length === 0 ? `- None` : comparisonIssues.map((issue) => `- ${issue}`).join("\n"),
    "",
    `## Artifacts`,
    "",
    `- Manifest: ${toRelativePath(input.paths.controllerRoot, input.paths.manifestPath)}`,
    `- Hashes: ${toRelativePath(input.paths.controllerRoot, input.paths.hashesPath)}`,
    `- Comparison: ${toRelativePath(input.paths.controllerRoot, input.paths.comparisonPath)}`,
    `- App log: ${toRelativePath(input.paths.controllerRoot, input.paths.appLogPath)}`,
    "",
    `## Changed Captures`,
    "",
    changedItems.length === 0
      ? `- None`
      : changedItems
          .map(
            (item) =>
              `- ${item.captureId}: drift ratio ${item.diffRatio ?? 1}${
                item.diffImagePath ? ` (${toRelativePath(input.paths.controllerRoot, item.diffImagePath)})` : ""
              }`
          )
          .join("\n"),
    "",
    `## Failed Captures`,
    "",
    failedCaptures.length === 0
      ? `- None`
      : failedCaptures.map((capture) => `- ${capture.captureId}: ${capture.error}`).join("\n"),
    ""
  ].join("\n");
}

export async function writeSourceSummaryMarkdown(input: {
  config: AppConfig;
  paths: SourceRunPaths;
  normalizedIntent: NormalizedIntent;
  workspace?: ResolvedSourceWorkspace;
  linearIssue: LinearIssueRef | null;
  captures: CaptureOutcome[];
  comparison?: ComparisonSummary;
  status: "planned" | "completed" | "failed";
  error?: string;
  generatedPlaywrightTests?: string[];
  attempts: SourceRunAttemptRecord[];
}): Promise<string> {
  const markdown = buildSourceSummaryMarkdown(input);
  await writeTextFile(input.paths.summaryPath, markdown);
  return markdown;
}

export function buildBusinessSummaryMarkdown(input: {
  config: AppConfig;
  paths: RunPaths;
  normalizedIntent: NormalizedIntent;
  sourceRuns: SourceEvidenceRecord[];
  linearPublication: BusinessLinearPublication | null;
  status: "completed" | "failed";
  hasDrift: boolean;
  counts: Record<ComparisonStatus, number>;
  errors: string[];
}): string {
  const completedSources = input.sourceRuns.filter((sourceRun) => sourceRun.status === "completed");
  const failedSources = input.sourceRuns.filter((sourceRun) => sourceRun.status === "failed");

  return [
    `# Intent POC Business Run Summary`,
    "",
    `- Run ID: ${input.paths.runId}`,
    `- Status: ${input.status}`,
    `- Intent: ${input.normalizedIntent.rawPrompt}`,
    `- Normalized summary: ${input.normalizedIntent.summary}`,
    `- Primary source: ${input.normalizedIntent.executionPlan.primarySourceId}`,
    `- Verification workflow: active`,
    `- Linear parent issue: ${input.linearPublication?.parentIssue?.url ?? input.linearPublication?.parentIssue?.identifier ?? "not created"}`,
    `- Has drift: ${input.hasDrift ? "yes" : "no"}`,
    `- Desired outcome: ${input.normalizedIntent.businessIntent.desiredOutcome}`,
    "",
    `## AI Stages`,
    "",
    buildAgentStageMarkdown(input.normalizedIntent.normalizationMeta.stages),
    "",
    `## Business Intent`,
    "",
    input.normalizedIntent.businessIntent.statement,
    "",
    `## Acceptance Criteria`,
    "",
    input.normalizedIntent.businessIntent.acceptanceCriteria.map((criterion) => `- ${criterion.description}`).join("\n"),
    "",
    `## BDD Scenarios`,
    "",
    input.normalizedIntent.businessIntent.scenarios
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
      .join("\n\n"),
    "",
    `## IDD Decomposition`,
    "",
    buildIntentDecompositionMarkdown({ normalizedIntent: input.normalizedIntent }),
    "",
    `## TDD Work Items`,
    "",
    input.normalizedIntent.businessIntent.workItems
      .map(
        (workItem) =>
          [
            `- ${workItem.title}`,
            `  - Sources: ${workItem.sourceIds.join(", ")}`,
            `  - Type: ${describeWorkItemType(workItem)}`,
            `  - Outcome: ${workItem.userVisibleOutcome}`,
            `  - Verification: ${workItem.verification}`,
            `  - Playwright specs: ${workItem.playwright.specs.length}`,
            `  - Checkpoints: ${workItem.playwright.specs.reduce((count, spec) => count + spec.checkpoints.length, 0)}`
          ].join("\n")
      )
      .join("\n"),
    "",
    `## Execution Plan`,
    "",
    `- Orchestration strategy: ${input.normalizedIntent.executionPlan.orchestrationStrategy}`,
    `- Planned sources: ${input.normalizedIntent.executionPlan.sources.map((source) => source.sourceId).join(", ")}`,
    `- Destinations: ${input.normalizedIntent.executionPlan.destinations.map((destination) => `${destination.label} [${destination.status}]`).join(", ")}`,
    `- Tools: ${input.normalizedIntent.executionPlan.tools.map((tool) => `${tool.label} [${tool.enabled ? "enabled" : "planned"}]`).join(", ")}`,
    "",
    `## Source Runs`,
    "",
    input.sourceRuns
      .map(
        (sourceRun) => {
          const latestAttempt = sourceRun.attempts.at(-1);

          return [
            `### ${sourceRun.sourceId}`,
            `- Status: ${sourceRun.status}`,
            `- Error: ${sourceRun.error ?? "none"}`,
            `- Linear issue: ${sourceRun.linearIssue?.url ?? sourceRun.linearIssue?.identifier ?? "not created"}`,
            `- Generated Playwright specs: ${sourceRun.generatedPlaywrightTests?.length ?? 0}`,
            `- Attempts: ${sourceRun.attempts.length}`,
            `- Latest runtime result: ${latestAttempt ? `${latestAttempt.status}${latestAttempt.failureStage ? ` (${latestAttempt.failureStage})` : ""}` : "not run"}`,
            `- Summary: ${toRelativePath(input.paths.controllerRoot, sourceRun.paths.summaryPath)}`,
            `- Manifest: ${toRelativePath(input.paths.controllerRoot, sourceRun.paths.manifestPath)}`
          ].join("\n");
        }
      )
      .join("\n\n"),
    "",
    `## Counts`,
    "",
    `- Baseline written: ${input.counts["baseline-written"]}`,
    `- Unchanged: ${input.counts.unchanged}`,
    `- Changed: ${input.counts.changed}`,
    `- Missing baseline: ${input.counts["missing-baseline"]}`,
    `- Capture failed: ${input.counts["capture-failed"]}`,
    `- Diff error: ${input.counts["diff-error"]}`,
    "",
    `## Outcome`,
    "",
    `- Completed sources: ${completedSources.length}`,
    `- Failed sources: ${failedSources.length}`,
    `- Errors: ${input.errors.length === 0 ? "none" : input.errors.join(" | ")}`,
    "",
    `## Artifacts`,
    "",
    `- Manifest: ${toRelativePath(input.paths.controllerRoot, input.paths.manifestPath)}`,
    `- Hashes: ${toRelativePath(input.paths.controllerRoot, input.paths.hashesPath)}`,
    `- Comparison: ${toRelativePath(input.paths.controllerRoot, input.paths.comparisonPath)}`,
    ""
  ].join("\n");
}

export async function writeBusinessSummaryMarkdown(input: {
  config: AppConfig;
  paths: RunPaths;
  normalizedIntent: NormalizedIntent;
  sourceRuns: SourceEvidenceRecord[];
  linearPublication: BusinessLinearPublication | null;
  status: "completed" | "failed";
  hasDrift: boolean;
  counts: Record<ComparisonStatus, number>;
  errors: string[];
}): Promise<string> {
  const markdown = buildBusinessSummaryMarkdown(input);
  await writeTextFile(input.paths.summaryPath, markdown);
  return markdown;
}

export async function writeSummaryMarkdown(input: {
  config: AppConfig;
  paths: SourceRunPaths;
  normalizedIntent: NormalizedIntent;
  workspace?: ResolvedSourceWorkspace;
  linearIssue: LinearIssueRef | null;
  captures: CaptureOutcome[];
  comparison?: ComparisonSummary;
  status: "planned" | "completed" | "failed";
  error?: string;
  generatedPlaywrightTests?: string[];
  attempts: SourceRunAttemptRecord[];
}): Promise<string> {
  return await writeSourceSummaryMarkdown(input);
}