import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ResolvedAgentStageConfig } from "../intent/agent-stage-config";
import { CodeSurfaceSelection, getCodeSurfaceImplementationHints } from "../intent/code-surface";
import { BDDScenario, TDDWorkItem } from "../intent/intent-types";
import { createGeminiClient } from "../intent/gemini-client";

const IMPLEMENTATION_OPERATION_TYPES = ["create", "replace", "delete"] as const;

export type ImplementationOperationType = (typeof IMPLEMENTATION_OPERATION_TYPES)[number];

export interface ImplementationWorkspaceFileDescriptor {
  relativePath: string;
  bytes: number;
  lineCount: number;
}

export interface ImplementationPackageContext {
  scripts: Record<string, string>;
}

export interface ImplementationGeneratedSpecContext {
  relativePath: string;
  content: string;
}

export interface ImplementationRelevantFileContext {
  relativePath: string;
  content: string;
  reason: string;
}

export interface ImplementationScenarioContext {
  title: string;
  goal: string;
  given: string[];
  when: string[];
  then: string[];
}

export interface ImplementationWorkItemContext {
  id: string;
  title: string;
  description: string;
  verification: string;
  userVisibleOutcome: string;
  order: number;
  dependsOnWorkItemIds: string[];
  scenarioIds: string[];
  verificationNotes: string[];
}

export interface ImplementationPromptContext {
  rawPrompt: string;
  summary: string;
  sourceId: string;
  codeSurface?: {
    id: string;
    label: string;
    confidence: string;
    rationale: string;
    primaryPathPrefixes: string[];
    adjacentPathPrefixes: string[];
    avoidPathPrefixes: string[];
  };
  desiredOutcome: string;
  acceptanceCriteria: string[];
  scenarios: ImplementationScenarioContext[];
  activeWorkItems: ImplementationWorkItemContext[];
  backlogWorkItems: ImplementationWorkItemContext[];
  workspaceFiles: ImplementationWorkspaceFileDescriptor[];
  generatedSpecs: ImplementationGeneratedSpecContext[];
  relevantFiles: ImplementationRelevantFileContext[];
  packageContext: ImplementationPackageContext;
}

export interface ImplementationChangeOperation {
  operation: ImplementationOperationType;
  filePath: string;
  rationale: string;
}

export interface PlannedImplementationChangeSet {
  operations: ImplementationChangeOperation[];
  warnings: string[];
}

export interface ImplementationExistingFileContext {
  filePath: string;
  content: string;
}

export interface MaterializedImplementationFile {
  filePath: string;
  content: string;
}

export interface MaterializedImplementationChangeSet {
  files: MaterializedImplementationFile[];
  warnings: string[];
}

export interface GenerateStructuredGeminiContentInput {
  stage: ResolvedAgentStageConfig;
  prompt: string;
  responseJsonSchema: Record<string, unknown>;
}

export interface GenerateImplementationContentDependencies {
  generateStructuredGeminiContent: (input: GenerateStructuredGeminiContentInput) => Promise<string>;
  readFile: typeof fs.readFile;
}

const planOperationSchema = z.object({
  operation: z.enum(IMPLEMENTATION_OPERATION_TYPES),
  filePath: z.string().min(1),
  rationale: z.string().min(1)
});

const plannedImplementationChangeSetSchema = z.object({
  operations: z.array(planOperationSchema).max(12),
  warnings: z.array(z.string().min(1)).optional()
});

const plannedImplementationResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operations: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          operation: {
            type: "string",
            enum: [...IMPLEMENTATION_OPERATION_TYPES]
          },
          filePath: { type: "string" },
          rationale: { type: "string" }
        },
        required: ["operation", "filePath", "rationale"]
      }
    },
    warnings: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["operations"]
} as const;

const materializedFileSchema = z.object({
  filePath: z.string().min(1),
  content: z.string()
});

const materializedImplementationChangeSetSchema = z.object({
  files: z.array(materializedFileSchema).max(12),
  warnings: z.array(z.string().min(1)).optional()
});

const materializedImplementationResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    files: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          filePath: { type: "string" },
          content: { type: "string" }
        },
        required: ["filePath", "content"]
      }
    },
    warnings: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["files"]
} as const;

const INCLUDED_SOURCE_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".md",
  ".yaml",
  ".yml",
  ".txt"
]);

