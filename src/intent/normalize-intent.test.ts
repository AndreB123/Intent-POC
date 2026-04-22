import { strict as assert } from "node:assert";
import test from "node:test";
import { toFileUrlPath } from "../evidence/paths";
import { parsePromptNormalizationHintsResponse } from "./gemini-prompt-normalizer";
import { normalizeIntent, normalizeIntentWithAgent } from "./normalize-intent";
import { SourceConfig } from "../config/schema";
import { NormalizedIntent } from "./intent-types";

const geminiAgent = {
  mode: "bounded-runner" as const,
  provider: "gemini",
  apiKeyEnv: "GEMINI_API_KEY",
  apiVersion: "v1alpha",
  temperature: 0.1,
  requireAIWorkflow: false,
  allowPromptNormalization: true,
  allowLinearScoping: true,
  allowBDDPlanning: false,
  allowTDDPlanning: true,
  allowImplementation: false,
  allowQAVerification: false,
  stages: {
    promptNormalization: {
      model: "models/gemini-3.1-flash-lite-preview"
    },
    linearScoping: {
      model: "models/gemini-3.1-flash-lite-preview"
    },
    bddPlanning: {
      model: "models/gemini-3.1-flash-lite-preview"
    },
    tddPlanning: {
      model: "models/gemini-3.1-flash-lite-preview"
    },
    implementation: {},
    qaVerification: {}
  },
  fallbackToRules: true
};

function buildPlanningFixture(overrides: {
  repoId?: string;
  repoLabel?: string;
  role?: string;
  summary?: string;
  notes: string[];
  verificationNotes?: string[];
  uiStates?: SourceConfig["planning"]["uiStates"];
}): SourceConfig["planning"] {
  return {
    repoId: overrides.repoId,
    repoLabel: overrides.repoLabel,
    role: overrides.role,
    summary: overrides.summary,
    notes: overrides.notes,
    verificationNotes: overrides.verificationNotes ?? [],
    uiStates: overrides.uiStates ?? []
  };
}

const availableSources: Record<string, Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">> = {
  "client-systems-roach-admin": {
    aliases: ["client-systems", "roach"],
    planning: buildPlanningFixture({
      repoId: "client-systems",
      repoLabel: "Client Systems",
      role: "primary product repo",
      notes: ["Bootstrapped from the current source shortlist."]
    }),
    source: {
      type: "git",
      gitUrl: "https://example.com/client-systems.git",
      ref: "main"
    },
    capture: {
      basePathPrefix: "",
      publishToLibrary: false,
      waitAfterLoadMs: 500,
      injectCss: [],
      defaultFullPage: true,
      items: [
        { id: "roach-overview", name: "Cockroach Overview", path: "/", maskSelectors: [], delayMs: 0 },
        {
          id: "roach-statements",
          name: "Cockroach Statements",
          path: "/#/sql-activity",
          maskSelectors: [],
          delayMs: 0
        }
      ]
    }
  },
  "docs-portal": {
    aliases: ["docs", "documentation"],
    planning: buildPlanningFixture({
      repoId: "docs-portal",
      repoLabel: "Docs Portal",
      role: "documentation",
      notes: []
    }),
    source: {
      type: "local",
      localPath: "/tmp/docs-portal"
    },
    capture: {
      basePathPrefix: "",
      publishToLibrary: false,
      waitAfterLoadMs: 500,
      injectCss: [],
      defaultFullPage: true,
      items: [{ id: "docs-home", name: "Docs Home", path: "/", maskSelectors: [], delayMs: 0 }]
    }
  }
};

const ambiguousDemoSources: Record<string, Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">> = {
  "intent-poc-app": {
    aliases: ["surface library", "surface-library", "library"],
    planning: buildPlanningFixture({
      repoId: "intent-poc",
      repoLabel: "Intent POC",
      role: "controller-and-demo-source",
      notes: []
    }),
    source: {
      type: "local",
      localPath: "/tmp/intent-poc"
    },
    capture: {
      basePathPrefix: "",
      publishToLibrary: false,
      waitAfterLoadMs: 500,
      injectCss: [],
      defaultFullPage: true,
      items: [{ id: "library-index", name: "Surface Library Index", path: "/library", maskSelectors: [], delayMs: 0 }]
    }
  },
  "example-storybook": {
    aliases: ["storybook", "demo"],
    planning: buildPlanningFixture({
      repoId: "target-app",
      repoLabel: "Example Storybook",
      role: "example target app",
      notes: []
    }),
    source: {
      type: "local",
      localPath: "/tmp/target-app"
    },
    capture: {
      basePathPrefix: "",
      publishToLibrary: false,
      waitAfterLoadMs: 500,
      injectCss: [],
      defaultFullPage: true,
      items: [{ id: "storybook-home", name: "Storybook Home", path: "/", maskSelectors: [], delayMs: 0 }]
    }
  }
};

const demoCatalogSources: Record<string, Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">> = {
  "intent-poc-app": {
    aliases: ["intent-poc-app", "surface library", "surface-library", "library"],
    planning: buildPlanningFixture({
      repoId: "intent-poc",
      repoLabel: "Intent POC",
      role: "controller-and-demo-source",
      notes: []
    }),
    source: {
      type: "local",
      localPath: "/tmp/intent-poc"
    },
    capture: {
      basePathPrefix: "",
      publishToLibrary: false,
      waitAfterLoadMs: 500,
      injectCss: [],
      defaultFullPage: true,
      items: [
        { id: "library-index", name: "Surface Library Index", path: "/library", maskSelectors: [], delayMs: 0 },
        {
          id: "component-button-primary",
          name: "Primary Button",
          path: "/library/component-button-primary",
          maskSelectors: [],
          delayMs: 0
        },
        {
          id: "page-analytics-overview",
          name: "Analytics Overview",
          path: "/library/page-analytics-overview",
          maskSelectors: [],
          delayMs: 0
        }
      ]
    }
  }
};

const intentPocAppSources: Record<string, Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">> = {
  "intent-poc-app": {
    aliases: ["intent-poc-app", "intent-studio", "studio", "surface library", "surface-library", "library", "components"],
    planning: buildPlanningFixture({
      repoId: "intent-poc",
      repoLabel: "Intent POC",
      role: "controller-and-demo-source",
      notes: [],
      verificationNotes: ["Verify the requested UI state before trusting screenshot evidence."],
      uiStates: [
        {
          id: "theme-mode",
          label: "Theme mode",
          description: "The demo app supports light and dark theme states that affect visual evidence.",
          activation: [
            {
              type: "query-param",
              target: "dark",
              values: {
                light: "false",
                dark: "true"
              },
              notes: []
            },
            {
              type: "ui-control",
              target: "[data-testid='theme-toggle']",
              values: {
                light: "false",
                dark: "true"
              },
              notes: []
            },
            {
              type: "ui-control",
              target: "#dark-mode-toggle",
              values: {
                light: "false",
                dark: "true"
              },
              notes: []
            }
          ],
          verificationStrategies: ["ui-interaction-playwright"],
          notes: ["Do not trust screenshots until the requested theme state is active."]
        }
      ]
    }),
    source: {
      type: "local",
      localPath: "/tmp/intent-poc"
    },
    capture: {
      basePathPrefix: "",
      publishToLibrary: false,
      waitAfterLoadMs: 500,
      injectCss: [],
      defaultFullPage: false,
      items: [
        { id: "library-index", name: "Surface Library Index", path: "/library", fullPage: true, maskSelectors: [], delayMs: 0 },
        {
          id: "component-button-primary",
          name: "Primary Button",
          path: "/library/component-button-primary",
          locator: "[data-testid='component-button-primary']",
          waitForSelector: "[data-testid='component-button-primary']",
          maskSelectors: [],
          delayMs: 0
        },
        {
          id: "page-analytics-overview",
          name: "Analytics Overview",
          path: "/library/page-analytics-overview",
          fullPage: true,
          maskSelectors: [],
          delayMs: 0
        }
      ]
    }
  }
};

const uiStateRichSources: Record<string, Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">> = {
  "stateful-demo": {
    aliases: ["stateful-demo", "demo"],
    planning: buildPlanningFixture({
      repoId: "intent-poc",
      repoLabel: "Intent POC",
      role: "controller-and-demo-source",
      notes: [],
      verificationNotes: ["Requested UI states must be activated before screenshot evidence is trusted."],
      uiStates: [
        {
          id: "theme-mode",
          label: "Theme mode",
          description: "The demo supports light and dark theme states.",
          activation: [
            {
              type: "ui-control",
              target: "[data-testid='theme-toggle']",
              values: {
                light: "false",
                dark: "true"
              },
              notes: []
            }
          ],
          verificationStrategies: ["ui-interaction-playwright"],
          notes: ["Theme changes must be applied before capture."]
        },
        {
          id: "density-mode",
          label: "Density mode",
          description: "The demo supports compact and comfortable density presets.",
          activation: [
            {
              type: "query-param",
              target: "density",
              values: {
                compact: "compact",
                comfortable: "comfortable"
              },
              notes: []
            }
          ],
          verificationStrategies: ["query-param-playwright"],
          notes: ["Density is route-driven for deterministic verification."]
        }
      ]
    }),
    source: {
      type: "local",
      localPath: "/tmp/stateful-demo"
    },
    capture: {
      basePathPrefix: "",
      publishToLibrary: false,
      waitAfterLoadMs: 500,
      injectCss: [],
      defaultFullPage: false,
      items: [
        {
          id: "component-button-primary",
          name: "Primary Button",
          path: "/library/component-button-primary",
          locator: "[data-testid='component-button-primary']",
          waitForSelector: "[data-testid='component-button-primary']",
          maskSelectors: [],
          delayMs: 0
        }
      ]
    }
  }
};

