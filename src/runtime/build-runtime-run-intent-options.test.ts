import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRuntimeRunIntentOptions } from "./build-runtime-run-intent-options";

async function writeConfig(configPath: string): Promise<void> {
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
      "  tracked:",
      "    source:",
      "      type: local",
      "      localPath: .",
      "    workspace:",
      "      checkoutMode: existing",
      "    app:",
      "      workdir: .",
      "      startCommand: echo tracked",
      "      baseUrl: http://127.0.0.1:3000",
      "      readiness:",
      "        type: http",
      "        url: http://127.0.0.1:3000/health",
      "    capture:",
      "      catalog: surface-library",
      "  publish-enabled:",
      "    source:",
      "      type: local",
      "      localPath: .",
      "    workspace:",
      "      checkoutMode: existing",
      "    app:",
      "      workdir: .",
      "      startCommand: echo publish-enabled",
      "      baseUrl: http://127.0.0.1:3001",
      "      readiness:",
      "        type: http",
      "        url: http://127.0.0.1:3001/health",
      "    capture:",
      "      publishToLibrary: true",
      "      items:",
      "        - id: publish-enabled-home",
      "          path: /",
      "  app:",
      "    source:",
      "      type: local",
      "      localPath: .",
      "    workspace:",
      "      checkoutMode: existing",
      "    app:",
      "      workdir: .",
      "      startCommand: echo app",
      "      baseUrl: http://127.0.0.1:3002",
      "      readiness:",
      "        type: http",
      "        url: http://127.0.0.1:3002/health",
      "    capture:",
      "      items:",
      "        - id: app-home",
      "          path: /",
      "playwright:",
      "  browser: chromium",
      "artifacts:",
      "  storageMode: controller",
      "  root: ./artifacts",
      "comparison:",
      "  hashAlgorithm: sha256",
      "run:",
      "  sourceId: tracked",
      "  intent: Test runtime policy",
      "  captureIds: []",
      "  continueOnCaptureError: false",
      "  metadata: {}",
      "  dryRun: true"
    ].join("\n"),
    "utf8"
  );
}

test("buildRuntimeRunIntentOptions enables tracked-library publishing for surface-library sources", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-runtime-policy-"));
  const configPath = path.join(tmpRoot, "intent-poc.yaml");

  await writeConfig(configPath);

  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const options = await buildRuntimeRunIntentOptions({
    configPath,
    intent: "Refresh the tracked library."
  });

  assert.equal(options.publishToLibrary, true);
  assert.equal(options.sourceIds, undefined);
});

test("buildRuntimeRunIntentOptions preserves non-library runs when requested sources are mixed", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-runtime-policy-"));
  const configPath = path.join(tmpRoot, "intent-poc.yaml");

  await writeConfig(configPath);

  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const options = await buildRuntimeRunIntentOptions({
    configPath,
    intent: "Run a mixed source scope.",
    sourceIds: ["tracked", "app"]
  });

  assert.equal(options.publishToLibrary, undefined);
  assert.deepEqual(options.sourceIds, ["tracked", "app"]);
});

test("buildRuntimeRunIntentOptions respects an explicit publish-to-library override", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-runtime-policy-"));
  const configPath = path.join(tmpRoot, "intent-poc.yaml");

  await writeConfig(configPath);

  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const options = await buildRuntimeRunIntentOptions({
    configPath,
    intent: "Force tracked publishing for one source.",
    sourceIds: ["app"],
    publishToLibrary: true
  });

  assert.equal(options.publishToLibrary, true);
  assert.deepEqual(options.sourceIds, ["app"]);
});

test("buildRuntimeRunIntentOptions passes through a reviewed normalized intent", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-runtime-policy-reviewed-"));
  const configPath = path.join(tmpRoot, "intent-poc.yaml");

  await writeConfig(configPath);

  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reviewedIntent = { intentId: "reviewed-intent-1" } as never;
  const options = await buildRuntimeRunIntentOptions({
    configPath,
    intent: "Run from reviewed intent.",
    normalizedIntent: reviewedIntent
  });

  assert.equal(options.normalizedIntent, reviewedIntent);
});

test("buildRuntimeRunIntentOptions rejects legacy artifact keys during config load", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-runtime-policy-legacy-"));
  const configPath = path.join(tmpRoot, "intent-poc.yaml");

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
      "  app:",
      "    source:",
      "      type: local",
      "      localPath: .",
      "    workspace:",
      "      checkoutMode: existing",
      "    app:",
      "      workdir: .",
      "      startCommand: echo app",
      "      baseUrl: http://127.0.0.1:3002",
      "      readiness:",
      "        type: http",
      "        url: http://127.0.0.1:3002/health",
      "    capture:",
      "      items:",
      "        - id: app-home",
      "          path: /",
      "playwright:",
      "  browser: chromium",
      "artifacts:",
      "  storageMode: controller",
      "  root: ./artifacts",
      "  runRoot: ./artifacts/runs",
      "comparison:",
      "  hashAlgorithm: sha256",
      "run:",
      "  sourceId: app",
      "  intent: Test runtime policy",
      "  captureIds: []",
      "  continueOnCaptureError: false",
      "  metadata: {}",
      "  dryRun: true"
    ].join("\n"),
    "utf8"
  );

  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    () =>
      buildRuntimeRunIntentOptions({
        configPath,
        intent: "Run with legacy keys"
      }),
    (error: unknown) => {
      assert.match(String(error), /Configuration validation failed/);
      assert.match(String(error), /artifacts: Unrecognized key\(s\) in object: 'runRoot'/);
      return true;
    }
  );
});