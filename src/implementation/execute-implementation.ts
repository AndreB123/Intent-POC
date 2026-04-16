import path from "node:path";
import { promises as fs } from "node:fs";
import type { ExecuteImplementationStageInput } from "../orchestrator/run-intent";
import { resolveGeminiApiKey } from "../intent/gemini-client";
import { writeTextFile } from "../shared/fs";
import {
  SourceStageCommandRecord,
  SourceStageExecutionRecord,
  SourceStageFileOperationRecord
} from "../evidence/write-manifest";
import { emitImplementationEvent } from "./implementation-events";
import {
  buildImplementationPromptContext,
  collectRelevantImplementationFiles,
  collectImplementationWorkspaceFiles,
  ImplementationExistingFileContext,
  planImplementationChanges,
  materializeImplementationChanges,
  readGeneratedSpecContexts,
  readWorkspacePackageContext
} from "./gemini-code-generator";
import { applyImplementationChangeSet } from "./apply-changes";

function captureErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ExecuteImplementationStageDependencies {
  collectWorkspaceFiles: typeof collectImplementationWorkspaceFiles;
  collectRelevantFiles: typeof collectRelevantImplementationFiles;
  readGeneratedSpecs: typeof readGeneratedSpecContexts;
  readPackageContext: typeof readWorkspacePackageContext;
  planChanges: typeof planImplementationChanges;
  materializeChanges: typeof materializeImplementationChanges;
  applyChangeSet: typeof applyImplementationChangeSet;
}

function createDefaultDependencies(): ExecuteImplementationStageDependencies {
  return {
    collectWorkspaceFiles: collectImplementationWorkspaceFiles,
    collectRelevantFiles: collectRelevantImplementationFiles,
    readGeneratedSpecs: readGeneratedSpecContexts,
    readPackageContext: readWorkspacePackageContext,
    planChanges: planImplementationChanges,
    materializeChanges: materializeImplementationChanges,
    applyChangeSet: applyImplementationChangeSet
  };
}

function buildCommandRecord(input: {
  label: string;
  command: string;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "failed";
  logPath?: string;
  error?: string;
}): SourceStageCommandRecord {
  return {
    label: input.label,
    command: input.command,
    cwd: input.cwd,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Date.parse(input.finishedAt) - Date.parse(input.startedAt),
    status: input.status,
    error: input.error,
    logPath: input.logPath
  };
}

async function writeAttemptLog(input: {
  sourcePaths: ExecuteImplementationStageInput["sourcePaths"];
  attemptNumber: number;
  label: string;
  value: unknown;
}): Promise<string> {
  const logPath = path.join(
    input.sourcePaths.attemptsDir,
    `attempt-${input.attemptNumber}-implementation-${input.label}.json`
  );
  await writeTextFile(logPath, `${JSON.stringify(input.value, null, 2)}\n`);
  return logPath;
}

function buildRelevantExistingFiles(
  workspaceRoot: string,
  operations: Array<{ operation: string; filePath: string }>
): Promise<ImplementationExistingFileContext[]> {
  return Promise.all(
    operations
      .filter((operation) => operation.operation === "replace")
      .map(async (operation) => ({
        filePath: operation.filePath,
        content: await fs.readFile(path.join(workspaceRoot, operation.filePath), "utf8")
      }))
  );
}

function buildForbiddenAbsolutePaths(input: ExecuteImplementationStageInput): string[] {
  const forbiddenRoots = [
    path.join(input.workspace.rootDir, ".git"),
    path.join(input.workspace.rootDir, "node_modules"),
    path.join(input.workspace.rootDir, "artifacts"),
    path.join(input.workspace.rootDir, "evidence")
  ];

  if (input.workspace.source.testing.playwright.outputDir) {
    forbiddenRoots.push(path.resolve(input.workspace.rootDir, input.workspace.source.testing.playwright.outputDir));
  }

  return forbiddenRoots;
}

function buildImplementationSummary(fileOperations: SourceStageFileOperationRecord[]): string {
  if (fileOperations.length === 0) {
    return "No source file changes were required for this attempt.";
  }

  const counts = fileOperations.reduce(
    (result, fileOperation) => {
      result[fileOperation.operation] += 1;
      return result;
    },
    { create: 0, replace: 0, delete: 0 }
  );

  return `Applied ${fileOperations.length} file operation${fileOperations.length === 1 ? "" : "s"} (${counts.create} create, ${counts.replace} replace, ${counts.delete} delete).`;
}

function getTestFileKind(filePath: string): "test" | "spec" | undefined {
  const normalizedPath = filePath.toLowerCase();
  if (/\.test\.[a-z0-9]+$/.test(normalizedPath)) {
    return "test";
  }

  if (/\.spec\.[a-z0-9]+$/.test(normalizedPath)) {
    return "spec";
  }

  return undefined;
}

function normalizeRelativeRoot(rootPath: string | undefined): string | undefined {
  if (!rootPath) {
    return undefined;
  }

  const normalized = path.normalize(rootPath).split(path.sep).join("/").replace(/\/+$/, "");
  if (!normalized || normalized === ".") {
    return undefined;
  }

  return normalized;
}