const reportingFixtureSources: Record<string, Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">> = {
  "reporting-fixture": {
    aliases: ["reporting-demo", "demo"],
    planning: buildPlanningFixture({
      repoId: "intent-poc",
      repoLabel: "Intent POC",
      role: "reporting-fixture",
      notes: []
    }),
    source: {
      type: "local",
      localPath: "/tmp/reporting-fixture"
    },
    capture: {
      basePathPrefix: "",
      publishToLibrary: false,
      waitAfterLoadMs: 500,
      injectCss: [],
      defaultFullPage: true,
      items: [
        { id: "library-index", name: "Library Index", path: "/library", maskSelectors: [], delayMs: 0 },
        {
          id: "view-dashboard-summary",
          name: "Dashboard Summary View",
          path: "/library/view-dashboard-summary",
          maskSelectors: [],
          delayMs: 0
        },
        {
          id: "page-analytics-overview",
          name: "Analytics Overview Page",
          path: "/library/page-analytics-overview",
          maskSelectors: [],
          delayMs: 0
        }
      ]
    }
  }
};

test("normalizeIntent uses the unified behavior-change workflow for free-text prompts", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Create baseline screenshots for client-systems roach pages",
    defaultSourceId: "client-systems-roach-admin",
    continueOnCaptureError: false,
    availableSources
  });

  assert.equal(normalized.intentType, "change-behavior");
  assert.equal(normalized.sourceId, "client-systems-roach-admin");
  assert.equal(normalized.executionPlan.primarySourceId, "client-systems-roach-admin");
  assert.equal(normalized.executionPlan.sources.length, 1);
  assert.equal(normalized.businessIntent.scenarios.length, 3);
  assert.equal(normalized.planning.repoCandidates[0]?.repoId, "client-systems");
  assert.equal(normalized.planning.linearPlan.mode, "new");
  assert.deepEqual(
    normalized.normalizationMeta.stages.map((stage) => [stage.stageId, stage.status, stage.source, stage.model]),
    [
      ["promptNormalization", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
      ["linearScoping", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"],
      ["bddPlanning", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
      ["tddPlanning", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
      ["implementation", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"],
      ["qaVerification", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"]
    ]
  );
  assert.equal(
    normalized.businessIntent.workItems.some((workItem) => workItem.type === "playwright-spec"),
    true
  );
  assert.equal(
    normalized.businessIntent.workItems.some((workItem) => (workItem.playwright.specs.length ?? 0) > 0),
    true
  );
  assert.equal(normalized.normalizationMeta.requestedPlanningDepth, "full");
  assert.equal(normalized.normalizationMeta.effectivePlanningDepth, "full");
  assert.equal(normalized.normalizationMeta.ambiguity.isAmbiguous, false);
});

test("normalizeIntent defers BDD and TDD details during the scoping draft pass", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Compare drift only for cockroach statements on client-systems.",
    defaultSourceId: "client-systems-roach-admin",
    continueOnCaptureError: false,
    planningDepth: "scoping",
    availableSources,
    agent: geminiAgent
  });

  assert.deepEqual(normalized.businessIntent.acceptanceCriteria, []);
  assert.deepEqual(normalized.businessIntent.scenarios, []);
  assert.deepEqual(normalized.businessIntent.workItems, []);
  assert.equal(normalized.executionPlan.tools.find((tool) => tool.id === "linear-scoping"), undefined);
  assert.equal(normalized.executionPlan.tools.find((tool) => tool.id === "bdd-planning")?.enabled, false);
  assert.equal(normalized.executionPlan.tools.find((tool) => tool.id === "playwright-tdd")?.enabled, false);
  assert.equal(
    normalized.normalizationMeta.stages.find((stage) => stage.stageId === "bddPlanning")?.warnings[0],
    "BDD planning is deferred until the full reviewed plan pass."
  );
  assert.equal(
    normalized.normalizationMeta.stages.find((stage) => stage.stageId === "tddPlanning")?.warnings[0],
    "Playwright-first TDD planning is deferred until the full reviewed plan pass."
  );
  assert.equal(normalized.normalizationMeta.requestedPlanningDepth, "scoping");
  assert.equal(normalized.normalizationMeta.effectivePlanningDepth, "scoping");
});

test("normalizeIntent maps explicit capture names to subset mode", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Compare drift only for cockroach statements on client-systems",
    defaultSourceId: "client-systems-roach-admin",
    continueOnCaptureError: false,
    availableSources
  });

  assert.equal(normalized.captureScope.mode, "subset");
  assert.deepEqual(normalized.captureScope.captureIds, ["roach-statements"]);
  assert.equal(normalized.planning.repoCandidates[0]?.selectionStatus, "selected");
});

test("normalizeIntent can plan across multiple sources for business-wide intent", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Create a business-wide hard gate so evidence is visible across client-systems and docs.",
    defaultSourceId: "client-systems-roach-admin",
    continueOnCaptureError: false,
    linearEnabled: false,
    publishToSourceWorkspace: false,
    availableSources
  });

  assert.equal(normalized.executionPlan.orchestrationStrategy, "multi-source");
  assert.deepEqual(
    normalized.executionPlan.sources.map((source) => source.sourceId),
    ["client-systems-roach-admin", "docs-portal"]
  );
  assert.equal(normalized.executionPlan.destinations.some((destination) => destination.type === "linear"), false);
  assert.equal(normalized.businessIntent.workItems.length, 2);
  assert.deepEqual(
    normalized.businessIntent.workItems.map((workItem) => workItem.sourceIds[0]),
    ["client-systems-roach-admin", "docs-portal"]
  );
  assert.ok(
    normalized.planning.reviewNotes.some((note) => note.includes("shared verification workflow"))
  );
  assert.equal(normalized.businessIntent.decomposition?.objectives.length, 1);
  assert.deepEqual(
    normalized.businessIntent.decomposition?.workstreams.map((workstream) => workstream.sourceIds[0]),
    ["client-systems-roach-admin", "docs-portal"]
  );
  assert.equal(
    normalized.businessIntent.workItems.every(
      (workItem) => Boolean(workItem.execution.taskId) && Boolean(workItem.execution.subtaskId)
    ),
    true
  );
});

test("normalizeIntent carries explicit resume targets into the planning context", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Continue the client-systems visual verification plan",
    defaultSourceId: "client-systems-roach-admin",
    continueOnCaptureError: false,
    resumeIssue: "ENG-321",
    availableSources
  });

  assert.equal(normalized.planning.linearPlan.mode, "resume-explicit");
  assert.equal(normalized.planning.linearPlan.issueReference, "ENG-321");
  assert.ok(
    normalized.planning.reviewNotes.some((note) => note.includes("ENG-321"))
  );
});

test("normalizeIntent prefers exact source tokens over overlapping aliases", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Create a baseline screenshot library for the intent-poc-app source so that the baseline is reviewable.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: ambiguousDemoSources
  });

  assert.deepEqual(
    normalized.executionPlan.sources.map((source) => source.sourceId),
    ["intent-poc-app"]
  );
  assert.equal(normalized.executionPlan.sources[0]?.selectionReason, "Source intent-poc-app was referenced directly in the prompt.");
});

test("normalizeIntent preserves the surface-library prompt contract on the unified app source", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Create a baseline screenshot library for the surface library source so that the baseline is reviewable.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: intentPocAppSources
  });

  assert.equal(normalized.sourceId, "intent-poc-app");
  assert.equal(normalized.executionPlan.primarySourceId, "intent-poc-app");
  assert.equal(normalized.executionPlan.sources[0]?.selectionReason, "Source intent-poc-app matched the prompt alias 'surface library'.");
  assert.deepEqual(normalized.captureScope, {
    mode: "subset",
    captureIds: ["library-index", "component-button-primary", "page-analytics-overview"]
  });
});

test("normalizeIntent infers the intent studio code surface while preserving source scope", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Add a dark mode button to the Intent Studio screen in intent-poc-app so that the theme toggle is visible.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: demoCatalogSources
  });

  assert.equal(normalized.sourceId, "intent-poc-app");
  assert.equal(normalized.executionPlan.primarySourceId, "intent-poc-app");
  assert.equal(normalized.codeSurface?.sourceId, "intent-poc-app");
  assert.equal(normalized.codeSurface?.id, "intent-studio");
  assert.equal(normalized.codeSurface?.confidence, "high");
});

test("normalizeIntent routes prompt box dark-mode fixes to Intent Studio", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Fix the dark mode prompt box in intent-poc-app so typed text stays visible while I write in the textarea.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: demoCatalogSources
  });

  assert.equal(normalized.sourceId, "intent-poc-app");
  assert.equal(normalized.codeSurface?.sourceId, "intent-poc-app");
  assert.equal(normalized.codeSurface?.id, "intent-studio");
  assert.equal(normalized.codeSurface?.confidence, "high");
});

test("normalizeIntent routes run-status indicator prompts to Intent Studio", () => {
  const normalized = normalizeIntent({
    rawPrompt: "i need a visual test run indicator added to the ui so i know what tests are run",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: demoCatalogSources
  });

  assert.equal(normalized.sourceId, "intent-poc-app");
  assert.equal(normalized.codeSurface?.sourceId, "intent-poc-app");
  assert.equal(normalized.codeSurface?.id, "intent-studio");
  assert.equal(normalized.codeSurface?.confidence, "high");
});

test("normalizeIntent routes Intent Studio indicator prompts to live tracked Playwright verification", () => {
  const normalized = normalizeIntent({
    rawPrompt: "i need a visual test run indicator added to the ui so i know what tests are run",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: demoCatalogSources
  });

  assert.equal(normalized.codeSurface?.id, "intent-studio");
  assert.ok(normalized.businessIntent.workItems.length > 0);
  assert.equal(
    normalized.businessIntent.workItems.every((workItem) => workItem.verificationMode === "tracked-playwright"),
    true
  );
  assert.equal(
    normalized.businessIntent.workItems.every((workItem) =>
      workItem.playwright.specs.every((spec) =>
        spec.checkpoints.every((checkpoint) => checkpoint.action !== "mock-studio-state")
      )
    ),
    true
  );
});

