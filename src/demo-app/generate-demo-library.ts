import path from "node:path";
import { runCapture } from "../capture/run-capture";
import { runComparison } from "../compare/run-comparison";
import { configSchema } from "../config/schema";
import { updateScreenshotLibrary, listFilesRecursive } from "../evidence/screenshot-library";
import { normalizeIntent } from "../intent/normalize-intent";
import { log } from "../shared/log";
import { ResolvedSourceWorkspace } from "../target/resolve-target";
import { buildCaptureItemsFromCatalog } from "./capture/build-capture-items";
import { SURFACE_CATALOG } from "./model/catalog";
import { startSurfaceCatalogServer } from "./server/start-surface-catalog-server";

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
      "demo-components": {
        aliases: ["components"],
        source: {
          type: "local",
          localPath: process.cwd()
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
      runRoot: path.join(process.cwd(), "artifacts", "runs"),
      libraryRoot: path.join(process.cwd(), "artifacts", "library"),
      baselineRoot: path.join(process.cwd(), "evidence", "baselines"),
      writeMarkdownSummary: true,
      writeJsonSummary: true,
      retainRuns: 20,
      cleanBeforeRun: false
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
      sourceId: "demo-components",
      mode: "compare",
      captureIds: [],
      continueOnCaptureError: false,
      allowBaselinePromotion: false,
      metadata: {},
      dryRun: false
    }
  });
}

function buildWorkspace(config: ReturnType<typeof buildConfig>): ResolvedSourceWorkspace {
  return {
    sourceId: "demo-components",
    source: config.sources["demo-components"],
    rootDir: process.cwd(),
    appDir: process.cwd(),
    baseUrl: config.sources["demo-components"].app.baseUrl,
    sourceType: "local"
  };
}

async function runDemoLibrary(): Promise<void> {
  const server = await startSurfaceCatalogServer(SURFACE_CATALOG);
  const config = buildConfig(server.baseUrl);
  const workspace = buildWorkspace(config);

  try {
    const normalizedIntentBaseline = normalizeIntent({
      rawPrompt: "Create baseline screenshot library for demo components",
      runMode: "baseline",
      defaultSourceId: "demo-components",
      continueOnCaptureError: false,
      linearEnabled: false,
      publishToSourceWorkspace: false,
      availableSources: {
        "demo-components": {
          aliases: ["components"],
          capture: workspace.source.capture
        }
      }
    });

    const baselineCapturesDir = path.join(process.cwd(), "artifacts", "runs", "demo-baseline-captures");
    const baselineDiffsDir = path.join(process.cwd(), "artifacts", "runs", "demo-baseline-diffs");
    const baselineRoot = path.join(process.cwd(), "evidence", "baselines", "demo-components");

    const baselineCapture = await runCapture(
      config,
      workspace,
      workspace.source.capture.items,
      baselineCapturesDir,
      process.cwd(),
      false
    );
    const baselineComparison = await runComparison(
      config,
      "baseline",
      baselineCapture.outcomes,
      baselineRoot,
      baselineDiffsDir
    );

    await updateScreenshotLibrary({
      config,
      sourceId: workspace.sourceId,
      runId: "demo-baseline",
      mode: "baseline",
      captures: baselineCapture.outcomes,
      comparison: baselineComparison,
      normalizedIntent: normalizedIntentBaseline
    });

    server.setVariant("v2");

    const normalizedIntentCompare = normalizeIntent({
      rawPrompt: "Compare screenshot drift for demo components",
      runMode: "compare",
      defaultSourceId: "demo-components",
      continueOnCaptureError: false,
      linearEnabled: false,
      publishToSourceWorkspace: false,
      availableSources: {
        "demo-components": {
          aliases: ["components"],
          capture: workspace.source.capture
        }
      }
    });

    const compareCapturesDir = path.join(process.cwd(), "artifacts", "runs", "demo-compare-captures");
    const compareDiffsDir = path.join(process.cwd(), "artifacts", "runs", "demo-compare-diffs");

    const compareCapture = await runCapture(
      config,
      workspace,
      workspace.source.capture.items,
      compareCapturesDir,
      process.cwd(),
      false
    );
    const compareComparison = await runComparison(
      config,
      "compare",
      compareCapture.outcomes,
      baselineRoot,
      compareDiffsDir
    );

    const libraryResult = await updateScreenshotLibrary({
      config,
      sourceId: workspace.sourceId,
      runId: "demo-compare",
      mode: "compare",
      captures: compareCapture.outcomes,
      comparison: compareComparison,
      normalizedIntent: normalizedIntentCompare
    });

    const files = await listFilesRecursive(libraryResult.sourceLibraryRoot);
    const imageCount = files.filter((file) => file.endsWith(".png")).length;
    log.info("Demo screenshot library generated.", {
      sourceId: workspace.sourceId,
      libraryRoot: libraryResult.sourceLibraryRoot,
      surfaceCount: SURFACE_CATALOG.length,
      layerBreakdown: {
        primitive: SURFACE_CATALOG.filter((item) => item.layer === "primitive").length,
        component: SURFACE_CATALOG.filter((item) => item.layer === "component").length,
        view: SURFACE_CATALOG.filter((item) => item.layer === "view").length,
        page: SURFACE_CATALOG.filter((item) => item.layer === "page").length
      },
      imageCount,
      comparisonCounts: compareComparison.counts,
      files: files.map((file) => path.relative(process.cwd(), file))
    });
  } finally {
    await server.close();
  }
}

void runDemoLibrary().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});