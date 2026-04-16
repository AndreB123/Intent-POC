import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeIntent, normalizeIntentWithAgent } from "./normalize-intent";
import { SourceConfig } from "../config/schema";

const geminiAgent = {
  mode: "bounded-runner" as const,
  provider: "gemini",
  apiKeyEnv: "GEMINI_API_KEY",
  apiVersion: "v1alpha",
  temperature: 0.1,
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

const availableSources: Record<string, Pick<SourceConfig, "aliases" | "capture" | "planning" | "source">> = {
  "client-systems-roach-admin": {
    aliases: ["client-systems", "roach"],
    planning: {
      repoId: "client-systems",
      repoLabel: "Client Systems",
      role: "primary product repo",
      notes: ["Bootstrapped from the current source shortlist."]
    },
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
    planning: {
      repoId: "docs-portal",
      repoLabel: "Docs Portal",
      role: "documentation",
      notes: []
    },
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
  "demo-catalog": {
    aliases: ["demo-catalog", "catalog"],
    planning: {
      repoId: "intent-poc",
      repoLabel: "Intent POC",
      role: "controller-and-demo-source",
      notes: []
    },
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
      items: [{ id: "library-index", name: "Demo Catalog Index", path: "/library", maskSelectors: [], delayMs: 0 }]
    }
  },
  "example-storybook": {
    aliases: ["storybook", "demo"],
    planning: {
      repoId: "target-app",
      repoLabel: "Example Storybook",
      role: "example target app",
      notes: []
    },
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
  "demo-catalog": {
    aliases: ["demo", "demo-app", "demo-catalog"],
    planning: {
      repoId: "intent-poc",
      repoLabel: "Intent POC",
      role: "controller-and-demo-source",
      notes: []
    },
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
        { id: "library-index", name: "Demo Catalog Index", path: "/library", maskSelectors: [], delayMs: 0 },
        {
          id: "component-button-primary",
          name: "Demo Primary Button",
          path: "/library/component-button-primary",
          maskSelectors: [],
          delayMs: 0
        },
        {
          id: "page-analytics-overview",
          name: "Demo Analytics Overview",
          path: "/library/page-analytics-overview",
          maskSelectors: [],
          delayMs: 0
        }
      ]
    }
  }
};

test("normalizeIntent infers baseline mode from free-text prompt", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Create baseline screenshots for client-systems roach pages",
    defaultSourceId: "client-systems-roach-admin",
    continueOnCaptureError: false,
    availableSources
  });

  assert.equal(normalized.intentType, "capture-evidence");
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
      ["linearScoping", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
      ["bddPlanning", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
      ["tddPlanning", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
      ["implementation", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"],
      ["qaVerification", "skipped", "skipped", "models/gemini-3.1-flash-lite-preview"]
    ]
  );
  assert.equal(normalized.businessIntent.workItems[0]?.type, "playwright-spec");
  assert.ok((normalized.businessIntent.workItems[0]?.playwright.specs.length ?? 0) > 0);
});

test("normalizeIntent defers BDD and TDD details during the Linear scoping pass", () => {
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
  assert.equal(normalized.executionPlan.tools.find((tool) => tool.id === "linear-scoping")?.enabled, true);
  assert.equal(normalized.executionPlan.tools.find((tool) => tool.id === "bdd-planning")?.enabled, false);
  assert.equal(normalized.executionPlan.tools.find((tool) => tool.id === "playwright-tdd")?.enabled, false);
  assert.equal(
    normalized.normalizationMeta.stages.find((stage) => stage.stageId === "bddPlanning")?.warnings[0],
    "BDD planning is deferred until Linear scoping completes."
  );
  assert.equal(
    normalized.normalizationMeta.stages.find((stage) => stage.stageId === "tddPlanning")?.warnings[0],
    "Playwright-first TDD planning is deferred until Linear scoping completes."
  );
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
  assert.ok(
    normalized.executionPlan.destinations.some(
      (destination) => destination.type === "linear" && destination.status === "planned"
    )
  );
  assert.equal(normalized.businessIntent.workItems.length, 2);
  assert.deepEqual(
    normalized.businessIntent.workItems.map((workItem) => workItem.sourceIds[0]),
    ["client-systems-roach-admin", "docs-portal"]
  );
  assert.ok(
    normalized.planning.reviewNotes.some((note) => note.includes("capture workflow"))
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
    rawPrompt: "Create a baseline screenshot library for the demo-catalog source so that the baseline is reviewable.",
    defaultSourceId: "demo-catalog",
    continueOnCaptureError: false,
    availableSources: ambiguousDemoSources
  });

  assert.deepEqual(
    normalized.executionPlan.sources.map((source) => source.sourceId),
    ["demo-catalog"]
  );
  assert.equal(normalized.executionPlan.sources[0]?.selectionReason, "Source demo-catalog was referenced directly in the prompt.");
});

test("normalizeIntent infers the intent studio code surface while preserving source scope", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Add a dark mode button to the Intent Studio screen in demo-catalog so that the theme toggle is visible.",
    defaultSourceId: "demo-catalog",
    continueOnCaptureError: false,
    availableSources: demoCatalogSources
  });

  assert.equal(normalized.sourceId, "demo-catalog");
  assert.equal(normalized.executionPlan.primarySourceId, "demo-catalog");
  assert.equal(normalized.codeSurface?.sourceId, "demo-catalog");
  assert.equal(normalized.codeSurface?.id, "intent-studio");
  assert.equal(normalized.codeSurface?.confidence, "high");
});

test("normalizeIntent keeps ambiguous source-local UI requests broad when the code surface is unclear", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Add a dark mode button to my application in demo-catalog so the theme control is visible.",
    defaultSourceId: "demo-catalog",
    continueOnCaptureError: false,
    availableSources: demoCatalogSources
  });

  assert.equal(normalized.sourceId, "demo-catalog");
  assert.equal(normalized.codeSurface?.id, "shared-source");
  assert.equal(normalized.codeSurface?.confidence, "low");
  assert.deepEqual(
    normalized.codeSurface?.alternatives.map((alternative) => alternative.id),
    ["intent-studio", "surface-catalog"]
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
        intentType: "capture-evidence",
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

  assert.equal(normalized.intentType, "capture-evidence");
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
      ["linearScoping", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
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

test("normalizeIntentWithAgent preserves full demo-catalog capture scope when Gemini narrows a conceptual prompt", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Compare the demo-catalog evidence so we can tell whether the dark mode work is visible.",
      defaultSourceId: "demo-catalog",
      continueOnCaptureError: false,
      availableSources: demoCatalogSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["demo-catalog"],
        captureIdsBySource: {
          "demo-catalog": ["library-index"]
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
      "Gemini suggested narrowing demo-catalog captures to library-index"
    )
  );
});

test("normalizeIntentWithAgent still narrows capture scope when the prompt explicitly names a capture", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Compare only page-analytics-overview in demo-catalog so we can inspect that page.",
      defaultSourceId: "demo-catalog",
      continueOnCaptureError: false,
      availableSources: demoCatalogSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => ({
        sourceIds: ["demo-catalog"],
        captureIdsBySource: {
          "demo-catalog": ["library-index"]
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
      ["linearScoping", "completed", "rules", "models/gemini-3.1-flash-lite-preview"],
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
    ["fallback", "completed", "skipped", "completed", "skipped", "skipped"]
  );
  assert.ok(
    normalized.normalizationMeta.warnings.some((warning) => warning.includes("quota exceeded"))
  );
});