function isWithinRelativeRoot(filePath: string, rootPath: string): boolean {
  return filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

function isApprovedCheckedInTestPath(filePath: string, testFileKind: "test" | "spec"): boolean {
  const normalizedPath = filePath.toLowerCase();
  const inNamedTestDirectory =
    normalizedPath.startsWith("__tests__/") || normalizedPath.includes("/__tests__/");

  if (inNamedTestDirectory) {
    return true;
  }

  if (normalizedPath.startsWith("tests/") || normalizedPath.startsWith("test/")) {
    return true;
  }

  return testFileKind === "test" && normalizedPath.startsWith("src/");
}

function describeTestOperation(operation: "create" | "replace" | "delete"): string {
  if (operation === "create") {
    return "create";
  }

  if (operation === "delete") {
    return "delete";
  }

  return "modify";
}

function validatePlannedOperations(input: {
  operations: Array<{ operation: "create" | "replace" | "delete"; filePath: string }>;
  workspaceFiles: Array<{ relativePath: string }>;
  generatedSpecs: Array<{ relativePath: string }>;
  generatedSpecOutputRoot?: string;
}): void {
  const existingPaths = new Set(input.workspaceFiles.map((file) => file.relativePath));
  const generatedSpecPaths = new Set(input.generatedSpecs.map((file) => file.relativePath));
  const generatedSpecOutputRoot = normalizeRelativeRoot(input.generatedSpecOutputRoot);

  for (const operation of input.operations) {
    if (generatedSpecPaths.has(operation.filePath)) {
      throw new Error(`Implementation cannot modify generated Playwright specs: ${operation.filePath}`);
    }

    if (generatedSpecOutputRoot && isWithinRelativeRoot(operation.filePath, generatedSpecOutputRoot)) {
      throw new Error(
        `Implementation cannot target the controller-owned generated Playwright output root: ${operation.filePath}. Update application/source files instead.`
      );
    }

    const testFileKind = getTestFileKind(operation.filePath);
    if (testFileKind && !isApprovedCheckedInTestPath(operation.filePath, testFileKind)) {
      throw new Error(
        `Implementation cannot ${describeTestOperation(operation.operation)} ad hoc ${testFileKind} files outside approved checked-in test roots: ${operation.filePath}. Update application/source files instead.`
      );
    }

    if (operation.operation === "create" && existingPaths.has(operation.filePath)) {
      throw new Error(`Implementation planned to create an existing file: ${operation.filePath}`);
    }

    if (operation.operation !== "create" && !existingPaths.has(operation.filePath)) {
      throw new Error(`Implementation planned to ${operation.operation} a file that does not exist: ${operation.filePath}`);
    }
  }
}

function assertImplementationStageSupported(input: ExecuteImplementationStageInput): void {
  if (!input.stage.provider) {
    throw new Error("Implementation stage requires an explicit provider when the stage is enabled.");
  }

  if (input.stage.provider !== "gemini") {
    throw new Error(`Implementation stage provider '${input.stage.provider}' is not supported. Supported providers: gemini.`);
  }

  resolveGeminiApiKey({ apiKeyEnv: input.stage.apiKeyEnv });
}

export async function executeImplementationStage(
  input: ExecuteImplementationStageInput,
  dependencies: Partial<ExecuteImplementationStageDependencies> = {}
): Promise<SourceStageExecutionRecord> {
  const activeDependencies = {
    ...createDefaultDependencies(),
    ...dependencies
  };
  const commands: SourceStageCommandRecord[] = [];
  let fileOperations: SourceStageFileOperationRecord[] = [];

  try {
    assertImplementationStageSupported(input);

    emitImplementationEvent(input, "Collecting workspace context for implementation.");
    const workspaceFiles = await activeDependencies.collectWorkspaceFiles(input.workspace.rootDir);
    const generatedSpecs = await activeDependencies.readGeneratedSpecs({
      rootDir: input.workspace.rootDir,
      generatedPlaywrightTests: input.generatedPlaywrightTests
    });
    const packageContext = await activeDependencies.readPackageContext({
      rootDir: input.workspace.rootDir
    });
    const scenarios = input.normalizedIntent.businessIntent.scenarios.filter((scenario) =>
      scenario.applicableSourceIds.includes(input.sourcePlan.sourceId)
    );
    const workItems = input.normalizedIntent.businessIntent.workItems.filter((workItem) =>
      workItem.sourceIds.includes(input.sourcePlan.sourceId)
    );
    const relevantFiles = await activeDependencies.collectRelevantFiles({
      rootDir: input.workspace.rootDir,
      rawPrompt: input.normalizedIntent.rawPrompt,
      summary: input.normalizedIntent.summary,
      sourceId: input.sourcePlan.sourceId,
      desiredOutcome: input.normalizedIntent.businessIntent.desiredOutcome,
      acceptanceCriteria: input.normalizedIntent.businessIntent.acceptanceCriteria.map((criterion) => criterion.description),
      scenarios,
      workItems,
      workspaceFiles,
      generatedSpecs
    });
    const context = buildImplementationPromptContext({
      rawPrompt: input.normalizedIntent.rawPrompt,
      summary: input.normalizedIntent.summary,
      sourceId: input.sourcePlan.sourceId,
      desiredOutcome: input.normalizedIntent.businessIntent.desiredOutcome,
      acceptanceCriteria: input.normalizedIntent.businessIntent.acceptanceCriteria.map((criterion) => criterion.description),
      scenarios,
      workItems,
      workspaceFiles,
      generatedSpecs,
      relevantFiles,
      packageContext
    });

    const planningStartedAt = new Date().toISOString();
    const plannedChangeSet = await activeDependencies.planChanges({
      stage: input.stage,
      context
    });
    const planningFinishedAt = new Date().toISOString();
    const planningLogPath = await writeAttemptLog({
      sourcePaths: input.sourcePaths,
      attemptNumber: input.attemptNumber,
      label: "plan",
      value: {
        context,
        plannedChangeSet
      }
    });
    commands.push(
      buildCommandRecord({
        label: "plan-change-set",
        command: "gemini:plan-implementation-change-set",
        cwd: input.workspace.rootDir,
        startedAt: planningStartedAt,
        finishedAt: planningFinishedAt,
        status: "completed",
        logPath: planningLogPath
      })
    );

    emitImplementationEvent(input, "Implementation change set planned.", {
      operationCount: plannedChangeSet.operations.length,
      warnings: plannedChangeSet.warnings
    });

    validatePlannedOperations({
      operations: plannedChangeSet.operations,
      workspaceFiles,
      generatedSpecs,
      generatedSpecOutputRoot: input.workspace.source.testing.playwright.outputDir
    });

    if (plannedChangeSet.operations.length === 0) {
      return {
        status: "completed",
        summary: "No source file changes were required for this attempt.",
        commands,
        fileOperations: []
      };
    }

    const existingFiles = await buildRelevantExistingFiles(input.workspace.rootDir, plannedChangeSet.operations);
    const materializationStartedAt = new Date().toISOString();
    const materializedChangeSet = await activeDependencies.materializeChanges({
      stage: input.stage,
      context,
      operations: plannedChangeSet.operations,
      existingFiles
    });
    const materializationFinishedAt = new Date().toISOString();
    const materializationLogPath = await writeAttemptLog({
      sourcePaths: input.sourcePaths,
      attemptNumber: input.attemptNumber,
      label: "materialize",
      value: {
        operations: plannedChangeSet.operations,
        existingFiles,
        materializedChangeSet
      }
    });
    commands.push(
      buildCommandRecord({
        label: "materialize-change-set",
        command: "gemini:materialize-implementation-files",
        cwd: input.workspace.rootDir,
        startedAt: materializationStartedAt,
        finishedAt: materializationFinishedAt,
        status: "completed",
        logPath: materializationLogPath
      })
    );

    const applyStartedAt = new Date().toISOString();
    fileOperations = await activeDependencies.applyChangeSet({
      rootDir: input.workspace.rootDir,
      operations: plannedChangeSet.operations,
      materializedFiles: materializedChangeSet.files,
      forbiddenAbsolutePaths: buildForbiddenAbsolutePaths(input)
    });
    const applyFinishedAt = new Date().toISOString();
    const applyLogPath = await writeAttemptLog({
      sourcePaths: input.sourcePaths,
      attemptNumber: input.attemptNumber,
      label: "apply",
      value: {
        operations: plannedChangeSet.operations,
        appliedFileOperations: fileOperations
      }
    });
    commands.push(
      buildCommandRecord({
        label: "apply-change-set",
        command: "apply:implementation-change-set",
        cwd: input.workspace.rootDir,
        startedAt: applyStartedAt,
        finishedAt: applyFinishedAt,
        status: "completed",
        logPath: applyLogPath
      })
    );

    emitImplementationEvent(input, "Implementation change set applied.", {
      fileOperationCount: fileOperations.length,
      fileOperations
    });

    return {
      status: "completed",
      summary: buildImplementationSummary(fileOperations),
      commands,
      fileOperations
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failedAt = new Date().toISOString();
    const failureLogPath = await writeAttemptLog({
      sourcePaths: input.sourcePaths,
      attemptNumber: input.attemptNumber,
      label: "failure",
      value: {
        error: errorMessage,
        fileOperations
      }
    });
    commands.push(
      buildCommandRecord({
        label: "implementation-failure",
        command: "implementation:failed",
        cwd: input.workspace.rootDir,
        startedAt: failedAt,
        finishedAt: failedAt,
        status: "failed",
        error: errorMessage,
        logPath: failureLogPath
      })
    );

    emitImplementationEvent(input, "Implementation attempt failed.", {
      error: errorMessage
    }, "error");

    return {
      status: "failed",
      summary: "Implementation could not produce a valid bounded change set.",
      error: errorMessage,
      commands,
      fileOperations
    };
  }
}