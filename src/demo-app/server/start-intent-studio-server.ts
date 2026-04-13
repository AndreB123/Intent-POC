import { promises as fs } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";
import { loadConfig } from "../../config/load-config";
import { RunMode } from "../../config/schema";
import { toRelativePath } from "../../evidence/paths";
import { normalizeIntent } from "../../intent/normalize-intent";
import { NormalizedIntent } from "../../intent/intent-types";
import { RunIntentEvent, RunIntentResult, runIntent } from "../../orchestrator/run-intent";
import { pathExists } from "../../shared/fs";
import { renderIntentStudioPage } from "../render/render-intent-studio-page";
import { renderSurfaceCatalogIndex, renderSurfacePage } from "../render/render-surface-page";
import { SURFACE_CATALOG } from "../model/catalog";
import { LibraryVariant } from "../model/types";

export interface IntentStudioServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export interface StartIntentStudioServerOptions {
  host?: string;
  port?: number;
  initialVariant?: LibraryVariant;
  configPath?: string;
}

interface StudioSourceSummary {
  id: string;
  label: string;
  summary: string;
  aliases: string[];
  captureCount: number;
  sourceType: string;
  sourceLocation: string;
  startCommand: string;
  readiness: string;
  baseUrl: string;
  status: "ready" | "attention";
  issues: string[];
  notes: string[];
}

interface StudioCaptureSummary {
  sourceId: string;
  captureId: string;
  status: "captured" | "failed";
  url: string;
  imagePath?: string;
  diffImagePath?: string;
  error?: string;
}

interface StudioSourceRunSummary {
  sourceId: string;
  status: "planned" | "completed" | "failed";
  error?: string;
  counts?: Record<string, number>;
  summaryPath?: string;
  appLogPath?: string;
}

interface StudioRunRecord {
  sessionId: string;
  prompt: string;
  sourceId?: string;
  mode?: RunMode;
  intentPlan?: NormalizedIntent;
  dryRun: boolean;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  normalizedSummary?: string;
  runId?: string;
  hasDrift?: boolean;
  counts?: Record<string, number>;
  error?: string;
  errors?: string[];
  events: Array<RunIntentEvent & { id: string }>;
  captures: StudioCaptureSummary[];
  sourceRuns: StudioSourceRunSummary[];
  linearIssue?: {
    identifier?: string;
    url?: string;
  };
  linearSourceIssues?: Array<{
    sourceId: string;
    identifier?: string;
    url?: string;
  }>;
  artifacts: {
    normalizedIntentPath?: string;
    summaryPath?: string;
    manifestPath?: string;
    comparisonPath?: string;
    appLogPath?: string;
  };
}

interface StudioState {
  configPath: string;
  configError?: string;
  linearEnabled: boolean;
  defaultPrompt?: string;
  defaultSourceId?: string;
  defaultMode?: RunMode;
  sources: StudioSourceSummary[];
  currentRun: StudioRunRecord | null;
  recentRuns: StudioRunRecord[];
  serverTime: string;
}

