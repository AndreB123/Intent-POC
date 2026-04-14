import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { startIntentStudioServer } from "./start-intent-studio-server";

test("startIntentStudioServer exposes only visible work-scope sources and config edit links", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-studio-server-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");

  await fs.writeFile(
    configPath,
    [
      "version: 1",
      "linear:",
      "  enabled: false",
      "  apiKeyEnv: LINEAR_API_KEY",
      "  teamId: ENG",
      "  createIssueOnStart: false",
      "  commentOnProgress: false",
      "  commentOnCompletion: false",
      "agent:",
      "  mode: bounded-runner",
      "sources:",
      "  app:",
      "    planning:",
      "      repoId: intent-poc",
      "      repoLabel: Intent POC",
      "      role: current repo",
      "      summary: Current workspace scope.",
      "    studio:",
      "      displayName: Current app",
      "      visible: true",
      "    source:",
      "      type: local",
      `      localPath: ${JSON.stringify(tmpDir)}`,
      "    workspace:",
      "      checkoutMode: existing",
      "    app:",
      "      workdir: .",
      "      startCommand: echo start",
      "      baseUrl: http://127.0.0.1:3000",
      "      readiness:",
      "        type: http",
      "        url: http://127.0.0.1:3000",
      "    capture:",
      "      items:",
      "        - id: home",
      "          path: /",
      "  screenshots:",
      "    planning:",
      "      repoId: intent-poc",
      "      repoLabel: Intent POC",
      "      role: internal automation",
      "      summary: Hidden screenshot maintenance source.",
      "    studio:",
      "      displayName: Hidden screenshots",
      "      visible: false",
      "    source:",
      "      type: local",
      `      localPath: ${JSON.stringify(tmpDir)}`,
      "    workspace:",
      "      checkoutMode: existing",
      "    app:",
      "      workdir: .",
      "      startCommand: echo start",
      "      baseUrl: http://127.0.0.1:3001",
      "      readiness:",
      "        type: http",
      "        url: http://127.0.0.1:3001",
      "    capture:",
      "      items:",
      "        - id: hidden",
      "          path: /hidden",
      "playwright:",
      "  browser: chromium",
      "artifacts:",
      "  storageMode: controller",
      "  runRoot: ./artifacts/runs",
      "  baselineRoot: ./evidence/baselines",
      "comparison:",
      "  hashAlgorithm: sha256",
      "run:",
      "  sourceId: app",
      "  mode: compare",
      "  captureIds: []",
      "  continueOnCaptureError: false",
      "  allowBaselinePromotion: false",
      "  metadata: {}",
      "  dryRun: true"
    ].join("\n"),
    "utf8"
  );

  const server = await startIntentStudioServer({ configPath, port: 0 });

  t.after(async () => {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const stateResponse = await fetch(`${server.baseUrl}/api/state`);
  assert.equal(stateResponse.status, 200);

  const state = (await stateResponse.json()) as {
    configPath: string;
    configFileUrl?: string;
    configEditorUrl?: string;
    hiddenSourceCount: number;
    sources: Array<{
      id: string;
      label: string;
      repoLabel?: string;
      role?: string;
      defaultScope: boolean;
    }>;
  };
  const expectedRelativeConfigPath = path.relative(process.cwd(), configPath) || path.basename(configPath);

  assert.equal(state.configPath, expectedRelativeConfigPath);
  assert.equal(state.configFileUrl, `/files/${encodeURIComponent(expectedRelativeConfigPath)}`);
  assert.match(state.configEditorUrl ?? "", /^vscode:\/\/file\//);
  assert.equal(state.hiddenSourceCount, 1);
  assert.equal(state.sources.length, 1);
  assert.equal(state.sources[0].id, "app");
  assert.equal(state.sources[0].label, "Current app");
  assert.equal(state.sources[0].repoLabel, "Intent POC");
  assert.equal(state.sources[0].role, "current repo");
  assert.equal(state.sources[0].defaultScope, true);

  const pageResponse = await fetch(server.baseUrl);
  assert.equal(pageResponse.status, 200);
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /id="source-scope"/);
  assert.match(pageHtml, /Open config in editor/);
});