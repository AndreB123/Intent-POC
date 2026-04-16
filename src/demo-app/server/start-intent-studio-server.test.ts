import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { startIntentStudioServer } from "./start-intent-studio-server";

async function writeStudioConfig(configPath: string, tmpDir: string): Promise<void> {
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
      "      repoLabel: Intent POC Demo Components",
      "      role: tracked screenshots",
      "      summary: Demo screenshot maintenance source.",
      "    studio:",
      "      displayName: Tracked demo screenshots",
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
}

test("startIntentStudioServer exposes all configured sources and saves source metadata edits", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-studio-server-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");

  await writeStudioConfig(configPath, tmpDir);

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
  assert.equal(state.sources.length, 2);
  assert.equal(state.sources[0].id, "app");
  assert.equal(state.sources[0].label, "Current app");
  assert.equal(state.sources[0].repoLabel, "Intent POC");
  assert.equal(state.sources[0].role, "current repo");
  assert.equal(state.sources[0].defaultScope, true);
  assert.equal(state.sources[1].id, "screenshots");
  assert.equal(state.sources[1].label, "Tracked demo screenshots");

  const saveResponse = await fetch(`${server.baseUrl}/api/source-metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sourceId: "screenshots",
      displayName: "Demo components",
      repoLabel: "Intent POC Demo Surfaces",
      role: "shared demo component library",
      summary: "Visible demo component source for tracked screenshots and catalog review."
    })
  });
  assert.equal(saveResponse.status, 200);

  const updatedStateResponse = await fetch(`${server.baseUrl}/api/state`);
  assert.equal(updatedStateResponse.status, 200);
  const updatedState = (await updatedStateResponse.json()) as typeof state;
  assert.equal(updatedState.sources[1].label, "Demo components");
  assert.equal(updatedState.sources[1].repoLabel, "Intent POC Demo Surfaces");
  assert.equal(updatedState.sources[1].role, "shared demo component library");

  const updatedConfig = await fs.readFile(configPath, "utf8");
  assert.match(updatedConfig, /displayName: Demo components/);
  assert.match(updatedConfig, /repoLabel: Intent POC Demo Surfaces/);
  assert.match(updatedConfig, /role: shared demo component library/);

  const pageResponse = await fetch(server.baseUrl);
  assert.equal(pageResponse.status, 200);
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /id="source-scope"/);
  assert.match(pageHtml, /id="source-editor-form"/);
  assert.match(pageHtml, /Open config in editor/);
});

test("startIntentStudioServer rejects Studio requests that enable implementation without a provider", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-studio-server-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");

  await writeStudioConfig(configPath, tmpDir);

  const server = await startIntentStudioServer({ configPath, port: 0 });

  t.after(async () => {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const payload = {
    prompt: "Implement dark mode for the app.",
    agentOverrides: {
      stages: {
        implementation: {
          enabled: true
        }
      }
    }
  };

  const planResponse = await fetch(`${server.baseUrl}/api/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  assert.equal(planResponse.status, 400);
  const planBody = (await planResponse.json()) as { error?: string };
  assert.match(planBody.error ?? "", /Implementation stage requires an explicit provider/);
  assert.match(planBody.error ?? "", /intent-poc\.local-no-linear\.yaml/);

  const runResponse = await fetch(`${server.baseUrl}/api/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  assert.equal(runResponse.status, 400);
  const runBody = (await runResponse.json()) as { error?: string };
  assert.match(runBody.error ?? "", /Implementation stage requires an explicit provider/);
  assert.match(runBody.error ?? "", /agent.provider: gemini/);

  const stateResponse = await fetch(`${server.baseUrl}/api/state`);
  assert.equal(stateResponse.status, 200);
  const state = (await stateResponse.json()) as { currentRun: unknown };
  assert.equal(state.currentRun, null);
});