function formatSourceLabel(sourceId: string): string {
  return sourceId
    .split(/[-_]/g)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatWorkspacePath(workspaceRoot: string, targetPath: string): string {
  const relativePath = path.relative(workspaceRoot, targetPath);
  return relativePath.length === 0 ? "." : relativePath;
}

function formatRepoSource(gitUrl: string, ref: string): string {
  try {
    const parsed = new URL(gitUrl);
    return `${parsed.pathname.replace(/^\//, "")} @ ${ref}`;
  } catch {
    return `${gitUrl} @ ${ref}`;
  }
}

function summarizeSource(sourceId: string, sourceType: string, startCommand: string, localPath?: string): string {
  if (/demo:serve/.test(startCommand)) {
    return "Built-in local source for running the studio and demo asset worker.";
  }

  if (/docker compose/i.test(startCommand)) {
    return "Git-backed source started through Docker Compose.";
  }

  if (/storybook/i.test(startCommand)) {
    return localPath === "."
      ? "Storybook source inside the current workspace."
      : "Local Storybook source outside the current workspace.";
  }

  return sourceType === "git"
    ? "Git-backed source with custom app startup."
    : "Local source with custom app startup.";
}

async function buildSourceSummary(
  workspaceRoot: string,
  sourceId: string,
  source: Awaited<ReturnType<typeof loadConfig>>["config"]["sources"][string]
): Promise<StudioSourceSummary> {
  const issues: string[] = [];
  const notes: string[] = [];
  let sourceLocation: string;

  if (source.source.type === "local") {
    sourceLocation = formatWorkspacePath(workspaceRoot, source.source.localPath);
    if (!(await pathExists(source.source.localPath))) {
      issues.push(`Local source path is missing: ${sourceLocation}.`);
    }

    const appDir = path.resolve(source.source.localPath, source.app.workdir);
    if (!(await pathExists(appDir))) {
      issues.push(`App workdir is missing: ${formatWorkspacePath(workspaceRoot, appDir)}.`);
    }
  } else {
    sourceLocation = formatRepoSource(source.source.gitUrl, source.source.ref);
    if (source.source.authTokenEnv) {
      notes.push(`Uses ${source.source.authTokenEnv} if repository authentication is required.`);
    }
  }

  if (/docker compose/i.test(source.app.startCommand)) {
    notes.push("Requires Docker and working container networking on this machine.");
  }

  const readiness =
    source.app.readiness.type === "http"
      ? `HTTP ${source.app.readiness.url ?? source.app.baseUrl}`
      : `Selector ${source.app.readiness.selector} at ${source.app.readiness.path}`;

  return {
    id: sourceId,
    label: formatSourceLabel(sourceId),
    summary: summarizeSource(
      sourceId,
      source.source.type,
      source.app.startCommand,
      source.source.type === "local" ? formatWorkspacePath(workspaceRoot, source.source.localPath) : undefined
    ),
    aliases: source.aliases,
    captureCount: source.capture.items.length,
    sourceType: source.source.type,
    sourceLocation,
    startCommand: source.app.startCommand,
    readiness,
    baseUrl: source.app.baseUrl,
    status: issues.length > 0 ? "attention" : "ready",
    issues,
    notes
  };
}

function resolveVariant(requestUrl: URL, fallback: LibraryVariant): LibraryVariant {
  const variant = requestUrl.searchParams.get("variant");
  return variant === "v2" ? "v2" : variant === "v1" ? "v1" : fallback;
}

function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }

  if (extension === ".md") {
    return "text/markdown; charset=utf-8";
  }

  if (extension === ".log" || extension === ".txt") {
    return "text/plain; charset=utf-8";
  }

  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }

  return "application/octet-stream";
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body)}\n`);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body exceeds 1MB."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function cloneRun(run: StudioRunRecord): StudioRunRecord {
  return JSON.parse(JSON.stringify(run)) as StudioRunRecord;
}

function createSessionId(): string {
  return `studio-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createEventId(run: StudioRunRecord): string {
  return `${run.sessionId}-${run.events.length + 1}`;
}

function normalizeMode(value: unknown): RunMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "baseline" || value === "compare" || value === "approve-baseline") {
    return value;
  }

  throw new Error("Mode must be one of baseline, compare, or approve-baseline.");
}

function buildPlannerSources(
  sources: Awaited<ReturnType<typeof loadConfig>>["config"]["sources"]
): Record<string, Pick<Awaited<ReturnType<typeof loadConfig>>["config"]["sources"][string], "aliases" | "capture">> {
  return Object.fromEntries(
    Object.entries(sources).map(([sourceId, source]) => [
      sourceId,
      {
        aliases: source.aliases,
        capture: source.capture
      }
    ])
  );
}