const INCLUDED_SOURCE_FILE_NAMES = new Set(["package.json", "tsconfig.json", "vite.config.ts", "next.config.js"]);
const EXCLUDED_WORKSPACE_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".next",
  ".turbo",
  ".workdirs",
  "artifacts",
  "coverage",
  "dist",
  "build",
  "evidence",
  "node_modules"
]);
const MAX_WORKSPACE_FILE_COUNT = 200;
const MAX_FILE_BYTES = 64_000;
const MAX_RELEVANT_FILE_COUNT = 6;
const MAX_RELEVANT_FILE_CHARACTERS = 5_000;
const RELEVANT_FILE_STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "build",
  "change",
  "changes",
  "compare",
  "create",
  "current",
  "dashboard",
  "default",
  "drift",
  "ensure",
  "evidence",
  "files",
  "intent",
  "implementation",
  "library",
  "planned",
  "prompt",
  "requested",
  "runner",
  "source",
  "stage",
  "stages",
  "tests",
  "that",
  "this",
  "through",
  "users",
  "with"
]);

function dedupeStrings(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0)));
}

function normalizeRelativeFilePath(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error("Implementation file paths cannot be blank.");
  }

  if (path.isAbsolute(trimmed)) {
    throw new Error(`Implementation file paths must be workspace-relative: ${trimmed}`);
  }

  const normalized = path.normalize(trimmed);
  if (normalized === "." || normalized === path.sep || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Implementation file paths cannot escape the workspace root: ${trimmed}`);
  }

  return normalized.split(path.sep).join("/");
}

function sanitizeOperations(operations: ImplementationChangeOperation[]): ImplementationChangeOperation[] {
  const seen = new Set<string>();
  const sanitized: ImplementationChangeOperation[] = [];

  for (const operation of operations) {
    const filePath = normalizeRelativeFilePath(operation.filePath);
    if (seen.has(filePath)) {
      throw new Error(`Implementation returned duplicate file operations for '${filePath}'.`);
    }

    seen.add(filePath);
    sanitized.push({
      operation: operation.operation,
      filePath,
      rationale: operation.rationale.trim()
    });
  }

  return sanitized;
}

function sanitizeMaterializedFiles(
  files: MaterializedImplementationFile[],
  expectedFilePaths: Set<string>
): MaterializedImplementationFile[] {
  const seen = new Set<string>();
  const sanitized: MaterializedImplementationFile[] = [];

  for (const file of files) {
    const filePath = normalizeRelativeFilePath(file.filePath);
    if (!expectedFilePaths.has(filePath)) {
      throw new Error(`Implementation materialization returned an unexpected file path: ${filePath}`);
    }

    if (seen.has(filePath)) {
      throw new Error(`Implementation materialization returned duplicate content for '${filePath}'.`);
    }

    seen.add(filePath);
    sanitized.push({
      filePath,
      content: file.content
    });
  }

  if (sanitized.length !== expectedFilePaths.size) {
    const missing = Array.from(expectedFilePaths).filter((filePath) => !seen.has(filePath));
    throw new Error(`Implementation materialization did not return all required files: ${missing.join(", ")}`);
  }

  return sanitized.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function buildScenarioContext(scenarios: BDDScenario[]): ImplementationScenarioContext[] {
  return scenarios.map((scenario) => ({
    title: scenario.title,
    goal: scenario.goal,
    given: scenario.given,
    when: scenario.when,
    then: scenario.then
  }));
}

function buildVerificationNotes(workItem: TDDWorkItem): string[] {
  return workItem.playwright.specs.map(
    (spec) =>
      `${spec.framework} coverage \"${spec.suiteName}\" / \"${spec.testName}\" is controller-owned and read-only during implementation.`
  );
}

function buildWorkItemContext(workItems: TDDWorkItem[]): ImplementationWorkItemContext[] {
  return workItems.map((workItem) => ({
    id: workItem.id,
    title: workItem.title,
    description: workItem.description,
    verification: workItem.verification,
    userVisibleOutcome: workItem.userVisibleOutcome,
    order: workItem.execution.order,
    dependsOnWorkItemIds: workItem.execution.dependsOnWorkItemIds,
    scenarioIds: workItem.scenarioIds,
    verificationNotes: buildVerificationNotes(workItem)
  }));
}

