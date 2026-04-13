import { AppConfig } from "../config/schema";
import { CaptureOutcome } from "../capture/capture-target";
import { ComparisonStatus, ComparisonSummary } from "../compare/run-comparison";
import { NormalizedIntent } from "../intent/intent-types";
import { LinearIssueRef } from "../linear/linear-client";
import { writeTextFile } from "../shared/fs";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import { RunPaths, SourceRunPaths, toRelativePath } from "./paths";
import { BusinessLinearPublication, SourceEvidenceRecord } from "./write-manifest";

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
}): string {
  const comparison = input.comparison;
  const changedItems = comparison ? comparison.items.filter((item) => item.status === "changed") : [];
  const failedCaptures = input.captures.filter((capture) => capture.status === "failed");
  const currentSourcePlan = input.normalizedIntent.executionPlan.sources.find(
    (source) => source.sourceId === input.paths.sourceId
  );
  const counts = comparison?.counts ?? emptyComparisonCounts();

  return [
    `# Intent POC Source Run Summary`,
    "",
    `- Run ID: ${input.paths.runId}`,
    `- Source: ${input.paths.sourceId}`,
    `- Status: ${input.status}`,
    `- Intent: ${input.normalizedIntent.rawPrompt}`,
    `- Normalized summary: ${input.normalizedIntent.summary}`,
    `- Mode: ${currentSourcePlan?.runMode ?? input.normalizedIntent.execution.runMode}`,
    `- Linear issue: ${input.linearIssue?.url ?? input.linearIssue?.identifier ?? "not created"}`,
    `- Has drift: ${comparison?.hasDrift ? "yes" : "no"}`,
    `- Desired outcome: ${input.normalizedIntent.businessIntent.desiredOutcome}`,
    input.error ? `- Error: ${input.error}` : `- Error: none`,
    "",
    `## Source Plan`,
    "",
    `- Selection reason: ${currentSourcePlan?.selectionReason ?? "not recorded"}`,
    `- Capture scope: ${currentSourcePlan?.captureScope.mode === "subset" ? currentSourcePlan.captureScope.captureIds.join(", ") : "all configured captures"}`,
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
    `## TDD Work Items`,
    "",
    input.normalizedIntent.businessIntent.workItems
      .filter((workItem) => workItem.sourceIds.includes(input.paths.sourceId))
      .map(
        (workItem) =>
          [
            `- ${workItem.title}`,
            `  - Outcome: ${workItem.userVisibleOutcome}`,
            `  - Verification: ${workItem.verification}`
          ].join("\n")
      )
      .join("\n") || "- None",
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
    `- Mode: ${input.normalizedIntent.execution.runMode}`,
    `- Linear parent issue: ${input.linearPublication?.parentIssue?.url ?? input.linearPublication?.parentIssue?.identifier ?? "not created"}`,
    `- Has drift: ${input.hasDrift ? "yes" : "no"}`,
    `- Desired outcome: ${input.normalizedIntent.businessIntent.desiredOutcome}`,
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
    `## TDD Work Items`,
    "",
    input.normalizedIntent.businessIntent.workItems
      .map(
        (workItem) =>
          [
            `- ${workItem.title}`,
            `  - Sources: ${workItem.sourceIds.join(", ")}`,
            `  - Outcome: ${workItem.userVisibleOutcome}`,
            `  - Verification: ${workItem.verification}`
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
        (sourceRun) =>
          [
            `### ${sourceRun.sourceId}`,
            `- Status: ${sourceRun.status}`,
            `- Error: ${sourceRun.error ?? "none"}`,
            `- Linear issue: ${sourceRun.linearIssue?.url ?? sourceRun.linearIssue?.identifier ?? "not created"}`,
            `- Summary: ${toRelativePath(input.paths.controllerRoot, sourceRun.paths.summaryPath)}`,
            `- Manifest: ${toRelativePath(input.paths.controllerRoot, sourceRun.paths.manifestPath)}`
          ].join("\n")
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
}): Promise<string> {
  return await writeSourceSummaryMarkdown(input);
}