async function previewNormalizedIntent(input: {
  configPath: string;
  prompt: string;
  sourceId?: string;
  mode?: RunMode;
}): Promise<NormalizedIntent> {
  const loaded = await loadConfig(input.configPath);
  const sourceId = input.sourceId ?? loaded.config.run.sourceId;
  const mode = input.mode ?? loaded.config.run.mode;

  return normalizeIntent({
    rawPrompt: input.prompt,
    runMode: mode,
    defaultSourceId: sourceId,
    continueOnCaptureError: loaded.config.run.continueOnCaptureError,
    availableSources: buildPlannerSources(loaded.config.sources),
    sourceIdOverride: input.sourceId,
    modeOverride: input.mode,
    linearEnabled: loaded.config.linear.enabled,
    publishToSourceWorkspace:
      loaded.config.artifacts.storageMode === "both" && Boolean(loaded.config.artifacts.copyToSourcePath)
  });
}

function toStudioCaptureSummaries(result: RunIntentResult): StudioCaptureSummary[] {
  return result.sourceRuns.flatMap((sourceRun) => {
    const comparisonItems = new Map((sourceRun.comparison?.items ?? []).map((item) => [item.captureId, item]));

    return sourceRun.captures.map((capture) => {
      const comparisonItem = comparisonItems.get(capture.captureId);
      return {
        sourceId: sourceRun.sourceId,
        captureId: capture.captureId,
        status: capture.status,
        url: capture.url,
        imagePath: capture.status === "captured" ? capture.relativeOutputPath : undefined,
        diffImagePath: comparisonItem?.diffImagePath
          ? toRelativePath(result.paths.controllerRoot, comparisonItem.diffImagePath)
          : undefined,
        error: capture.error
      };
    });
  });
}

function applyRunResult(run: StudioRunRecord, result: RunIntentResult): void {
  run.sourceId = result.sourceId;
  run.mode = result.mode;
  run.runId = result.paths.runId;
  run.normalizedSummary = result.normalizedIntent.summary;
  run.intentPlan = result.normalizedIntent;
  run.hasDrift = result.hasDrift;
  run.counts = result.counts;
  run.errors = result.errors;
  run.error = result.errors.length > 0 ? result.errors.join(" | ") : undefined;
  run.captures = toStudioCaptureSummaries(result);
  run.sourceRuns = result.sourceRuns.map((sourceRun) => ({
    sourceId: sourceRun.sourceId,
    status: sourceRun.status,
    error: sourceRun.error,
    counts: sourceRun.comparison?.counts,
    summaryPath: toRelativePath(result.paths.controllerRoot, sourceRun.paths.summaryPath),
    appLogPath: toRelativePath(result.paths.controllerRoot, sourceRun.paths.appLogPath)
  }));
  run.linearIssue = result.linearIssue
    ? {
        identifier: result.linearIssue.identifier,
        url: result.linearIssue.url
      }
    : undefined;
  run.linearSourceIssues = Object.entries(result.linearPublication?.sourceIssues ?? {}).map(([sourceId, issue]) => ({
    sourceId,
    identifier: issue.identifier,
    url: issue.url
  }));
  run.artifacts = {
    normalizedIntentPath: toRelativePath(result.paths.controllerRoot, result.paths.normalizedIntentPath),
    summaryPath: result.paths.summaryPath ? toRelativePath(result.paths.controllerRoot, result.paths.summaryPath) : undefined,
    manifestPath: result.paths.manifestPath ? toRelativePath(result.paths.controllerRoot, result.paths.manifestPath) : undefined,
    comparisonPath: result.paths.comparisonPath ? toRelativePath(result.paths.controllerRoot, result.paths.comparisonPath) : undefined,
    appLogPath: result.sourceRuns[0] ? toRelativePath(result.paths.controllerRoot, result.sourceRuns[0].paths.appLogPath) : undefined
  };
}