function shouldIncludeWorkspaceFile(filePath: string): boolean {
  const fileName = path.basename(filePath);
  if (INCLUDED_SOURCE_FILE_NAMES.has(fileName)) {
    return true;
  }

  return INCLUDED_SOURCE_FILE_EXTENSIONS.has(path.extname(filePath));
}

async function collectWorkspaceFilesRecursive(
  rootDir: string,
  currentDir: string,
  collected: ImplementationWorkspaceFileDescriptor[]
): Promise<void> {
  if (collected.length >= MAX_WORKSPACE_FILE_COUNT) {
    return;
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (collected.length >= MAX_WORKSPACE_FILE_COUNT) {
      return;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath);
    const normalizedRelativePath = relativePath.split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (EXCLUDED_WORKSPACE_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await collectWorkspaceFilesRecursive(rootDir, absolutePath, collected);
      continue;
    }

    if (!entry.isFile() || !shouldIncludeWorkspaceFile(normalizedRelativePath)) {
      continue;
    }

    const stats = await fs.stat(absolutePath);
    if (stats.size > MAX_FILE_BYTES) {
      continue;
    }

    const content = await fs.readFile(absolutePath, "utf8");
    collected.push({
      relativePath: normalizedRelativePath,
      bytes: stats.size,
      lineCount: content.split(/\r?\n/).length
    });
  }
}

export async function collectImplementationWorkspaceFiles(rootDir: string): Promise<ImplementationWorkspaceFileDescriptor[]> {
  const collected: ImplementationWorkspaceFileDescriptor[] = [];
  await collectWorkspaceFilesRecursive(rootDir, rootDir, collected);
  return collected.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function readGeneratedSpecContexts(input: {
  rootDir: string;
  generatedPlaywrightTests: string[];
  readFile?: typeof fs.readFile;
}): Promise<ImplementationGeneratedSpecContext[]> {
  const readFile = input.readFile ?? fs.readFile;

  return await Promise.all(
    input.generatedPlaywrightTests
      .map((filePath) => path.resolve(filePath))
      .sort((left, right) => left.localeCompare(right))
      .map(async (absolutePath) => ({
        relativePath: path.relative(input.rootDir, absolutePath).split(path.sep).join("/"),
        content: await readFile(absolutePath, "utf8")
      }))
  );
}

export async function readWorkspacePackageContext(input: {
  rootDir: string;
  readFile?: typeof fs.readFile;
}): Promise<ImplementationPackageContext> {
  const readFile = input.readFile ?? fs.readFile;
  const packageJsonPath = path.join(input.rootDir, "package.json");

  try {
    const content = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> };
    const scripts = Object.fromEntries(
      Object.entries(parsed.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );

    return { scripts };
  } catch {
    return { scripts: {} };
  }
}

function tokenizeRelevantFileTerms(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/g))
        .map((value) => value.trim())
        .filter((value) => value.length >= 4 && !RELEVANT_FILE_STOP_WORDS.has(value))
    )
  ).slice(0, 32);
}

function truncateRelevantFileContent(content: string): string {
  if (content.length <= MAX_RELEVANT_FILE_CHARACTERS) {
    return content;
  }

  return `${content.slice(0, MAX_RELEVANT_FILE_CHARACTERS)}\n/* truncated for prompt context */`;
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

function isPreferredImplementationSourcePath(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  return normalizedPath.startsWith("src/") && !getTestFileKind(normalizedPath);
}

function matchesAnyPathPrefix(relativePath: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => relativePath.startsWith(prefix.toLowerCase()));
}

