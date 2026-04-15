import { promises as fs } from "node:fs";
import path from "node:path";
import { runIntent } from "../orchestrator/run-intent";
import { log } from "../shared/log";
import { removeDirectory } from "../shared/fs";
import { runCommand } from "../shared/process";
import { getDemoScreenshotRoot } from "./capture/screenshot-paths";

function shouldSkipPreflightChecks(): boolean {
  return process.argv.includes("--skip-preflight");
}

function getLegacyDemoArtifactPaths(workspaceRoot: string): string[] {
  return [
    path.join(workspaceRoot, "artifacts", "library", "demo-components"),
    path.join(workspaceRoot, "artifacts", "runs", "demo-baseline-captures"),
    path.join(workspaceRoot, "artifacts", "runs", "demo-baseline-diffs"),
    path.join(workspaceRoot, "artifacts", "runs", "demo-compare-captures"),
    path.join(workspaceRoot, "artifacts", "runs", "demo-compare-diffs")
  ];
}

async function runPreflightChecks(workspaceRoot: string): Promise<void> {
  log.info("Running preflight validation before deterministic screenshot regeneration.", {
    commands: ["npm run typecheck", "npm run test:code"]
  });

  await runCommand("npm run typecheck", {
    cwd: workspaceRoot,
    timeoutMs: 180_000
  });

  await runCommand("npm run test:code", {
    cwd: workspaceRoot,
    timeoutMs: 240_000
  });

  log.info("Preflight validation passed.", {
    commands: ["npm run typecheck", "npm run test:code"]
  });
}

async function listTrackedScreenshotFiles(rootPath: string): Promise<string[]> {
  const directoryEntries = await fs.readdir(rootPath, { withFileTypes: true });
  const files = await Promise.all(
    directoryEntries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return listTrackedScreenshotFiles(entryPath);
      }

      return entry.name.endsWith(".png") ? [entryPath] : [];
    })
  );

  return files.flat().sort();
}

async function runDemoLibrary(): Promise<void> {
  const workspaceRoot = process.cwd();
  const screenshotRoot = getDemoScreenshotRoot(workspaceRoot);
  const configPath = path.join(workspaceRoot, "intent-poc.yaml");

  if (shouldSkipPreflightChecks()) {
    log.info("Skipping preflight validation before deterministic screenshot regeneration.", {
      reason: "--skip-preflight"
    });
  } else {
    await runPreflightChecks(workspaceRoot);
  }

  const result = await runIntent({
    configPath,
    sourceIds: ["demo-components"],
    intent: "Create a baseline for the deterministic screenshot library for the built-in demo surface catalog."
  });

  await Promise.all(getLegacyDemoArtifactPaths(workspaceRoot).map((targetPath) => removeDirectory(targetPath)));

  const capturedFiles = (await listTrackedScreenshotFiles(screenshotRoot)).map((filePath) =>
    path.relative(workspaceRoot, filePath)
  );

  log.info("Demo screenshot library generated through the unified runIntent workflow.", {
    runId: result.paths.runId,
    sourceId: result.sourceId,
    screenshotRoot: path.relative(workspaceRoot, screenshotRoot),
    imageCount: capturedFiles.length,
    summaryPath: path.relative(workspaceRoot, result.paths.summaryPath),
    manifestPath: path.relative(workspaceRoot, result.paths.manifestPath),
    preflightChecks: shouldSkipPreflightChecks() ? [] : ["npm run typecheck", "npm run test:code"],
    legacyArtifactPathsCleared: getLegacyDemoArtifactPaths(workspaceRoot).map((targetPath) =>
      path.relative(workspaceRoot, targetPath)
    ),
    files: capturedFiles
  });
}

void runDemoLibrary().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});