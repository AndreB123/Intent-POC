import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ComparisonSummary } from "../compare/run-comparison";
import { normalizeIntent } from "../intent/normalize-intent";
import { readJsonFile } from "../shared/fs";
import {
  buildBehaviorTestLoadedConfig,
  buildCapturedOutcome,
  buildComparisonSummary,
  buildSourceRunAttemptRecord
} from "../orchestrator/run-intent.test-support";
import { createRunPaths } from "./paths";
import {
  SourceEvidenceRecord,
  writeBusinessEvidenceFiles,
  writePlanLifecycleFile,
  writeSourceEvidenceFiles
} from "./write-manifest";

function buildNormalizedIntentForLoadedConfig(
  loadedConfig: ReturnType<typeof buildBehaviorTestLoadedConfig>,
  sourceId: string
) {
  return normalizeIntent({
    rawPrompt: "Generate stable evidence for configured source.",
    defaultSourceId: sourceId,
    continueOnCaptureError: false,
    availableSources: loadedConfig.config.sources,
    requestedSourceIds: [sourceId]
  });
}

test("writeSourceEvidenceFiles serializes comparison and command paths as controller-relative paths", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-write-source-evidence-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);
  const sourceId = loadedConfig.config.run.sourceId;

  try {
    const paths = await createRunPaths(loadedConfig, [sourceId]);
    const sourcePaths = paths.sourceRuns[sourceId];
    const normalizedIntent = buildNormalizedIntentForLoadedConfig(loadedConfig, sourceId);

    const attempts = [
      buildSourceRunAttemptRecord({
        targetedWorkItemIds: ["work-1"],
        completedInAttemptWorkItemIds: ["work-1"],
        pendingTargetedWorkItemIds: [],
        completedWorkItemIds: ["work-1"],
        remainingWorkItemIds: [],
        qaVerification: {
          status: "completed",
          summary: "QA verification passed 1 command.",
          targetedWorkItemIds: ["work-1"],
          completedWorkItemIds: ["work-1"],
          remainingWorkItemIds: [],
          commands: [
            {
              label: "typecheck",
              command: "npm run typecheck",
              cwd: tmpRoot,
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:00:01.000Z",
              durationMs: 1000,
              status: "completed",
              exitCode: 0,
              logPath: path.join(sourcePaths.attemptsDir, "attempt-1-qaverification-typecheck.log")
            }
          ],
          fileOperations: []
        }
      })
    ];

    const comparison = buildComparisonSummary({
      hasDrift: true,
      counts: { changed: 1 },
      items: [
        {
          captureId: "roach-overview",
          status: "changed",
          baselinePath: path.join(tmpRoot, "artifacts", "library", sourceId, "roach-overview.png"),
          currentPath: path.join(sourcePaths.capturesDir, "roach-overview.png"),
          baselineHash: "baseline-hash",
          currentHash: "current-hash",
          diffImagePath: path.join(sourcePaths.diffsDir, "roach-overview.png"),
          diffPixels: 42,
          diffRatio: 0.25
        }
      ]
    });

    await writeSourceEvidenceFiles({
      loadedConfig,
      config: loadedConfig.config,
      paths: sourcePaths,
      normalizedIntent,
      linearIssue: null,
      captures: [buildCapturedOutcome(tmpRoot, "roach-overview")],
      comparison,
      status: "completed",
      attempts,
      generatedPlaywrightTests: [path.join(tmpRoot, "tests", "intent", sourceId, "verify.spec.ts")]
    });

    const manifest = await readJsonFile<Record<string, unknown>>(sourcePaths.manifestPath);
    const comparisonJson = await readJsonFile<{
      items: ComparisonSummary["items"];
    }>(sourcePaths.comparisonPath);

    assert.ok(manifest);
    const serializedManifest = JSON.stringify(manifest);
    assert.equal(serializedManifest.includes("runRoot"), false);
    assert.equal(serializedManifest.includes("retainRuns"), false);

    const attemptsInManifest = (manifest?.attempts as Array<{ qaVerification?: { commands?: Array<{ logPath?: string }> } }>) ?? [];
    const commandLogPath = attemptsInManifest[0]?.qaVerification?.commands?.[0]?.logPath;
    assert.equal(commandLogPath?.startsWith("artifacts/"), true);
    assert.equal(commandLogPath?.includes(tmpRoot), false);

    const generatedTests = ((manifest?.source as { generatedPlaywrightTests?: string[] })?.generatedPlaywrightTests) ?? [];
    assert.equal(generatedTests[0]?.startsWith("tests/intent/"), true);
    assert.equal(generatedTests[0]?.includes(tmpRoot), false);

    const firstComparisonItem = comparisonJson?.items[0];
    assert.ok(firstComparisonItem);
    assert.equal(firstComparisonItem?.baselinePath?.startsWith("artifacts/"), true);
    assert.equal(firstComparisonItem?.currentPath?.startsWith("artifacts/"), true);
    assert.equal(firstComparisonItem?.diffImagePath?.startsWith("artifacts/"), true);
    assert.equal(firstComparisonItem?.baselinePath?.includes(tmpRoot), false);
    assert.equal(firstComparisonItem?.currentPath?.includes(tmpRoot), false);
    assert.equal(firstComparisonItem?.diffImagePath?.includes(tmpRoot), false);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("writePlanLifecycleFile and writeBusinessEvidenceFiles keep lifecycle and artifact references on stable contract", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-write-business-evidence-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);
  const sourceId = loadedConfig.config.run.sourceId;

  try {
    const paths = await createRunPaths(loadedConfig, [sourceId]);
    const sourcePaths = paths.sourceRuns[sourceId];
    const normalizedIntent = buildNormalizedIntentForLoadedConfig(loadedConfig, sourceId);

    const sourceRuns: SourceEvidenceRecord[] = [
      {
        sourceId,
        status: "completed",
        paths: sourcePaths,
        captures: [buildCapturedOutcome(tmpRoot, "roach-overview")],
        comparison: buildComparisonSummary({ counts: { unchanged: 1 } }),
        linearIssue: null,
        attempts: [
          buildSourceRunAttemptRecord({
            targetedWorkItemIds: ["work-1"],
            completedInAttemptWorkItemIds: ["work-1"],
            pendingTargetedWorkItemIds: [],
            completedWorkItemIds: ["work-1"],
            remainingWorkItemIds: []
          })
        ]
      }
    ];

    await writePlanLifecycleFile({
      config: loadedConfig.config,
      paths,
      normalizedIntent,
      linearPublication: null,
      sourceRuns
    });

    await writeBusinessEvidenceFiles({
      loadedConfig,
      config: loadedConfig.config,
      paths,
      normalizedIntent,
      sourceRuns,
      linearPublication: null,
      status: "completed",
      hasDrift: false,
      counts: {
        "baseline-written": 0,
        unchanged: 1,
        changed: 0,
        "missing-baseline": 0,
        "capture-failed": 0,
        "diff-error": 0
      },
      errors: []
    });

    const planLifecycle = await readJsonFile<Record<string, unknown>>(paths.planLifecyclePath);
    const businessManifest = await readJsonFile<{
      artifacts?: { planLifecyclePath?: string };
      sources?: Array<{ artifacts?: { capturesDir?: string; attemptsDir?: string } }>;
    }>(paths.manifestPath);

    assert.ok(planLifecycle);
    const serializedLifecycle = JSON.stringify(planLifecycle);
    assert.equal(serializedLifecycle.includes("runRoot"), false);
    assert.equal(serializedLifecycle.includes("retainRuns"), false);
    assert.equal(serializedLifecycle.includes("artifacts/runs/"), false);

    assert.equal(businessManifest?.artifacts?.planLifecyclePath, "artifacts/business/plan-lifecycle.json");
    assert.equal(businessManifest?.sources?.[0]?.artifacts?.capturesDir?.startsWith("artifacts/sources/"), true);
    assert.equal(businessManifest?.sources?.[0]?.artifacts?.attemptsDir?.startsWith("artifacts/sources/"), true);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