function scoreRelevantFile(input: {
  relativePath: string;
  content: string;
  keywords: string[];
  codeSurface?: CodeSurfaceSelection;
}): { score: number; matchedKeywords: string[] } {
  const relativePath = input.relativePath.toLowerCase();
  const content = input.content.toLowerCase();
  const testFileKind = getTestFileKind(relativePath);
  const matchedKeywords: string[] = [];
  let score = 0;
  const surfaceHints = input.codeSurface ? getCodeSurfaceImplementationHints(input.codeSurface.id) : undefined;

  if (relativePath.startsWith("src/demo-app/") && !testFileKind) {
    score += 8;
  } else if (relativePath.startsWith("src/") && !testFileKind) {
    score += 5;
  } else if (relativePath.startsWith("src/")) {
    score += 2;
  }

  if (/(render|page|view|component|route|screen|layout|app)/.test(relativePath)) {
    score += 3;
  }

  if (surfaceHints) {
    if (matchesAnyPathPrefix(relativePath, surfaceHints.primaryPathPrefixes)) {
      score += 24;
      matchedKeywords.push(`surface:${input.codeSurface?.id}:primary`);
    }

    if (matchesAnyPathPrefix(relativePath, surfaceHints.adjacentPathPrefixes)) {
      score += 10;
      matchedKeywords.push(`surface:${input.codeSurface?.id}:adjacent`);
    }

    if (matchesAnyPathPrefix(relativePath, surfaceHints.avoidPathPrefixes)) {
      score -= 12;
      matchedKeywords.push(`surface:${input.codeSurface?.id}:avoid`);
    }
  }

  for (const keyword of input.keywords) {
    let matched = false;

    if (relativePath.includes(keyword)) {
      score += 5;
      matched = true;
    }

    if (content.includes(keyword)) {
      score += 3;
      matched = true;
    }

    if (matched) {
      matchedKeywords.push(keyword);
    }
  }

  return {
    score,
    matchedKeywords: Array.from(new Set(matchedKeywords)).slice(0, 6)
  };
}

export async function collectRelevantImplementationFiles(input: {
  rootDir: string;
  rawPrompt: string;
  summary: string;
  sourceId: string;
  codeSurface?: CodeSurfaceSelection;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  scenarios: BDDScenario[];
  workItems: TDDWorkItem[];
  workspaceFiles: ImplementationWorkspaceFileDescriptor[];
  generatedSpecs: ImplementationGeneratedSpecContext[];
  readFile?: typeof fs.readFile;
}): Promise<ImplementationRelevantFileContext[]> {
  const readFile = input.readFile ?? fs.readFile;
  const generatedSpecPaths = new Set(input.generatedSpecs.map((spec) => spec.relativePath));
  const surfaceHints = input.codeSurface ? getCodeSurfaceImplementationHints(input.codeSurface.id) : undefined;
  const keywords = tokenizeRelevantFileTerms([
    input.rawPrompt,
    input.summary,
    input.desiredOutcome,
    ...(surfaceHints?.keywords ?? []),
    ...input.acceptanceCriteria,
    ...input.scenarios.flatMap((scenario) => [scenario.title, scenario.goal, ...scenario.given, ...scenario.when, ...scenario.then]),
    ...input.workItems.flatMap((workItem) => [
      workItem.title,
      workItem.description,
      workItem.userVisibleOutcome,
      workItem.verification
    ])
  ]);

  const scoredFiles = await Promise.all(
    input.workspaceFiles
      .filter((descriptor) => !generatedSpecPaths.has(descriptor.relativePath))
      .map(async (descriptor) => {
        const absolutePath = path.join(input.rootDir, descriptor.relativePath);
        const content = await readFile(absolutePath, "utf8");
        const score = scoreRelevantFile({
          relativePath: descriptor.relativePath,
          content,
          keywords,
          codeSurface: input.codeSurface
        });

        return {
          relativePath: descriptor.relativePath,
          content,
          score: score.score,
          matchedKeywords: score.matchedKeywords
        };
      })
  );

  const relevantFiles = scoredFiles
    .filter((file) => file.score > 0)
    .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));
  const preferredSourceFiles = relevantFiles.filter((file) => isPreferredImplementationSourcePath(file.relativePath));
  const selectedFiles = preferredSourceFiles.length > 0 ? preferredSourceFiles : relevantFiles;

  return selectedFiles
    .slice(0, MAX_RELEVANT_FILE_COUNT)
    .map((file) => ({
      relativePath: file.relativePath,
      content: truncateRelevantFileContent(file.content),
      reason:
        file.matchedKeywords.length > 0
          ? `Matched prompt, plan, and surface terms: ${file.matchedKeywords.join(", ")}`
          : "Likely source entrypoint for the requested behavior."
    }));
}

