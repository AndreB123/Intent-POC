import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeIntent } from "./normalize-intent";
import { SourceConfig } from "../config/schema";

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