import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CaptureOutcome } from "../../capture/capture-target";
import { upsertTrackedScreenshots } from "./upsert-tracked-screenshots";

test("upsertTrackedScreenshots updates tracked files without deleting unrelated screenshots", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-upsert-tracked-"));
  const trackedRoot = path.join(tmpRoot, "tracked");
  const stagedRoot = path.join(tmpRoot, "staged");

  const existingTrackedFile = path.join(trackedRoot, "components", "component-button-primary.png");
  const unrelatedTrackedFile = path.join(trackedRoot, "components", "component-button-secondary.png");
  const stagedFile = path.join(stagedRoot, "components", "component-button-primary.png");

  await fs.mkdir(path.dirname(existingTrackedFile), { recursive: true });
  await fs.mkdir(path.dirname(stagedFile), { recursive: true });
  await fs.writeFile(existingTrackedFile, "old-file", "utf8");
  await fs.writeFile(unrelatedTrackedFile, "keep-file", "utf8");
  await fs.writeFile(stagedFile, "new-file", "utf8");

  const captures: CaptureOutcome[] = [
    {
      captureId: "component-button-primary",
      path: "/library/component-button-primary",
      url: "http://127.0.0.1:6006/library/component-button-primary",
      kind: "locator",
      outputPath: stagedFile,
      relativeOutputPath: "artifacts/sources/intent-poc-app/captures/components/component-button-primary.png",
      durationMs: 10,
      viewport: { width: 1440, height: 900 },
      locator: "[data-testid='component-button-primary']",
      status: "captured",
      warnings: []
    },
    {
      captureId: "component-button-danger",
      path: "/library/component-button-danger",
      url: "http://127.0.0.1:6006/library/component-button-danger",
      kind: "locator",
      outputPath: path.join(stagedRoot, "components", "component-button-danger.png"),
      relativeOutputPath: "artifacts/sources/intent-poc-app/captures/components/component-button-danger.png",
      durationMs: 10,
      viewport: { width: 1440, height: 900 },
      locator: "[data-testid='component-button-danger']",
      status: "failed",
      error: "capture failed",
      warnings: []
    }
  ];

  const updated = await upsertTrackedScreenshots({
    captures,
    captureItems: [
      {
        id: "component-button-primary",
        path: "/library/component-button-primary",
        relativeOutputPath: "components/component-button-primary.png",
        locator: "[data-testid='component-button-primary']",
        waitForSelector: "[data-testid='component-button-primary']",
        maskSelectors: [],
        delayMs: 0
      },
      {
        id: "component-button-danger",
        path: "/library/component-button-danger",
        relativeOutputPath: "components/component-button-danger.png",
        locator: "[data-testid='component-button-danger']",
        waitForSelector: "[data-testid='component-button-danger']",
        maskSelectors: [],
        delayMs: 0
      }
    ],
    trackedRoot
  });

  assert.deepEqual(updated, [existingTrackedFile]);
  assert.equal(await fs.readFile(existingTrackedFile, "utf8"), "new-file");
  assert.equal(await fs.readFile(unrelatedTrackedFile, "utf8"), "keep-file");

  await fs.rm(tmpRoot, { recursive: true, force: true });
});