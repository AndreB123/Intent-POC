import path from "node:path";
import { AppConfig } from "../config/schema";
import { copyDirectory, copyFile, ensureDirectory } from "../shared/fs";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import { RunPaths, SourceRunPaths } from "./paths";

export interface PublishResult {
  sourceOutputDir: string;
  copiedFiles: string[];
}

export async function publishArtifactsToSourceIfConfigured(input: {
  config: AppConfig;
  workspace: ResolvedSourceWorkspace;
  paths: RunPaths;
  sourcePaths: SourceRunPaths;
}): Promise<PublishResult | null> {
  if (input.config.artifacts.storageMode !== "both") {
    return null;
  }

  if (!input.config.artifacts.copyToSourcePath) {
    return null;
  }

  const sourceOutputDir = path.resolve(
    input.workspace.rootDir,
    input.config.artifacts.copyToSourcePath,
    input.paths.runId
  );

  await ensureDirectory(sourceOutputDir);

  const filesToCopy = [
    { from: input.paths.summaryPath, to: path.join(sourceOutputDir, "summary.md") },
    { from: input.paths.manifestPath, to: path.join(sourceOutputDir, "manifest.json") },
    { from: input.paths.comparisonPath, to: path.join(sourceOutputDir, "comparison.json") },
    { from: input.sourcePaths.summaryPath, to: path.join(sourceOutputDir, "source-summary.md") },
    { from: input.sourcePaths.manifestPath, to: path.join(sourceOutputDir, "source-manifest.json") },
    { from: input.sourcePaths.hashesPath, to: path.join(sourceOutputDir, "source-hashes.json") },
    { from: input.sourcePaths.comparisonPath, to: path.join(sourceOutputDir, "source-comparison.json") }
  ];

  for (const file of filesToCopy) {
    await copyFile(file.from, file.to);
  }

  await copyDirectory(input.sourcePaths.capturesDir, path.join(sourceOutputDir, "captures"));
  await copyDirectory(input.sourcePaths.diffsDir, path.join(sourceOutputDir, "diffs"));

  return {
    sourceOutputDir,
    copiedFiles: [
      "summary.md",
      "manifest.json",
      "comparison.json",
      "source-summary.md",
      "source-manifest.json",
      "source-hashes.json",
      "source-comparison.json",
      "captures/*",
      "diffs/*"
    ]
  };
}

export async function publishArtifactsToTargetIfConfigured(input: {
  config: AppConfig;
  workspace: ResolvedSourceWorkspace;
  paths: RunPaths;
  sourcePaths: SourceRunPaths;
}): Promise<PublishResult | null> {
  return await publishArtifactsToSourceIfConfigured(input);
}