test("normalizeIntent builds indicator checkpoints around real Studio QA state instead of static shell screenshots", () => {
  const normalized = normalizeIntent({
    rawPrompt: "i need a visual test run indicator added to the ui so i know what tests are run",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: demoCatalogSources
  });

  const indicatorSpec = normalized.businessIntent.workItems[0]?.playwright.specs[0];

  assert.ok(indicatorSpec);
  assert.equal(
    indicatorSpec?.checkpoints.some((checkpoint) => checkpoint.target === "[data-testid='test-status-indicator']"),
    true
  );
  assert.equal(
    indicatorSpec?.checkpoints.some((checkpoint) => checkpoint.target === "#step-implementation-status"),
    false
  );
  assert.equal(
    indicatorSpec?.checkpoints.some((checkpoint) => checkpoint.target === "#current-status-pill"),
    true
  );
  assert.equal(
    indicatorSpec?.checkpoints.some(
      (checkpoint) => checkpoint.attributeName === "data-state-code" && checkpoint.expectedSubstring === "RUNNING"
    ),
    true
  );
  assert.equal(
    indicatorSpec?.checkpoints.some((checkpoint) => checkpoint.action === "mock-studio-state"),
    false
  );
});

test("normalizeIntent derives a specific desired outcome from plain-language review-first prompts", () => {
  const normalized = normalizeIntent({
    rawPrompt:
      "i need all the fields in the app to stay closed by default unless they are clicked by a user. right now they open as the page loads.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: demoCatalogSources
  });

  assert.equal(
    normalized.businessIntent.desiredOutcome,
    "all the fields in the app to stay closed by default unless they are clicked by a user"
  );
});

test("normalizeIntent keeps ambiguous source-local UI requests broad when the code surface is unclear", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Add a dark mode button to my application in intent-poc-app so the theme control is visible.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: demoCatalogSources
  });

  assert.equal(normalized.sourceId, "intent-poc-app");
  assert.equal(normalized.codeSurface?.id, "shared-source");
  assert.equal(normalized.codeSurface?.confidence, "low");
  assert.deepEqual(
    normalized.codeSurface?.alternatives.map((alternative) => alternative.id),
    ["intent-studio", "surface-library"]
  );
  assert.equal(normalized.normalizationMeta.ambiguity.isAmbiguous, true);
  assert.ok(
    normalized.normalizationMeta.ambiguity.reasons.includes(normalized.codeSurface?.rationale ?? "")
  );
  assert.ok(normalized.planning.scopingContext);
  assert.equal(normalized.planning.scopingContext?.primarySurface?.id, "shared-source");
  assert.deepEqual(
    normalized.planning.scopingContext?.alternativeSurfaces.map((alternative) => alternative.id),
    ["intent-studio", "surface-library"]
  );
  assert.deepEqual(normalized.planning.scopingContext?.repoNoteHints, []);
});

test("normalizeIntent retrieves UI-state and verification context only when the prompt implies it", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Fix the dark mode prompt box in intent-poc-app so typed text stays visible while I write in the textarea.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    planningDepth: "scoping",
    availableSources: intentPocAppSources
  });

  assert.ok(normalized.planning.scopingContext);
  assert.equal(normalized.planning.scopingContext?.primarySurface?.id, "intent-studio");
  assert.ok(
    normalized.planning.scopingContext?.primarySurface?.primaryPaths.includes("src/demo-app/render/render-intent-studio-page.ts")
  );
  assert.deepEqual(
    normalized.planning.scopingContext?.uiStateHints.map((hint) => hint.stateId),
    ["theme-mode"]
  );
  assert.ok(
    normalized.planning.scopingContext?.verificationHints.some((hint) =>
      hint.note.includes("Verify the requested UI state before trusting screenshot evidence.")
    )
  );
  assert.equal(normalized.planning.scopingContext?.captureHints.length, 0);
});

test("normalizeIntent retrieves prompt-relevant repo memory notes from the exported catalog", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Fix the dark mode prompt box in intent studio so the theme-mode route keeps text visible.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    planningDepth: "scoping",
    availableSources: intentPocAppSources
  });

  assert.ok(normalized.planning.scopingContext);
  assert.ok(
    normalized.planning.scopingContext?.repoMemoryHints.some(
      (hint) =>
        hint.memoryId === "ui-state-metadata" &&
        hint.sourcePath === "/memories/repo/ui-state-metadata.md" &&
        hint.note.includes("theme-mode uses a shared dark query-param contract")
    )
  );
});

test("normalizeIntentWithAgent passes the retrieved scoping context pack into Gemini prompt normalization", async () => {
  let receivedScopingContext: NormalizedIntent["planning"]["scopingContext"] | undefined;

  await normalizeIntentWithAgent(
    {
      rawPrompt: "Add a dark mode button to the Intent Studio screen in intent-poc-app so that the theme toggle is visible.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      planningDepth: "scoping",
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async (input) => {
        receivedScopingContext = input.scopingContext;
        return {
          sourceIds: ["intent-poc-app"],
          codeSurfaceId: "intent-studio"
        };
      }
    }
  );

  assert.equal(receivedScopingContext?.primarySurface?.id, "intent-studio");
  assert.ok((receivedScopingContext?.matchedPromptTerms.length ?? 0) > 0);
  assert.ok(
    receivedScopingContext?.pathHints.some((hint) => hint.path === "src/demo-app/render/render-intent-studio-page.ts")
  );
});

test("normalizeIntentWithAgent preserves Intent Studio layout and collapsible section semantics in Playwright checkpoints", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt:
        "Move the run intent button directly below the prompt input box and make the work scope and steps sections collapsable and expandable.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: demoCatalogSources,
      agent: {
        ...geminiAgent,
        allowBDDPlanning: true
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "intent-studio"
      }),
      refineIntentPlanWithGemini: async () => ({
        statement: "The run intent button stays directly below the prompt input, and the work scope and steps sections can be collapsed or expanded.",
        desiredOutcome: "The prompt run layout keeps the run intent button below the prompt input while both sections remain collapsible.",
        acceptanceCriteria: [
          { description: "The run intent button remains directly below the prompt input." },
          { description: "The work scope section can be collapsed and expanded again." },
          { description: "The steps section can be collapsed and expanded again." }
        ],
        scenarios: [
          {
            title: "Verify prompt run component layout",
            goal: "Verify that the run intent button stays directly below the prompt input.",
            given: ["The user is viewing the prompt run interface"],
            when: ["The prompt run form loads"],
            then: ["The run intent button remains directly below the prompt input"],
            applicableSourceIds: ["intent-poc-app"]
          },
          {
            title: "Verify collapsible sections",
            goal: "Verify that the work scope and steps sections can be collapsed and expanded.",
            given: ["The user is viewing the prompt run interface", "The work scope and steps sections are currently expanded"],
            when: ["The user clicks the collapse and expand toggles for each section"],
            then: ["Both sections can be collapsed and expanded again", "The prompt run input remains accessible"],
            applicableSourceIds: ["intent-poc-app"]
          }
        ]
      })
    }
  );

  assert.equal(normalized.codeSurface?.id, "intent-studio");
  assert.equal(normalized.businessIntent.workItems.length, 2);

  const layoutWorkItem = normalized.businessIntent.workItems.find((workItem) =>
    workItem.title.toLowerCase().includes("prompt run component layout")
  );
  const collapsibleWorkItem = normalized.businessIntent.workItems.find((workItem) =>
    workItem.title.toLowerCase().includes("collapsible sections")
  );

  assert.ok(layoutWorkItem);
  assert.ok(collapsibleWorkItem);
  assert.deepEqual(
    layoutWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.target ?? checkpoint.path),
    ["/", "#submit-button", "#submit-button"]
  );
  assert.equal(layoutWorkItem?.playwright.specs[0]?.checkpoints[0]?.waitUntil, "domcontentloaded");
  assert.equal(layoutWorkItem?.playwright.specs[0]?.checkpoints[2]?.action, "assert-below");
  assert.equal(layoutWorkItem?.playwright.specs[0]?.checkpoints[2]?.referenceTarget, "#prompt-input");
  assert.deepEqual(
    collapsibleWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.target ?? checkpoint.path),
    [
      "/",
      "#work-scope-panel",
      "#toggle-work-scope-visibility",
      "#work-scope-panel",
      "#toggle-work-scope-visibility",
      "#source-scope",
      "#steps-panel",
      "#toggle-stages-visibility",
      "#steps-panel",
      "#toggle-stages-visibility",
      "#agent-stages-grid"
    ]
  );
  assert.equal(collapsibleWorkItem?.playwright.specs[0]?.checkpoints[3]?.action, "assert-hidden");
  assert.equal(collapsibleWorkItem?.playwright.specs[0]?.checkpoints[8]?.action, "assert-hidden");
});
test("normalizeIntent routes results-page screenshot linking prompts through Intent Studio checkpoints", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Verify that screenshots at the bottom of the results page link to the actual images.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: intentPocAppSources
  });

  assert.equal(normalized.codeSurface?.id, "intent-studio");

  const resultsSpec = normalized.businessIntent.workItems
    .flatMap((workItem) => workItem.playwright.specs)
    .find((spec) => spec.checkpoints.some((checkpoint) => checkpoint.action === "mock-studio-state"));

  assert.ok(resultsSpec);
  assert.deepEqual(
    resultsSpec?.checkpoints.map((checkpoint) => checkpoint.action),
    ["mock-studio-state", "assert-attribute-contains", "assert-attribute-contains"]
  );
  assert.equal(resultsSpec?.checkpoints[1]?.attributeName, "src");
  assert.equal(resultsSpec?.checkpoints[2]?.attributeName, "href");
  assert.equal(
    resultsSpec?.checkpoints[1]?.expectedSubstring,
    toFileUrlPath("artifacts/sources/intent-poc-app/captures/verify-screenshot-artifact-linking.png")
  );
  assert.equal(resultsSpec?.checkpoints[0]?.waitForSelector, "#captures .capture-card img");
});

