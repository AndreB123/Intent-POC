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
      waitAfterLoadMs: 500,
      injectCss: [],
      defaultFullPage: true,
      items: [{ id: "storybook-home", name: "Storybook Home", path: "/", maskSelectors: [], delayMs: 0 }]
    }
  }
};

test("normalizeIntent infers baseline mode from free-text prompt", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Create baseline screenshots for client-systems roach pages",
    runMode: "compare",
    defaultSourceId: "client-systems-roach-admin",
    continueOnCaptureError: false,
    availableSources
  });

  assert.equal(normalized.intentType, "baseline");
  assert.equal(normalized.execution.runMode, "baseline");
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
    runMode: "baseline",
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
    runMode: "compare",
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
    runMode: "compare",
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
  assert.ok(normalized.businessIntent.workItems.length >= 3);
  assert.ok(
    normalized.planning.reviewNotes.some((note) => note.includes("single run mode"))
  );
});

test("normalizeIntent carries explicit resume targets into the planning context", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Continue the client-systems visual verification plan",
    runMode: "compare",
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
    runMode: "compare",
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

test("normalizeIntent honors the requested source scope across multiple sources", () => {
  const normalized = normalizeIntent({
    rawPrompt: "Prepare reviewable visual evidence for the current release.",
    runMode: "compare",
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
      runMode: "compare",
      defaultSourceId: "client-systems-roach-admin",
      continueOnCaptureError: false,
      availableSources,
      agent: geminiAgent
    },
    {
      normalizePromptWithGemini: async () => ({
        intentType: "baseline",
        desiredOutcome: "The documentation screenshots are reviewable by stakeholders.",
        sourceIds: ["docs-portal"],
        captureIdsBySource: {
          "docs-portal": ["docs-home"]
        },
        warnings: ["Gemini selected the documentation source."]
      })
    }
  );

  assert.equal(normalized.intentType, "baseline");
  assert.equal(normalized.execution.runMode, "baseline");
  assert.equal(normalized.sourceId, "docs-portal");
  assert.deepEqual(normalized.captureScope, {
    mode: "subset",
    captureIds: ["docs-home"]
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
});

test("normalizeIntentWithAgent applies Gemini planning refinement when the planning stage is enabled", async () => {
  const normalized = await normalizeIntentWithAgent(
    {
      rawPrompt: "Prepare the documentation screenshots so release managers can review the docs lane.",
      runMode: "compare",
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
      runMode: "compare",
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
      runMode: "compare",
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