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
import { getDemoSurfaceScreenshotPath } from "../demo-app/capture/screenshot-paths";
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
      runRoot: "./artifacts/runs"
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
      captureIds: [],
      continueOnCaptureError: false,
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

    const primitive = captureResult.outcomes.find((outcome) => outcome.captureId === "primitive-color-chip");
    const component = captureResult.outcomes.find((outcome) => outcome.captureId === "component-button-primary");
    const view = captureResult.outcomes.find((outcome) => outcome.captureId === "view-list-overview");
    const page = captureResult.outcomes.find((outcome) => outcome.captureId === "page-analytics-overview");

    assert.ok(primitive);
    assert.ok(component);
    assert.ok(view);
    assert.ok(page);

    assert.equal(primitive.outputPath.endsWith(getDemoSurfaceScreenshotPath(SURFACE_CATALOG[0])), true);
    assert.equal(component.outputPath.endsWith("components/component-button-primary.png"), true);
    assert.equal(view.outputPath.endsWith("views/view-list-overview.png"), true);
    assert.equal(page.outputPath.endsWith("pages/page-analytics-overview.png"), true);

    const comparison = await runComparison(config, "baseline", captureResult.outcomes, baselineDir, diffDir);

    assert.equal(comparison.counts["baseline-written"], SURFACE_CATALOG.length);
    assert.equal(comparison.counts.changed, 0);
    assert.equal(comparison.hasDrift, false);

    await fs.access(path.join(baselineDir, "components", "component-button-primary.png"));
    await fs.access(path.join(baselineDir, "views", "view-list-overview.png"));
    await fs.access(path.join(baselineDir, "pages", "page-analytics-overview.png"));
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

test("compare mode reads an existing baseline library without rewriting tracked files", async (t) => {
  if (!(await ensurePlaywrightAvailable(t))) {
    return;
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-capture-readonly-"));
  const baselineCapturesDir = path.join(tmpRoot, "captures-baseline");
  const compareCapturesDir = path.join(tmpRoot, "captures-compare");
  const libraryDir = path.join(tmpRoot, "library", "component-library");
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
    await runComparison(config, "baseline", baselineCapture.outcomes, libraryDir, diffDir);

    const trackedImagePath = path.join(libraryDir, "components", "component-button-primary.png");
    const manifestPath = path.join(libraryDir, "manifest.json");
    const baselineImageBefore = await fs.readFile(trackedImagePath);
    const manifestBefore = JSON.stringify({
      runId: "seed-baseline",
      mode: "baseline",
      note: "sentinel"
    }, null, 2);
    await fs.writeFile(manifestPath, `${manifestBefore}\n`, "utf8");

    server.setVariant("v2");

    const compareCapture = await runCapture(
      config,
      workspace,
      workspace.source.capture.items,
      compareCapturesDir,
      tmpRoot,
      false
    );
    const comparison = await runComparison(config, "compare", compareCapture.outcomes, libraryDir, diffDir);

    assert.equal(comparison.hasDrift, true);
    assert.ok(comparison.counts.changed > 0);
    assert.deepEqual(await fs.readFile(trackedImagePath), baselineImageBefore);
    assert.equal(await fs.readFile(manifestPath, "utf8"), `${manifestBefore}\n`);
  } finally {
    await server.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("compare mode treats bootstrap config as read-only missing-baseline behavior", async (t) => {
  if (!(await ensurePlaywrightAvailable(t))) {
    return;
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-capture-bootstrap-readonly-"));
  const compareCapturesDir = path.join(tmpRoot, "captures-compare");
  const libraryDir = path.join(tmpRoot, "library", "component-library");
  const diffDir = path.join(tmpRoot, "diffs");

  const server = await startSurfaceCatalogServer(SURFACE_CATALOG);
  const config = buildConfig(server.baseUrl);
  config.comparison.onMissingBaseline = "bootstrap";
  const workspace = buildWorkspace(config, tmpRoot);
  const captureItems = workspace.source.capture.items.filter((item) => item.id === "component-button-primary");

  try {
    const compareCapture = await runCapture(
      config,
      workspace,
      captureItems,
      compareCapturesDir,
      tmpRoot,
      false
    );
    const comparison = await runComparison(config, "compare", compareCapture.outcomes, libraryDir, diffDir);

    assert.equal(comparison.counts["baseline-written"], 0);
    assert.equal(comparison.counts["missing-baseline"], 1);
    assert.equal(comparison.hasDrift, true);
    assert.equal(comparison.items[0]?.status, "missing-baseline");
    assert.ok(comparison.items[0]?.note?.includes("Compare mode keeps the baseline library read-only"));
    await assert.rejects(fs.access(path.join(libraryDir, "components", "component-button-primary.png")));
    await assert.rejects(fs.access(path.join(libraryDir, "manifest.json")));
  } finally {
    await server.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("compare mode rejects baseline libraries whose manifest was generated by compare mode", async (t) => {
  if (!(await ensurePlaywrightAvailable(t))) {
    return;
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-capture-compare-manifest-"));
  const baselineCapturesDir = path.join(tmpRoot, "captures-baseline");
  const compareCapturesDir = path.join(tmpRoot, "captures-compare");
  const libraryDir = path.join(tmpRoot, "library", "component-library");
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
    await runComparison(config, "baseline", baselineCapture.outcomes, libraryDir, diffDir);

    const trackedImagePath = path.join(libraryDir, "components", "component-button-primary.png");
    const manifestPath = path.join(libraryDir, "manifest.json");
    const baselineImageBefore = await fs.readFile(trackedImagePath);
    const manifestBefore = JSON.stringify(
      {
        runId: "compare-tainted-run",
        mode: "compare",
        note: "sentinel"
      },
      null,
      2
    );
    await fs.writeFile(manifestPath, `${manifestBefore}\n`, "utf8");

    server.setVariant("v2");

    const compareCapture = await runCapture(
      config,
      workspace,
      workspace.source.capture.items,
      compareCapturesDir,
      tmpRoot,
      false
    );

    await assert.rejects(
      runComparison(config, "compare", compareCapture.outcomes, libraryDir, diffDir),
      /manifest was generated by compare mode/
    );

    assert.deepEqual(await fs.readFile(trackedImagePath), baselineImageBefore);
    assert.equal(await fs.readFile(manifestPath, "utf8"), `${manifestBefore}\n`);
  } finally {
    await server.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});