test("normalizeIntentWithAgent keeps Intent Studio special routing scoped to the matching scenario", async () => {
  const planningAgent = {
    ...geminiAgent,
    allowPromptNormalization: false,
    allowBDDPlanning: true
  };

  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt:
        "Verify that screenshots at the bottom of the results page link to the actual images, and the work scope card and guide copy update immediately.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: planningAgent
    },
    {
      refineIntentPlanWithGemini: async () => ({
        acceptanceCriteria: [
          { description: "Screenshots at the bottom of the results page link to the actual images." },
          { description: "The work scope card and guide copy update immediately." }
        ],
        scenarios: [
          {
            title: "Verify Screenshot Artifact Linking",
            goal: "Confirm result thumbnails and links target the captured artifact files.",
            given: ["A completed Intent Studio run is visible on the results page."],
            when: ["QA reviews the screenshot links and previews at the bottom of the results page."],
            then: ["Screenshots at the bottom of the results page link to the actual images."],
            applicableSourceIds: ["intent-poc-app"]
          },
          {
            title: "Verify Reactive Metadata Updates",
            goal: "Confirm work scope metadata changes show up in the visible Studio copy.",
            given: ["The Intent Studio work scope source metadata has been updated."],
            when: ["The Studio renders the work scope section again."],
            then: ["The work scope card and guide copy update immediately."],
            applicableSourceIds: ["intent-poc-app"]
          }
        ]
      })
    }
  );

  const linkingWorkItem = normalized.businessIntent.workItems.find(
    (workItem) => workItem.title === "Verify Screenshot Artifact Linking"
  );
  const metadataWorkItem = normalized.businessIntent.workItems.find(
    (workItem) => workItem.title === "Verify Reactive Metadata Updates"
  );

  assert.ok(linkingWorkItem);
  assert.ok(metadataWorkItem);
  assert.deepEqual(
    linkingWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.action),
    ["mock-studio-state", "assert-attribute-contains", "assert-attribute-contains"]
  );
  assert.deepEqual(
    metadataWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.action),
    ["goto", "assert-visible"]
  );
  assert.equal(metadataWorkItem?.playwright.specs[0]?.checkpoints[1]?.target, "#work-scope-panel");
});

test("normalizeIntentWithAgent warns when a scenario has no strong acceptance-criteria match but keeps verification bounded", async () => {
  const planningAgent = {
    ...geminiAgent,
    allowPromptNormalization: false,
    allowBDDPlanning: true
  };

  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "In Intent Studio, verify that the work scope card and guide copy update immediately.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: planningAgent
    },
    {
      refineIntentPlanWithGemini: async () => ({
        acceptanceCriteria: [{ description: "Screenshots at the bottom of the results page link to the actual images." }],
        scenarios: [
          {
            title: "Verify Reactive Metadata Updates",
            goal: "Confirm work scope metadata changes show up in the visible Studio copy.",
            given: ["The Intent Studio work scope source metadata has been updated."],
            when: ["The Studio renders the work scope section again."],
            then: ["The work scope card and guide copy update immediately."],
            applicableSourceIds: ["intent-poc-app"]
          }
        ]
      })
    }
  );

  const metadataWorkItem = normalized.businessIntent.workItems.find(
    (workItem) => workItem.title === "Verify Reactive Metadata Updates"
  );

  assert.ok(metadataWorkItem);
  assert.deepEqual(
    metadataWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.action),
    ["goto", "assert-visible"]
  );
  assert.ok(
    normalized.normalizationMeta.warnings.some(
      (warning) =>
        warning.includes('Scenario "Verify Reactive Metadata Updates"')
        && warning.includes("did not strongly match any acceptance criteria")
    )
  );
});

test("normalizeIntent maps orchestrator lifecycle rerun prompts to mocked-state Playwright verification without bogus catalog checkpoints", () => {
  const normalized = normalizeIntent({
    rawPrompt:
      "the intent lifecycle needs to map the execution plan better and support state reversion when the model calls a rerun on a step.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: intentPocAppSources
  });

  assert.equal(normalized.intentType, "change-behavior");
  assert.equal(normalized.codeSurface?.id, "orchestrator-and-planning");
  assert.equal(normalized.summary, "change behavior for intent-poc-app");
  assert.equal(normalized.businessIntent.workItems.length, 1);
  assert.equal(normalized.businessIntent.workItems[0]?.type, "playwright-spec");
  assert.equal(normalized.businessIntent.workItems[0]?.verificationMode, "mocked-state-playwright");
  assert.match(
    normalized.businessIntent.workItems[0]?.verification ?? "",
    /mocked Studio app state/
  );
  assert.equal(
    normalized.businessIntent.workItems.some((workItem) => (workItem.playwright.specs.length ?? 0) > 0),
    true
  );
  assert.ok(
    normalized.businessIntent.workItems[0]?.playwright.specs.some((spec) =>
      spec.checkpoints.some((checkpoint) => checkpoint.action === "mock-studio-state")
    )
  );
  assert.ok(
    normalized.businessIntent.workItems.every((workItem) =>
      workItem.playwright.specs.every((spec) =>
        spec.checkpoints.every((checkpoint) => checkpoint.captureId !== "page-system-settings")
      )
    )
  );
});

test("normalizeIntent keeps code-only planner change-behavior prompts on the targeted code-validation path", () => {
  const normalized = normalizeIntent({
    rawPrompt:
      "the planner needs to keep source-lane distribution summaries aligned with linear publishing without changing the Studio UI.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: intentPocAppSources
  });

  assert.equal(normalized.intentType, "change-behavior");
  assert.equal(normalized.codeSurface?.id, "orchestrator-and-planning");
  assert.equal(normalized.businessIntent.workItems[0]?.type, "code-validation");
  assert.equal(normalized.businessIntent.workItems[0]?.verificationMode, "targeted-code-validation");
  assert.deepEqual(normalized.businessIntent.workItems[0]?.playwright.specs, []);
  assert.match(normalized.businessIntent.workItems[0]?.verification ?? "", /no tracked Playwright spec is planned/);
});

test("normalizeIntentWithAgent still generates Playwright specs for Intent Studio behavior fixes when Gemini classifies the prompt as change-behavior", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "the run workspace and studio guide buttons shift after run intent is submitted. that need to be fixed",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "intent-studio"
      })
    }
  );

  assert.equal(normalized.intentType, "change-behavior");
  assert.equal(normalized.codeSurface?.id, "intent-studio");
  assert.equal(
    normalized.businessIntent.workItems.some((workItem) => (workItem.playwright.specs.length ?? 0) > 0),
    true
  );
});

test("normalizeIntent rejects rules-only planning when AI-first workflow is required", () => {
  assert.throws(
    () =>
      normalizeIntent({
        rawPrompt: "the run status indicator should update while implementation and qa are executing",
        defaultSourceId: "intent-poc-app",
        continueOnCaptureError: false,
        availableSources: intentPocAppSources,
        agent: {
          ...geminiAgent,
          requireAIWorkflow: true,
          fallbackToRules: false,
          allowBDDPlanning: true
        }
      }),
    /AI-first workflow requires provider-backed planning via normalizeIntentWithAgent/
  );
});

test("normalizeIntentWithAgent allows mocked-state behavior verification when AI-first workflow is required", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt:
        "the intent lifecycle needs to map the execution plan better and support state reversion when the model calls a rerun on a step.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: {
        ...geminiAgent,
        requireAIWorkflow: true,
        fallbackToRules: false,
        allowBDDPlanning: true,
        stages: {
          ...geminiAgent.stages,
          tddPlanning: {
            ...geminiAgent.stages.tddPlanning,
            fallbackToRules: false
          }
        }
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "orchestrator-and-planning"
      }),
      refineIntentPlanWithGemini: async () => ({}),
      refineIntentTddWithGemini: async () => ({
        workItems: [
          {
            title: "Verify lifecycle behavior for intent-poc-app",
            description: "Generate tracked lifecycle verification for intent-poc-app.",
            verificationMode: "mocked-state-playwright",
            sourceIds: ["intent-poc-app"],
            userVisibleOutcome: "Lifecycle state and status handling remain reviewable in intent-poc-app.",
            verification: "A Gemini-authored Playwright spec validates lifecycle state handling through the Studio UI.",
            specs: [
              {
                sourceId: "intent-poc-app",
                relativeSpecPath: "intent-poc-app/verify-lifecycle-behavior.spec.ts",
                suiteName: "Intent-driven flow for intent-poc-app",
                testName: "Verify lifecycle behavior for intent-poc-app",
                checkpoints: [
                  {
                    label: "Lifecycle State Running",
                    action: "mock-studio-state",
                    assertion: "The Studio renders an executing lifecycle state for the active run.",
                    screenshotId: "shot-lifecycle-running",
                    path: "/",
                    waitForSelector: "#step-implementation-status",
                    waitUntil: "domcontentloaded",
                    mockStudioState: {
                      currentRun: {
                        status: "running"
                      }
                    }
                  }
                ]
              }
            ]
          }
        ]
      })
    }
  );

  assert.equal(normalized.codeSurface?.id, "orchestrator-and-planning");
  assert.ok(normalized.businessIntent.workItems.length > 0);
  assert.equal(
    normalized.businessIntent.workItems.every((workItem) => workItem.verificationMode === "mocked-state-playwright"),
    true
  );
  assert.equal(
    normalized.businessIntent.workItems.every((workItem) =>
      workItem.playwright.specs.every((spec) =>
        spec.checkpoints.some((checkpoint) => checkpoint.action === "mock-studio-state")
      )
    ),
    true
  );
  assert.equal(normalized.businessIntent.workItems.every((workItem) => workItem.playwright.generatedBy === "llm"), true);
  assert.equal(
    normalized.normalizationMeta.stages.find((stage) => stage.stageId === "tddPlanning")?.source,
    "llm"
  );
});

