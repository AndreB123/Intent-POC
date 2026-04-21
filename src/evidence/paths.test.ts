import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LoadedConfig } from "../config/load-config";
import { configSchema } from "../config/schema";
import { createRunPaths } from "./paths";

function buildLoadedConfig(tmpRoot: string, options: { publishToLibrary?: boolean } = {}): LoadedConfig {
  return {
    configPath: path.join(tmpRoot, "intent-poc.yaml"),
    configDir: tmpRoot,
    config: configSchema.parse({
      version: 1,
      linear: {
        enabled: false,
        apiKeyEnv: "LINEAR_API_KEY",
        teamId: "ENG",
        createIssueOnStart: false,
        commentOnProgress: false,
        commentOnCompletion: false
      },
      agent: {
        mode: "bounded-runner"
      },
      sources: {
        app: {
          aliases: [],
          source: {
            type: "local",
            localPath: "."
          },
          workspace: {
            checkoutMode: "existing"
          },
          app: {
            workdir: ".",
            startCommand: "echo no-op",
            baseUrl: "http://127.0.0.1:3000",
            readiness: {
              type: "http",
              url: "http://127.0.0.1:3000",
              expectedStatus: 200,
              timeoutMs: 30_000,
              intervalMs: 250
            }
          },
          capture: {
            publishToLibrary: options.publishToLibrary ?? false,
            items: [
              {
                id: "home",
                path: "/"
              }
            ]
          }
        }
      },
      playwright: {
        browser: "chromium",
        headless: true,
        viewport: {
          width: 1280,
          height: 720
        },
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: "light",
        disableAnimations: true,
        extraHTTPHeaders: {}
      },
      artifacts: {
        storageMode: "controller",
        root: path.join(tmpRoot, "artifacts"),
        libraryRoot: path.join(tmpRoot, "artifacts", "library"),
        cleanBeforeRun: true
      },
      comparison: {
        enabled: true,
        hashAlgorithm: "sha256",
        diffMethod: "pixelmatch",
        pixelThreshold: 0.01,
        failOnChange: false,
        onMissingBaseline: "error",
        writeDiffImages: true
      },
      run: {
        sourceId: "app",
        intent: "Verify current behavior.",
        captureIds: [],
        continueOnCaptureError: false,
        metadata: {},
        dryRun: false
      }
    })
  };
}

test("createRunPaths Given cleanBeforeRun When durable artifacts exist Then it removes only transient run directories", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-paths-"));

  try {
    const artifactRoot = path.join(tmpRoot, "artifacts");
    const businessFile = path.join(artifactRoot, "business", "summary.md");
    const captureFile = path.join(artifactRoot, "sources", "app", "captures", "existing.png");
    const manifestFile = path.join(artifactRoot, "sources", "app", "manifest.json");
    const attemptFile = path.join(artifactRoot, "sources", "app", "attempts", "attempt-1.log");
    const appLogFile = path.join(artifactRoot, "sources", "app", "logs", "app.log");
    const legacyRunFile = path.join(artifactRoot, "runs", "legacy-run", "summary.md");

    await Promise.all([
      fs.mkdir(path.dirname(businessFile), { recursive: true }),
      fs.mkdir(path.dirname(captureFile), { recursive: true }),
      fs.mkdir(path.dirname(manifestFile), { recursive: true }),
      fs.mkdir(path.dirname(attemptFile), { recursive: true }),
      fs.mkdir(path.dirname(appLogFile), { recursive: true }),
      fs.mkdir(path.dirname(legacyRunFile), { recursive: true })
    ]);

    await Promise.all([
      fs.writeFile(businessFile, "business summary\n", "utf8"),
      fs.writeFile(captureFile, "capture", "utf8"),
      fs.writeFile(manifestFile, "{}\n", "utf8"),
      fs.writeFile(attemptFile, "attempt\n", "utf8"),
      fs.writeFile(appLogFile, "log\n", "utf8"),
      fs.writeFile(legacyRunFile, "legacy\n", "utf8")
    ]);

    const paths = await createRunPaths(buildLoadedConfig(tmpRoot), ["app"]);

    await assert.doesNotReject(() => fs.access(businessFile));
    await assert.doesNotReject(() => fs.access(captureFile));
    await assert.doesNotReject(() => fs.access(manifestFile));
    await assert.rejects(() => fs.access(attemptFile));
    await assert.rejects(() => fs.access(appLogFile));
    await assert.rejects(() => fs.access(legacyRunFile));
    await assert.doesNotReject(() => fs.access(paths.sourceRuns.app.attemptsDir));
    await assert.doesNotReject(() => fs.access(paths.sourceRuns.app.logsDir));
    assert.equal(paths.runDir, path.join(artifactRoot, "business"));
    assert.equal(paths.sourceRuns.app.capturesDir, path.join(artifactRoot, "sources", "app", "captures"));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("createRunPaths Given a publish-to-library source When paths are created Then captures write directly into the tracked library root", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-library-paths-"));

  try {
    const artifactRoot = path.join(tmpRoot, "artifacts");
    const paths = await createRunPaths(buildLoadedConfig(tmpRoot, { publishToLibrary: true }), ["app"]);

    assert.equal(paths.sourceRuns.app.capturesDir, path.join(artifactRoot, "library", "app"));
    assert.equal(paths.sourceRuns.app.baselineSourceDir, path.join(artifactRoot, "library", "app"));
    await assert.doesNotReject(() => fs.access(paths.sourceRuns.app.capturesDir));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("createRunPaths Given publish-to-library is enabled by the run option When paths are created Then captures still write directly into the tracked library root", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-library-override-paths-"));

  try {
    const artifactRoot = path.join(tmpRoot, "artifacts");
    const paths = await createRunPaths(buildLoadedConfig(tmpRoot), ["app"], { publishToLibrary: true });

    assert.equal(paths.sourceRuns.app.capturesDir, path.join(artifactRoot, "library", "app"));
    assert.equal(paths.sourceRuns.app.baselineSourceDir, path.join(artifactRoot, "library", "app"));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("createRunPaths Given stale source capture duplicates for a publish-to-library source When cleanBeforeRun runs Then it removes the duplicate source capture directory", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-library-cleanup-"));

  try {
    const staleCaptureFile = path.join(tmpRoot, "artifacts", "sources", "app", "captures", "old.png");
    const trackedCaptureFile = path.join(tmpRoot, "artifacts", "library", "app", "current.png");

    await fs.mkdir(path.dirname(staleCaptureFile), { recursive: true });
    await fs.mkdir(path.dirname(trackedCaptureFile), { recursive: true });
    await fs.writeFile(staleCaptureFile, "stale", "utf8");
    await fs.writeFile(trackedCaptureFile, "tracked", "utf8");

    const paths = await createRunPaths(buildLoadedConfig(tmpRoot, { publishToLibrary: true }), ["app"]);

    await assert.rejects(() => fs.access(staleCaptureFile));
    await assert.doesNotReject(() => fs.access(trackedCaptureFile));
    assert.equal(paths.sourceRuns.app.capturesDir, path.join(tmpRoot, "artifacts", "library", "app"));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
