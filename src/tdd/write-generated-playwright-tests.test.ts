import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeIntent } from "../intent/normalize-intent";
import { buildBehaviorSource } from "../orchestrator/run-intent.test-support";
import { writeGeneratedPlaywrightTests } from "./write-generated-playwright-tests";

test("writeGeneratedPlaywrightTests overwrites the generated source subtree", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-playwright-tests-"));
  const source = {
    ...buildBehaviorSource({
      rootDir,
      aliases: ["demo"],
      planning: {
        repoId: "intent-poc",
        repoLabel: "Intent POC",
        notes: []
      },
      startCommand: "echo start",
      baseUrl: "http://127.0.0.1:3000",
      captureItems: [
        { id: "library-index", name: "Library Index", path: "/library", maskSelectors: [], delayMs: 0 },
        {
          id: "button-primary",
          name: "Primary Button",
          path: "/library/button-primary",
          locator: "[data-testid='button-primary']",
          waitForSelector: "[data-testid='button-primary']",
          maskSelectors: [],
          delayMs: 0
        }
      ]
    }),
    testing: {
      playwright: {
        enabled: true,
        outputDir: "tests/intent/generated"
      }
    }
  };

  const normalizedIntent = normalizeIntent({
    rawPrompt: "Create a baseline screenshot library for the demo source.",
    runMode: "baseline",
    defaultSourceId: "demo-source",
    continueOnCaptureError: false,
    availableSources: {
      "demo-source": {
        aliases: source.aliases,
        capture: source.capture,
        planning: source.planning,
        source: source.source
      }
    }
  });

  const staleDir = path.join(rootDir, "tests", "intent", "generated", "demo-source");
  await fs.mkdir(staleDir, { recursive: true });
  await fs.writeFile(path.join(staleDir, "obsolete.spec.ts"), "obsolete", "utf8");

  const result = await writeGeneratedPlaywrightTests({
    workspace: {
      sourceId: "demo-source",
      source,
      rootDir,
      appDir: rootDir,
      baseUrl: source.app.baseUrl,
      sourceType: source.source.type
    },
    normalizedIntent,
    sourceId: "demo-source"
  });

  assert.ok(result);
  assert.equal(result?.sourceDir, staleDir);
  assert.ok((result?.files.length ?? 0) > 0);

  const generatedEntries = await fs.readdir(staleDir);
  assert.equal(generatedEntries.includes("obsolete.spec.ts"), false);

  const firstGeneratedFile = result!.files[0]!;
  const generatedContent = await fs.readFile(firstGeneratedFile, "utf8");
  assert.equal(generatedContent.includes('import { expect, test } from "playwright/test";'), true);
  assert.equal(generatedContent.includes('const baseUrl = process.env.INTENT_POC_BASE_URL ?? "http://127.0.0.1:3000";'), true);
  assert.equal(
    generatedContent.includes(`const screenshotRoot = process.env.INTENT_POC_E2E_SCREENSHOT_ROOT ?? ${JSON.stringify(path.join(rootDir, "artifacts", "library"))};`),
    true
  );
  assert.equal(generatedContent.includes("await mkdir(path.dirname(screenshotPath), { recursive: true });"), true);

  await fs.rm(rootDir, { recursive: true, force: true });
});