test("normalizeIntentWithAgent falls back to live tracked Playwright when Gemini emits mocked-state indicator verification", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt:
        "i need a visual test run indicator added to the ui so i know what tests are run and the status of them so we can monitor live code state.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: {
        ...geminiAgent,
        allowBDDPlanning: true
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "intent-studio"
      }),
      refineIntentPlanWithGemini: async () => ({
        acceptanceCriteria: [
          { description: "A visual test run indicator is visible while QA is active." }
        ],
        scenarios: [
          {
            title: "Verify status indicator lifecycle",
            goal: "Verify that the status indicator is visible while QA is active.",
            given: ["The user is in Intent Studio during an active run."],
            when: ["QA verification is executing."],
            then: ["The visual test run indicator is visible while QA is active."],
            applicableSourceIds: ["intent-poc-app"]
          }
        ]
      }),
      refineIntentTddWithGemini: async () => ({
        workItems: [
          {
            title: "Verify status indicator lifecycle",
            description: "Verify that the status indicator is visible while QA is active.",
            verificationMode: "mocked-state-playwright",
            sourceIds: ["intent-poc-app"],
            scenarioIds: ["scenario-1-verify-status-indicator-lifecycle"],
            userVisibleOutcome: "The visual test run indicator is visible while QA is active.",
            verification: "A Gemini-authored Playwright spec validates the indicator.",
            specs: [
              {
                sourceId: "intent-poc-app",
                relativeSpecPath: "intent-poc-app/test-execution-indicator.spec.ts",
                suiteName: "Intent Studio Test Execution Indicator",
                testName: "Verify status indicator lifecycle",
                scenarioIds: ["scenario-1-verify-status-indicator-lifecycle"],
                checkpoints: [
                  {
                    label: "Lifecycle State Running",
                    action: "mock-studio-state",
                    assertion: "The indicator displays 'Running' status and code when the test is active.",
                    screenshotId: "indicator-running-state",
                    path: "/",
                    waitForSelector: "[data-testid='test-status-indicator']",
                    waitUntil: "domcontentloaded",
                    mockStudioState: {
                      currentRun: {
                        status: "running"
                      }
                    }
                  }
                ]
              }
            ]
          }
        ]
      })
    }
  );

  assert.equal(normalized.businessIntent.workItems[0]?.verificationMode, "tracked-playwright");
  assert.equal(
    normalized.businessIntent.workItems[0]?.playwright.specs[0]?.checkpoints.some(
      (checkpoint) => checkpoint.action === "mock-studio-state"
    ),
    false
  );
  assert.equal(normalized.businessIntent.workItems[0]?.playwright.generatedBy, "rules");
  assert.equal(
    normalized.normalizationMeta.stages.find((stage) => stage.stageId === "tddPlanning")?.source,
    "rules"
  );
});

test("normalizeIntentWithAgent normalizes Gemini Intent Studio checkpoints to live-stream waits and running stage state codes", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt:
        "i need a visual test run indicator added to the ui so i know what tests are run and the status of them so we can monitor live code state.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: {
        ...geminiAgent,
        requireAIWorkflow: true,
        allowBDDPlanning: true,
        stages: {
          ...geminiAgent.stages,
          promptNormalization: {
            ...geminiAgent.stages.promptNormalization,
            fallbackToRules: false
          },
          bddPlanning: {
            ...geminiAgent.stages.bddPlanning,
            fallbackToRules: false
          },
          tddPlanning: {
            ...geminiAgent.stages.tddPlanning,
            fallbackToRules: false
          }
        }
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "intent-studio"
      }),
      refineIntentPlanWithGemini: async () => ({
        acceptanceCriteria: [
          { description: "A visual test run indicator is visible while QA is active." }
        ],
        scenarios: [
          {
            title: "Verify real-time test run indicator updates",
            goal: "Verify the real test run indicator updates during QA.",
            given: ["The user is in Intent Studio during an active run."],
            when: ["QA verification is executing."],
            then: ["The visual test run indicator is visible while QA is active."],
            applicableSourceIds: ["intent-poc-app"]
          }
        ]
      }),
      refineIntentTddWithGemini: async () => ({
        workItems: [
          {
            title: "Verify real-time test run indicator updates",
            description: "Verify that the real test run indicator updates during QA.",
            verificationMode: "tracked-playwright",
            sourceIds: ["intent-poc-app"],
            scenarioIds: ["scenario-1-verify-real-time-test-run-indicator-updates"],
            userVisibleOutcome: "The visual test run indicator is visible while QA is active.",
            verification: "A Gemini-authored Playwright spec validates the indicator against the live Studio session.",
            specs: [
              {
                sourceId: "intent-poc-app",
                relativeSpecPath: "intent-poc-app/test-run-indicator.spec.ts",
                suiteName: "Intent Studio Execution Monitoring",
                testName: "Verify real-time test run indicator updates",
                scenarioIds: ["scenario-1-verify-real-time-test-run-indicator-updates"],
                checkpoints: [
                  {
                    label: "Navigate to Intent Studio",
                    action: "goto",
                    assertion: "Studio interface is loaded",
                    screenshotId: "studio-initial-load",
                    path: "/intent-studio?dark=false",
                    waitUntil: "networkidle"
                  },
                  {
                    label: "Trigger test execution",
                    action: "click",
                    assertion: "Execution starts",
                    screenshotId: "execution-triggered",
                    target: "#submit-button",
                    waitForSelector: "#submit-button"
                  },
                  {
                    label: "Verify state code display",
                    action: "assert-attribute-contains",
                    assertion: "Indicator displays correct state code",
                    screenshotId: "indicator-state-code",
                    target: "[data-testid='test-status-indicator']",
                    attributeName: "data-state-code",
                    expectedSubstring: "RUNNING_001"
                  }
                ]
              }
            ]
          }
        ]
      })
    }
  );

  const indicatorSpec = normalized.businessIntent.workItems[0]?.playwright.specs[0];

  assert.ok(indicatorSpec);
  assert.equal(indicatorSpec?.checkpoints[0]?.path, "/?dark=false");
  assert.equal(indicatorSpec?.checkpoints[0]?.waitUntil, "domcontentloaded");
  assert.equal(indicatorSpec?.checkpoints[1]?.action, "fill");
  assert.equal(indicatorSpec?.checkpoints[1]?.target, "#prompt-input");
  assert.equal(indicatorSpec?.checkpoints[2]?.target, "#workflow-readiness-status");
  assert.equal(indicatorSpec?.checkpoints[2]?.attributeName, "class");
  assert.equal(indicatorSpec?.checkpoints[2]?.expectedSubstring, "target-ready");
  assert.equal(indicatorSpec?.checkpoints[2]?.timeoutMs, 30_000);
  assert.equal(indicatorSpec?.checkpoints[3]?.target, "[data-testid='run-tests-button']");
  assert.equal(indicatorSpec?.checkpoints[3]?.waitForSelector, "[data-testid='run-tests-button']");
  assert.equal(indicatorSpec?.checkpoints[4]?.locator, "text=Scoping IDD draft ready.");
  assert.equal(indicatorSpec?.checkpoints[4]?.timeoutMs, 30_000);
  assert.equal(indicatorSpec?.checkpoints[5]?.label, "Approve Reviewed Intent");
  assert.equal(indicatorSpec?.checkpoints[5]?.target, "[data-testid='run-tests-button']");
  assert.equal(indicatorSpec?.checkpoints[6]?.expectedSubstring, "RUNNING");
  assert.equal(indicatorSpec?.checkpoints[6]?.timeoutMs, 45_000);
  assert.equal(normalized.businessIntent.workItems[0]?.playwright.generatedBy, "llm");
});

test("normalizeIntentWithAgent injects an initial Studio navigation checkpoint when Gemini omits it for Intent Studio specs", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "verify the status indicator remains readable in dark mode while the studio is open",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: {
        ...geminiAgent,
        requireAIWorkflow: true,
        allowBDDPlanning: true,
        stages: {
          ...geminiAgent.stages,
          promptNormalization: {
            ...geminiAgent.stages.promptNormalization,
            fallbackToRules: false
          },
          bddPlanning: {
            ...geminiAgent.stages.bddPlanning,
            fallbackToRules: false
          },
          tddPlanning: {
            ...geminiAgent.stages.tddPlanning,
            fallbackToRules: false
          }
        }
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "intent-studio"
      }),
      refineIntentPlanWithGemini: async () => ({
        acceptanceCriteria: [{ description: "The indicator remains readable in dark mode." }],
        scenarios: [
          {
            title: "Verify dark mode indicator readability",
            goal: "Verify the indicator remains readable in dark mode.",
            given: ["The user is in Intent Studio."],
            when: ["Dark mode is enabled."],
            then: ["The status indicator remains visible and readable."],
            applicableSourceIds: ["intent-poc-app"]
          }
        ]
      }),
      refineIntentTddWithGemini: async () => ({
        workItems: [
          {
            title: "Verify dark mode indicator readability",
            description: "Verify the indicator remains readable in dark mode.",
            verificationMode: "tracked-playwright",
            sourceIds: ["intent-poc-app"],
            scenarioIds: ["scenario-1-verify-dark-mode-indicator-readability"],
            userVisibleOutcome: "The status indicator remains readable in dark mode.",
            verification: "A Gemini-authored Playwright spec validates the indicator in dark mode.",
            specs: [
              {
                sourceId: "intent-poc-app",
                relativeSpecPath: "intent-poc-app/status-indicator-theme.spec.ts",
                suiteName: "Intent Studio Status Indicator Theme",
                testName: "Verify dark mode indicator readability",
                scenarioIds: ["scenario-1-verify-dark-mode-indicator-readability"],
                checkpoints: [
                  {
                    label: "Toggle dark mode",
                    action: "click",
                    assertion: "Dark mode enabled",
                    screenshotId: "toggle-dark-mode",
                    target: "#dark-mode-toggle"
                  },
                  {
                    label: "Verify indicator visibility in dark mode",
                    action: "assert-visible",
                    assertion: "Indicator is visible in dark mode",
                    screenshotId: "indicator-visible-dark-mode",
                    target: "[data-testid='test-status-indicator']"
                  }
                ]
              }
            ]
          }
        ]
      })
    }
  );

  const indicatorSpec = normalized.businessIntent.workItems[0]?.playwright.specs[0];

  assert.ok(indicatorSpec);
  assert.equal(indicatorSpec?.checkpoints[0]?.action, "goto");
  assert.equal(indicatorSpec?.checkpoints[0]?.path, "/");
  assert.equal(indicatorSpec?.checkpoints[0]?.waitUntil, "domcontentloaded");
  assert.equal(indicatorSpec?.checkpoints[1]?.action, "click");
  assert.equal(indicatorSpec?.checkpoints[1]?.target, "#dark-mode-toggle");
});

