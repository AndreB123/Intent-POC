import path from "node:path";
import { promises as fs } from "node:fs";
import { AppConfig } from "../config/schema";
import { CaptureOutcome } from "../capture/capture-target";
import { ComparisonSummary } from "../compare/run-comparison";
import { NormalizedIntent } from "../intent/intent-types";
import { copyFile, ensureDirectory, removeDirectory, writeJsonFile } from "../shared/fs";

export interface ScreenshotLibraryResult {
  libraryRoot: string;
  sourceLibraryRoot: string;
  baselineImagesDir: string;
  latestImagesDir: string;
  latestDiffsDir: string;
}

export async function updateScreenshotLibrary(input: {
  config: AppConfig;
  sourceId: string;
  runId: string;
  mode: AppConfig["run"]["mode"];
  captures: CaptureOutcome[];
  comparison: ComparisonSummary;
  normalizedIntent: NormalizedIntent;
}): Promise<ScreenshotLibraryResult> {
  const sourceLibraryRoot = path.join(input.config.artifacts.libraryRoot, input.sourceId);
  const baselineImagesDir = path.join(sourceLibraryRoot, "baseline", "images");
  const latestImagesDir = path.join(sourceLibraryRoot, "latest", "images");
  const latestDiffsDir = path.join(sourceLibraryRoot, "latest", "diffs");

  await ensureDirectory(sourceLibraryRoot);
  if (input.mode === "baseline" || input.mode === "approve-baseline") {
    await removeDirectory(baselineImagesDir);
  }
  await ensureDirectory(baselineImagesDir);
  await removeDirectory(latestImagesDir);
  await removeDirectory(latestDiffsDir);
  await ensureDirectory(latestImagesDir);
  await ensureDirectory(latestDiffsDir);

  for (const capture of input.captures) {
    if (capture.status !== "captured") {
      continue;
    }

    const latestPath = path.join(latestImagesDir, `${capture.captureId}.png`);
    await copyFile(capture.outputPath, latestPath);

    if (input.mode === "baseline" || input.mode === "approve-baseline") {
      const baselinePath = path.join(baselineImagesDir, `${capture.captureId}.png`);
      await copyFile(capture.outputPath, baselinePath);
    }
  }

  for (const item of input.comparison.items) {
    if (!item.diffImagePath || item.status !== "changed") {
      continue;
    }

    const destination = path.join(latestDiffsDir, `${item.captureId}.png`);
    await copyFile(item.diffImagePath, destination);
  }

  const latestManifestPath = path.join(sourceLibraryRoot, "latest", "manifest.json");
  const latestHashesPath = path.join(sourceLibraryRoot, "latest", "hashes.json");
  const latestComparisonPath = path.join(sourceLibraryRoot, "latest", "comparison.json");

  const hashItems = input.captures
    .filter((capture) => capture.status === "captured" && capture.hash)
    .map((capture) => ({
      captureId: capture.captureId,
      relativePath: path.join("latest", "images", `${capture.captureId}.png`),
      sha256: capture.hash
    }));

  await writeJsonFile(latestManifestPath, {
    runId: input.runId,
    sourceId: input.sourceId,
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    intentSummary: input.normalizedIntent.summary,
    captures: input.captures,
    comparison: input.comparison
  });

  await writeJsonFile(latestHashesPath, {
    algorithm: "sha256",
    generatedAt: new Date().toISOString(),
    items: hashItems
  });

  await writeJsonFile(latestComparisonPath, {
    runId: input.runId,
    sourceId: input.sourceId,
    mode: input.mode,
    hasDrift: input.comparison.hasDrift,
    counts: input.comparison.counts,
    items: input.comparison.items.map((item) => ({
      ...item,
      diffImagePath:
        item.status === "changed" && item.diffImagePath
          ? path.join("latest", "diffs", `${item.captureId}.png`)
          : undefined
    }))
  });

  if (input.mode === "baseline" || input.mode === "approve-baseline") {
    const baselineManifestPath = path.join(sourceLibraryRoot, "baseline", "manifest.json");
    const baselineHashesPath = path.join(sourceLibraryRoot, "baseline", "hashes.json");

    await writeJsonFile(baselineManifestPath, {
      runId: input.runId,
      sourceId: input.sourceId,
      generatedAt: new Date().toISOString(),
      mode: input.mode,
      captures: input.captures
    });

    await writeJsonFile(baselineHashesPath, {
      algorithm: "sha256",
      generatedAt: new Date().toISOString(),
      items: hashItems.map((item) => ({
        ...item,
        relativePath: item.relativePath.replace("latest/images", "baseline/images")
      }))
    });
  }

  return {
    libraryRoot: input.config.artifacts.libraryRoot,
    sourceLibraryRoot,
    baselineImagesDir,
    latestImagesDir,
    latestDiffsDir
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