import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "./load-config";

test("loadConfig tolerates blank optional yaml fields", async () => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-config-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");

  await fs.writeFile(
    configPath,
    [
      "version: 1",
      "linear:",
      "  enabled: false",
      "  apiKeyEnv: LINEAR_API_KEY",
      "  teamId: ENG",
      "  projectId:",
      "  createIssueOnStart: true",
      "  commentOnProgress: true",
      "  commentOnCompletion: true",
      "  defaultStateIds:",
      "    started:",
      "    completed:",
      "    failed:",
      "agent:",
      "  mode: bounded-runner",
      "  provider: gemini",
      "  model:",
      "  apiKeyEnv: GEMINI_API_KEY",
      "  apiVersion:",
      "  allowIntentPlanning: true",
      "  stages:",
      "    promptNormalization:",
      "      model: gemini-3.1-flash",
      "      apiVersion: v1alpha",
      "    intentPlanning:",
      "      model: gemini-3.1",
      "      apiKeyEnv:",
      "sources:",
      "  s1:",
      "    planning:",
      "      repoId: intent-poc",
      "      repoLabel: Intent POC",
      "      notes:",
      "        - Current workspace bootstrap repo",
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
      "        - id: one",
      "          path: /",
      "playwright:",
      "  browser: chromium",
      "artifacts:",
      "  storageMode: controller",
      "  runRoot: ./artifacts/runs",
      "  baselineRoot: ./evidence/baselines",
      "comparison:",
      "  hashAlgorithm: sha256",
      "run:",
      "  sourceId: s1",
      "  mode: compare",
      "  intent:",
      "  resumeIssue:",
      "  captureIds: []",
      "  continueOnCaptureError: false",
      "  allowBaselinePromotion: false",
      "  metadata: {}",
      "  dryRun: true"
    ].join("\n"),
    "utf8"
  );

  const loaded = await loadConfig(configPath);
  assert.equal(loaded.config.linear.projectId, undefined);
  assert.equal(loaded.config.run.intent, undefined);
  assert.equal(loaded.config.run.resumeIssue, undefined);
  assert.equal(loaded.config.run.sourceId, "s1");
  assert.ok(loaded.config.sources.s1);
  assert.equal(loaded.config.agent.provider, "gemini");
  assert.equal(loaded.config.agent.model, undefined);
  assert.equal(loaded.config.agent.apiKeyEnv, "GEMINI_API_KEY");
  assert.equal(loaded.config.agent.apiVersion, undefined);
  assert.equal(loaded.config.agent.allowIntentPlanning, true);
  assert.equal(loaded.config.agent.stages.promptNormalization.model, "gemini-3.1-flash");
  assert.equal(loaded.config.agent.stages.promptNormalization.apiVersion, "v1alpha");
  assert.equal(loaded.config.agent.stages.intentPlanning.model, "gemini-3.1");
  assert.equal(loaded.config.agent.stages.intentPlanning.apiKeyEnv, undefined);
  assert.equal(loaded.config.linear.defaultStateIds.started, undefined);
  assert.equal(loaded.config.sources.s1.planning.repoId, "intent-poc");
  assert.deepEqual(loaded.config.sources.s1.planning.notes, ["Current workspace bootstrap repo"]);
  assert.equal(loaded.config.sources.s1.studio.displayName, "Current app");
  assert.equal(loaded.config.sources.s1.studio.visible, true);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("loadConfig expands the built-in demo surface catalog and resolves tracked roots", async () => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-config-catalog-test-"));
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
      "  demo-components:",
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
      "      catalog: demo-surface-catalog",
      "      trackedRoot: ./tracked/demo-components",
      "playwright:",
      "  browser: chromium",
      "artifacts:",
      "  storageMode: controller",
      "  runRoot: ./artifacts/runs",
      "  baselineRoot: ./evidence/baselines",
      "comparison:",
      "  hashAlgorithm: sha256",
      "run:",
      "  sourceId: demo-components",
      "  mode: baseline",
      "  trackedBaseline: true",
      "  captureIds: []",
      "  continueOnCaptureError: false",
      "  allowBaselinePromotion: false",
      "  metadata: {}",
      "  dryRun: true"
    ].join("\n"),
    "utf8"
  );

  const loaded = await loadConfig(configPath);
  assert.equal(loaded.config.sources["demo-components"].capture.catalog, "demo-surface-catalog");
  assert.equal(loaded.config.sources["demo-components"].capture.items.length, 46);
  assert.equal(
    loaded.config.sources["demo-components"].capture.trackedRoot,
    path.join(tmpDir, "tracked", "demo-components")
  );
  assert.equal(loaded.config.run.trackedBaseline, true);

  await fs.rm(tmpDir, { recursive: true, force: true });
});