function buildPlanningPrompt(input: ImplementationPromptContext): string {
  return [
    "You are selecting the minimal bounded file operations needed to implement one source lane for an intent-driven development runner.",
    "Return only JSON that matches the provided schema.",
    "Use only these operations: create, replace, delete.",
    "All file paths must be relative to the workspace root.",
    "Modify application or source files to satisfy the requested behavior.",
    "Prefer existing source files under src/ and src/demo-app/ when they are relevant.",
    "Do not target .git, node_modules, artifacts, evidence, or generated Playwright output files.",
    "Generated Playwright specs are controller-owned read-only verification inputs. Do not modify them or use them as edit targets.",
    "Do not create ad hoc .spec or .test files to satisfy implementation work. Source changes are the default expected outcome.",
    "Prefer the smallest change set that should satisfy the planned work and QA bundle.",
    "If no source changes are needed, return an empty operations array.",
    `Source id: ${input.sourceId}`,
    ...(input.codeSurface
      ? [
          `Code surface: ${input.codeSurface.label} (${input.codeSurface.id}, confidence: ${input.codeSurface.confidence})`,
          `Code surface rationale: ${input.codeSurface.rationale}`,
          "Primary surface paths:",
          JSON.stringify(input.codeSurface.primaryPathPrefixes, null, 2),
          "Adjacent surface paths:",
          JSON.stringify(input.codeSurface.adjacentPathPrefixes, null, 2),
          "Avoid unrelated surface paths unless the change clearly requires them:",
          JSON.stringify(input.codeSurface.avoidPathPrefixes, null, 2)
        ]
      : []),
    `Intent summary: ${input.summary}`,
    `Desired outcome: ${input.desiredOutcome}`,
    "Acceptance criteria:",
    JSON.stringify(input.acceptanceCriteria, null, 2),
    "Relevant scenarios:",
    JSON.stringify(input.scenarios, null, 2),
    "Active work items to implement in this pass:",
    JSON.stringify(input.activeWorkItems, null, 2),
    "Remaining backlog work items for context only. Do not claim the source is complete based on backlog items unless they are in the active set:",
    JSON.stringify(input.backlogWorkItems, null, 2),
    "Package scripts:",
    JSON.stringify(input.packageContext, null, 2),
    "Generated Playwright specs (read-only verification inputs):",
    JSON.stringify(
      input.generatedSpecs.map((spec) => ({
        relativePath: spec.relativePath,
        usage: "Controller-owned verification input. Do not modify or copy as a target file."
      })),
      null,
      2
    ),
    "Relevant existing source files:",
    JSON.stringify(input.relevantFiles, null, 2),
    "Workspace file manifest:",
    JSON.stringify(input.workspaceFiles, null, 2),
    "Original user prompt:",
    input.rawPrompt
  ].join("\n\n");
}

function buildMaterializationPrompt(input: {
  context: ImplementationPromptContext;
  operations: ImplementationChangeOperation[];
  existingFiles: ImplementationExistingFileContext[];
}): string {
  return [
    "You are materializing full file contents for a bounded implementation change set.",
    "Return only JSON that matches the provided schema.",
    "Generate full file contents for every create or replace operation.",
    "Do not emit patch hunks. Return the complete file text for each file.",
    "Keep changes minimal and aligned with the planned work and generated Playwright specs.",
    `Source id: ${input.context.sourceId}`,
    `Intent summary: ${input.context.summary}`,
    "Selected file operations:",
    JSON.stringify(input.operations, null, 2),
    "Existing file contents for replace targets:",
    JSON.stringify(input.existingFiles, null, 2),
    "Relevant existing source files:",
    JSON.stringify(input.context.relevantFiles, null, 2),
    "Generated Playwright specs:",
    JSON.stringify(input.context.generatedSpecs, null, 2),
    "Active work items for this pass:",
    JSON.stringify(input.context.activeWorkItems, null, 2),
    "Remaining backlog work items:",
    JSON.stringify(input.context.backlogWorkItems, null, 2)
  ].join("\n\n");
}

