import path from "node:path";
import { promises as fs } from "node:fs";
import { LoadedConfig } from "../config/load-config";
import { ensureDirectory, removeDirectory, sanitizeFileSegment } from "../shared/fs";

export interface SourceRunPaths {
  controllerRoot: string;
  runId: string;
  sourceId: string;
  sourceDir: string;
  attemptsDir: string;
  capturesDir: string;
  diffsDir: string;
  logsDir: string;
  manifestPath: string;
  hashesPath: string;
  comparisonPath: string;
  summaryPath: string;
  appLogPath: string;
  baselineSourceDir: string;
}

export interface RunPaths {
  controllerRoot: string;
  runId: string;
  runDir: string;
  sourcesDir: string;
  logsDir: string;
  normalizedIntentPath: string;
  linearPath: string;
  planLifecyclePath: string;
  manifestPath: string;
  hashesPath: string;
  comparisonPath: string;
  summaryPath: string;
  sourceRuns: Record<string, SourceRunPaths>;
}

export async function createRunPaths(
  loadedConfig: LoadedConfig,
  sourceIds: string[]
): Promise<RunPaths> {
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const sourceScope = sourceIds.length === 1 ? sourceIds[0] : `${sourceIds.length}-sources`;
  const runId = `${timestamp}-${sanitizeFileSegment(sourceScope)}`;
  const runDir = path.join(loadedConfig.config.artifacts.runRoot, runId);

  if (loadedConfig.config.artifacts.cleanBeforeRun) {
    await removeDirectory(runDir);
  }

  const sourceRuns = Object.fromEntries(
    sourceIds.map((sourceId) => {
      const sourceDir = path.join(runDir, "sources", sourceId);
      const baselineSourceDir = path.join(loadedConfig.config.artifacts.libraryRoot, sourceId);

      return [
        sourceId,
        {
          controllerRoot: loadedConfig.configDir,
          runId,
          sourceId,
          sourceDir,
          attemptsDir: path.join(sourceDir, "attempts"),
          capturesDir: path.join(sourceDir, "captures"),
          diffsDir: path.join(sourceDir, "diffs"),
          logsDir: path.join(sourceDir, "logs"),
          manifestPath: path.join(sourceDir, "manifest.json"),
          hashesPath: path.join(sourceDir, "hashes.json"),
          comparisonPath: path.join(sourceDir, "comparison.json"),
          summaryPath: path.join(sourceDir, "summary.md"),
          appLogPath: path.join(sourceDir, "logs", "app.log"),
          baselineSourceDir
        } satisfies SourceRunPaths
      ];
    })
  ) as Record<string, SourceRunPaths>;

  const paths: RunPaths = {
    controllerRoot: loadedConfig.configDir,
    runId,
    runDir,
    sourcesDir: path.join(runDir, "sources"),
    logsDir: path.join(runDir, "logs"),
    normalizedIntentPath: path.join(runDir, "normalized-intent.json"),
    linearPath: path.join(runDir, "linear.json"),
    planLifecyclePath: path.join(runDir, "plan-lifecycle.json"),
    manifestPath: path.join(runDir, "manifest.json"),
    hashesPath: path.join(runDir, "hashes.json"),
    comparisonPath: path.join(runDir, "comparison.json"),
    summaryPath: path.join(runDir, "summary.md"),
    sourceRuns
  };

  await ensureDirectory(paths.runDir);
  await ensureDirectory(paths.sourcesDir);
  await ensureDirectory(paths.logsDir);

  await Promise.all(
    Object.values(paths.sourceRuns).flatMap((sourcePaths) => [
      ensureDirectory(sourcePaths.sourceDir),
      ensureDirectory(sourcePaths.attemptsDir),
      ensureDirectory(sourcePaths.capturesDir),
      ensureDirectory(sourcePaths.logsDir)
    ])
  );

  return paths;
}

export function toRelativePath(controllerRoot: string, targetPath?: string): string | undefined {
  if (!targetPath) {
    return undefined;
  }

  return path.relative(controllerRoot, targetPath);
}

export function toFileUrlPath(relativePath?: string): string | undefined {
  if (!relativePath) {
    return undefined;
  }

  return `/files/${encodeURIComponent(relativePath)}`;
}

export async function retainRecentRuns(runRoot: string, keepCount: number): Promise<void> {
  await ensureDirectory(runRoot);
  const entries = await fs.readdir(runRoot, { withFileTypes: true });
  const runDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(runRoot, entry.name));

  if (runDirs.length <= keepCount) {
    return;
  }

  const sorted = await Promise.all(
    runDirs.map(async (entry) => ({
      path: entry,
      modifiedAt: (await fs.stat(entry)).mtimeMs
    }))
  );

  sorted.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const toDelete = sorted.slice(keepCount);
  await Promise.all(toDelete.map((entry) => removeDirectory(entry.path)));
}