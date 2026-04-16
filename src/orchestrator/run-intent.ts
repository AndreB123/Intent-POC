import path from "node:path";
import { LoadedConfig, loadConfig } from "../config/load-config";
import { AppConfig, CaptureItemConfig, SourceConfig } from "../config/schema";
import { CaptureOutcome } from "../capture/capture-target";
import { runCapture } from "../capture/run-capture";
import { ComparisonStatus, ComparisonSummary } from "../compare/run-comparison";
import { RunPaths, SourceRunPaths, createRunPaths, retainRecentRuns, toRelativePath } from "../evidence/paths";
import { publishArtifactsToSourceIfConfigured } from "../evidence/publish-artifacts";
import { updateScreenshotLibrary } from "../evidence/screenshot-library";
import {
  BusinessLinearPublication,
  SourceRunAttemptRecord,
  writePlanLifecycleFile,
  SourceEvidenceRecord,
  SourceStageCommandRecord,
  SourceStageExecutionRecord,
  writeBusinessEvidenceFiles,
  writeSourceEvidenceFiles
} from "../evidence/write-manifest";
import { writeBusinessSummaryMarkdown, writeSourceSummaryMarkdown } from "../evidence/write-summary";
import { NormalizedIntent, TDDWorkItem } from "../intent/intent-types";
import {
  ResolvedAgentStageConfig,
  RunAgentConfigOverride,
  applyAgentOverrides,
  assertImplementationStageReady,
  resolveAgentStageConfig
} from "../intent/agent-stage-config";
import { normalizeIntentWithAgent } from "../intent/normalize-intent";
import { executeImplementationStage as executeGeminiImplementationStage } from "../implementation/execute-implementation";
import { LinearClient, LinearIssueRef } from "../linear/linear-client";
import {
  BUSINESS_PLAN_SECTION_ID,
  getPlannerSectionStartMarker,
  sourceLaneSectionId,
  upsertPlannerSection
} from "../linear/planner-sections";
import { attachToRunningApp, startApp } from "../runtime/start-app";
import { checkReady, waitForReady } from "../runtime/wait-for-ready";
import { runCommandAllowFailure } from "../shared/process";
import { sanitizeFileSegment, writeJsonFile, writeTextFile } from "../shared/fs";
import { log } from "../shared/log";
import { prepareSourceWorkspace } from "../target/prepare-workspace";
import { ResolvedSourceWorkspace, resolveSourceWorkspace } from "../target/resolve-target";
import { classifyChangedPaths } from "./test-impact-detector";
import { writeGeneratedPlaywrightTests } from "../tdd/write-generated-playwright-tests";

export interface RunIntentEvent {
  timestamp: string;
  level: "info" | "warn" | "error";
  phase:
    | "config"
    | "intent"
    | "linear"
    | "workspace"
    | "implementation"
    | "qa-verification"
    | "app"
    | "capture"
    | "artifacts"
    | "run";
  message: string;
  details?: unknown;
}

export interface SourceRunResult extends SourceEvidenceRecord {
  summaryMarkdown?: string;
}

export interface RunIntentResult {
  status: "completed" | "failed";
  sourceId: string;
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
  sourceIds?: string[];
  agentOverrides?: RunAgentConfigOverride;
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
type LinearPlanningDepth = "scoping" | "full";

export interface ExecuteSourceRunInput {
  config: AppConfig;
  agentConfig: AppConfig["agent"];
  normalizedIntent: NormalizedIntent;
  sourcePlan: ExecutionSourcePlan;
  runPaths: RunPaths;
  sourcePaths: SourceRunPaths;
  options: RunIntentOptions;
  linearClient: LinearClientLike | null;
  parentIssue: LinearIssueRef | null;
  sourceIssue: LinearIssueRef | null;
  linearErrors: string[];
  executeImplementationStage: (input: ExecuteImplementationStageInput) => Promise<SourceStageExecutionRecord>;
  executeQAVerificationStage: (input: ExecuteQAVerificationStageInput) => Promise<SourceStageExecutionRecord>;
}

export interface ExecuteImplementationStageInput {
  config: AppConfig;
  stage: ResolvedAgentStageConfig;
  normalizedIntent: NormalizedIntent;
  sourcePlan: ExecutionSourcePlan;
  sourcePaths: SourceRunPaths;
  workspace: ResolvedSourceWorkspace;
  generatedPlaywrightTests: string[];
  attemptNumber: number;
  activeWorkItemIds: string[];
  completedWorkItemIds: string[];
  remainingWorkItemIds: string[];
  options: RunIntentOptions;
}

export interface ExecuteQAVerificationStageInput {
  config: AppConfig;
  normalizedIntent: NormalizedIntent;
  sourcePlan: ExecutionSourcePlan;
  sourcePaths: SourceRunPaths;
  workspace: ResolvedSourceWorkspace;
  generatedPlaywrightTests: string[];
  implementationFileOperations: SourceStageExecutionRecord["fileOperations"];
  attemptNumber: number;
  activeWorkItemIds: string[];
  completedWorkItemIds: string[];
  remainingWorkItemIds: string[];
  options: RunIntentOptions;
}

export interface SourceAttemptExecutionResult<Resource = void> {
  implementation: SourceStageExecutionRecord;
  qaVerification: SourceStageExecutionRecord;
  targetedWorkItemIds: string[];
  completedWorkItemIds: string[];
  remainingWorkItemIds: string[];
  resource?: Resource;
}

export interface RunSourceAttemptLoopInput<Resource = void> {
  sourceId: string;
  workItems: TDDWorkItem[];
  maxAttempts: number;
  retryEnabled: boolean;
  executeAttempt: (input: {
    attemptNumber: number;
    activeWorkItemIds: string[];
    completedWorkItemIds: string[];
    remainingWorkItemIds: string[];
  }) => Promise<SourceAttemptExecutionResult<Resource>>;
  releaseResource?: (resource: Resource) => Promise<void>;
  onRetry?: (input: { attempt: SourceRunAttemptRecord; nextAttemptNumber: number }) => void;
}

export interface RunSourceAttemptLoopResult<Resource = void> {
  attempts: SourceRunAttemptRecord[];
  status: "completed" | "failed";
  error?: string;
  resource?: Resource;
}

export interface RunIntentDependencies {
  loadConfig: (configPathInput: string) => Promise<LoadedConfig>;
  normalizeIntent: typeof normalizeIntentWithAgent;
  createRunPaths: typeof createRunPaths;
  createLinearClient: (config: AppConfig["linear"]) => LinearClientLike;
  executeSourceRun: (input: ExecuteSourceRunInput) => Promise<SourceRunResult>;
  executeImplementationStage: (input: ExecuteImplementationStageInput) => Promise<SourceStageExecutionRecord>;
  executeQAVerificationStage: (input: ExecuteQAVerificationStageInput) => Promise<SourceStageExecutionRecord>;
  writeJsonFile: typeof writeJsonFile;
  writePlanLifecycleFile: typeof writePlanLifecycleFile;
  writeBusinessEvidenceFiles: typeof writeBusinessEvidenceFiles;
  writeBusinessSummaryMarkdown: typeof writeBusinessSummaryMarkdown;
  retainRecentRuns: typeof retainRecentRuns;
}

export interface QAVerificationCommandPlan {
  label: string;
  command: string;
}

export interface QAVerificationExecutionPlan {
  commands?: QAVerificationCommandPlan[];
  error?: string;
}

interface QAFallbackPathGroup {
  reason: string;
  matches: (normalizedPath: string) => boolean;
  testTargets: string[];
}

const MAX_SOURCE_ATTEMPTS = 3;
const QA_COMMAND_TIMEOUT_MS = 600_000;
type RunningAppHandle = Awaited<ReturnType<typeof startApp>>;

function formatProcessExitSummary(exit: { exitCode: number | null; signal: NodeJS.Signals | null }): string {
  if (typeof exit.exitCode === "number") {
    return `exit code ${exit.exitCode}`;
  }

  if (exit.signal) {
    return `signal ${exit.signal}`;
  }

  return "unknown exit status";
}

export async function waitForSourceAppReady(input: {
  config: AppConfig;
  workspace: ResolvedSourceWorkspace;
  appHandle: Pick<RunningAppHandle, "logPath" | "waitForExit">;
}): Promise<void> {
  const readinessResult = await Promise.race<
    | { kind: "ready" }
    | { kind: "exited"; exit: { exitCode: number | null; signal: NodeJS.Signals | null } }
  >([
    waitForReady(input.config, input.workspace).then(() => ({ kind: "ready" as const })),
    input.appHandle.waitForExit().then((exit) => ({ kind: "exited" as const, exit }))
  ]);

  if (readinessResult.kind === "exited") {
    throw new Error(
      `Source app exited before readiness check completed (${formatProcessExitSummary(readinessResult.exit)}). See ${input.appHandle.logPath} for details.`
    );
  }
}

function supportsExistingServerReuse(workspace: ResolvedSourceWorkspace): boolean {
  return workspace.sourceType === "local"
    && workspace.source.workspace.checkoutMode === "existing"
    && workspace.source.app.reuseExistingServer;
}

export async function canReuseRunningSourceApp(input: {
  config: AppConfig;
  workspace: ResolvedSourceWorkspace;
}): Promise<boolean> {
  if (!supportsExistingServerReuse(input.workspace)) {
    return false;
  }

  const readiness = input.workspace.source.app.readiness;
  const quickTimeoutMs = Math.min(
    readiness.intervalMs,
    readiness.timeoutMs,
    1_000
  );

  return await checkReady(input.config, input.workspace, quickTimeoutMs);
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

function quoteShellArg(value: string): string {
  return JSON.stringify(value);
}

const SOURCE_SCOPED_FULL_QA_GROUPS: Array<Pick<QAFallbackPathGroup, "reason" | "matches">> = [
  {
    reason: "Tracked screenshot artifacts and runnable source config changes still require the full workflow.",
    matches: (normalizedPath) =>
      normalizedPath.startsWith("artifacts/library/")
      || normalizedPath === "intent-poc.yaml"
      || normalizedPath === "intent-poc.local-no-linear.yaml"
  },
  {
    reason: "Config, capture, comparison, and evidence changes still require the full workflow.",
    matches: (normalizedPath) =>
      normalizedPath.startsWith("src/config/")
      || normalizedPath.startsWith("src/capture/")
      || normalizedPath.startsWith("src/compare/")
      || normalizedPath.startsWith("src/evidence/")
      || normalizedPath === "src/cli.ts"
      || normalizedPath === "package.json"
  }
];

const SOURCE_SCOPED_TARGETED_QA_GROUPS: QAFallbackPathGroup[] = [
  {
    reason: "Demo app changes can stay on focused studio server coverage.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/demo-app/"),
    testTargets: ["src/demo-app/server/start-intent-studio-server.test.ts"]
  },
  {
    reason: "Implementation changes can stay on implementation guardrail coverage.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/implementation/"),
    testTargets: [
      "src/implementation/execute-implementation.test.ts",
      "src/implementation/apply-changes.test.ts"
    ]
  },
  {
    reason: "Intent planning changes can stay on normalization coverage.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/intent/"),
    testTargets: ["src/intent/normalize-intent.test.ts"]
  },
  {
    reason: "Linear planning changes can stay on planner section coverage.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/linear/"),
    testTargets: ["src/linear/planner-sections.test.ts"]
  },
  {
    reason: "Playwright TDD writer changes can stay on tracked spec writer coverage.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/tdd/"),
    testTargets: ["src/tdd/write-generated-playwright-tests.test.ts"]
  },
  {
    reason: "Orchestrator changes can stay on focused runner behavior coverage during source-lane QA.",
    matches: (normalizedPath) => normalizedPath.startsWith("src/orchestrator/"),
    testTargets: ["src/orchestrator/run-intent.behavior.test.ts"]
  },
  {
    reason: "Explicit test edits can rerun the touched test files directly.",
    matches: (normalizedPath) => normalizedPath.endsWith(".test.ts"),
    testTargets: []
  }
];

function normalizeImplementationChangedPaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths
        .map((filePath) => filePath.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
        .filter((filePath) => filePath.length > 0)
    )
  ).sort();
}

function buildTargetedCodeTestCommand(testTargets: string[]): string {
  return `npm run test:code -- ${testTargets.map((filePath) => quoteShellArg(filePath)).join(" ")}`;
}

function resolveSourceScopedQAFallback(input: {
  implementationChangedPaths: string[];
}): QAVerificationCommandPlan {
  const implementationChangedPaths = normalizeImplementationChangedPaths(input.implementationChangedPaths);

  if (implementationChangedPaths.length === 0) {
    return {
      label: "test-code",
      command: "npm run test:code"
    };
  }

  const requiresFullWorkflow = implementationChangedPaths.some((filePath) =>
    SOURCE_SCOPED_FULL_QA_GROUPS.some((group) => group.matches(filePath))
  );

  if (requiresFullWorkflow) {
    return {
      label: "test-full",
      command: "npm test"
    };
  }

  const targetedTestTargets = new Set<string>();
  let allPathsAreTargetable = true;

  for (const filePath of implementationChangedPaths) {
    const matchingGroup = SOURCE_SCOPED_TARGETED_QA_GROUPS.find((group) => group.matches(filePath));

    if (!matchingGroup) {
      allPathsAreTargetable = false;
      break;
    }

    if (matchingGroup.testTargets.length === 0) {
      targetedTestTargets.add(filePath);
      continue;
    }

    for (const testTarget of matchingGroup.testTargets) {
      targetedTestTargets.add(testTarget);
    }
  }

  if (allPathsAreTargetable && targetedTestTargets.size > 0) {
    const testTargets = Array.from(targetedTestTargets).sort();
    return {
      label: "test-code-targeted",
      command: buildTargetedCodeTestCommand(testTargets)
    };
  }

  const impactDecision = classifyChangedPaths(implementationChangedPaths);
  return {
    label: impactDecision.scope === "full" ? "test-full" : "test-code",
    command: impactDecision.command
  };
}

function buildSkippedStageExecutionRecord(summary: string): SourceStageExecutionRecord {
  return {
    status: "skipped",
    summary,
    targetedWorkItemIds: [],
    completedWorkItemIds: [],
    remainingWorkItemIds: [],
    commands: [],
    fileOperations: []
  };
}

