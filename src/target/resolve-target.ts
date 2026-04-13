import path from "node:path";
import { ensureDirectory, pathExists, removeDirectory } from "../shared/fs";
import { runCommand } from "../shared/process";
import { AppConfig, SourceConfig } from "../config/schema";

export interface ResolvedSourceWorkspace {
  sourceId: string;
  source: SourceConfig;
  rootDir: string;
  appDir: string;
  baseUrl: string;
  sourceType: SourceConfig["source"]["type"];
  gitRef?: string;
  gitCommit?: string;
}

export type ResolvedTargetWorkspace = ResolvedSourceWorkspace;

async function tryReadGitCommit(directory: string): Promise<string | undefined> {
  try {
    const result = await runCommand("git rev-parse HEAD", { cwd: directory });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function buildGitUrlWithOptionalToken(source: Extract<SourceConfig["source"], { type: "git" }>): string {
  if (!source.authTokenEnv) {
    return source.gitUrl;
  }

  const token = process.env[source.authTokenEnv];
  if (!token) {
    // Allow public repository access without requiring an auth token.
    return source.gitUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(source.gitUrl);
  } catch {
    throw new Error(
      `authTokenEnv is supported only for absolute git URLs. Received '${source.gitUrl}'.`
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `authTokenEnv is currently supported only for https git URLs. Received '${source.gitUrl}'.`
    );
  }

  parsed.username = "x-access-token";
  parsed.password = encodeURIComponent(token);
  return parsed.toString();
}

async function checkoutGitSource(sourceId: string, source: SourceConfig): Promise<string> {
  if (source.source.type !== "git") {
    throw new Error(`Source '${sourceId}' is not configured as a git source.`);
  }

  const authenticatedGitUrl = buildGitUrlWithOptionalToken(source.source);

  const sourceDir = path.join(source.workspace.cloneRoot, sourceId);

  if (source.workspace.checkoutMode === "fresh-clone") {
    await removeDirectory(sourceDir);
  }

  if (!(await pathExists(sourceDir))) {
    await ensureDirectory(source.workspace.cloneRoot);
    await runCommand(`git clone '${authenticatedGitUrl}' '${sourceDir}'`, {
      cwd: source.workspace.cloneRoot
    });
  } else {
    await runCommand(`git fetch --prune '${authenticatedGitUrl}'`, { cwd: sourceDir });
  }

  if (source.source.ref) {
    await runCommand(`git checkout '${source.source.ref}'`, { cwd: sourceDir });
  }

  return sourceDir;
}

export async function resolveSourceWorkspace(
  config: AppConfig,
  sourceId: string
): Promise<ResolvedSourceWorkspace> {
  const source = config.sources[sourceId];
  if (!source) {
    throw new Error(`Source '${sourceId}' is not defined in configuration.`);
  }

  let rootDir: string;
  if (source.source.type === "local") {
    rootDir = source.source.localPath;
    if (!(await pathExists(rootDir))) {
      throw new Error(`Configured source path does not exist: ${rootDir}`);
    }
  } else {
    rootDir = await checkoutGitSource(sourceId, source);
  }

  const appDir = path.resolve(rootDir, source.app.workdir);
  if (!(await pathExists(appDir))) {
    throw new Error(`Configured app workdir does not exist: ${appDir}`);
  }

  return {
    sourceId,
    source,
    rootDir,
    appDir,
    baseUrl: source.app.baseUrl,
    sourceType: source.source.type,
    gitRef: source.source.type === "git" ? source.source.ref : undefined,
    gitCommit: await tryReadGitCommit(rootDir)
  };
}

export async function resolveTargetWorkspace(config: AppConfig, sourceId: string): Promise<ResolvedTargetWorkspace> {
  return await resolveSourceWorkspace(config, sourceId);
}