test("normalizeIntentWithAgent fails loudly when AI-first TDD generation cannot produce artifacts", async () => {
  await assert.rejects(
    () =>
      normalizeIntentWithAgent(
        {
          rawPrompt: "show live lifecycle state changes in the studio while the run is executing",
          defaultSourceId: "intent-poc-app",
          continueOnCaptureError: false,
          availableSources: intentPocAppSources,
          agent: {
            ...geminiAgent,
            requireAIWorkflow: true,
            fallbackToRules: false,
            allowBDDPlanning: true,
            stages: {
              ...geminiAgent.stages,
              tddPlanning: {
                ...geminiAgent.stages.tddPlanning,
                fallbackToRules: false
              }
            }
          }
        },
        {
          normalizePromptWithGemini: async () => ({
            sourceIds: ["intent-poc-app"],
            codeSurfaceId: "intent-studio"
          }),
          refineIntentPlanWithGemini: async () => ({}),
          refineIntentTddWithGemini: async () => {
            throw new Error("provider returned no runnable spec artifacts");
          }
        }
      ),
    /Gemini TDD planning failed: provider returned no runnable spec artifacts/
  );
});

test("normalizeIntentWithAgent passes stage model failover candidates into TDD planning dependencies", async () => {
  let observedModelFailover: string[] | undefined;

  await assert.rejects(
    () =>
      normalizeIntentWithAgent(
        {
          rawPrompt: "verify lifecycle indicator evidence in studio",
          defaultSourceId: "intent-poc-app",
          continueOnCaptureError: false,
          availableSources: intentPocAppSources,
          agent: {
            ...geminiAgent,
            requireAIWorkflow: true,
            fallbackToRules: false,
            allowBDDPlanning: true,
            stages: {
              ...geminiAgent.stages,
              tddPlanning: {
                ...geminiAgent.stages.tddPlanning,
                fallbackToRules: false,
                modelFailover: ["models/gemini-3.1-pro-preview", "models/gemini-3-pro-preview"]
              }
            }
          }
        },
        {
          normalizePromptWithGemini: async () => ({
            sourceIds: ["intent-poc-app"],
            codeSurfaceId: "intent-studio"
          }),
          refineIntentPlanWithGemini: async () => ({}),
          refineIntentTddWithGemini: async ({ stage }) => {
            observedModelFailover = stage.modelFailover;
            throw new Error("provider returned no runnable spec artifacts");
          }
        }
      ),
    /Gemini TDD planning failed: provider returned no runnable spec artifacts/
  );

  assert.deepEqual(observedModelFailover, ["models/gemini-3.1-pro-preview", "models/gemini-3-pro-preview"]);
});

test("normalizeIntentWithAgent passes stage model failover candidates into prompt normalization dependencies", async () => {
  let observedModelFailover: string[] | undefined;

  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "route the prompt through ai normalization",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: {
        ...geminiAgent,
        allowBDDPlanning: false,
        allowTDDPlanning: false,
        stages: {
          ...geminiAgent.stages,
          promptNormalization: {
            ...geminiAgent.stages.promptNormalization,
            modelFailover: ["models/gemini-3-flash-preview", "models/gemini-3.1-pro-preview"]
          }
        }
      }
    },
    {
      normalizePromptWithGemini: async ({ stage }) => {
        observedModelFailover = stage.modelFailover;
        throw new Error("UNAVAILABLE high demand");
      }
    }
  );

  assert.deepEqual(observedModelFailover, ["models/gemini-3-flash-preview", "models/gemini-3.1-pro-preview"]);
  assert.equal(
    normalized.normalizationMeta.stages.find((stage) => stage.stageId === "promptNormalization")?.source,
    "fallback"
  );
});

test("normalizeIntentWithAgent passes stage model failover candidates into BDD planning dependencies", async () => {
  let observedModelFailover: string[] | undefined;

  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "plan acceptance criteria via bdd for intent studio",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: {
        ...geminiAgent,
        allowBDDPlanning: true,
        allowTDDPlanning: false,
        stages: {
          ...geminiAgent.stages,
          bddPlanning: {
            ...geminiAgent.stages.bddPlanning,
            modelFailover: ["models/gemini-3-flash-preview", "models/gemini-3.1-pro-preview"]
          }
        }
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "intent-studio"
      }),
      refineIntentPlanWithGemini: async ({ stage }) => {
        observedModelFailover = stage.modelFailover;
        throw new Error("UNAVAILABLE high demand");
      }
    }
  );

  assert.deepEqual(observedModelFailover, ["models/gemini-3-flash-preview", "models/gemini-3.1-pro-preview"]);
  assert.equal(
    normalized.normalizationMeta.stages.find((stage) => stage.stageId === "bddPlanning")?.source,
    "fallback"
  );
});

test("normalizeIntent honors the requested source scope across multiple sources", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Prepare reviewable visual evidence for the current release.",
    defaultSourceId: "client-systems-roach-admin",
    continueOnCaptureError: false,
    availableSources,
    requestedSourceIds: ["docs-portal", "client-systems-roach-admin"]
  });

  assert.deepEqual(
    normalized.executionPlan.sources.map((source) => source.sourceId),
    ["docs-portal", "client-systems-roach-admin"]
  );
  assert.equal(normalized.executionPlan.orchestrationStrategy, "multi-source");
  assert.equal(
    normalized.executionPlan.sources[0]?.selectionReason,
    "Source docs-portal was selected in the requested source scope."
  );
});

test("normalizeIntentWithAgent uses Gemini hints when the provider returns valid bounded ids", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Refresh the documentation screenshots so the docs site is reviewable.",
      defaultSourceId: "client-systems-roach-admin",
      continueOnCaptureError: false,
      availableSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => ({
        desiredOutcome: "The documentation screenshots are reviewable by stakeholders.",
        sourceIds: ["docs-portal"],
        codeSurfaceId: "capture-and-evidence",
        captureIdsBySource: {
          "docs-portal": ["docs-home"]
        },
        warnings: ["Gemini selected the documentation source."]
      })
    }
  );

  assert.equal(normalized.intentType, "change-behavior");
  assert.equal(normalized.sourceId, "docs-portal");
  assert.equal(normalized.codeSurface?.id, "capture-and-evidence");
  assert.deepEqual(normalized.captureScope, {
    mode: "all",
    captureIds: []
  });
  assert.equal(normalized.normalizationMeta.source, "llm");
  assert.deepEqual(
    normalized.normalizationMeta.stages.map((stage) => [stage.stageId, stage.status, stage.source, stage.model]),
    [
      ["promptNormalization", "completed", "llm", "models/gemini-3.1-flash-lite-preview"],
      ["linearScoping", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"],
      ["bddPlanning", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"],
      ["tddPlanning", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
      ["implementation", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"],
      ["qaVerification", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"]
    ]
  );
  assert.ok(
    normalized.normalizationMeta.warnings.some((warning) => warning.includes("Gemini selected the documentation source"))
  );
  assert.deepEqual(normalized.executionPlan.sources[0]?.warnings, []);
});

test("normalizeIntentWithAgent keeps valid Gemini hints when sibling hint fields are malformed", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Refresh the documentation screenshots so the docs site is reviewable.",
      defaultSourceId: "client-systems-roach-admin",
      continueOnCaptureError: false,
      availableSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () =>
        parsePromptNormalizationHintsResponse(
          JSON.stringify({
            desiredOutcome: "The documentation screenshots are reviewable by stakeholders.",
            sourceIds: ["docs-portal"],
            codeSurfaceAlternatives: ["not-a-real-surface"],
            captureIdsBySource: ["docs-home"]
          })
        )
    }
  );

  assert.equal(normalized.sourceId, "docs-portal");
  assert.equal(
    normalized.businessIntent.desiredOutcome,
    "The documentation screenshots are reviewable by stakeholders."
  );
  assert.equal(normalized.normalizationMeta.source, "llm");
  assert.ok(
    normalized.normalizationMeta.warnings.some((warning) =>
      warning.includes("invalid codeSurfaceAlternatives hints")
    )
  );
  assert.ok(
    normalized.normalizationMeta.warnings.some((warning) =>
      warning.includes("invalid captureIdsBySource hint")
    )
  );
});

test("parsePromptNormalizationHintsResponse keeps valid scoping detail sections when sibling sections are malformed", () => {
  const hints = parsePromptNormalizationHintsResponse(
    JSON.stringify({
      scopingDetails: {
        repoContext: ["Inspect the Intent Studio run status area first."],
        baseline: "not-an-array"
      }
    })
  );

  assert.deepEqual(hints.scopingDetails, {
    repoContext: ["Inspect the Intent Studio run status area first."]
  });
  assert.ok(
    hints.warnings?.some((warning) => warning.includes("invalid scopingDetails.baseline hints"))
  );
});