function sortWorkItemsForExecution(workItems: TDDWorkItem[]): TDDWorkItem[] {
  return [...workItems].sort((left, right) => {
    const orderDelta = left.execution.order - right.execution.order;
    if (orderDelta !== 0) {
      return orderDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

function resolveNextExecutableWorkItem(
  workItems: TDDWorkItem[],
  completedWorkItemIds: Set<string>,
  pendingWorkItemIds: Set<string>
): TDDWorkItem | undefined {
  return sortWorkItemsForExecution(workItems).find((workItem) => {
    if (!pendingWorkItemIds.has(workItem.id)) {
      return false;
    }

    return workItem.execution.dependsOnWorkItemIds.every((dependencyId) => completedWorkItemIds.has(dependencyId));
  });
}

function buildRemainingWorkItemIds(workItems: TDDWorkItem[], completedWorkItemIds: Set<string>): string[] {
  return sortWorkItemsForExecution(workItems)
    .map((workItem) => workItem.id)
    .filter((workItemId) => !completedWorkItemIds.has(workItemId));
}

function buildProgressAwareStageRecord(
  stage: SourceStageExecutionRecord,
  input: {
    targetedWorkItemIds: string[];
    completedWorkItemIds: string[];
    remainingWorkItemIds: string[];
  }
): SourceStageExecutionRecord {
  return {
    ...stage,
    targetedWorkItemIds: input.targetedWorkItemIds,
    completedWorkItemIds: input.completedWorkItemIds,
    remainingWorkItemIds: input.remainingWorkItemIds
  };
}

function buildAttemptFailureMessage(sourceId: string, attempt: SourceRunAttemptRecord): string {
  if (attempt.failureStage === "implementation") {
    return `Implementation failed for source '${sourceId}' on attempt ${attempt.attemptNumber}: ${attempt.implementation.error ?? attempt.implementation.summary}`;
  }

  return `QA verification failed for source '${sourceId}' on attempt ${attempt.attemptNumber}: ${attempt.qaVerification.error ?? attempt.qaVerification.summary}`;
}

function buildCommandLogContent(command: SourceStageCommandRecord, stdout: string, stderr: string): string {
  return [
    `Command: ${command.command}`,
    `Label: ${command.label}`,
    `Cwd: ${command.cwd}`,
    `Status: ${command.status}`,
    `Exit code: ${command.exitCode ?? -1}`,
    `Timed out: ${command.timedOut ? "yes" : "no"}`,
    `Started at: ${command.startedAt}`,
    `Finished at: ${command.finishedAt}`,
    `Duration ms: ${command.durationMs}`,
    command.error ? `Error: ${command.error}` : "Error: none",
    "",
    "## stdout",
    "",
    stdout || "",
    "",
    "## stderr",
    "",
    stderr || "",
    ""
  ].join("\n");
}

export function buildQAVerificationExecutionPlan(input: {
  normalizedIntent: NormalizedIntent;
  sourceId: string;
  activeWorkItemIds: string[];
  generatedPlaywrightTests: string[];
  implementationFileOperations: SourceStageExecutionRecord["fileOperations"];
  workspaceRootDir: string;
}): QAVerificationExecutionPlan {
  const activeWorkItems = sortWorkItemsForExecution(
    input.normalizedIntent.businessIntent.workItems.filter(
      (workItem) => workItem.sourceIds.includes(input.sourceId) && input.activeWorkItemIds.includes(workItem.id)
    )
  );
  const activeWorkItemIds = activeWorkItems.map((workItem) => workItem.id);
  const expectsGeneratedPlaywright = activeWorkItems.some((workItem) => workItem.playwright.specs.length > 0);

  if (expectsGeneratedPlaywright && input.generatedPlaywrightTests.length === 0) {
    return {
      error: `Missing targeted tracked Playwright specs for active work items: ${activeWorkItemIds.join(", ")}.`
    };
  }

  const implementationChangedPaths = normalizeImplementationChangedPaths(
    input.implementationFileOperations.map((operation) => operation.filePath)
  );
  const allActiveWorkIsPlaywright = activeWorkItems.length > 0 && activeWorkItems.every((workItem) => workItem.type === "playwright-spec");
  const fallbackCommand = resolveSourceScopedQAFallback({ implementationChangedPaths });

  return {
    commands: [
      {
        label: "typecheck",
        command: "npm run typecheck"
      },
      ...(allActiveWorkIsPlaywright && input.generatedPlaywrightTests.length > 0
        ? [
            {
              label: "generated-playwright",
              command: `npx playwright test ${input.generatedPlaywrightTests
                .map((filePath) => quoteShellArg(path.relative(input.workspaceRootDir, filePath)))
                .join(" ")}`
            }
          ]
        : [
            fallbackCommand
          ])
    ]
  };
}

async function runLoggedStageCommand(input: {
  stageId: "qaVerification";
  attemptNumber: number;
  sourcePaths: SourceRunPaths;
  label: string;
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<SourceStageCommandRecord> {
  const startedAt = new Date().toISOString();
  const result = await runCommandAllowFailure(input.command, {
    cwd: input.cwd,
    env: input.env,
    timeoutMs: input.timeoutMs
  });
  const finishedAt = new Date().toISOString();
  const status = !result.timedOut && result.exitCode === 0 ? "completed" : "failed";
  const logPath = path.join(
    input.sourcePaths.attemptsDir,
    `attempt-${input.attemptNumber}-${sanitizeFileSegment(input.stageId)}-${sanitizeFileSegment(input.label)}.log`
  );
  const error = status === "failed"
    ? result.timedOut
      ? `Command timed out after ${input.timeoutMs}ms.`
      : `Command failed (${result.exitCode}).`
    : undefined;
  const commandRecord: SourceStageCommandRecord = {
    label: input.label,
    command: input.command,
    cwd: input.cwd,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    status,
    exitCode: result.exitCode,
    timedOut: result.timedOut || undefined,
    error,
    logPath
  };

  await writeTextFile(logPath, buildCommandLogContent(commandRecord, result.stdout, result.stderr));

  return commandRecord;
}

async function executeDefaultQAVerificationStage(input: ExecuteQAVerificationStageInput): Promise<SourceStageExecutionRecord> {
  const env = {
    ...input.workspace.source.workspace.env,
    ...input.workspace.source.app.env,
    INTENT_POC_BASE_URL: input.workspace.baseUrl
  };
  const qaPlan = buildQAVerificationExecutionPlan({
    normalizedIntent: input.normalizedIntent,
    sourceId: input.sourcePlan.sourceId,
    activeWorkItemIds: input.activeWorkItemIds,
    generatedPlaywrightTests: input.generatedPlaywrightTests,
    implementationFileOperations: input.implementationFileOperations,
    workspaceRootDir: input.workspace.rootDir
  });

  if (qaPlan.error) {
    return {
      status: "failed",
      summary: "QA verification failed before execution because targeted Playwright coverage was missing.",
      error: qaPlan.error,
      targetedWorkItemIds: input.activeWorkItemIds,
      completedWorkItemIds: input.completedWorkItemIds,
      remainingWorkItemIds: input.remainingWorkItemIds,
      commands: [],
      fileOperations: []
    };
  }
  const commands = qaPlan.commands ?? [];
  const commandRecords: SourceStageCommandRecord[] = [];

  for (const command of commands) {
    emitRunEvent(input.options, "qa-verification", `Running QA command '${command.label}'.`, {
      sourceId: input.sourcePlan.sourceId,
      attemptNumber: input.attemptNumber,
      command: command.command,
      cwd: input.workspace.rootDir
    });

    const commandRecord = await runLoggedStageCommand({
      stageId: "qaVerification",
      attemptNumber: input.attemptNumber,
      sourcePaths: input.sourcePaths,
      label: command.label,
      command: command.command,
      cwd: input.workspace.rootDir,
      env,
      timeoutMs: QA_COMMAND_TIMEOUT_MS
    });
    commandRecords.push(commandRecord);

    if (commandRecord.status === "failed") {
      return {
        status: "failed",
        summary: `QA verification failed while running '${command.label}'.`,
        error: commandRecord.error,
        targetedWorkItemIds: input.activeWorkItemIds,
        completedWorkItemIds: input.completedWorkItemIds,
        remainingWorkItemIds: input.remainingWorkItemIds,
        commands: commandRecords,
        fileOperations: []
      };
    }
  }

  return {
    status: "completed",
    summary: `QA verification passed ${commandRecords.length} command${commandRecords.length === 1 ? "" : "s"}.`,
    targetedWorkItemIds: input.activeWorkItemIds,
    completedWorkItemIds: [...input.completedWorkItemIds, ...input.activeWorkItemIds],
    remainingWorkItemIds: input.remainingWorkItemIds.filter((workItemId) => !input.activeWorkItemIds.includes(workItemId)),
    commands: commandRecords,
    fileOperations: []
  };
}

async function startReadySourceApp(input: {
  config: AppConfig;
  workspace: ResolvedSourceWorkspace;
  sourcePaths: SourceRunPaths;
  runPaths: RunPaths;
  options: RunIntentOptions;
  reason: "qa-verification" | "evidence-capture";
  attemptNumber?: number;
}): Promise<RunningAppHandle> {
  if (await canReuseRunningSourceApp({ config: input.config, workspace: input.workspace })) {
    const appHandle = attachToRunningApp(input.sourcePaths.appLogPath);

    log.info("Reusing existing source app.", {
      sourceId: input.workspace.sourceId,
      baseUrl: input.workspace.baseUrl,
      reason: input.reason,
      attemptNumber: input.attemptNumber
    });

    emitRunEvent(input.options, "app", "Reusing existing source app.", {
      sourceId: input.workspace.sourceId,
      baseUrl: input.workspace.baseUrl,
      readiness: input.workspace.source.app.readiness,
      externallyManaged: true,
      reason: input.reason,
      attemptNumber: input.attemptNumber
    });

    return appHandle;
  }

  emitRunEvent(input.options, "app", "Starting source app.", {
    sourceId: input.workspace.sourceId,
    baseUrl: input.workspace.baseUrl,
    startCommand: input.workspace.source.app.startCommand,
    workdir: input.workspace.source.app.workdir,
    reason: input.reason,
    attemptNumber: input.attemptNumber
  });

  const appHandle = await startApp(input.workspace, input.sourcePaths.appLogPath);
  log.info("Source app started.", {
    sourceId: input.workspace.sourceId,
    pid: appHandle.pid,
    logPath: input.sourcePaths.appLogPath,
    reason: input.reason,
    attemptNumber: input.attemptNumber
  });

  emitRunEvent(input.options, "app", "Source app started.", {
    sourceId: input.workspace.sourceId,
    pid: appHandle.pid,
    externallyManaged: false,
    appLogPath: toRelativePath(input.runPaths.controllerRoot, input.sourcePaths.appLogPath),
    reason: input.reason,
    attemptNumber: input.attemptNumber
  });

  emitRunEvent(input.options, "app", "Waiting for readiness check.", {
    sourceId: input.workspace.sourceId,
    readiness: input.workspace.source.app.readiness,
    reason: input.reason,
    attemptNumber: input.attemptNumber
  });

  await waitForSourceAppReady({
    config: input.config,
    workspace: input.workspace,
    appHandle
  });
  log.info("Source app is ready.", {
    sourceId: input.workspace.sourceId,
    baseUrl: input.workspace.baseUrl,
    reason: input.reason,
    attemptNumber: input.attemptNumber
  });

  emitRunEvent(input.options, "app", "Source app is ready.", {
    sourceId: input.workspace.sourceId,
    baseUrl: input.workspace.baseUrl,
    externallyManaged: false,
    reason: input.reason,
    attemptNumber: input.attemptNumber
  });

  return appHandle;
}

export async function runSourceAttemptLoop<Resource>(
  input: RunSourceAttemptLoopInput<Resource>
): Promise<RunSourceAttemptLoopResult<Resource>> {
  const attempts: SourceRunAttemptRecord[] = [];

  const completedWorkItemIds = new Set<string>();
  let remainingWorkItemIds = buildRemainingWorkItemIds(input.workItems, completedWorkItemIds);
  let attemptNumber = 1;
  let latestResource: Resource | undefined;

  while (remainingWorkItemIds.length > 0) {
    const nextWorkItem = resolveNextExecutableWorkItem(input.workItems, completedWorkItemIds, new Set(remainingWorkItemIds));

    if (!nextWorkItem) {
      return {
        attempts,
        status: "failed",
        error: `No dependency-ready work item remained for source '${input.sourceId}'. Check work item execution ordering.`
      };
    }

    const activeWorkItemIds = [nextWorkItem.id];

    for (let retryNumber = 1; retryNumber <= input.maxAttempts; retryNumber += 1) {
      const startedAt = new Date().toISOString();
      const result = await input.executeAttempt({
        attemptNumber,
        activeWorkItemIds,
        completedWorkItemIds: Array.from(completedWorkItemIds),
        remainingWorkItemIds
      });
      const finishedAt = new Date().toISOString();
      const failureStage =
        result.implementation.status === "failed"
          ? "implementation"
          : result.qaVerification.status === "failed"
            ? "qaVerification"
            : undefined;
      const attempt: SourceRunAttemptRecord = {
        attemptNumber,
        startedAt,
        finishedAt,
        status: failureStage ? "failed" : "completed",
        failureStage,
        targetedWorkItemIds: result.targetedWorkItemIds,
        completedWorkItemIds: result.completedWorkItemIds,
        remainingWorkItemIds: result.remainingWorkItemIds,
        implementation: result.implementation,
        qaVerification: result.qaVerification
      };

      attempts.push(attempt);

      if (!failureStage) {
        activeWorkItemIds.forEach((workItemId) => completedWorkItemIds.add(workItemId));
        remainingWorkItemIds = buildRemainingWorkItemIds(input.workItems, completedWorkItemIds);
        latestResource = result.resource;
        attemptNumber += 1;
        break;
      }

      if (result.resource && input.releaseResource) {
        await input.releaseResource(result.resource);
      }

      const canRetry = input.retryEnabled && retryNumber < input.maxAttempts && result.implementation.status !== "skipped";
      if (!canRetry) {
        return {
          attempts,
          status: "failed",
          error: buildAttemptFailureMessage(input.sourceId, attempt)
        };
      }

      input.onRetry?.({
        attempt,
        nextAttemptNumber: attemptNumber + 1
      });
      attemptNumber += 1;
    }
  }

  return {
    attempts,
    status: "completed",
    resource: latestResource
  };
}

function formatWorkItemDescription(workItem: TDDWorkItem, includeSources: boolean): string {
  const checkpointCount = workItem.playwright.specs.reduce((count, spec) => count + spec.checkpoints.length, 0);
  const lines = [
    `- ${workItem.title}`,
    ...(includeSources ? [`  - Sources: ${workItem.sourceIds.join(", ")}`] : []),
    `  - Outcome: ${workItem.userVisibleOutcome}`,
    `  - Verification: ${workItem.verification}`,
    `  - Order: ${workItem.execution.order}`,
    `  - Depends on: ${workItem.execution.dependsOnWorkItemIds.length > 0 ? workItem.execution.dependsOnWorkItemIds.join(", ") : "none"}`,
    `  - Playwright specs: ${workItem.playwright.specs.length}`,
    `  - Checkpoints: ${checkpointCount}`
  ];

  if (workItem.playwright.specs.length > 0) {
    lines.push(
      `  - Spec paths: ${workItem.playwright.specs
        .map((spec) => `${spec.sourceId}:${spec.relativeSpecPath}`)
        .join(", ")}`
    );
  }

  return lines.join("\n");
}

function buildRepoContextMarkdown(normalizedIntent: NormalizedIntent): string {
  return (
    normalizedIntent.planning.repoCandidates
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
      .join("\n") || "- None"
  );
}

function buildExecutionSourcesMarkdown(normalizedIntent: NormalizedIntent): string {
  return (
    normalizedIntent.executionPlan.sources
      .map(
        (source) =>
          `- ${source.sourceId} (${source.captureScope.mode === "subset" ? source.captureScope.captureIds.join(", ") : "all captures"})`
      )
      .join("\n") || "- None"
  );
}

function buildDestinationsMarkdown(normalizedIntent: NormalizedIntent): string {
  return (
    normalizedIntent.executionPlan.destinations
      .map((destination) => `- ${destination.label} [${destination.status}] - ${destination.reason}`)
      .join("\n") || "- None"
  );
}

function buildToolsMarkdown(normalizedIntent: NormalizedIntent): string {
  return (
    normalizedIntent.executionPlan.tools
      .map((tool) => `- ${tool.label} [${tool.enabled ? "enabled" : "planned"}] - ${tool.reason}`)
      .join("\n") || "- None"
  );
}

function buildPlanningLifecycleMarkdown(normalizedIntent: NormalizedIntent): string {
  return (
    [
      `- Linear plan mode: ${normalizedIntent.planning.linearPlan.mode}`,
      normalizedIntent.planning.linearPlan.issueReference
        ? `- Resume issue: ${normalizedIntent.planning.linearPlan.issueReference}`
        : undefined,
      ...normalizedIntent.planning.reviewNotes.map((note) => `- ${note}`),
      ...normalizedIntent.planning.plannerSections.map(
        (section) => `- Managed section: ${section.title} - ${section.summary}`
      )
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n") || "- None"
  );
}

function describeSourceCaptureScope(sourcePlan: ExecutionSourcePlan | undefined): string {
  return sourcePlan?.captureScope.mode === "subset" ? sourcePlan.captureScope.captureIds.join(", ") : "all configured captures";
}

function buildLinearScopingParentIssueDescription(input: {
  rawPrompt: string;
  normalizedIntent: NormalizedIntent;
}): string {
  return [
    `## Business Intent`,
    "",
    input.normalizedIntent.businessIntent.statement,
    "",
    `## Desired Outcome`,
    "",
    input.normalizedIntent.businessIntent.desiredOutcome,
    "",
    `## Linear Scoping`,
    "",
    `- Summary: ${input.normalizedIntent.summary}`,
    `- Orchestration strategy: ${input.normalizedIntent.executionPlan.orchestrationStrategy}`,
    `- Planned sources: ${input.normalizedIntent.executionPlan.sources.map((source) => source.sourceId).join(", ") || "none"}`,
    "",
    `## Repo Context`,
    "",
    buildRepoContextMarkdown(input.normalizedIntent),
    "",
    `## Execution Sources`,
    "",
    buildExecutionSourcesMarkdown(input.normalizedIntent),
    "",
    `## Destinations`,
    "",
    buildDestinationsMarkdown(input.normalizedIntent),
    "",
    `## Tools`,
    "",
    buildToolsMarkdown(input.normalizedIntent),
    "",
    `## Plan Lifecycle`,
    "",
    buildPlanningLifecycleMarkdown(input.normalizedIntent),
    "",
    `## Raw Intent`,
    "",
    input.rawPrompt,
    ""
  ].join("\n");
}

function buildLinearScopingSourceIssueDescription(input: {
  normalizedIntent: NormalizedIntent;
  sourceId: string;
}): string {
  const sourcePlan = input.normalizedIntent.executionPlan.sources.find((source) => source.sourceId === input.sourceId);
  const repoContext = input.normalizedIntent.planning.repoCandidates.find((repo) => repo.sourceIds.includes(input.sourceId));

  return [
    `## Source Lane`,
    "",
    `- Source: ${input.sourceId}`,
    `- Capture workflow: ${sourcePlan ? "configured" : "default"}`,
    `- Capture scope: ${describeSourceCaptureScope(sourcePlan)}`,
    `- Selection reason: ${sourcePlan?.selectionReason ?? "not recorded"}`,
    repoContext ? `- Repo context: ${repoContext.label} (${repoContext.repoId})` : `- Repo context: not linked`,
    "",
    `## Linear Scope`,
    "",
    `- Business summary: ${input.normalizedIntent.summary}`,
    `- Desired outcome: ${input.normalizedIntent.businessIntent.desiredOutcome}`,
    `- Detailed BDD and Playwright-first TDD planning will be added after Linear scoping completes.`,
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
    .map((workItem) => formatWorkItemDescription(workItem, true))
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
    acceptanceCriteria || "- None",
    "",
    `## BDD Scenarios`,
    "",
    scenarios || "- None",
    "",
    `## TDD Work Items`,
    "",
    workItems || "- None",
    "",
    `## Repo Context`,
    "",
    buildRepoContextMarkdown(input.normalizedIntent),
    "",
    `## Execution Sources`,
    "",
    buildExecutionSourcesMarkdown(input.normalizedIntent),
    "",
    `## Destinations`,
    "",
    buildDestinationsMarkdown(input.normalizedIntent),
    "",
    `## Tools`,
    "",
    buildToolsMarkdown(input.normalizedIntent),
    "",
    `## Plan Lifecycle`,
    "",
    buildPlanningLifecycleMarkdown(input.normalizedIntent),
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
    .map((workItem) => formatWorkItemDescription(workItem, false))
    .join("\n");

  return [
    `## Source Lane`,
    "",
    `- Source: ${input.sourceId}`,
    `- Capture workflow: ${sourcePlan ? "configured" : "default"}`,
    `- Capture scope: ${describeSourceCaptureScope(sourcePlan)}`,
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
  planningDepth?: LinearPlanningDepth;
}): string {
  return upsertPlannerSection(existingDescription, {
    id: BUSINESS_PLAN_SECTION_ID,
    title: "IDD Plan",
    body: input.planningDepth === "scoping" ? buildLinearScopingParentIssueDescription(input) : buildParentIssueDescription(input)
  });
}

function buildManagedSourceIssueDescription(existingDescription: string | undefined, input: {
  normalizedIntent: NormalizedIntent;
  sourceId: string;
  planningDepth?: LinearPlanningDepth;
}): string {
  return upsertPlannerSection(existingDescription, {
    id: sourceLaneSectionId(input.sourceId),
    title: `IDD Source Lane: ${input.sourceId}`,
    body: input.planningDepth === "scoping" ? buildLinearScopingSourceIssueDescription(input) : buildSourceIssueDescription(input)
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

async function upsertLinearParentIssue(input: {
  linearClient: LinearClientLike;
  options: RunIntentOptions;
  errors: string[];
  rawPrompt: string;
  normalizedIntent: NormalizedIntent;
  planningDepth: LinearPlanningDepth;
  existingParentIssue?: LinearIssueRef | null;
  resumeIssue?: string;
  createIfMissing: boolean;
}): Promise<LinearIssueRef | null> {
  const issueTitle = input.normalizedIntent.linear.issueTitle;
  const currentParentIssue = input.existingParentIssue ?? null;

  if (currentParentIssue) {
    return (
      (await safeLinearTask({
        enabled: true,
        options: input.options,
        errors: input.errors,
        message: "Failed to update the Linear parent issue",
        task: async () => {
          const description = buildManagedParentIssueDescription(currentParentIssue.description, {
            rawPrompt: input.rawPrompt,
            normalizedIntent: input.normalizedIntent,
            planningDepth: input.planningDepth
          });

          await input.linearClient.updateIssueTitle(currentParentIssue.id, issueTitle);
          await input.linearClient.updateIssueDescription(currentParentIssue.id, description);

          return {
            ...currentParentIssue,
            title: issueTitle,
            description
          };
        }
      })) ?? currentParentIssue
    );
  }

  if (input.resumeIssue) {
    return (
      (await safeLinearTask({
        enabled: true,
        options: input.options,
        errors: input.errors,
        message: `Failed to resolve the Linear resume issue '${input.resumeIssue}'`,
        task: async () => {
          const existingIssue = await input.linearClient.fetchIssue(input.resumeIssue!);
          if (!existingIssue) {
            throw new Error(`Linear issue '${input.resumeIssue}' was not found.`);
          }

          const description = buildManagedParentIssueDescription(existingIssue.description, {
            rawPrompt: input.rawPrompt,
            normalizedIntent: input.normalizedIntent,
            planningDepth: input.planningDepth
          });

          await input.linearClient.updateIssueTitle(existingIssue.id, issueTitle);
          await input.linearClient.updateIssueDescription(existingIssue.id, description);

          return {
            ...existingIssue,
            title: issueTitle,
            description
          };
        }
      })) ?? null
    );
  }

  if (!input.createIfMissing) {
    return null;
  }

  return (
    (await safeLinearTask({
      enabled: true,
      options: input.options,
      errors: input.errors,
      message: "Failed to create the Linear parent issue",
      task: async () =>
        await input.linearClient.createIssue({
          title: issueTitle,
          description: buildManagedParentIssueDescription(undefined, {
            rawPrompt: input.rawPrompt,
            normalizedIntent: input.normalizedIntent,
            planningDepth: input.planningDepth
          })
        })
    })) ?? null
  );
}

async function upsertLinearSourceIssues(input: {
  linearClient: LinearClientLike;
  options: RunIntentOptions;
  errors: string[];
  parentIssue: LinearIssueRef;
  normalizedIntent: NormalizedIntent;
  planningDepth: LinearPlanningDepth;
  sourceIssues: Record<string, LinearIssueRef>;
  loadReusableChildren: boolean;
}): Promise<void> {
  const reusableSourceIssues = input.loadReusableChildren
    ? (
        (await safeLinearTask({
          enabled: true,
          options: input.options,
          errors: input.errors,
          message: `Failed to list existing Linear child issues for '${input.parentIssue.identifier ?? input.parentIssue.id}'`,
          task: async () => await input.linearClient.listChildIssues(input.parentIssue.id)
        })) ?? []
      )
    : [];

  for (const sourcePlan of input.normalizedIntent.executionPlan.sources) {
    const existingSourceIssue = input.sourceIssues[sourcePlan.sourceId] ?? findReusableSourceIssue(reusableSourceIssues, sourcePlan.sourceId);
    const issueTitle = buildSourceIssueTitle(input.normalizedIntent, sourcePlan.sourceId);

    const sourceIssue = existingSourceIssue
      ? await safeLinearTask({
          enabled: true,
          options: input.options,
          errors: input.errors,
          message: `Failed to update the Linear source issue for ${sourcePlan.sourceId}`,
          details: { sourceId: sourcePlan.sourceId },
          task: async () => {
            const issueDescription = buildManagedSourceIssueDescription(existingSourceIssue.description, {
              normalizedIntent: input.normalizedIntent,
              sourceId: sourcePlan.sourceId,
              planningDepth: input.planningDepth
            });

            await input.linearClient.updateIssueTitle(existingSourceIssue.id, issueTitle);
            await input.linearClient.updateIssueDescription(existingSourceIssue.id, issueDescription);

            return {
              ...existingSourceIssue,
              title: issueTitle,
              description: issueDescription
            };
          }
        })
      : await safeLinearTask({
          enabled: true,
          options: input.options,
          errors: input.errors,
          message: `Failed to create the Linear source issue for ${sourcePlan.sourceId}`,
          details: { sourceId: sourcePlan.sourceId },
          task: async () =>
            await input.linearClient.createIssue({
              title: issueTitle,
              description: buildManagedSourceIssueDescription(undefined, {
                normalizedIntent: input.normalizedIntent,
                sourceId: sourcePlan.sourceId,
                planningDepth: input.planningDepth
              }),
              parentId: input.parentIssue.id
            })
        });

    if (sourceIssue) {
      input.sourceIssues[sourcePlan.sourceId] = sourceIssue;
      emitRunEvent(
        input.options,
        "linear",
        existingSourceIssue ? "Linear source issue updated." : "Linear source issue created.",
        {
          sourceId: sourcePlan.sourceId,
          identifier: sourceIssue.identifier,
          url: sourceIssue.url,
          parentId: input.parentIssue.id,
          planningDepth: input.planningDepth
        }
      );
    }
  }
}

async function executeSourceRun(input: ExecuteSourceRunInput): Promise<SourceRunResult> {
  let workspace: ResolvedSourceWorkspace | undefined;
  let captures: CaptureOutcome[] = [];
  let comparison: ComparisonSummary | undefined;
  let summaryMarkdown: string | undefined;
  let publishedSourcePath: string | undefined;
  let generatedPlaywrightTests: string[] = [];
  let attempts: SourceRunAttemptRecord[] = [];
  let appHandle: RunningAppHandle | null = null;
  const sourceErrors: string[] = [];

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

    const generatedSpecBundle = await writeGeneratedPlaywrightTests({
      workspace,
      normalizedIntent: input.normalizedIntent,
      sourceId: input.sourcePlan.sourceId
    });

    if (generatedSpecBundle) {
      generatedPlaywrightTests = generatedSpecBundle.files;
      emitRunEvent(input.options, "artifacts", "Tracked Playwright specs refreshed in source workspace.", {
        sourceId: input.sourcePlan.sourceId,
        outputDir: toRelativePath(input.runPaths.controllerRoot, generatedSpecBundle.outputDir),
        files: generatedSpecBundle.files.map((filePath) => toRelativePath(input.runPaths.controllerRoot, filePath))
      });
    }

    await safeLinearTask({
      enabled: Boolean(input.linearClient && input.parentIssue && input.config.linear.commentOnProgress),
      options: input.options,
      errors: input.linearErrors,
      message: `Failed to post Linear start comment for ${input.sourcePlan.sourceId}`,
      details: { sourceId: input.sourcePlan.sourceId },
      task: async () => {
        await input.linearClient!.createComment(
          input.parentIssue!.id,
          `Source lane started for '${input.sourcePlan.sourceId}' in the capture workflow.`
        );
      }
    });

    const implementationStage = resolveAgentStageConfig(input.agentConfig, "implementation");
    const qaVerificationStage = resolveAgentStageConfig(input.agentConfig, "qaVerification");
    const sourceWorkItems = sortWorkItemsForExecution(
      input.normalizedIntent.businessIntent.workItems.filter((workItem) => workItem.sourceIds.includes(input.sourcePlan.sourceId))
    );

    assertImplementationStageReady(implementationStage);

    if (implementationStage.enabled || qaVerificationStage.enabled) {
      const attemptLoop = await runSourceAttemptLoop<RunningAppHandle>({
        sourceId: input.sourcePlan.sourceId,
        workItems: sourceWorkItems,
        maxAttempts: implementationStage.enabled ? MAX_SOURCE_ATTEMPTS : 1,
        retryEnabled: implementationStage.enabled,
        executeAttempt: async ({ attemptNumber, activeWorkItemIds, completedWorkItemIds, remainingWorkItemIds }) => {
          let implementationResult = buildSkippedStageExecutionRecord(
            implementationStage.enabled
              ? "Implementation did not run."
              : "Implementation stage is disabled for this run."
          );

          if (implementationStage.enabled) {
            emitRunEvent(input.options, "implementation", "Implementation attempt started.", {
              sourceId: input.sourcePlan.sourceId,
              attemptNumber,
              model: implementationStage.model,
              provider: implementationStage.provider
            });

            try {
              implementationResult = await input.executeImplementationStage({
                config: input.config,
                stage: implementationStage,
                normalizedIntent: input.normalizedIntent,
                sourcePlan: input.sourcePlan,
                sourcePaths: input.sourcePaths,
                workspace: workspace!,
                generatedPlaywrightTests,
                attemptNumber,
                activeWorkItemIds,
                completedWorkItemIds,
                remainingWorkItemIds,
                options: input.options
              });
            } catch (error) {
              implementationResult = {
                status: "failed",
                summary: "Implementation executor threw before the source lane could continue.",
                error: captureErrorMessage(error),
                targetedWorkItemIds: activeWorkItemIds,
                completedWorkItemIds,
                remainingWorkItemIds,
                commands: [],
                fileOperations: []
              };
            }

            emitRunEvent(
              input.options,
              "implementation",
              implementationResult.status === "failed"
                ? "Implementation attempt failed."
                : implementationResult.status === "completed"
                  ? "Implementation attempt completed."
                  : "Implementation attempt skipped.",
              {
                sourceId: input.sourcePlan.sourceId,
                attemptNumber,
                status: implementationResult.status,
                summary: implementationResult.summary,
                error: implementationResult.error,
                targetedWorkItemIds: implementationResult.targetedWorkItemIds,
                completedWorkItemIds: implementationResult.completedWorkItemIds,
                remainingWorkItemIds: implementationResult.remainingWorkItemIds,
                fileOperations: implementationResult.fileOperations
              },
              implementationResult.status === "failed"
                ? "error"
                : implementationResult.status === "skipped"
                  ? "warn"
                  : "info"
            );
          }

          if (implementationResult.status === "failed") {
            return {
              targetedWorkItemIds: activeWorkItemIds,
              completedWorkItemIds,
              remainingWorkItemIds,
              implementation: implementationResult,
              qaVerification: buildProgressAwareStageRecord(
                buildSkippedStageExecutionRecord("QA verification was skipped because implementation did not complete successfully."),
                {
                  targetedWorkItemIds: activeWorkItemIds,
                  completedWorkItemIds,
                  remainingWorkItemIds
                }
              )
            };
          }

          let attemptAppHandle: RunningAppHandle | null = null;

          try {
            attemptAppHandle = await startReadySourceApp({
              config: input.config,
              workspace: workspace!,
              sourcePaths: input.sourcePaths,
              runPaths: input.runPaths,
              options: input.options,
              reason: qaVerificationStage.enabled ? "qa-verification" : "evidence-capture",
              attemptNumber
            });

            if (!qaVerificationStage.enabled) {
              return {
                targetedWorkItemIds: activeWorkItemIds,
                completedWorkItemIds: [...completedWorkItemIds, ...activeWorkItemIds],
                remainingWorkItemIds: remainingWorkItemIds.filter((workItemId) => !activeWorkItemIds.includes(workItemId)),
                implementation: implementationResult,
                qaVerification: buildProgressAwareStageRecord(
                  buildSkippedStageExecutionRecord("QA verification stage is disabled for this run."),
                  {
                    targetedWorkItemIds: activeWorkItemIds,
                    completedWorkItemIds: [...completedWorkItemIds, ...activeWorkItemIds],
                    remainingWorkItemIds: remainingWorkItemIds.filter((workItemId) => !activeWorkItemIds.includes(workItemId))
                  }
                ),
                resource: attemptAppHandle
              };
            }

            emitRunEvent(input.options, "qa-verification", "QA verification started.", {
              sourceId: input.sourcePlan.sourceId,
              attemptNumber,
              model: qaVerificationStage.model,
              provider: qaVerificationStage.provider,
              generatedPlaywrightSpecs: generatedPlaywrightTests.length
            });

            let qaVerificationResult: SourceStageExecutionRecord;

            try {
              qaVerificationResult = await input.executeQAVerificationStage({
                config: input.config,
                normalizedIntent: input.normalizedIntent,
                sourcePlan: input.sourcePlan,
                sourcePaths: input.sourcePaths,
                workspace: workspace!,
                generatedPlaywrightTests,
                implementationFileOperations: implementationResult.fileOperations,
                attemptNumber,
                activeWorkItemIds,
                completedWorkItemIds,
                remainingWorkItemIds,
                options: input.options
              });
            } catch (error) {
              qaVerificationResult = {
                status: "failed",
                summary: "QA verification threw before the source lane could continue.",
                error: captureErrorMessage(error),
                targetedWorkItemIds: activeWorkItemIds,
                completedWorkItemIds,
                remainingWorkItemIds,
                commands: [],
                fileOperations: []
              };
            }

            emitRunEvent(
              input.options,
              "qa-verification",
              qaVerificationResult.status === "failed"
                ? "QA verification failed."
                : qaVerificationResult.status === "completed"
                  ? "QA verification passed."
                  : "QA verification skipped.",
              {
                sourceId: input.sourcePlan.sourceId,
                attemptNumber,
                status: qaVerificationResult.status,
                summary: qaVerificationResult.summary,
                error: qaVerificationResult.error,
                targetedWorkItemIds: qaVerificationResult.targetedWorkItemIds,
                completedWorkItemIds: qaVerificationResult.completedWorkItemIds,
                remainingWorkItemIds: qaVerificationResult.remainingWorkItemIds,
                commands: qaVerificationResult.commands.map((command) => ({
                  label: command.label,
                  status: command.status,
                  logPath: toRelativePath(input.runPaths.controllerRoot, command.logPath)
                }))
              },
              qaVerificationResult.status === "failed"
                ? "error"
                : qaVerificationResult.status === "skipped"
                  ? "warn"
                  : "info"
            );

            if (qaVerificationResult.status === "completed") {
              return {
                targetedWorkItemIds: activeWorkItemIds,
                completedWorkItemIds: [...completedWorkItemIds, ...activeWorkItemIds],
                remainingWorkItemIds: remainingWorkItemIds.filter((workItemId) => !activeWorkItemIds.includes(workItemId)),
                implementation: implementationResult,
                qaVerification: qaVerificationResult,
                resource: attemptAppHandle
              };
            }

            await attemptAppHandle.stop();

            return {
              targetedWorkItemIds: activeWorkItemIds,
              completedWorkItemIds,
              remainingWorkItemIds,
              implementation: implementationResult,
              qaVerification: qaVerificationResult
            };
          } catch (error) {
            if (attemptAppHandle) {
              await attemptAppHandle.stop();
            }

            return {
              targetedWorkItemIds: activeWorkItemIds,
              completedWorkItemIds,
              remainingWorkItemIds,
              implementation: implementationResult,
              qaVerification: buildProgressAwareStageRecord({
                status: "failed",
                summary: "QA verification could not start because the source app never became ready.",
                error: captureErrorMessage(error),
                targetedWorkItemIds: [],
                completedWorkItemIds: [],
                remainingWorkItemIds: [],
                commands: [],
                fileOperations: []
              }, {
                targetedWorkItemIds: activeWorkItemIds,
                completedWorkItemIds,
                remainingWorkItemIds
              })
            };
          }
        },
        releaseResource: async (resource) => {
          await resource.stop();
        },
        onRetry: ({ attempt, nextAttemptNumber }) => {
          emitRunEvent(
            input.options,
            "run",
            "Retrying source lane after failed implementation or QA verification.",
            {
              sourceId: input.sourcePlan.sourceId,
              nextAttemptNumber,
              failedAttempt: attempt.attemptNumber,
              failureStage: attempt.failureStage,
              error:
                attempt.failureStage === "implementation"
                  ? attempt.implementation.error ?? attempt.implementation.summary
                  : attempt.qaVerification.error ?? attempt.qaVerification.summary
            },
            "warn"
          );
        }
      });

      attempts = attemptLoop.attempts;

      if (attemptLoop.status === "failed") {
        throw new Error(attemptLoop.error ?? `Implementation or QA verification failed for source '${input.sourcePlan.sourceId}'.`);
      }

      appHandle = attemptLoop.resource ?? null;
    }

    if (!appHandle) {
      appHandle = await startReadySourceApp({
        config: input.config,
        workspace,
        sourcePaths: input.sourcePaths,
        runPaths: input.runPaths,
        options: input.options,
        reason: "evidence-capture"
      });
    }

    const selectedCaptureItems = selectCaptureItems(
      workspace.source.capture.items,
      input.sourcePlan.captureScope.mode === "subset"
        ? input.sourcePlan.captureScope.captureIds
        : input.config.run.captureIds
    );

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

    if (input.sourcePlan.warnings.length > 0) {
      emitRunEvent(
        input.options,
        "capture",
        "Source plan preserved configured capture coverage.",
        {
          sourceId: input.sourcePlan.sourceId,
          captureScope: input.sourcePlan.captureScope,
          warnings: input.sourcePlan.warnings,
          captureCount: captures.length
        },
        "warn"
      );
    }

    if (captureResult.abortedDueToError) {
      sourceErrors.push("Capture run stopped early because continueOnCaptureError is disabled.");
    }

    if (input.config.sources[input.sourcePlan.sourceId]?.capture.publishToLibrary) {
      try {
        const libraryResult = await updateScreenshotLibrary({
          config: input.config,
          sourceId: input.sourcePlan.sourceId,
          runId: input.runPaths.runId,
          captures,
          normalizedIntent: input.normalizedIntent
        });

        emitRunEvent(input.options, "artifacts", "Screenshot library updated.", {
          sourceId: input.sourcePlan.sourceId,
          screenshotLibrary: toRelativePath(input.runPaths.controllerRoot, libraryResult.sourceLibraryRoot)
        });
      } catch (error) {
        sourceErrors.push(`Failed to update the screenshot library: ${captureErrorMessage(error)}`);
      }
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

    const status = sourceErrors.length > 0 ? "failed" : "completed";
    const error = sourceErrors.length > 0 ? sourceErrors.join(" ") : undefined;
    const completionCounts = comparison?.counts ?? emptyComparisonCounts();
    const latestAttempt = attempts.at(-1);

    await writeSourceEvidenceFiles({
      loadedConfig: { config: input.config, configPath: "", configDir: input.runPaths.controllerRoot },
      config: input.config,
      paths: input.sourcePaths,
      normalizedIntent: input.normalizedIntent,
      workspace,
      linearIssue: input.sourceIssue,
      captures,
      comparison,
      writeBaselineRecords: true,
      status,
      error,
      publishedSourcePath,
      generatedPlaywrightTests,
      attempts
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
      error,
      generatedPlaywrightTests,
      attempts
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
              `Attempts: ${attempts.length}`,
              `Latest runtime result: ${latestAttempt ? `${latestAttempt.status}${latestAttempt.failureStage ? ` (${latestAttempt.failureStage})` : ""}` : "not run"}`,
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
            `Attempts: ${attempts.length}`,
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
        hasDrift: comparison?.hasDrift ?? false,
        counts: comparison?.counts,
        attemptCount: attempts.length,
        latestFailureStage: latestAttempt?.failureStage,
        captureScope: input.sourcePlan.captureScope,
        sourceWarnings: input.sourcePlan.warnings,
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
      generatedPlaywrightTests,
      attempts,
      summaryMarkdown
    };
  } catch (error) {
    const errorMessage = captureErrorMessage(error);
    const latestAttempt = attempts.at(-1);

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
      publishedSourcePath,
      generatedPlaywrightTests,
      attempts
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
      error: errorMessage,
      generatedPlaywrightTests,
      attempts
    });

    await safeLinearTask({
      enabled: Boolean(input.linearClient && input.sourceIssue),
      options: input.options,
      errors: input.linearErrors,
      message: `Failed to update Linear failure state for ${input.sourcePlan.sourceId}`,
      details: { sourceId: input.sourcePlan.sourceId },
      task: async () => {
        if (input.config.linear.commentOnCompletion) {
          await input.linearClient!.createComment(
            input.sourceIssue!.id,
            [
              `Source lane failed: ${errorMessage}`,
              `Attempts: ${attempts.length}`,
              `Latest runtime result: ${latestAttempt ? `${latestAttempt.status}${latestAttempt.failureStage ? ` (${latestAttempt.failureStage})` : ""}` : "not run"}`
            ].join("\n")
          );
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
        await input.linearClient!.createComment(
          input.parentIssue!.id,
          [
            `Source lane failed for '${input.sourcePlan.sourceId}': ${errorMessage}`,
            `Attempts: ${attempts.length}`,
            `Latest runtime result: ${latestAttempt ? `${latestAttempt.status}${latestAttempt.failureStage ? ` (${latestAttempt.failureStage})` : ""}` : "not run"}`
          ].join("\n")
        );
      }
    });

    emitRunEvent(input.options, "run", "Source lane failed.", {
      sourceId: input.sourcePlan.sourceId,
      error: errorMessage,
      attemptCount: attempts.length,
      latestFailureStage: latestAttempt?.failureStage,
      captureScope: input.sourcePlan.captureScope,
      sourceWarnings: input.sourcePlan.warnings,
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
      generatedPlaywrightTests,
      attempts,
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
    executeImplementationStage: executeGeminiImplementationStage,
    executeQAVerificationStage: executeDefaultQAVerificationStage,
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
    const agent = applyAgentOverrides(config.agent, options.agentOverrides);
    const requestedSourceIds = options.sourceIds?.length ? Array.from(new Set(options.sourceIds)) : undefined;
    const rawPrompt = options.intent ?? config.run.intent;
    const resumeIssue = options.resumeIssue ?? config.run.resumeIssue;
    const dryRun = options.dryRun ?? config.run.dryRun;

    emitRunEvent(options, "config", "Configuration loaded.", {
      configPath: loadedConfig.configPath,
      defaultSourceId: config.run.sourceId,
      linearEnabled: config.linear.enabled,
      sourceCount: Object.keys(config.sources).length,
      requestedSourceIds,
      agentOverrides: options.agentOverrides,
      resumeIssue
    });

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
      resumeIssue
    });

    const shouldManageLinearPlan = Boolean(linearClient && (config.linear.createIssueOnStart || resumeIssue));
    let scopingIntent: NormalizedIntent | null = null;

    if (linearClient && shouldManageLinearPlan) {
      scopingIntent = await dependencies.normalizeIntent({
        rawPrompt,
        defaultSourceId: config.run.sourceId,
        continueOnCaptureError: config.run.continueOnCaptureError,
        agent,
        requestedSourceIds,
        resumeIssue,
        linearEnabled: config.linear.enabled,
        publishToSourceWorkspace: config.artifacts.storageMode === "both" && Boolean(config.artifacts.copyToSourcePath),
        availableSources,
        planningDepth: "scoping"
      });

      emitRunEvent(options, "linear", "Linear scoping prepared.", {
        sourceIds: scopingIntent.executionPlan.sources.map((sourcePlan) => sourcePlan.sourceId),
        summary: scopingIntent.summary
      });

      linearPublication.parentIssue = await upsertLinearParentIssue({
        linearClient,
        options,
        errors: linearErrors,
        rawPrompt,
        normalizedIntent: scopingIntent,
        planningDepth: "scoping",
        existingParentIssue: linearPublication.parentIssue,
        resumeIssue,
        createIfMissing: Boolean(!resumeIssue && config.linear.createIssueOnStart)
      });

      if (resumeIssue && !linearPublication.parentIssue) {
        throw new Error(`Configured resume issue '${resumeIssue}' could not be resolved in Linear.`);
      }

      if (linearPublication.parentIssue) {
        emitRunEvent(options, "linear", "Linear parent issue scoped.", {
          identifier: linearPublication.parentIssue.identifier,
          url: linearPublication.parentIssue.url,
          planningDepth: "scoping"
        });

        await upsertLinearSourceIssues({
          linearClient,
          options,
          errors: linearErrors,
          parentIssue: linearPublication.parentIssue,
          normalizedIntent: scopingIntent,
          planningDepth: "scoping",
          sourceIssues: linearPublication.sourceIssues,
          loadReusableChildren: Boolean(resumeIssue)
        });
      }
    }

    const normalizedIntent = await dependencies.normalizeIntent({
      rawPrompt,
      defaultSourceId: config.run.sourceId,
      continueOnCaptureError: config.run.continueOnCaptureError,
      agent,
      requestedSourceIds,
      resumeIssue,
      linearEnabled: config.linear.enabled,
      publishToSourceWorkspace: config.artifacts.storageMode === "both" && Boolean(config.artifacts.copyToSourcePath),
      availableSources
    });

    if (linearClient && shouldManageLinearPlan && scopingIntent) {
      const scopedSourceIds = scopingIntent.executionPlan.sources.map((sourcePlan) => sourcePlan.sourceId);
      const plannedSourceIds = normalizedIntent.executionPlan.sources.map((sourcePlan) => sourcePlan.sourceId);
      const addedSourceIds = plannedSourceIds.filter((sourceId) => !scopedSourceIds.includes(sourceId));
      const removedSourceIds = scopedSourceIds.filter((sourceId) => !plannedSourceIds.includes(sourceId));

      if (addedSourceIds.length > 0 || removedSourceIds.length > 0) {
        for (const sourceId of removedSourceIds) {
          delete linearPublication.sourceIssues[sourceId];
        }

        emitRunEvent(
          options,
          "linear",
          "Detailed planning changed the scoped Linear source lanes.",
          {
            addedSourceIds,
            removedSourceIds,
            note: "Removed lanes remain in Linear, but they are not part of this run's final plan."
          },
          "warn"
        );
      }

      if (linearPublication.parentIssue) {
        linearPublication.parentIssue = await upsertLinearParentIssue({
          linearClient,
          options,
          errors: linearErrors,
          rawPrompt,
          normalizedIntent,
          planningDepth: "full",
          existingParentIssue: linearPublication.parentIssue,
          createIfMissing: false
        });

        if (linearPublication.parentIssue) {
          await upsertLinearSourceIssues({
            linearClient,
            options,
            errors: linearErrors,
            parentIssue: linearPublication.parentIssue,
            normalizedIntent,
            planningDepth: "full",
            sourceIssues: linearPublication.sourceIssues,
            loadReusableChildren: false
          });
        }
      }
    }

    const sourceIds = normalizedIntent.executionPlan.sources.map((sourcePlan) => sourcePlan.sourceId);
    const paths = await dependencies.createRunPaths(loadedConfig, sourceIds);
    await dependencies.writeJsonFile(paths.normalizedIntentPath, normalizedIntent);

    emitRunEvent(options, "intent", "Intent normalized.", {
      rawPrompt,
      summary: normalizedIntent.summary,
      sourceId: normalizedIntent.executionPlan.primarySourceId,
      sourceIds,
      requestedSourceIds,
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

    if (linearClient && shouldManageLinearPlan) {
      await dependencies.writeJsonFile(paths.linearPath, linearPublication);
    }

    if (dryRun) {
      const sourceRuns: SourceRunResult[] = sourceIds.map((currentSourceId) => ({
        sourceId: currentSourceId,
        status: "planned",
        paths: paths.sourceRuns[currentSourceId],
        captures: [],
        attempts: [],
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
        normalizedIntentPath: toRelativePath(paths.controllerRoot, paths.normalizedIntentPath),
        planLifecyclePath: toRelativePath(paths.controllerRoot, paths.planLifecyclePath)
      });

      log.info("Dry run complete.", {
        sourceId: normalizedIntent.executionPlan.primarySourceId,
        sourceIds,
        normalizedIntentPath: toRelativePath(paths.controllerRoot, paths.normalizedIntentPath),
        planLifecyclePath: toRelativePath(paths.controllerRoot, paths.planLifecyclePath)
      });

      await dependencies.retainRecentRuns(config.artifacts.runRoot, config.artifacts.retainRuns);
      return {
        status: "completed",
        sourceId: normalizedIntent.executionPlan.primarySourceId,
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
        agentConfig: agent,
        normalizedIntent,
        sourcePlan,
        runPaths: paths,
        sourcePaths: paths.sourceRuns[sourcePlan.sourceId],
        options,
        linearClient,
        parentIssue: linearPublication.parentIssue,
        sourceIssue: linearPublication.sourceIssues[sourcePlan.sourceId] ?? null,
        linearErrors,
        executeImplementationStage: dependencies.executeImplementationStage,
        executeQAVerificationStage: dependencies.executeQAVerificationStage
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