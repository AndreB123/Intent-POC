import path from "node:path";
import { promises as fs } from "node:fs";
import { AppConfig, RunMode } from "../config/schema";
import { CaptureOutcome } from "../capture/capture-target";
import { ComparisonSummary } from "../compare/run-comparison";
import { NormalizedIntent } from "../intent/intent-types";
import { copyFile, ensureDirectory, writeJsonFile } from "../shared/fs";

export interface ScreenshotLibraryResult {
  libraryRoot: string;
  sourceLibraryRoot: string;
}

export type ScreenshotLibraryUpdateMode = Exclude<RunMode, "compare">;

export function isScreenshotLibraryUpdateMode(mode: RunMode): mode is ScreenshotLibraryUpdateMode {
  return mode === "baseline" || mode === "approve-baseline";
}

export async function updateScreenshotLibrary(input: {
  config: AppConfig;
  sourceId: string;
  runId: string;
  mode: ScreenshotLibraryUpdateMode;
  captures: CaptureOutcome[];
  comparison: ComparisonSummary;
  normalizedIntent: NormalizedIntent;
}): Promise<ScreenshotLibraryResult> {
  if (!isScreenshotLibraryUpdateMode(input.mode)) {
    throw new Error(`Screenshot library updates are only supported for baseline runs, received '${input.mode}'.`);
  }

  const sourceLibraryRoot = path.join(input.config.artifacts.libraryRoot, input.sourceId);

  await ensureDirectory(sourceLibraryRoot);

  for (const capture of input.captures) {
    if (capture.status !== "captured") {
      continue;
    }

    const relativePath = capture.relativeOutputPath ?? `${capture.captureId}.png`;
    const destinationPath = path.join(sourceLibraryRoot, relativePath);
    await ensureDirectory(path.dirname(destinationPath));
    await copyFile(capture.outputPath, destinationPath);
  }

  await writeJsonFile(path.join(sourceLibraryRoot, "manifest.json"), {
    runId: input.runId,
    sourceId: input.sourceId,
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    intentSummary: input.normalizedIntent.summary,
    captureCount: input.captures.filter((c) => c.status === "captured").length,
    hasDrift: input.comparison.hasDrift,
    comparisonSummary: {
      counts: input.comparison.counts,
      itemCount: input.comparison.items.length
    }
  });

  return {
    libraryRoot: input.config.artifacts.libraryRoot,
    sourceLibraryRoot
  };
}

export async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(dirPath: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      output.push(fullPath);
    }
  }

  if (!(await fs
    .access(rootDir)
    .then(() => true)
    .catch(() => false))) {
    return [];
  }

  await walk(rootDir);
  return output.sort();
}