test("normalizeIntentWithAgent persists valid Gemini scoping details on the normalized intent", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "i need a visual test run indicator in intent studio",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: demoCatalogSources,
      agent: geminiAgent,
      planningDepth: "scoping"
    },
    {
      normalizePromptWithGemini: async () =>
        parsePromptNormalizationHintsResponse(
          JSON.stringify({
            sourceIds: ["intent-poc-app"],
            codeSurfaceId: "intent-studio",
            scopingDetails: {
              repoContext: ["Inspect the Intent Studio run-status panel before widening scope."],
              sourceScope: ["Keep the first pass inside the Studio render path and its adjacent server wiring."],
              verificationObligations: ["Reuse the current Intent Studio verification path before proposing a new test lane."]
            }
          })
        )
    }
  );

  assert.deepEqual(normalized.planning.scopingDetails, {
    repoContext: ["Inspect the Intent Studio run-status panel before widening scope."],
    sourceScope: ["Keep the first pass inside the Studio render path and its adjacent server wiring."],
    verificationObligations: ["Reuse the current Intent Studio verification path before proposing a new test lane."]
  });
});

test("normalizeIntentWithAgent overrides a weak Gemini capture surface hint when the prompt clearly targets Intent Studio", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt:
        "The space under the prompt run input box and instructions must be collapsable. We want to simplify the prompt run box so users can use it easier.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: demoCatalogSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "capture-and-evidence"
      })
    }
  );

  assert.equal(normalized.codeSurface?.id, "intent-studio");
  assert.equal(normalized.businessIntent.workItems[0]?.playwright.specs[0]?.checkpoints[0]?.path, "/");
});

test("normalizeIntentWithAgent preserves full intent-poc-app capture scope when Gemini narrows a conceptual prompt", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Compare the intent-poc-app evidence so we can tell whether the dark mode work is visible.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: demoCatalogSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        captureIdsBySource: {
          "intent-poc-app": ["library-index"]
        }
      })
    }
  );

  assert.deepEqual(normalized.captureScope, {
    mode: "all",
    captureIds: []
  });
  assert.deepEqual(normalized.executionPlan.sources[0]?.captureScope, {
    mode: "all",
    captureIds: []
  });
  assert.equal(normalized.executionPlan.sources[0]?.warnings.length, 1);
  assert.ok(
    normalized.executionPlan.sources[0]?.warnings[0]?.includes(
      "Gemini suggested narrowing intent-poc-app captures to library-index"
    )
  );
});

test("normalizeIntent resolves source-level UI state requirements into the plan and Playwright specs", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Compare the surface library evidence in dark mode so we can verify the theme styling.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: intentPocAppSources
  });

  const sourcePlan = normalized.executionPlan.sources[0];
  assert.equal(sourcePlan?.sourceId, "intent-poc-app");
  assert.equal(sourcePlan?.uiStateRequirements?.[0]?.stateId, "theme-mode");
  assert.equal(sourcePlan?.uiStateRequirements?.[0]?.requestedValue, "dark");
  assert.ok(sourcePlan?.warnings.some((warning) => warning.includes("Requested UI states: theme-mode=dark")));
  assert.ok(
    normalized.executionPlan.reviewNotes.some((note) =>
      note.includes("Verify the requested UI state before trusting screenshot evidence")
    )
  );

  const firstSpec = normalized.businessIntent.workItems[0]?.playwright.specs[0];
  assert.equal(firstSpec?.requiredUiStates?.[0]?.stateId, "theme-mode");
  assert.equal(firstSpec?.checkpoints[0]?.requiredUiStates?.[0]?.requestedValue, "dark");
});

test("normalizeIntent builds a typed input verification flow for dark-mode input readability prompts", () => {
  const inputFieldSources: Record<string, Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">> = {
    "intent-poc-app": {
      aliases: ["intent-poc-app", "library", "surface-library"],
      planning: buildPlanningFixture({
        repoId: "intent-poc",
        repoLabel: "Intent POC",
        role: "controller-and-demo-source",
        notes: [],
        verificationNotes: ["Verify the requested UI state before trusting screenshot evidence."],
        uiStates: [
          {
            id: "theme-mode",
            label: "Theme mode",
            description: "The demo app supports light and dark theme states that affect visual evidence.",
            activation: [
              {
                type: "ui-control",
                target: "[data-testid='theme-toggle']",
                values: {
                  light: "false",
                  dark: "true"
                },
                notes: []
              }
            ],
            verificationStrategies: ["ui-interaction-playwright"],
            notes: []
          }
        ]
      }),
      source: {
        type: "local",
        localPath: "/tmp/intent-poc"
      },
      capture: {
        basePathPrefix: "",
        publishToLibrary: false,
        waitAfterLoadMs: 500,
        injectCss: [],
        defaultFullPage: false,
        items: [
          {
            id: "primitive-input-field",
            name: "Input Field",
            path: "/library/primitive-input-field",
            locator: "[data-testid='primitive-input-field']",
            waitForSelector: "[data-testid='primitive-input-field']",
            maskSelectors: [],
            delayMs: 0
          }
        ]
      }
    }
  };

  const normalized = normalizeIntent({
    rawPrompt: "Verify dark mode input field readability in intent-poc-app so typed text stays visible.",
    defaultSourceId: "intent-poc-app",
    continueOnCaptureError: false,
    availableSources: inputFieldSources
  });

  const firstSpec = normalized.businessIntent.workItems[0]?.playwright.specs[0];
  assert.ok(firstSpec);
  assert.deepEqual(
    firstSpec?.checkpoints.map((checkpoint) => checkpoint.action),
    ["goto", "fill"]
  );
  assert.equal(firstSpec?.requiredUiStates?.[0]?.stateId, "theme-mode");
  assert.equal(firstSpec?.requiredUiStates?.[0]?.requestedValue, "dark");
  assert.equal(firstSpec?.checkpoints[0]?.path, "/library/primitive-input-field");
  assert.equal(firstSpec?.checkpoints[1]?.target, "[data-testid='primitive-input-field'] input");
  assert.equal(firstSpec?.checkpoints[1]?.value, "Readable dark mode sample text");
});

test("normalizeIntent resolves query-param UI states from prompt language", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Compare the stateful demo in compact density mode so spacing stays reviewable.",
    defaultSourceId: "stateful-demo",
    continueOnCaptureError: false,
    availableSources: uiStateRichSources
  });

  const sourcePlan = normalized.executionPlan.sources[0];
  assert.equal(sourcePlan?.uiStateRequirements?.[0]?.stateId, "density-mode");
  assert.equal(sourcePlan?.uiStateRequirements?.[0]?.requestedValue, "compact");
  assert.ok(
    normalized.executionPlan.reviewNotes.some((note) =>
      note.includes("Requested UI states must be activated before screenshot evidence is trusted")
    )
  );

  const firstSpec = normalized.businessIntent.workItems[0]?.playwright.specs[0];
  assert.equal(firstSpec?.requiredUiStates?.[0]?.stateId, "density-mode");
  assert.equal(firstSpec?.checkpoints[0]?.requiredUiStates?.[0]?.requestedValue, "compact");
});

test("normalizeIntent resolves multiple UI states when the prompt requests more than one active state", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Compare the stateful demo in dark mode with compact density so both theme and spacing are reviewable.",
    defaultSourceId: "stateful-demo",
    continueOnCaptureError: false,
    availableSources: uiStateRichSources
  });

  const requirements = normalized.executionPlan.sources[0]?.uiStateRequirements ?? [];
  assert.deepEqual(
    requirements.map((requirement) => [requirement.stateId, requirement.requestedValue]),
    [
      ["theme-mode", "dark"],
      ["density-mode", "compact"]
    ]
  );

  const firstSpec = normalized.businessIntent.workItems[0]?.playwright.specs[0];
  assert.deepEqual(
    firstSpec?.requiredUiStates?.map((requirement) => requirement.stateId),
    ["theme-mode", "density-mode"]
  );
});

test("normalizeIntentWithAgent still narrows capture scope when the prompt explicitly names a capture", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Compare only page-analytics-overview in intent-poc-app so we can inspect that page.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: demoCatalogSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        captureIdsBySource: {
          "intent-poc-app": ["library-index"]
        }
      })
    }
  );

  assert.deepEqual(normalized.captureScope, {
    mode: "subset",
    captureIds: ["page-analytics-overview"]
  });
  assert.deepEqual(normalized.executionPlan.sources[0]?.captureScope, {
    mode: "subset",
    captureIds: ["page-analytics-overview"]
  });
  assert.deepEqual(normalized.executionPlan.sources[0]?.warnings, []);
});

test("normalizeIntentWithAgent narrows generic evidence specs to the scenario-matching captures", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Prepare reviewable evidence for the built-in demo surfaces.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: {
        ...geminiAgent,
        allowBDDPlanning: true
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "capture-and-evidence"
      }),
      refineIntentPlanWithGemini: async () => ({
        statement: "Prepare reviewable evidence for the built-in demo surfaces.",
        desiredOutcome: "Each requested demo surface has a reviewable screenshot artifact.",
        acceptanceCriteria: [
          { description: "The primary button component has reviewable evidence." },
          { description: "The analytics overview page has reviewable evidence." }
        ],
        scenarios: [
          {
            title: "Capture visual evidence for primary button component",
            goal: "Capture the primary button component for review.",
            given: ["The built-in demo surfaces are available."],
            when: ["The screenshot flow runs for the primary button component."],
            then: ["The primary button component is captured for review."],
            applicableSourceIds: ["intent-poc-app"]
          },
          {
            title: "Capture visual evidence for analytics overview page",
            goal: "Capture the analytics overview page for review.",
            given: ["The built-in demo surfaces are available."],
            when: ["The screenshot flow runs for the analytics overview page."],
            then: ["The analytics overview page is captured for review."],
            applicableSourceIds: ["intent-poc-app"]
          }
        ]
      })
    }
  );

  const primaryButtonWorkItem = normalized.businessIntent.workItems.find((workItem) =>
    workItem.title.toLowerCase().includes("primary button")
  );
  const analyticsOverviewWorkItem = normalized.businessIntent.workItems.find((workItem) =>
    workItem.title.toLowerCase().includes("analytics overview")
  );

  assert.ok(primaryButtonWorkItem);
  assert.ok(analyticsOverviewWorkItem);
  assert.deepEqual(
    primaryButtonWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.captureId).filter(Boolean),
    ["component-button-primary"]
  );
  assert.deepEqual(
    analyticsOverviewWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.captureId).filter(Boolean),
    ["page-analytics-overview"]
  );
});

