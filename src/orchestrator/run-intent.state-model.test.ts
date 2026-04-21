import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ComparisonSummary } from "../compare/run-comparison";
import { readJsonFile } from "../shared/fs";
import {
  buildBehaviorTestLoadedConfig,
  buildCapturedOutcome,
  buildComparisonSummary,
  buildSourceRunAttemptRecord,
  buildSourceRunResult
} from "./run-intent.test-support";
import { createRunIntentRunner } from "./run-intent";

test("runIntent state contract keeps plan lifecycle on stable roots and excludes legacy run-root fields", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-state-contract-dry-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: "Preview source scope and contract shape.",
      dryRun: true
    });

    const planLifecycle = await readJsonFile<Record<string, unknown>>(result.paths.planLifecyclePath);

    assert.equal(result.paths.runDir, path.join(tmpRoot, "artifacts", "business"));
    assert.equal(result.paths.planLifecyclePath, path.join(tmpRoot, "artifacts", "business", "plan-lifecycle.json"));
    assert.equal(result.paths.runDir.includes(`${path.sep}artifacts${path.sep}runs${path.sep}`), false);

    assert.ok(planLifecycle);
    assert.equal(typeof planLifecycle?.runId, "string");
    assert.equal(typeof planLifecycle?.intentId, "string");
    assert.equal(Array.isArray(planLifecycle?.sources), true);

    const serialized = JSON.stringify(planLifecycle);
    assert.equal(serialized.includes("runRoot"), false);
    assert.equal(serialized.includes("retainRuns"), false);
    assert.equal(serialized.includes(`${path.sep}artifacts${path.sep}runs${path.sep}`), false);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("runIntent state contract writes relative artifact references and avoids legacy persistent run paths", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-state-contract-success-"));
  const loadedConfig = buildBehaviorTestLoadedConfig(tmpRoot);

  try {
    const runIntent = createRunIntentRunner({
      loadConfig: async () => loadedConfig,
      executeSourceRun: async (input) =>
        buildSourceRunResult(input, {
          captures: [buildCapturedOutcome(tmpRoot, "roach-statements")],
          attempts: [
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
                    logPath: path.join(tmpRoot, "artifacts", "sources", input.sourcePlan.sourceId, "attempts", "attempt-1-qaverification-typecheck.log")
                  }
                ],
                fileOperations: []
              }
            })
          ],
          comparison: buildComparisonSummary({
            counts: { changed: 1 },
            hasDrift: true,
            items: [
              {
                captureId: "roach-statements",
                status: "changed",
                baselinePath: path.join(tmpRoot, "artifacts", "library", input.sourcePlan.sourceId, "roach-statements.png"),
                currentPath: path.join(tmpRoot, "artifacts", "sources", input.sourcePlan.sourceId, "captures", "roach-statements.png"),
                baselineHash: "baseline-hash",
                currentHash: "current-hash",
                diffImagePath: path.join(tmpRoot, "artifacts", "sources", input.sourcePlan.sourceId, "diffs", "roach-statements.png"),
                diffPixels: 42,
                diffRatio: 0.25
              }
            ]
          })
        })
    });

    const result = await runIntent({
      configPath: loadedConfig.configPath,
      intent: "Run one source and persist state artifacts."
    });

    const businessManifest = await readJsonFile<{
      sources: Array<{
        artifacts: {
          manifestPath: string;
          capturesDir: string;
          attemptsDir: string;
        };
        attempts?: Array<{
          qaVerification?: {
            commands?: Array<{ logPath?: string }>;
          };
        }>;
      }>;
    }>(result.paths.manifestPath);

    const businessComparison = await readJsonFile<{
      sources: Array<{
        items: ComparisonSummary["items"];
      }>;
    }>(result.paths.comparisonPath);

    assert.ok(businessManifest);
    const sourceRecord = businessManifest?.sources[0];
    assert.ok(sourceRecord);
    assert.equal(sourceRecord?.artifacts.manifestPath.startsWith("artifacts/"), true);
    assert.equal(sourceRecord?.artifacts.capturesDir.startsWith("artifacts/"), true);
    assert.equal(sourceRecord?.artifacts.attemptsDir.startsWith("artifacts/"), true);
    assert.equal(sourceRecord?.artifacts.capturesDir.includes("artifacts/runs/"), false);

    const commandLogPath = sourceRecord?.attempts?.[0]?.qaVerification?.commands?.[0]?.logPath;
    assert.equal(typeof commandLogPath, "string");
    assert.equal(commandLogPath?.startsWith("artifacts/"), true);
    assert.equal(commandLogPath?.includes(tmpRoot), false);

    const serializedManifest = JSON.stringify(businessManifest);
    assert.equal(serializedManifest.includes("runRoot"), false);
    assert.equal(serializedManifest.includes("retainRuns"), false);
    assert.equal(serializedManifest.includes("artifacts/runs/"), false);

    const firstComparisonItem = businessComparison?.sources[0]?.items[0];
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
