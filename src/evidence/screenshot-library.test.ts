import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CaptureOutcome } from "../capture/capture-target";
import { configSchema } from "../config/schema";
import { NormalizedIntent } from "../intent/intent-types";
import { readJsonFile } from "../shared/fs";
import { updateScreenshotLibrary } from "./screenshot-library";

type ComparisonMode = "baseline" | "compare" | "approve-baseline";

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
          publishToLibrary: true,
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
      root: tmpRoot,
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
      captureIds: [],
      continueOnCaptureError: false,
      metadata: {},
      dryRun: false
    }
  });
}

function buildNormalizedIntent(intentType: NormalizedIntent["intentType"]): NormalizedIntent {
  return {
    intentId: "intent-1",
    receivedAt: "2026-04-15T00:00:00.000Z",
    rawPrompt: "Refresh the screenshot library.",
    summary: "change behavior for library",
    intentType,
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
      requireHashes: true
    },
    linear: {
      createIssue: false,
      issueTitle: "IDD: refresh screenshot library"
    },
    execution: {
      continueOnCaptureError: false
    },
    normalizationMeta: {
      source: "rules",
      warnings: [],
      requestedPlanningDepth: "full",
      effectivePlanningDepth: "full",
      ambiguity: {
        isAmbiguous: false,
        reasons: []
      },
      stages: []
    }
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

test("updateScreenshotLibrary writes captured assets for tracked screenshot sources", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-screenshot-library-"));

  try {
    const intentType: NormalizedIntent["intentType"] = "change-behavior";
    const config = buildConfig(tmpRoot);
    const stagedRoot = path.join(tmpRoot, `staged-${intentType}`);
    const capturePath = path.join(stagedRoot, "pages", "home.png");
    await fs.mkdir(path.dirname(capturePath), { recursive: true });
    await fs.writeFile(capturePath, `${intentType}-capture`, "utf8");

    const result = await updateScreenshotLibrary({
      config,
      sourceId: "library",
      runId: `run-${intentType}`,
      captures: [buildCapture(capturePath)],
      normalizedIntent: buildNormalizedIntent(intentType)
    });

    const copiedImagePath = path.join(result.sourceLibraryRoot, "pages", "home.png");
    const manifestPath = path.join(result.sourceLibraryRoot, "manifest.json");
    const manifest = await readJsonFile<{ runId: string; captureCount: number; failedCaptureCount: number }>(manifestPath);

    assert.equal(await fs.readFile(copiedImagePath, "utf8"), `${intentType}-capture`);
    assert.equal(manifest?.runId, `run-${intentType}`);
    assert.equal(manifest?.captureCount, 1);
    assert.equal(manifest?.failedCaptureCount, 0);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});