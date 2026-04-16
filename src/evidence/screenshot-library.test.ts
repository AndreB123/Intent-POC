import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CaptureOutcome } from "../capture/capture-target";
import { ComparisonSummary } from "../compare/run-comparison";
import { configSchema, RunMode } from "../config/schema";
import { NormalizedIntent } from "../intent/intent-types";
import { readJsonFile } from "../shared/fs";
import { ScreenshotLibraryUpdateMode, updateScreenshotLibrary } from "./screenshot-library";

function buildConfig(tmpRoot: string) {
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
      library: {
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
          items: [
            {
              id: "home",
              path: "/",
              relativeOutputPath: "pages/home.png"
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
      runRoot: path.join(tmpRoot, "runs"),
      libraryRoot: path.join(tmpRoot, "library")
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
      sourceId: "library",
      mode: "baseline",
      captureIds: [],
      continueOnCaptureError: false,
      allowBaselinePromotion: false,
      metadata: {},
      dryRun: false
    }
  });
}

function buildNormalizedIntent(runMode: RunMode): NormalizedIntent {
  return {
    intentId: "intent-1",
    receivedAt: "2026-04-15T00:00:00.000Z",
    rawPrompt: "Refresh the screenshot library.",
    summary: "refresh screenshot library",
    intentType: runMode,
    businessIntent: {
      statement: "Refresh the screenshot library.",
      desiredOutcome: "Library reflects the latest approved captures.",
      acceptanceCriteria: [],
      scenarios: [],
      workItems: []
    },
    planning: {
      repoCandidates: [],
      plannerSections: [],
      reviewNotes: [],
      linearPlan: {
        mode: "new"
      }
    },
    executionPlan: {
      primarySourceId: "library",
      sources: [],
      destinations: [],
      tools: [],
      orchestrationStrategy: "single-source",
      reviewNotes: []
    },
    sourceId: "library",
    captureScope: {
      mode: "all",
      captureIds: []
    },
    artifacts: {
      requireScreenshots: true,
      requireManifest: true,
      requireHashes: true,
      requireComparison: true
    },
    linear: {
      createIssue: false,
      issueTitle: "IDD: refresh screenshot library"
    },
    execution: {
      runMode,
      continueOnCaptureError: false
    },
    normalizationMeta: {
      source: "rules",
      warnings: [],
      stages: []
    }
  };
}

function buildComparison(mode: RunMode): ComparisonSummary {
  return {
    mode,
    hasDrift: false,
    counts: {
      "baseline-written": 1,
      unchanged: 0,
      changed: 0,
      "missing-baseline": 0,
      "capture-failed": 0,
      "diff-error": 0
    },
    items: [
      {
        captureId: "home",
        status: "baseline-written",
        currentPath: "pages/home.png",
        baselinePath: "pages/home.png",
        currentHash: "capture-hash",
        baselineHash: "capture-hash"
      }
    ]
  };
}

function buildCapture(outputPath: string): CaptureOutcome {
  return {
    captureId: "home",
    path: "/",
    url: "http://127.0.0.1:3000/",
    kind: "page",
    outputPath,
    relativeOutputPath: "pages/home.png",
    durationMs: 10,
    viewport: { width: 1280, height: 720 },
    status: "captured",
    hash: "capture-hash",
    warnings: []
  };
}

test("updateScreenshotLibrary writes captured assets for baseline and approve-baseline modes", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-screenshot-library-"));

  try {
    for (const mode of ["baseline", "approve-baseline"] as ScreenshotLibraryUpdateMode[]) {
      const config = buildConfig(tmpRoot);
      const stagedRoot = path.join(tmpRoot, `staged-${mode}`);
      const capturePath = path.join(stagedRoot, "pages", "home.png");
      await fs.mkdir(path.dirname(capturePath), { recursive: true });
      await fs.writeFile(capturePath, `${mode}-capture`, "utf8");

      const result = await updateScreenshotLibrary({
        config,
        sourceId: "library",
        runId: `run-${mode}`,
        mode,
        captures: [buildCapture(capturePath)],
        comparison: buildComparison(mode),
        normalizedIntent: buildNormalizedIntent(mode)
      });

      const copiedImagePath = path.join(result.sourceLibraryRoot, "pages", "home.png");
      const manifestPath = path.join(result.sourceLibraryRoot, "manifest.json");
      const manifest = await readJsonFile<{ mode: RunMode; runId: string; captureCount: number }>(manifestPath);

      assert.equal(await fs.readFile(copiedImagePath, "utf8"), `${mode}-capture`);
      assert.equal(manifest?.mode, mode);
      assert.equal(manifest?.runId, `run-${mode}`);
      assert.equal(manifest?.captureCount, 1);
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("updateScreenshotLibrary rejects compare mode to keep the library read-only during comparisons", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-screenshot-library-compare-"));

  try {
    const config = buildConfig(tmpRoot);
    const stagedRoot = path.join(tmpRoot, "staged-compare");
    const capturePath = path.join(stagedRoot, "pages", "home.png");
    await fs.mkdir(path.dirname(capturePath), { recursive: true });
    await fs.writeFile(capturePath, "compare-capture", "utf8");

    await assert.rejects(
      updateScreenshotLibrary({
        config,
        sourceId: "library",
        runId: "run-compare",
        mode: "compare" as ScreenshotLibraryUpdateMode,
        captures: [buildCapture(capturePath)],
        comparison: {
          ...buildComparison("compare"),
          mode: "compare"
        },
        normalizedIntent: buildNormalizedIntent("compare")
      }),
      /only supported for baseline runs/
    );

    await assert.rejects(fs.access(path.join(tmpRoot, "library", "library")));
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});