test("normalizeIntentWithAgent warns when scenario capture matching falls back to the current capture scope", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Prepare reviewable evidence for the built-in demo surfaces.",
      defaultSourceId: "intent-poc-app",
      continueOnCaptureError: false,
      availableSources: intentPocAppSources,
      agent: {
        ...geminiAgent,
        allowBDDPlanning: true
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["intent-poc-app"],
        codeSurfaceId: "capture-and-evidence"
      }),
      refineIntentPlanWithGemini: async () => ({
        statement: "Prepare reviewable evidence for the built-in demo surfaces.",
        desiredOutcome: "A reviewable demo evidence package is available.",
        acceptanceCriteria: [
          { description: "A reviewable demo evidence package is available." }
        ],
        scenarios: [
          {
            title: "Capture reviewable demo evidence package",
            goal: "Capture a generic reviewable evidence package for the built-in demo surfaces.",
            given: ["The built-in demo surfaces are available."],
            when: ["The screenshot flow runs for the demo evidence package."],
            then: ["A reviewable demo evidence package is available."],
            applicableSourceIds: ["intent-poc-app"]
          }
        ]
      })
    }
  );

  const captureWorkItem = normalized.businessIntent.workItems.find(
    (workItem) => workItem.title === "Capture reviewable demo evidence package"
  );

  assert.ok(captureWorkItem);
  assert.deepEqual(
    captureWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.captureId).filter(Boolean),
    ["library-index", "component-button-primary", "page-analytics-overview"]
  );
  assert.ok(
    normalized.normalizationMeta.warnings.some(
      (warning) =>
        warning.includes('Scenario "Capture reviewable demo evidence package"')
        && warning.includes("did not strongly match a specific capture item")
    )
  );
});

test("normalizeIntentWithAgent keeps reporting-style evidence review prompts at the current capture scope", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt:
        "Improve the demo evidence workflow so generated Playwright coverage is easier to review source-by-source.",
      defaultSourceId: "reporting-fixture",
      continueOnCaptureError: false,
      availableSources: reportingFixtureSources,
      agent: {
        ...geminiAgent,
        allowBDDPlanning: true
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["reporting-fixture"],
        codeSurfaceId: "capture-and-evidence"
      }),
      refineIntentPlanWithGemini: async () => ({
        statement:
          "Improve the demo evidence workflow so generated Playwright coverage is easier to review source-by-source.",
        desiredOutcome:
          "Runtime summaries, source summaries, comparison issues, and generated spec paths are easier to review source-by-source.",
        acceptanceCriteria: [
          {
            description:
              "Runtime summaries, source summaries, comparison issues, and generated spec paths are easier to review source-by-source."
          }
        ],
        scenarios: [
          {
            title: "Review runtime summaries, source summaries, comparison issues, and generated spec paths source-by-source",
            goal:
              "Capture Playwright evidence so reviewers can inspect runtime summaries, source summaries, comparison issues, and generated spec paths per source.",
            given: ["The reporting fixture source has multiple reviewable surfaces."],
            when: [
              "The screenshot flow runs and emits runtime summaries, source summaries, comparison issues, and generated spec paths for the source."
            ],
            then: ["Generated Playwright coverage is easier to review source-by-source."],
            applicableSourceIds: ["reporting-fixture"]
          }
        ]
      })
    }
  );

  const reportingWorkItem = normalized.businessIntent.workItems.find(
    (workItem) =>
      workItem.title === "Review runtime summaries, source summaries, comparison issues, and generated spec paths source-by-source"
  );

  assert.ok(reportingWorkItem);
  assert.equal(normalized.intentType, "change-behavior");
  assert.deepEqual(
    reportingWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.captureId).filter(Boolean),
    ["library-index", "view-dashboard-summary", "page-analytics-overview"]
  );
  assert.ok(
    normalized.normalizationMeta.warnings.some(
      (warning) =>
        warning.includes(
          'Scenario "Review runtime summaries, source summaries, comparison issues, and generated spec paths source-by-source"'
        )
        && warning.includes("did not strongly match a specific capture item")
    )
  );
});

test("normalizeIntentWithAgent still narrows explicit dashboard summary prompts to view-dashboard-summary", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Capture dashboard summary evidence so reviewers can inspect that surface.",
      defaultSourceId: "reporting-fixture",
      continueOnCaptureError: false,
      availableSources: reportingFixtureSources,
      agent: {
        ...geminiAgent,
        allowBDDPlanning: true
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["reporting-fixture"],
        codeSurfaceId: "capture-and-evidence"
      }),
      refineIntentPlanWithGemini: async () => ({
        statement: "Capture dashboard summary evidence so reviewers can inspect that surface.",
        desiredOutcome: "The dashboard summary view has reviewable evidence.",
        acceptanceCriteria: [{ description: "The dashboard summary view has reviewable evidence." }],
        scenarios: [
          {
            title: "Capture dashboard summary view evidence",
            goal: "Capture the dashboard summary view for review.",
            given: ["The reporting fixture source has multiple reviewable surfaces."],
            when: ["The screenshot flow runs for the dashboard summary view."],
            then: ["The dashboard summary view is captured for review."],
            applicableSourceIds: ["reporting-fixture"]
          }
        ]
      })
    }
  );

  const dashboardWorkItem = normalized.businessIntent.workItems.find(
    (workItem) => workItem.title === "Capture dashboard summary view evidence"
  );

  assert.ok(dashboardWorkItem);
  assert.deepEqual(
    dashboardWorkItem?.playwright.specs[0]?.checkpoints.map((checkpoint) => checkpoint.captureId).filter(Boolean),
    ["view-dashboard-summary"]
  );
});

test("normalizeIntentWithAgent applies Gemini planning refinement when the planning stage is enabled", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Prepare the documentation screenshots so release managers can review the docs lane.",
      defaultSourceId: "client-systems-roach-admin",
      continueOnCaptureError: false,
      availableSources,
      agent: {
        ...geminiAgent,
        allowBDDPlanning: true
      }
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["docs-portal"]
      }),
      refineIntentPlanWithGemini: async () => ({
        statement: "Prepare the docs evidence package for release review.",
        desiredOutcome: "Release managers can review documentation evidence without reading implementation details.",
        acceptanceCriteria: [
          {
            description: "The docs evidence package is ready for release review."
          },
          {
            description: "The docs plan stays inside the selected documentation source scope."
          }
        ],
        scenarios: [
          {
            title: "Documentation evidence is planned for release review",
            goal: "Produce a reviewable docs evidence lane.",
            given: ["The documentation source is selected."],
            when: ["The planner refines the docs lane."],
            then: ["The docs evidence package is ready for release review."],
            applicableSourceIds: ["docs-portal"]
          }
        ],
        warnings: ["Gemini planning refined the documentation plan."]
      })
    }
  );

  assert.equal(normalized.businessIntent.statement, "Prepare the docs evidence package for release review.");
  assert.equal(
    normalized.businessIntent.desiredOutcome,
    "Release managers can review documentation evidence without reading implementation details."
  );
  assert.deepEqual(
    normalized.businessIntent.acceptanceCriteria.map((criterion) => criterion.description),
    [
      "The docs evidence package is ready for release review.",
      "The docs plan stays inside the selected documentation source scope."
    ]
  );
  assert.deepEqual(
    normalized.businessIntent.scenarios.map((scenario) => scenario.title),
    ["Documentation evidence is planned for release review"]
  );
  assert.deepEqual(
    normalized.normalizationMeta.stages.map((stage) => [stage.stageId, stage.status, stage.source, stage.model]),
    [
      ["promptNormalization", "completed", "llm", "models/gemini-3.1-flash-lite-preview"],
      ["linearScoping", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"],
      ["bddPlanning", "completed", "llm", "models/gemini-3.1-flash-lite-preview"],
      ["tddPlanning", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
      ["implementation", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"],
      ["qaVerification", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"]
    ]
  );
  assert.ok(
    normalized.normalizationMeta.warnings.some((warning) =>
      warning.includes("Gemini planning refined the documentation plan")
    )
  );
});

test("normalizeIntentWithAgent keeps the requested source scope when Gemini returns a narrower source hint", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Prepare reviewable evidence for the release.",
      defaultSourceId: "client-systems-roach-admin",
      continueOnCaptureError: false,
      availableSources,
      requestedSourceIds: ["docs-portal", "client-systems-roach-admin"],
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["docs-portal"],
        warnings: ["Gemini narrowed the scope to documentation."]
      })
    }
  );

  assert.deepEqual(
    normalized.executionPlan.sources.map((source) => source.sourceId),
    ["docs-portal", "client-systems-roach-admin"]
  );
  assert.equal(normalized.normalizationMeta.source, "llm");
  assert.equal(
    normalized.normalizationMeta.stages.find((stage) => stage.stageId === "bddPlanning")?.status,
    "skipped"
  );
});

test("normalizeIntentWithAgent falls back to rules when Gemini normalization fails", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Compare drift only for cockroach statements on client-systems",
      defaultSourceId: "client-systems-roach-admin",
      continueOnCaptureError: false,
      availableSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => {
        throw new Error("quota exceeded");
      }
    }
  );

  assert.equal(normalized.normalizationMeta.source, "fallback");
  assert.equal(normalized.sourceId, "client-systems-roach-admin");
  assert.equal(normalized.captureScope.mode, "subset");
  assert.deepEqual(normalized.captureScope.captureIds, ["roach-statements"]);
  assert.deepEqual(
    normalized.normalizationMeta.stages.map((stage) => stage.status),
    ["fallback", "skipped", "skipped", "completed", "skipped", "skipped"]
  );
  assert.ok(
    normalized.normalizationMeta.warnings.some((warning) => warning.includes("quota exceeded"))
  );
});