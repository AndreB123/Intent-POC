import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { runCapture } from "./run-capture";
import { runComparison } from "../compare/run-comparison";
import { configSchema } from "../config/schema";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import { buildCaptureItemsFromCatalog } from "../demo-app/capture/build-capture-items";
import { SURFACE_CATALOG } from "../demo-app/model/catalog";
import { startSurfaceCatalogServer } from "../demo-app/server/start-surface-catalog-server";

function buildConfig(baseUrl: string) {
  return configSchema.parse({
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
      "component-library": {
        aliases: ["components"],
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
          baseUrl,
          readiness: {
            type: "http",
            url: baseUrl,
            expectedStatus: 200,
            timeoutMs: 30_000,
            intervalMs: 250
          }
        },
        capture: {
          waitAfterLoadMs: 0,
          injectCss: [],
          defaultFullPage: false,
          items: buildCaptureItemsFromCatalog(SURFACE_CATALOG)
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
      runRoot: "./artifacts/runs",
      baselineRoot: "./evidence/baselines"
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
      sourceId: "component-library",
      mode: "compare",
      captureIds: [],
      continueOnCaptureError: false,
      allowBaselinePromotion: false,
      metadata: {},
      dryRun: false
    }
  });
}

function buildWorkspace(config: ReturnType<typeof buildConfig>, rootDir: string): ResolvedSourceWorkspace {
  return {
    sourceId: "component-library",
    source: config.sources["component-library"],
    rootDir,
    appDir: rootDir,
    baseUrl: config.sources["component-library"].app.baseUrl,
    sourceType: "local"
  };
}

async function ensurePlaywrightAvailable(t: test.TestContext): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    t.skip("Playwright Chromium is not installed. Run 'npm run install:browsers'.");
    return false;
  }
}

test("creates a component screenshot baseline library via Playwright", async (t) => {
  if (!(await ensurePlaywrightAvailable(t))) {
    return;
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-capture-baseline-"));
  const capturesDir = path.join(tmpRoot, "captures");
  const baselineDir = path.join(tmpRoot, "baseline", "component-library");
  const diffDir = path.join(tmpRoot, "diffs");

  const server = await startSurfaceCatalogServer(SURFACE_CATALOG);
  const config = buildConfig(server.baseUrl);
  const workspace = buildWorkspace(config, tmpRoot);

  try {
    const captureResult = await runCapture(
      config,
      workspace,
      workspace.source.capture.items,
      capturesDir,
      tmpRoot,
      false
    );

    assert.equal(captureResult.abortedDueToError, false);
    assert.equal(captureResult.outcomes.length, SURFACE_CATALOG.length);
    for (const outcome of captureResult.outcomes) {
      assert.equal(outcome.status, "captured");
      assert.ok(outcome.hash, `Expected hash for capture '${outcome.captureId}'.`);
      await fs.access(outcome.outputPath);
    }

    const comparison = await runComparison(config, "baseline", captureResult.outcomes, baselineDir, diffDir);

    assert.equal(comparison.counts["baseline-written"], SURFACE_CATALOG.length);
    assert.equal(comparison.counts.changed, 0);
    assert.equal(comparison.hasDrift, false);

    await fs.access(path.join(baselineDir, "images", "component-button-primary.png"));
    await fs.access(path.join(baselineDir, "images", "view-list-overview.png"));
    await fs.access(path.join(baselineDir, "images", "page-analytics-overview.png"));
  } finally {
    await server.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("detects drift when a global theme update occurs", async (t) => {
  if (!(await ensurePlaywrightAvailable(t))) {
    return;
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-capture-drift-"));
  const baselineCapturesDir = path.join(tmpRoot, "captures-baseline");
  const compareCapturesDir = path.join(tmpRoot, "captures-compare");
  const baselineDir = path.join(tmpRoot, "baseline", "component-library");
  const diffDir = path.join(tmpRoot, "diffs");

  const server = await startSurfaceCatalogServer(SURFACE_CATALOG);
  const config = buildConfig(server.baseUrl);
  const workspace = buildWorkspace(config, tmpRoot);

  try {
    const baselineCapture = await runCapture(
      config,
      workspace,
      workspace.source.capture.items,
      baselineCapturesDir,
      tmpRoot,
      false
    );
    await runComparison(config, "baseline", baselineCapture.outcomes, baselineDir, diffDir);

    server.setVariant("v2");

    const compareCapture = await runCapture(
      config,
      workspace,
      workspace.source.capture.items,
      compareCapturesDir,
      tmpRoot,
      false
    );
    const comparison = await runComparison(config, "compare", compareCapture.outcomes, baselineDir, diffDir);

    assert.equal(
      comparison.counts.changed,
      SURFACE_CATALOG.filter((component) => component.changesInV2).length
    );
    assert.equal(
      comparison.counts.unchanged,
      SURFACE_CATALOG.filter((component) => !component.changesInV2).length
    );
    assert.equal(comparison.hasDrift, true);

    const changed = comparison.items.find((item) => item.captureId === "component-button-primary");
    assert.ok(changed, "Expected component-button-primary comparison result.");
    assert.equal(changed.status, "changed");
    assert.ok(changed.diffImagePath, "Expected a diff image path for changed capture.");
    await fs.access(changed.diffImagePath as string);

    const changedView = comparison.items.find((item) => item.captureId === "view-list-overview");
    assert.ok(changedView, "Expected view-list-overview comparison result.");
    assert.equal(changedView.status, "changed");
  } finally {
    await server.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});