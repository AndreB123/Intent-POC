import path from "node:path";
import { promises as fs } from "node:fs";
import ts from "typescript";
import type { ExecuteImplementationStageInput } from "../orchestrator/run-intent";
import { resolveGeminiApiKey } from "../intent/gemini-client";
import { TDDWorkItem } from "../intent/intent-types";
import { pathExists, writeTextFile } from "../shared/fs";
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
import { formatCompactUiStateList } from "../intent/ui-state-requirements";

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

function buildImplementationSummary(
  fileOperations: SourceStageFileOperationRecord[],
  uiStateRequirements: ExecuteImplementationStageInput["sourcePlan"]["uiStateRequirements"] = []
): string {
  const uiStateSummary =
    uiStateRequirements.length > 0
      ? ` Requested UI states for downstream verification: ${formatCompactUiStateList(uiStateRequirements)}.`
      : "";

  if (fileOperations.length === 0) {
    return `No source file changes were required for this attempt.${uiStateSummary}`;
  }

  const counts = fileOperations.reduce(
    (result, fileOperation) => {
      result[fileOperation.operation] += 1;
      return result;
    },
    { create: 0, replace: 0, delete: 0 }
  );

  return `Applied ${fileOperations.length} file operation${fileOperations.length === 1 ? "" : "s"} (${counts.create} create, ${counts.replace} replace, ${counts.delete} delete).${uiStateSummary}`;
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

function inferScriptKind(filePath: string): ts.ScriptKind | undefined {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".js":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return undefined;
  }
}

function collectSyntacticDiagnostics(filePath: string, content: string): readonly ts.Diagnostic[] {
  const scriptKind = inferScriptKind(filePath);
  if (!scriptKind) {
    return [];
  }

  const extension = path.extname(filePath).toLowerCase();
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext
  };

  if (extension === ".tsx" || extension === ".jsx") {
    compilerOptions.jsx = ts.JsxEmit.Preserve;
  }

  return ts.transpileModule(content, {
    fileName: filePath,
    compilerOptions,
    reportDiagnostics: true
  }).diagnostics ?? [];
}

