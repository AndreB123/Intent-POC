import { promises as fs } from "node:fs";
import path from "node:path";
import { writeTextFile } from "../shared/fs";
import { SourceStageFileOperationRecord } from "../evidence/write-manifest";
import {
  ImplementationChangeOperation,
  MaterializedImplementationFile
} from "./gemini-code-generator";

export interface ApplyImplementationChangeSetInput {
  rootDir: string;
  operations: ImplementationChangeOperation[];
  materializedFiles: MaterializedImplementationFile[];
  forbiddenAbsolutePaths: string[];
}

function normalizeWorkspaceRelativePath(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error("Implementation file paths cannot be blank.");
  }

  if (path.isAbsolute(trimmed)) {
    throw new Error(`Implementation file paths must be relative to the workspace root: ${trimmed}`);
  }

  const normalized = path.normalize(trimmed);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Implementation file paths cannot escape the workspace root: ${trimmed}`);
  }

  return normalized.split(path.sep).join("/");
}

function resolveWorkspacePath(rootDir: string, relativePath: string): string {
  const absolutePath = path.resolve(rootDir, relativePath);
  const normalizedRoot = path.resolve(rootDir);

  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Implementation target path escapes the workspace root: ${relativePath}`);
  }

  return absolutePath;
}

function isForbiddenPath(targetPath: string, forbiddenAbsolutePaths: string[]): boolean {
  return forbiddenAbsolutePaths.some((forbiddenPath) => {
    const normalizedForbiddenPath = path.resolve(forbiddenPath);
    return targetPath === normalizedForbiddenPath || targetPath.startsWith(`${normalizedForbiddenPath}${path.sep}`);
  });
}

export async function applyImplementationChangeSet(
  input: ApplyImplementationChangeSetInput
): Promise<SourceStageFileOperationRecord[]> {
  const normalizedOperations = input.operations.map((operation) => ({
    ...operation,
    filePath: normalizeWorkspaceRelativePath(operation.filePath)
  }));
  const materializedFileMap = new Map(
    input.materializedFiles.map((file) => [normalizeWorkspaceRelativePath(file.filePath), file.content])
  );

  const preparedOperations = await Promise.all(
    normalizedOperations.map(async (operation) => {
      const absolutePath = resolveWorkspacePath(input.rootDir, operation.filePath);
      if (isForbiddenPath(absolutePath, input.forbiddenAbsolutePaths)) {
        throw new Error(`Implementation attempted to write a forbidden path: ${operation.filePath}`);
      }

      const existingStats = await fs.stat(absolutePath).catch(() => undefined);
      const existing = Boolean(existingStats);
      if (operation.operation === "create" && existing) {
        throw new Error(`Implementation attempted to create an existing file: ${operation.filePath}`);
      }

      if ((operation.operation === "replace" || operation.operation === "delete") && !existing) {
        throw new Error(`Implementation attempted to ${operation.operation} a missing file: ${operation.filePath}`);
      }

      if ((operation.operation === "replace" || operation.operation === "delete") && existingStats && !existingStats.isFile()) {
        throw new Error(`Implementation attempted to ${operation.operation} a non-file path: ${operation.filePath}`);
      }

      if (operation.operation !== "delete" && !materializedFileMap.has(operation.filePath)) {
        throw new Error(`Implementation did not provide content for ${operation.operation} '${operation.filePath}'.`);
      }

      return {
        operation,
        absolutePath
      };
    })
  );

  const fileOperations: SourceStageFileOperationRecord[] = [];

  for (const prepared of preparedOperations) {
    const { operation, absolutePath } = prepared;

    if (operation.operation === "delete") {
      await fs.unlink(absolutePath);
    } else {
      await writeTextFile(absolutePath, materializedFileMap.get(operation.filePath) ?? "");
    }

    fileOperations.push({
      operation: operation.operation,
      filePath: operation.filePath,
      rationale: operation.rationale,
      status: "applied"
    });
  }

  return fileOperations;
}