async function generateStructuredGeminiContentDefault(
  input: GenerateStructuredGeminiContentInput
): Promise<string> {
  const ai = createGeminiClient({
    apiKeyEnv: input.stage.apiKeyEnv,
    apiVersion: input.stage.apiVersion
  });
  const response = await ai.models.generateContent({
    model: input.stage.model,
    contents: input.prompt,
    config: {
      temperature: input.stage.temperature,
      maxOutputTokens: input.stage.maxTokens,
      responseMimeType: "application/json",
      responseJsonSchema: input.responseJsonSchema
    }
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini implementation generation returned an empty response.");
  }

  return text;
}

function parseJson<T>(text: string, schema: z.ZodType<T>, errorPrefix: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${errorPrefix} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  return schema.parse(parsed);
}

export function buildImplementationPromptContext(input: {
  rawPrompt: string;
  summary: string;
  sourceId: string;
  codeSurface?: CodeSurfaceSelection;
  desiredOutcome: string;
  acceptanceCriteria: string[];
  scenarios: BDDScenario[];
  activeWorkItems: TDDWorkItem[];
  backlogWorkItems: TDDWorkItem[];
  workspaceFiles: ImplementationWorkspaceFileDescriptor[];
  generatedSpecs: ImplementationGeneratedSpecContext[];
  relevantFiles: ImplementationRelevantFileContext[];
  packageContext: ImplementationPackageContext;
}): ImplementationPromptContext {
  const surfaceHints = input.codeSurface ? getCodeSurfaceImplementationHints(input.codeSurface.id) : undefined;

  return {
    rawPrompt: input.rawPrompt,
    summary: input.summary,
    sourceId: input.sourceId,
    codeSurface: input.codeSurface
      ? {
          id: input.codeSurface.id,
          label: input.codeSurface.label,
          confidence: input.codeSurface.confidence,
          rationale: input.codeSurface.rationale,
          primaryPathPrefixes: surfaceHints?.primaryPathPrefixes ?? [],
          adjacentPathPrefixes: surfaceHints?.adjacentPathPrefixes ?? [],
          avoidPathPrefixes: surfaceHints?.avoidPathPrefixes ?? []
        }
      : undefined,
    desiredOutcome: input.desiredOutcome,
    acceptanceCriteria: input.acceptanceCriteria,
    scenarios: buildScenarioContext(input.scenarios),
    activeWorkItems: buildWorkItemContext(input.activeWorkItems),
    backlogWorkItems: buildWorkItemContext(input.backlogWorkItems),
    workspaceFiles: input.workspaceFiles,
    generatedSpecs: input.generatedSpecs,
    relevantFiles: input.relevantFiles,
    packageContext: input.packageContext
  };
}

export async function planImplementationChanges(
  input: {
    stage: ResolvedAgentStageConfig;
    context: ImplementationPromptContext;
  },
  dependencies: Partial<GenerateImplementationContentDependencies> = {}
): Promise<PlannedImplementationChangeSet> {
  const generateStructuredGeminiContent =
    dependencies.generateStructuredGeminiContent ?? generateStructuredGeminiContentDefault;

  const text = await generateStructuredGeminiContent({
    stage: input.stage,
    prompt: buildPlanningPrompt(input.context),
    responseJsonSchema: plannedImplementationResponseJsonSchema
  });
  const parsed = parseJson(text, plannedImplementationChangeSetSchema, "Gemini implementation planning");

  return {
    operations: sanitizeOperations(parsed.operations),
    warnings: dedupeStrings(parsed.warnings)
  };
}

export async function materializeImplementationChanges(
  input: {
    stage: ResolvedAgentStageConfig;
    context: ImplementationPromptContext;
    operations: ImplementationChangeOperation[];
    existingFiles: ImplementationExistingFileContext[];
  },
  dependencies: Partial<GenerateImplementationContentDependencies> = {}
): Promise<MaterializedImplementationChangeSet> {
  const generateStructuredGeminiContent =
    dependencies.generateStructuredGeminiContent ?? generateStructuredGeminiContentDefault;

  const materializedTargets = new Set(
    input.operations.filter((operation) => operation.operation !== "delete").map((operation) => operation.filePath)
  );

  if (materializedTargets.size === 0) {
    return {
      files: [],
      warnings: []
    };
  }

  const text = await generateStructuredGeminiContent({
    stage: input.stage,
    prompt: buildMaterializationPrompt(input),
    responseJsonSchema: materializedImplementationResponseJsonSchema
  });
  const parsed = parseJson(text, materializedImplementationChangeSetSchema, "Gemini implementation materialization");

  return {
    files: sanitizeMaterializedFiles(parsed.files, materializedTargets),
    warnings: dedupeStrings(parsed.warnings)
  };
}