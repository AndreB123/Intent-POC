import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toFileUrlPath } from "../evidence/paths";
import { normalizeIntent } from "../intent/normalize-intent";
import { NormalizedIntent } from "../intent/intent-types";
import { buildBehaviorSource, buildDemoCatalogBehaviorSource } from "../orchestrator/run-intent.test-support";
import { writeGeneratedPlaywrightTests } from "./write-generated-playwright-tests";

test("writeGeneratedPlaywrightTests preserves unrelated tracked specs while refreshing targeted files", async () => {
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
        outputDir: "tests/intent"
      }
    }
  };

  const normalizedIntent = normalizeIntent({
    rawPrompt: "Create a baseline screenshot library for the demo source.",
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

  const staleDir = path.join(rootDir, "tests", "intent", "demo-source");
  await fs.mkdir(staleDir, { recursive: true });
  await fs.writeFile(path.join(staleDir, "obsolete.spec.ts"), "test('obsolete but kept', () => {});\n", "utf8");

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
  assert.equal(generatedEntries.includes("obsolete.spec.ts"), true);
  const obsoleteContent = await fs.readFile(path.join(staleDir, "obsolete.spec.ts"), "utf8");
  assert.equal(obsoleteContent, "test('obsolete but kept', () => {});\n");

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

test("writeGeneratedPlaywrightTests Given a hidden-state checkpoint When specs are generated Then the selector wait uses hidden state", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-playwright-hidden-"));

  try {
    const source = {
      ...buildDemoCatalogBehaviorSource(rootDir),
      testing: {
        playwright: {
          enabled: true,
          outputDir: "tests/intent"
        }
      }
    };

    const normalizedIntent: NormalizedIntent = {
      intentId: "intent-hidden-checkpoint",
      receivedAt: new Date().toISOString(),
      rawPrompt: "Collapse the optional configuration section in Intent Studio.",
      summary: "capture evidence for demo-catalog",
      intentType: "capture-evidence",
      businessIntent: {
        statement: "Collapse the optional configuration section in Intent Studio.",
        desiredOutcome: "The optional configuration section can be collapsed.",
        acceptanceCriteria: [],
        scenarios: [],
        workItems: [
          {
            id: "work-1-collapse-configuration-section-demo-catalog",
            type: "playwright-spec",
            verificationMode: "tracked-playwright",
            title: "Collapse configuration section",
            description: "Verify the configuration section collapses.",
            scenarioIds: [],
            sourceIds: ["demo-catalog"],
            userVisibleOutcome: "The configuration section is no longer visible.",
            verification: "A generated Playwright spec captures reviewable screenshots so QA can run this verification automatically.",
            execution: {
              order: 1,
              dependsOnWorkItemIds: []
            },
            playwright: {
              generatedBy: "rules",
              specs: [
                {
                  framework: "playwright",
                  sourceId: "demo-catalog",
                  relativeSpecPath: "demo-catalog/work-1-collapse-configuration-section-demo-catalog.spec.ts",
                  suiteName: "Intent-driven flow for demo-catalog",
                  testName: "Collapse configuration section",
                  scenarioIds: [],
                  checkpoints: [
                    {
                      id: "checkpoint-hidden",
                      label: "Configuration Section Collapsed",
                      action: "assert-hidden",
                      assertion: "A generated Playwright spec captures reviewable screenshots so QA can run this verification automatically.",
                      screenshotId: "collapsed-state",
                      target: "#agent-stages-grid",
                      waitForSelector: "#agent-stages-grid"
                    }
                  ]
                }
              ]
            }
          }
        ]
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
        primarySourceId: "demo-catalog",
        sources: [
          {
            sourceId: "demo-catalog",
            selectionReason: "Requested source.",
            captureScope: {
              mode: "all",
              captureIds: []
            },
            warnings: []
          }
        ],
        destinations: [],
        tools: [],
        orchestrationStrategy: "single-source",
        reviewNotes: []
      },
      sourceId: "demo-catalog",
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
        issueTitle: ""
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

    const result = await writeGeneratedPlaywrightTests({
      workspace: {
        sourceId: "demo-catalog",
        source,
        rootDir,
        appDir: rootDir,
        baseUrl: source.app.baseUrl,
        sourceType: source.source.type
      },
      normalizedIntent,
      sourceId: "demo-catalog"
    });

    const hiddenSpecPath = result?.files.find((filePath) => filePath.includes("collapse"));
    assert.ok(hiddenSpecPath);

    const generatedContent = await fs.readFile(hiddenSpecPath!, "utf8");
    assert.equal(
      generatedContent.includes('await page.waitForSelector("#agent-stages-grid", { state: "hidden" });'),
      true
    );
    assert.equal(
      generatedContent.includes('await expect(target, "A generated Playwright spec captures reviewable screenshots so QA can run this verification automatically.").toBeHidden();'),
      true
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("writeGeneratedPlaywrightTests Given a below-layout checkpoint When specs are generated Then the spec emits the layout helper and assertion", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-playwright-layout-"));

  try {
    const source = {
      ...buildDemoCatalogBehaviorSource(rootDir),
      testing: {
        playwright: {
          enabled: true,
          outputDir: "tests/intent"
        }
      }
    };

    const normalizedIntent: NormalizedIntent = {
      intentId: "intent-layout-checkpoint",
      receivedAt: new Date().toISOString(),
      rawPrompt: "Keep the run intent button directly below the prompt input.",
      summary: "capture evidence for demo-catalog",
      intentType: "capture-evidence",
      businessIntent: {
        statement: "Keep the run intent button directly below the prompt input.",
        desiredOutcome: "The run intent button remains directly below the prompt input.",
        acceptanceCriteria: [],
        scenarios: [],
        workItems: [
          {
            id: "work-1-verify-prompt-layout-demo-catalog",
            type: "playwright-spec",
            verificationMode: "tracked-playwright",
            title: "Verify prompt layout",
            description: "Verify the prompt layout relationship.",
            scenarioIds: [],
            sourceIds: ["demo-catalog"],
            userVisibleOutcome: "The run intent button remains directly below the prompt input.",
            verification: "The run intent button remains directly below the prompt input.",
            execution: {
              order: 1,
              dependsOnWorkItemIds: []
            },
            playwright: {
              generatedBy: "rules",
              specs: [
                {
                  framework: "playwright",
                  sourceId: "demo-catalog",
                  relativeSpecPath: "demo-catalog/work-1-verify-prompt-layout-demo-catalog.spec.ts",
                  suiteName: "Intent-driven flow for demo-catalog",
                  testName: "Verify prompt layout",
                  scenarioIds: [],
                  checkpoints: [
                    {
                      id: "checkpoint-layout",
                      label: "Run Intent Button Below Prompt Input",
                      action: "assert-below",
                      assertion: "The run intent button remains directly below the prompt input.",
                      screenshotId: "layout-state",
                      target: "#submit-button",
                      referenceTarget: "#prompt-input",
                      waitForSelector: "#submit-button"
                    }
                  ]
                }
              ]
            }
          }
        ]
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
        primarySourceId: "demo-catalog",
        sources: [
          {
            sourceId: "demo-catalog",
            selectionReason: "Requested source.",
            captureScope: {
              mode: "all",
              captureIds: []
            },
            warnings: []
          }
        ],
        destinations: [],
        tools: [],
        orchestrationStrategy: "single-source",
        reviewNotes: []
      },
      sourceId: "demo-catalog",
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
        issueTitle: ""
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

    const result = await writeGeneratedPlaywrightTests({
      workspace: {
        sourceId: "demo-catalog",
        source,
        rootDir,
        appDir: rootDir,
        baseUrl: source.app.baseUrl,
        sourceType: source.source.type
      },
      normalizedIntent,
      sourceId: "demo-catalog"
    });

    const layoutSpecPath = result?.files.find((filePath) => filePath.includes("prompt-layout"));
    assert.ok(layoutSpecPath);

    const generatedContent = await fs.readFile(layoutSpecPath!, "utf8");
    assert.equal(generatedContent.includes('import { expect, test, type Page } from "playwright/test";'), true);
    assert.equal(generatedContent.includes("async function assertLocatorBelow(page: Page, targetSelector: string, referenceSelector: string, message: string): Promise<void> {"), true);
    assert.equal(
      generatedContent.includes('await assertLocatorBelow(page, "#submit-button", "#prompt-input", "The run intent button remains directly below the prompt input.");'),
      true
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("writeGeneratedPlaywrightTests Given Studio results-link checkpoints When specs are generated Then the spec mocks Studio state and asserts file-backed attributes", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-playwright-studio-results-"));

  try {
    const source = {
      ...buildDemoCatalogBehaviorSource(rootDir),
      testing: {
        playwright: {
          enabled: true,
          outputDir: "tests/intent"
        }
      }
    };

    const normalizedIntent: NormalizedIntent = {
      intentId: "intent-studio-results-links",
      receivedAt: new Date().toISOString(),
      rawPrompt: "Verify that screenshots at the bottom of the results page link to the actual images.",
      summary: "capture evidence for demo-catalog",
      intentType: "capture-evidence",
      businessIntent: {
        statement: "Verify that screenshots at the bottom of the results page link to the actual images.",
        desiredOutcome: "The results page capture previews link to the generated images.",
        acceptanceCriteria: [],
        scenarios: [],
        workItems: [
          {
            id: "work-1-verify-results-links-demo-catalog",
            type: "playwright-spec",
            verificationMode: "mocked-state-playwright",
            title: "Verify results links",
            description: "Verify the Studio results page uses file-backed screenshot links.",
            scenarioIds: [],
            sourceIds: ["demo-catalog"],
            userVisibleOutcome: "The results page capture previews link to the generated images.",
            verification: "The results page capture previews link to the generated images.",
            execution: {
              order: 1,
              dependsOnWorkItemIds: []
            },
            playwright: {
              generatedBy: "rules",
              specs: [
                {
                  framework: "playwright",
                  sourceId: "demo-catalog",
                  relativeSpecPath: "demo-catalog/work-1-verify-results-links-demo-catalog.spec.ts",
                  suiteName: "Intent-driven flow for demo-catalog",
                  testName: "Verify results links",
                  scenarioIds: [],
                  checkpoints: [
                    {
                      id: "checkpoint-mock-state",
                      label: "Results Page Mocked Run State",
                      action: "mock-studio-state",
                      assertion: "The Intent Studio results page renders mocked capture output for review.",
                      screenshotId: "results-page-state",
                      path: "/",
                      waitForSelector: "#captures .capture-card img",
                      mockStudioState: {
                        configPath: "intent-poc.yaml",
                        linearEnabled: false,
                        defaultSourceId: "demo-catalog",
                        agentStages: [],
                        sources: [
                          {
                            id: "demo-catalog",
                            label: "Demo Catalog",
                            aliases: ["demo-catalog"],
                            captureCount: 1,
                            sourceType: "local",
                            sourceLocation: ".",
                            startCommand: "echo start",
                            readiness: "HTTP http://127.0.0.1:3000",
                            baseUrl: "http://127.0.0.1:3000",
                            defaultScope: true,
                            status: "ready",
                            issues: [],
                            notes: []
                          }
                        ],
                        currentRun: {
                          sessionId: "session-1",
                          prompt: "Verify that screenshots at the bottom of the results page link to the actual images.",
                          requestedSourceIds: ["demo-catalog"],
                          sourceId: "demo-catalog",
                          dryRun: true,
                          status: "completed",
                          startedAt: "2026-04-16T00:00:00.000Z",
                          finishedAt: "2026-04-16T00:00:05.000Z",
                          runId: "run-1",
                          events: [],
                          captures: [
                            {
                              sourceId: "demo-catalog",
                              captureId: "result",
                              status: "captured",
                              url: "/results",
                              imagePath: "artifacts/runs/run-1/sources/demo-catalog/captures/result.png"
                            }
                          ],
                          sourceRuns: [],
                          artifacts: {}
                        },
                        recentRuns: [],
                        serverTime: "2026-04-16T00:00:05.000Z"
                      }
                    },
                    {
                      id: "checkpoint-image-src",
                      label: "Capture Preview Uses Run Artifact Path",
                      action: "assert-attribute-contains",
                      assertion: "The results page capture previews link to the generated images.",
                      screenshotId: "results-page-image-src",
                      target: "#captures .capture-card img",
                      attributeName: "src",
                      expectedSubstring: toFileUrlPath("artifacts/runs/run-1/sources/demo-catalog/captures/result.png") ?? "",
                      waitForSelector: "#captures .capture-card img"
                    },
                    {
                      id: "checkpoint-link-href",
                      label: "Capture Link Uses Run Artifact Path",
                      action: "assert-attribute-contains",
                      assertion: "The results page capture previews link to the generated images.",
                      screenshotId: "results-page-link-href",
                      target: "#captures .capture-card .capture-links a",
                      attributeName: "href",
                      expectedSubstring: toFileUrlPath("artifacts/runs/run-1/sources/demo-catalog/captures/result.png") ?? "",
                      waitForSelector: "#captures .capture-card .capture-links a"
                    }
                  ]
                }
              ]
            }
          }
        ]
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
        primarySourceId: "demo-catalog",
        sources: [
          {
            sourceId: "demo-catalog",
            selectionReason: "Requested source.",
            captureScope: {
              mode: "all",
              captureIds: []
            },
            warnings: []
          }
        ],
        destinations: [],
        tools: [],
        orchestrationStrategy: "single-source",
        reviewNotes: []
      },
      sourceId: "demo-catalog",
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
        issueTitle: ""
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

    const result = await writeGeneratedPlaywrightTests({
      workspace: {
        sourceId: "demo-catalog",
        source,
        rootDir,
        appDir: rootDir,
        baseUrl: source.app.baseUrl,
        sourceType: source.source.type
      },
      normalizedIntent,
      sourceId: "demo-catalog"
    });

    const specPath = result?.files.find((filePath) => filePath.includes("results-links"));
    assert.ok(specPath);

    const generatedContent = await fs.readFile(specPath!, "utf8");
    assert.equal(generatedContent.includes('await page.route("**/api/state", async (route) => {'), true);
    assert.equal(generatedContent.includes('await page.route("**/api/events", async (route) => {'), true);
    assert.equal(generatedContent.includes('const attributeValue = await target.getAttribute("src");'), true);
    assert.equal(
      generatedContent.includes('expect(attributeValue ?? "", "The results page capture previews link to the generated images.").toContain("/files/artifacts%2Fruns%2Frun-1%2Fsources%2Fdemo-catalog%2Fcaptures%2Fresult.png");'),
      true
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});