function tryRepairUnterminatedTemplateLiteral(filePath: string, content: string, diagnostics: readonly ts.Diagnostic[]): string {
  if (!diagnostics.some((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").includes("Unterminated template literal"))) {
    return content;
  }

  if ((content.match(/`/g) ?? []).length % 2 === 0 || !content.includes("return `")) {
    return content;
  }

  const trailingQuoteMatch = /(["'])\s*;\s*(\}\s*)?$/.exec(content);
  if (!trailingQuoteMatch || trailingQuoteMatch.index === undefined) {
    return content;
  }

  const repairedContent = `${content.slice(0, trailingQuoteMatch.index)}\`${content.slice(trailingQuoteMatch.index + 1)}`;
  const repairedDiagnostics = collectSyntacticDiagnostics(filePath, repairedContent);

  return repairedDiagnostics.length === 0 ? repairedContent : content;
}

function sanitizeMaterializedFiles(files: Array<{ filePath: string; content: string }>): Array<{ filePath: string; content: string }> {
  return files.map((file) => {
    const scriptKind = inferScriptKind(file.filePath);
    if (!scriptKind) {
      return file;
    }

    const diagnostics = collectSyntacticDiagnostics(file.filePath, file.content);
    if (diagnostics.length === 0) {
      return file;
    }

    const repairedContent = tryRepairUnterminatedTemplateLiteral(file.filePath, file.content, diagnostics);
    return repairedContent === file.content ? file : { ...file, content: repairedContent };
  });
}

function validateMaterializedFiles(files: Array<{ filePath: string; content: string }>): void {
  for (const file of files) {
    const diagnostics = collectSyntacticDiagnostics(file.filePath, file.content);
    if (diagnostics.length === 0) {
      continue;
    }

    const diagnostic = diagnostics[0];
    const sourceFile = ts.createSourceFile(file.filePath, file.content, ts.ScriptTarget.Latest, false, inferScriptKind(file.filePath));
    const position = diagnostic.start === undefined ? undefined : sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
    const line = position ? position.line + 1 : 1;
    const character = position ? position.character + 1 : 1;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

    throw new Error(`Implementation generated invalid ${path.extname(file.filePath) || "source"} content for ${file.filePath}:${line}:${character} - ${message}`);
  }
}

function extractRequiredElementIds(workItems: TDDWorkItem[]): string[] {
  const ids = new Set<string>();

  for (const workItem of workItems) {
    for (const spec of workItem.playwright.specs) {
      for (const checkpoint of spec.checkpoints) {
        for (const selector of [checkpoint.target, checkpoint.locator, checkpoint.waitForSelector]) {
          if (selector && /^#[A-Za-z][A-Za-z0-9_-]*$/.test(selector)) {
            ids.add(selector.slice(1));
          }
        }
      }
    }
  }

  return Array.from(ids).sort();
}

function extractRequiredDataTestIds(workItems: TDDWorkItem[]): string[] {
  const testIds = new Set<string>();

  for (const workItem of workItems) {
    for (const spec of workItem.playwright.specs) {
      for (const checkpoint of spec.checkpoints) {
        for (const selector of [checkpoint.target, checkpoint.locator, checkpoint.waitForSelector]) {
          if (!selector) {
            continue;
          }

          for (const match of selector.matchAll(/\[data-testid=(['"])([^'"]+)\1\]/g)) {
            testIds.add(match[2]);
          }
        }
      }
    }
  }

  return Array.from(testIds).sort();
}

function includesAttributeValue(content: string, attributeName: string, value: string): boolean {
  return new RegExp(`${attributeName}=("|')${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`).test(content);
}

function validateRequiredSelectorsRetained(input: {
  operations: Array<{ operation: "create" | "replace" | "delete"; filePath: string }>;
  existingFiles: ImplementationExistingFileContext[];
  materializedFiles: Array<{ filePath: string; content: string }>;
  requiredElementIds: string[];
  requiredDataTestIds: string[];
}): void {
  if (input.requiredElementIds.length === 0 && input.requiredDataTestIds.length === 0) {
    return;
  }

  const replacePaths = new Set(
    input.operations.filter((operation) => operation.operation === "replace").map((operation) => operation.filePath)
  );
  const existingFileMap = new Map(input.existingFiles.map((file) => [file.filePath, file.content]));
  const materializedFileMap = new Map(input.materializedFiles.map((file) => [file.filePath, file.content]));

  for (const filePath of replacePaths) {
    const existingContent = existingFileMap.get(filePath);
    const nextContent = materializedFileMap.get(filePath);
    if (!existingContent || !nextContent) {
      continue;
    }

    const droppedIds = input.requiredElementIds.filter(
      (id) => existingContent.includes(`id="${id}"`) && !nextContent.includes(`id="${id}"`)
    );
    const droppedDataTestIds = input.requiredDataTestIds.filter(
      (testId) => includesAttributeValue(existingContent, "data-testid", testId) && !includesAttributeValue(nextContent, "data-testid", testId)
    );

    if (droppedIds.length > 0) {
      throw new Error(
        `Implementation removed required selector ids from ${filePath}: ${droppedIds.map((id) => `#${id}`).join(", ")}`
      );
    }

    if (droppedDataTestIds.length > 0) {
      throw new Error(
        `Implementation removed required selector test ids from ${filePath}: ${droppedDataTestIds.map((testId) => `[data-testid='${testId}']`).join(", ")}`
      );
    }
  }
}

async function validatePlannedOperations(input: {
  operations: Array<{ operation: "create" | "replace" | "delete"; filePath: string }>;
  workspaceRoot: string;
  workspaceFiles: Array<{ relativePath: string }>;
  generatedSpecs: Array<{ relativePath: string }>;
  generatedSpecOutputRoot?: string;
}): Promise<void> {
  const existingPaths = new Set(input.workspaceFiles.map((file) => file.relativePath));
  const generatedSpecPaths = new Set(input.generatedSpecs.map((file) => file.relativePath));
  const generatedSpecOutputRoot = normalizeRelativeRoot(input.generatedSpecOutputRoot);

  for (const operation of input.operations) {
    if (generatedSpecPaths.has(operation.filePath)) {
      throw new Error(`Implementation cannot modify tracked Playwright verification specs during the source lane: ${operation.filePath}`);
    }

    if (generatedSpecOutputRoot && isWithinRelativeRoot(operation.filePath, generatedSpecOutputRoot)) {
      throw new Error(
        `Implementation cannot target the tracked Playwright verification root during implementation: ${operation.filePath}. Update application/source files instead.`
      );
    }

    const testFileKind = getTestFileKind(operation.filePath);
    if (testFileKind && !isApprovedCheckedInTestPath(operation.filePath, testFileKind)) {
      throw new Error(
        `Implementation cannot ${describeTestOperation(operation.operation)} ad hoc ${testFileKind} files outside approved checked-in test roots: ${operation.filePath}. Update application/source files instead.`
      );
    }

    const fileExists = existingPaths.has(operation.filePath)
      ? true
      : await pathExists(path.join(input.workspaceRoot, operation.filePath));

    if (operation.operation === "create" && fileExists) {
      throw new Error(`Implementation planned to create an existing file: ${operation.filePath}`);
    }

    if (operation.operation !== "create" && !fileExists) {
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
    const sourceWorkItems = input.normalizedIntent.businessIntent.workItems.filter((workItem) =>
      workItem.sourceIds.includes(input.sourcePlan.sourceId)
    );
    const activeWorkItems = sourceWorkItems.filter((workItem) => input.activeWorkItemIds.includes(workItem.id));
    const backlogWorkItems = sourceWorkItems.filter(
      (workItem) => input.remainingWorkItemIds.includes(workItem.id) && !input.activeWorkItemIds.includes(workItem.id)
    );
    const requiredElementIds = extractRequiredElementIds(activeWorkItems);
    const requiredDataTestIds = extractRequiredDataTestIds(activeWorkItems);
    const relevantFiles = await activeDependencies.collectRelevantFiles({
      rootDir: input.workspace.rootDir,
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
    const context = buildImplementationPromptContext({
      rawPrompt: input.normalizedIntent.rawPrompt,
      summary: input.normalizedIntent.summary,
      sourceId: input.sourcePlan.sourceId,
      codeSurface: input.normalizedIntent.codeSurface,
      desiredOutcome: input.normalizedIntent.businessIntent.desiredOutcome,
      acceptanceCriteria: input.normalizedIntent.businessIntent.acceptanceCriteria.map((criterion) => criterion.description),
      sourceUiStateRequirements: input.sourcePlan.uiStateRequirements,
      scenarios,
      activeWorkItems,
      backlogWorkItems,
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

    await validatePlannedOperations({
      operations: plannedChangeSet.operations,
      workspaceRoot: input.workspace.rootDir,
      workspaceFiles,
      generatedSpecs,
      generatedSpecOutputRoot: input.workspace.source.testing.playwright.outputDir
    });

    if (plannedChangeSet.operations.length === 0) {
      return {
        status: activeWorkItems.length === 0 ? "completed" : "failed",
        summary:
          activeWorkItems.length === 0
            ? "No source file changes were required for this attempt."
            : "Implementation planned no source file changes even though active work items remain.",
        error:
          activeWorkItems.length === 0
            ? undefined
            : `Implementation planned zero operations for active work items: ${activeWorkItems.map((workItem) => workItem.id).join(", ")}`,
        targetedWorkItemIds: input.activeWorkItemIds,
        completedWorkItemIds: input.completedWorkItemIds,
        remainingWorkItemIds: input.remainingWorkItemIds,
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

    materializedChangeSet.files = sanitizeMaterializedFiles(materializedChangeSet.files);
    validateMaterializedFiles(materializedChangeSet.files);
    validateRequiredSelectorsRetained({
      operations: plannedChangeSet.operations,
      existingFiles,
      materializedFiles: materializedChangeSet.files,
      requiredElementIds,
      requiredDataTestIds
    });

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
      summary: buildImplementationSummary(fileOperations, input.sourcePlan.uiStateRequirements),
      targetedWorkItemIds: input.activeWorkItemIds,
      completedWorkItemIds: [...input.completedWorkItemIds, ...input.activeWorkItemIds],
      remainingWorkItemIds: input.remainingWorkItemIds.filter((workItemId) => !input.activeWorkItemIds.includes(workItemId)),
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
      targetedWorkItemIds: input.activeWorkItemIds,
      completedWorkItemIds: input.completedWorkItemIds,
      remainingWorkItemIds: input.remainingWorkItemIds,
      commands,
      fileOperations
    };
  }
}