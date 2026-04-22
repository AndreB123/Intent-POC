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
      "  allowBDDPlanning: true",
      "  allowTDDPlanning: true",
      "  stages:",
      "    promptNormalization:",
      "      model: models/gemini-3.1-flash-lite-preview",
      "      apiVersion: v1alpha",
      "    bddPlanning:",
      "      model: models/gemini-3.1-flash-lite-preview",
      "      apiKeyEnv:",
      "sources:",
      "  s1:",
      "    planning:",
      "      repoId: intent-poc",
      "      repoLabel: Intent POC",
      "      notes:",
      "        - Current workspace bootstrap repo",
      "      verificationNotes:",
      "        - Theme-sensitive verification must declare the requested UI state before screenshots are trusted.",
      "      uiStates:",
      "        - id: theme-mode",
      "          description: The demo app supports multiple theme states that affect screenshots and contrast.",
      "          activation:",
      "            - type: ui-control",
      "              target: \"[data-testid='theme-toggle']\"",
      "              values:",
      "                light: \"false\"",
      "                dark: \"true\"",
      "          verificationStrategies:",
      "            - ui-interaction-playwright",
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
      "  root: ./artifacts",
      "comparison:",
      "  hashAlgorithm: sha256",
      "run:",
      "  sourceId: s1",
      "  intent:",
      "  resumeIssue:",
      "  workItemBatchSize: 2",
      "  captureIds: []",
      "  continueOnCaptureError: false",
      "  metadata: {}",
      "  dryRun: true"
    ].join("\n"),
    "utf8"
  );

  const loaded = await loadConfig(configPath);
  assert.equal(loaded.config.linear.projectId, undefined);
  assert.equal(loaded.config.run.intent, undefined);
  assert.equal(loaded.config.run.resumeIssue, undefined);
  assert.equal(loaded.config.run.workItemBatchSize, 2);
  assert.equal(loaded.config.run.sourceId, "s1");
  assert.ok(loaded.config.sources.s1);
  assert.equal(loaded.config.agent.provider, "gemini");
  assert.equal(loaded.config.agent.model, undefined);
  assert.equal(loaded.config.agent.apiKeyEnv, "GEMINI_API_KEY");
  assert.equal(loaded.config.agent.apiVersion, undefined);
  assert.equal(loaded.config.agent.requireAIWorkflow, false);
  assert.equal(loaded.config.agent.allowBDDPlanning, true);
  assert.equal(loaded.config.agent.allowTDDPlanning, true);
  assert.equal(loaded.config.agent.stages.promptNormalization.model, "models/gemini-3.1-flash-lite-preview");
  assert.equal(loaded.config.agent.stages.promptNormalization.apiVersion, "v1alpha");
  assert.equal(loaded.config.agent.stages.bddPlanning.model, "models/gemini-3.1-flash-lite-preview");
  assert.equal(loaded.config.agent.stages.bddPlanning.apiKeyEnv, undefined);
  assert.equal(loaded.config.linear.defaultStateIds.started, undefined);
  assert.equal(loaded.config.sources.s1.planning.repoId, "intent-poc");
  assert.deepEqual(loaded.config.sources.s1.planning.notes, ["Current workspace bootstrap repo"]);
  assert.deepEqual(loaded.config.sources.s1.planning.verificationNotes, [
    "Theme-sensitive verification must declare the requested UI state before screenshots are trusted."
  ]);
  assert.equal(loaded.config.sources.s1.planning.uiStates[0]?.id, "theme-mode");
  assert.equal(loaded.config.sources.s1.planning.uiStates[0]?.activation[0]?.type, "ui-control");
  assert.equal(loaded.config.sources.s1.planning.uiStates[0]?.verificationStrategies[0], "ui-interaction-playwright");
  assert.equal(loaded.config.sources.s1.studio.displayName, "Current app");
  assert.equal(loaded.config.sources.s1.app.reuseExistingServer, false);
  assert.equal(loaded.config.sources.s1.testing.playwright.outputDir, "tests/intent");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("loadConfig expands the built-in surface library capture set for the unified app source", async () => {
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
      "  intent-poc-app:",
      "    aliases:",
      "      - surface-library",
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
      "      catalog: surface-library",
      "      publishToLibrary: false",
      "      items:",
      "        - id: library-index",
      "          path: /library",
      "          fullPage: true",
      "        - id: component-button-primary",
      "          path: /library/component-button-primary",
      "        - id: page-analytics-overview",
      "          path: /library/page-analytics-overview",
      "          fullPage: true",
      "playwright:",
      "  browser: chromium",
      "artifacts:",
      "  storageMode: controller",
      "  root: ./artifacts",
      "comparison:",
      "  hashAlgorithm: sha256",
      "run:",
      "  sourceId: intent-poc-app",
      "  captureIds: []",
      "  continueOnCaptureError: false",
      "  metadata: {}",
      "  dryRun: true"
    ].join("\n"),
    "utf8"
  );

  const loaded = await loadConfig(configPath);
  assert.equal(loaded.config.sources["intent-poc-app"].capture.catalog, "surface-library");
  assert.equal(loaded.config.sources["intent-poc-app"].capture.items.length, 48);
  assert.equal(
    loaded.config.sources["intent-poc-app"].capture.items.some((item) => item.id === "library-index" && item.fullPage === true),
    true
  );
  assert.equal(
    loaded.config.sources["intent-poc-app"].capture.items.some(
      (item) => item.id === "component-button-primary" && item.relativeOutputPath?.startsWith("components/")
    ),
    true
  );
  assert.equal(
    loaded.config.sources["intent-poc-app"].capture.items.some((item) => item.id === "page-analytics-overview" && item.fullPage === true),
    true
  );
  assert.equal(loaded.config.sources["intent-poc-app"].app.reuseExistingServer, false);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("loadConfig rejects legacy artifacts runRoot and retainRuns keys", async () => {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-config-legacy-artifacts-test-"));
  const configPath = path.join(tmpDir, "intent-poc.yaml");

  await fs.writeFile(
    configPath,
    [
      "version: 1",
      "linear:",
      "  enabled: false",
      "  apiKeyEnv: LINEAR_API_KEY",
      "  teamId: ENG",
      "agent:",
      "  mode: bounded-runner",
      "sources:",
      "  s1:",
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
      "  root: ./artifacts",
      "  runRoot: ./artifacts/runs",
      "  retainRuns: 5",
      "comparison:",
      "  hashAlgorithm: sha256",
      "run:",
      "  sourceId: s1",
      "  captureIds: []",
      "  continueOnCaptureError: false",
      "  metadata: {}",
      "  dryRun: true"
    ].join("\n"),
    "utf8"
  );

  await assert.rejects(
    () => loadConfig(configPath),
    (error: unknown) => {
      assert.match(String(error), /Configuration validation failed/);
      assert.match(String(error), /artifacts: Unrecognized key\(s\) in object: 'runRoot', 'retainRuns'/);
      return true;
    }
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});