export async function startIntentStudioServer(
  options: StartIntentStudioServerOptions = {}
): Promise<IntentStudioServer> {
  const host = options.host ?? "127.0.0.1";
  const configPath = options.configPath ?? "./intent-poc.yaml";
  const workspaceRoot = process.cwd();
  let variant: LibraryVariant = options.initialVariant ?? "v1";
  const byRoute = new Map(SURFACE_CATALOG.map((surface) => [`/library/${surface.id}`, surface]));
  const clients = new Set<ServerResponse>();
  const recentRuns: StudioRunRecord[] = [];
  let currentRun: StudioRunRecord | null = null;
  let baseUrl = "";

  async function buildState(): Promise<StudioState> {
    try {
      const loaded = await loadConfig(configPath);
      const sources = await Promise.all(
        Object.entries(loaded.config.sources).map(async ([sourceId, source]) =>
          await buildSourceSummary(workspaceRoot, sourceId, source)
        )
      );

      return {
        configPath: path.relative(workspaceRoot, loaded.configPath) || path.basename(loaded.configPath),
        linearEnabled: loaded.config.linear.enabled,
        defaultPrompt: loaded.config.run.intent,
        defaultSourceId: loaded.config.run.sourceId,
        defaultMode: loaded.config.run.mode,
        sources,
        currentRun: currentRun ? cloneRun(currentRun) : null,
        recentRuns: recentRuns.map((run) => cloneRun(run)),
        serverTime: new Date().toISOString()
      };
    } catch (error) {
      return {
        configPath: path.relative(workspaceRoot, path.resolve(configPath)) || configPath,
        configError: error instanceof Error ? error.message : String(error),
        linearEnabled: false,
        sources: [],
        currentRun: currentRun ? cloneRun(currentRun) : null,
        recentRuns: recentRuns.map((run) => cloneRun(run)),
        serverTime: new Date().toISOString()
      };
    }
  }

  async function broadcastState(): Promise<void> {
    const state = await buildState();
    const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;

    for (const client of clients) {
      client.write(payload);
    }
  }

  function archiveCurrentRun(): void {
    if (!currentRun || currentRun.status === "running") {
      return;
    }

    recentRuns.unshift(cloneRun(currentRun));
    recentRuns.splice(8);
  }

  function appendEvent(run: StudioRunRecord, event: RunIntentEvent): void {
    run.events.push({
      ...event,
      id: createEventId(run)
    });

    if (event.phase === "intent" && event.details && typeof event.details === "object") {
      const details = event.details as {
        summary?: string;
        sourceId?: string;
        runMode?: RunMode;
        normalizedIntent?: NormalizedIntent;
      };
      run.normalizedSummary = details.summary ?? run.normalizedSummary;
      run.sourceId = details.sourceId ?? run.sourceId;
      run.mode = details.runMode ?? run.mode;
      run.intentPlan = details.normalizedIntent ?? run.intentPlan;
    }

    if (event.phase === "linear" && event.details && typeof event.details === "object") {
      const details = event.details as { sourceId?: string; identifier?: string; url?: string };
      if (details.sourceId && (details.identifier || details.url)) {
        const existing = run.linearSourceIssues ?? [];
        const index = existing.findIndex((item) => item.sourceId === details.sourceId);
        const next = {
          sourceId: details.sourceId,
          identifier: details.identifier,
          url: details.url
        };
        if (index >= 0) {
          existing[index] = next;
        } else {
          existing.push(next);
        }
        run.linearSourceIssues = existing;
      } else if (details.identifier || details.url) {
        run.linearIssue = {
          identifier: details.identifier ?? run.linearIssue?.identifier,
          url: details.url ?? run.linearIssue?.url
        };
      }
    }
  }

  function startRun(input: { prompt: string; sourceId?: string; mode?: RunMode; dryRun: boolean }): void {
    archiveCurrentRun();

    const run: StudioRunRecord = {
      sessionId: createSessionId(),
      prompt: input.prompt,
      sourceId: input.sourceId,
      mode: input.mode,
      dryRun: input.dryRun,
      status: "running",
      startedAt: new Date().toISOString(),
      events: [],
      captures: [],
      sourceRuns: [],
      artifacts: {}
    };

    currentRun = run;
    appendEvent(run, {
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "run",
      message: "Run request accepted.",
      details: {
        sourceId: input.sourceId,
        mode: input.mode,
        dryRun: input.dryRun
      }
    });
    void broadcastState();

    void (async () => {
      try {
        const result = await runIntent({
          configPath,
          intent: input.prompt,
          sourceId: input.sourceId,
          mode: input.mode,
          dryRun: input.dryRun,
          onEvent: (event) => {
            appendEvent(run, event);
            void broadcastState();
          }
        });

        applyRunResult(run, result);
  run.status = result.status;
        run.finishedAt = new Date().toISOString();
        void broadcastState();
      } catch (error) {
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        run.error = error instanceof Error ? error.message : String(error);
        appendEvent(run, {
          timestamp: new Date().toISOString(),
          level: "error",
          phase: "run",
          message: "Studio run failed.",
          details: {
            error: run.error
          }
        });
        void broadcastState();
      }
    })();
  }

  async function serveFile(requestedPath: string, res: ServerResponse): Promise<void> {
    const decodedPath = decodeURIComponent(requestedPath);
    const absolutePath = path.resolve(workspaceRoot, decodedPath);

    if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${path.sep}`)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("forbidden");
      return;
    }

    try {
      const content = await fs.readFile(absolutePath);
      res.writeHead(200, { "Content-Type": getContentType(absolutePath) });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestUrl = new URL(req.url ?? "/", `http://${host}`);
    const route = requestUrl.pathname;
    const effectiveVariant = resolveVariant(requestUrl, variant);

    if (req.method === "GET" && route === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderIntentStudioPage({ configPath: path.relative(workspaceRoot, path.resolve(configPath)) || configPath }));
      return;
    }

    if (req.method === "GET" && route === "/library") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderSurfaceCatalogIndex(SURFACE_CATALOG, effectiveVariant));
      return;
    }

    if (req.method === "GET" && route === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    if (req.method === "GET" && route === "/api/state") {
      sendJson(res, 200, await buildState());
      return;
    }

    if (req.method === "POST" && route === "/api/plan") {
      try {
        const rawBody = await readRequestBody(req);
        const body = rawBody.length > 0 ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

        if (!prompt) {
          sendJson(res, 200, { plan: null });
          return;
        }

        const sourceId = typeof body.sourceId === "string" && body.sourceId.trim().length > 0
          ? body.sourceId.trim()
          : undefined;
        const mode = normalizeMode(body.mode);
        const plan = await previewNormalizedIntent({
          configPath,
          prompt,
          sourceId,
          mode
        });

        sendJson(res, 200, { plan });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && route === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });
      res.write(": connected\n\n");
      clients.add(res);
      res.write(`event: state\ndata: ${JSON.stringify(await buildState())}\n\n`);
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    if (req.method === "POST" && route === "/api/runs") {
      if (currentRun && currentRun.status === "running") {
        sendJson(res, 409, { error: "A run is already in progress." });
        return;
      }

      try {
        const rawBody = await readRequestBody(req);
        const body = rawBody.length > 0 ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

        if (!prompt) {
          sendJson(res, 400, { error: "Prompt is required." });
          return;
        }

        const sourceId = typeof body.sourceId === "string" && body.sourceId.trim().length > 0
          ? body.sourceId.trim()
          : undefined;
        const mode = normalizeMode(body.mode);
        const dryRun = body.dryRun === true;

        startRun({ prompt, sourceId, mode, dryRun });
        sendJson(res, 202, { ok: true });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && route.startsWith("/files/")) {
      await serveFile(route.slice("/files/".length), res);
      return;
    }

    const surface = byRoute.get(route);
    if (req.method === "GET" && surface) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderSurfacePage(surface, effectiveVariant));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, host, () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://${host}:${address.port}`;

  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        for (const client of clients) {
          client.end();
        }
        clients.clear();

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}