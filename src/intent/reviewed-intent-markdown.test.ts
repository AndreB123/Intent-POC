import { strict as assert } from "node:assert";
import test from "node:test";
import {
  buildReviewedIntentDraftPreview,
  buildReviewedIntentMarkdown,
  buildReviewedIntentPlanningPrompt,
  parseReviewedIntentMarkdown
} from "./reviewed-intent-markdown";
import { NormalizedIntent } from "./intent-types";

function buildNormalizedIntent(overrides: Partial<NormalizedIntent> = {}): NormalizedIntent {
  return {
    intentId: "intent-1",
    receivedAt: "2026-04-21T00:00:00.000Z",
    rawPrompt: "i need all the fields in the app to stay closed by default unless they are clicked by a users. right now it looks like they start close, then open as the page loads.",
    summary: "change behavior for intent-poc-app",
    intentType: "change-behavior",
    codeSurface: {
      sourceId: "intent-poc-app",
      id: "shared-source",
      label: "Shared Source",
      confidence: "low",
      rationale: "The prompt suggests a user-facing change in intent-poc-app, but it does not unambiguously identify which code surface owns it.",
      alternatives: [
        {
          id: "intent-studio",
          label: "Intent Studio",
          reason: "The request may belong to the Studio shell."
        },
        {
          id: "surface-library",
          label: "Surface Library",
          reason: "The request may belong to the library rendering surface."
        }
      ]
    },
    businessIntent: {
      statement: "i need all the fields in the app to stay closed by default unless they are clicked by a users. right now it looks like they start close, then open as the page loads.",
      desiredOutcome: "all the fields in the app to stay closed by default unless they are clicked by a users",
      acceptanceCriteria: [],
      scenarios: [],
      workItems: []
    },
    planning: {
      repoCandidates: [
        {
          repoId: "intent-poc",
          label: "Intent POC",
          role: "controller-and-demo-source",
          sourceIds: ["intent-poc-app"],
          selectionStatus: "selected",
          reason: "Source intent-poc-app was selected in the requested source scope.",
          summary: "Current workspace source for Intent Studio and surface-library behavior.",
          sourceTypes: ["local"],
          locations: ["."],
          refs: [],
          notes: ["Configured visual captures across linked sources: 48."],
          captureCount: 48
        }
      ],
      scopingContext: {
        matchedPromptTerms: [],
        sourceMatches: [
          {
            sourceId: "intent-poc-app",
            matchedTerms: [],
            reason: "Source intent-poc-app was selected in the requested source scope."
          }
        ],
        primarySurface: {
          sourceId: "intent-poc-app",
          id: "shared-source",
          label: "Shared Source",
          confidence: "low",
          rationale: "The prompt suggests a user-facing change in intent-poc-app, but it does not unambiguously identify which code surface owns it.",
          matchedTerms: [],
          primaryPaths: [],
          adjacentPaths: []
        },
        alternativeSurfaces: [
          {
            sourceId: "intent-poc-app",
            id: "intent-studio",
            label: "Intent Studio",
            confidence: "low",
            rationale: "The request may belong to the Studio shell.",
            matchedTerms: [],
            primaryPaths: ["src/demo-app/render/render-intent-studio-page.ts"],
            adjacentPaths: ["src/demo-app/server/start-intent-studio-server.ts"]
          },
          {
            sourceId: "intent-poc-app",
            id: "surface-library",
            label: "Surface Library",
            confidence: "low",
            rationale: "The request may belong to the library rendering surface.",
            matchedTerms: [],
            primaryPaths: ["src/demo-app/render/render-surface-frame.ts", "src/demo-app/render/render-surface-page.ts"],
            adjacentPaths: ["src/demo-app/model/catalog.ts", "src/demo-app/model/types.ts"]
          }
        ],
        pathHints: [],
        uiStateHints: [],
        verificationHints: [],
        repoNoteHints: [],
        repoMemoryHints: [],
        captureHints: [],
        unresolvedQuestions: [
          "The prompt suggests a user-facing change in intent-poc-app, but it does not unambiguously identify which code surface owns it."
        ]
      },
      plannerSections: [],
      reviewNotes: ["1 additional configured repo candidate remains available if the plan expands."],
      linearPlan: {
        mode: "new"
      }
    },
    executionPlan: {
      primarySourceId: "intent-poc-app",
      sources: [
        {
          sourceId: "intent-poc-app",
          selectionReason: "Source intent-poc-app was selected in the requested source scope.",
          captureScope: {
            mode: "all",
            captureIds: []
          },
          warnings: []
        }
      ],
      destinations: [
        {
          id: "controller",
          type: "controller",
          label: "Controller artifacts",
          status: "active",
          reason: "Local evidence bundles are always written by the controller.",
          details: []
        }
      ],
      tools: [],
      orchestrationStrategy: "single-source",
      reviewNotes: []
    },
    sourceId: "intent-poc-app",
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
      stages: [],
      requestedPlanningDepth: "scoping",
      effectivePlanningDepth: "scoping",
      ambiguity: {
        isAmbiguous: true,
        reasons: ["The prompt suggests a user-facing change in intent-poc-app, but it does not unambiguously identify which code surface owns it."]
      }
    },
    ...overrides
  };
}

test("buildReviewedIntentMarkdown keeps scoping previews lean and actionable when routing is unresolved", () => {
  const normalizedIntent = buildNormalizedIntent();

  const preview = buildReviewedIntentDraftPreview({ normalizedIntent });
  const markdown = buildReviewedIntentMarkdown({ rawPrompt: normalizedIntent.rawPrompt, normalizedIntent });

  assert.deepEqual(preview.repoContext, [
    "Scaffolded repo context from repo heuristics. Review and tighten before approval.",
    "Intent POC: Current workspace source for Intent Studio and surface-library behavior.",
    "Candidate surfaces to inspect first: Intent Studio via src/demo-app/render/render-intent-studio-page.ts; adjacent check src/demo-app/server/start-intent-studio-server.ts and Surface Library via src/demo-app/render/render-surface-frame.ts and src/demo-app/render/render-surface-page.ts; adjacent check src/demo-app/model/catalog.ts and src/demo-app/model/types.ts.",
    "Open routing question: The prompt suggests a user-facing change in intent-poc-app, but it does not unambiguously identify which code surface owns it."
  ]);
  assert.match(markdown, /^## Repo Context/m);
  assert.match(markdown, /Inspect first: Intent Studio via src\/demo-app\/render\/render-intent-studio-page\.ts; adjacent check src\/demo-app\/server\/start-intent-studio-server\.ts\./);
  assert.match(markdown, /Owning surface is not identified yet inside the selected source\./);
  assert.match(markdown, /Current behavior to confirm: They start close, then open as the page loads\./);
  assert.match(markdown, /Identify the existing Playwright or screenshot check closest to Intent Studio and Surface Library before planning implementation\./);
  assert.doesNotMatch(markdown, /^## Non-Goals/m);
  assert.doesNotMatch(markdown, /^## Delivery Obligations/m);
  assert.doesNotMatch(markdown, /^## Review Notes/m);
  assert.doesNotMatch(markdown, /Configured visual captures across linked sources/);
});

test("buildReviewedIntentDraftPreview includes concrete owning-file hints when scoping resolves to a specific surface", () => {
  const normalizedIntent = buildNormalizedIntent({
    rawPrompt: "i need a visual test run indicator in intent studio",
    businessIntent: {
      statement: "i need a visual test run indicator in intent studio",
      desiredOutcome: "a visual test run indicator in intent studio",
      acceptanceCriteria: [],
      scenarios: [],
      workItems: []
    },
    codeSurface: {
      sourceId: "intent-poc-app",
      id: "intent-studio",
      label: "Intent Studio",
      confidence: "high",
      rationale: "The prompt explicitly references Intent Studio inside intent-poc-app.",
      alternatives: []
    },
    planning: {
      ...buildNormalizedIntent().planning,
      scopingContext: {
        matchedPromptTerms: ["intent studio"],
        sourceMatches: [
          {
            sourceId: "intent-poc-app",
            matchedTerms: ["intent studio"],
            reason: "Source intent-poc-app matched the prompt alias 'intent studio'."
          }
        ],
        primarySurface: {
          sourceId: "intent-poc-app",
          id: "intent-studio",
          label: "Intent Studio",
          confidence: "high",
          rationale: "The prompt explicitly references Intent Studio inside intent-poc-app.",
          matchedTerms: ["intent studio"],
          primaryPaths: ["src/demo-app/render/render-intent-studio-page.ts"],
          adjacentPaths: ["src/demo-app/server/start-intent-studio-server.ts"]
        },
        alternativeSurfaces: [],
        pathHints: [
          {
            sourceId: "intent-poc-app",
            path: "src/demo-app/render/render-intent-studio-page.ts",
            reason: "Primary implementation path for Intent Studio."
          }
        ],
        uiStateHints: [],
        verificationHints: [],
        repoNoteHints: [],
        repoMemoryHints: [
          {
            memoryId: "studio-lifecycle-preview",
            title: "Studio Lifecycle Preview",
            sourcePath: "/memories/repo/studio-lifecycle-preview.md",
            note: "POST /api/plan returns a scoping-only reviewed IDD draft first, and that preview should stay lean and prompt-relevant.",
            reason: "Matched repo memory terms: intent studio."
          }
        ],
        captureHints: [],
        unresolvedQuestions: []
      },
      plannerSections: [],
      reviewNotes: ["1 additional configured repo candidate remains available if the plan expands."],
      linearPlan: {
        mode: "new"
      }
    },
    normalizationMeta: {
      source: "rules",
      warnings: [],
      stages: [],
      requestedPlanningDepth: "scoping",
      effectivePlanningDepth: "scoping",
      ambiguity: {
        isAmbiguous: false,
        reasons: []
      }
    }
  });

  const preview = buildReviewedIntentDraftPreview({ normalizedIntent });

  assert.equal(preview.repoContext[0], "Scaffolded repo context from repo heuristics. Review and tighten before approval.");
  assert.equal(preview.repoContext[1], "Start in Intent Studio: src/demo-app/render/render-intent-studio-page.ts.");
  assert.equal(
    preview.repoContext[2],
    "Studio Lifecycle Preview: POST /api/plan returns a scoping-only reviewed IDD draft first, and that preview should stay lean and prompt-relevant."
  );
  assert.equal(preview.sourceScope[1], "Likely owning surface: Intent Studio (high confidence).");
});

test("buildReviewedIntentDraftPreview merges AI scoping details ahead of deterministic fallback bullets", () => {
  const baseIntent = buildNormalizedIntent();
  const normalizedIntent = buildNormalizedIntent({
    planning: {
      ...baseIntent.planning,
      scopingDetails: {
        repoContext: ["Inspect the run-status area in Intent Studio before widening into other surfaces."],
        sourceScope: ["Stay inside the Studio render path first and only widen if the owner is still unclear."],
        verificationObligations: ["Reuse the closest existing Intent Studio verification path before inventing a new lane."]
      }
    }
  });

  const preview = buildReviewedIntentDraftPreview({ normalizedIntent });

  assert.equal(preview.repoContext[0], "Inspect the run-status area in Intent Studio before widening into other surfaces.");
  assert.ok(
    preview.repoContext.includes(
      "Candidate surfaces to inspect first: Intent Studio via src/demo-app/render/render-intent-studio-page.ts; adjacent check src/demo-app/server/start-intent-studio-server.ts and Surface Library via src/demo-app/render/render-surface-frame.ts and src/demo-app/render/render-surface-page.ts; adjacent check src/demo-app/model/catalog.ts and src/demo-app/model/types.ts."
    )
  );
  assert.equal(preview.sourceScope[0], "Stay inside the Studio render path first and only widen if the owner is still unclear.");
  assert.ok(preview.sourceScope.includes("Owning surface is not identified yet inside the selected source."));
  assert.equal(
    preview.verificationObligations[0],
    "Reuse the closest existing Intent Studio verification path before inventing a new lane."
  );
  assert.ok(
    preview.verificationObligations.includes(
      "Identify the existing Playwright or screenshot check closest to Intent Studio and Surface Library before planning implementation."
    )
  );
});

test("parseReviewedIntentMarkdown extracts the editable intent fields from a reviewed draft", () => {
  const normalizedIntent = buildNormalizedIntent({
    normalizationMeta: {
      ...buildNormalizedIntent().normalizationMeta,
      effectivePlanningDepth: "full"
    }
  });
  const markdown = buildReviewedIntentMarkdown({ rawPrompt: normalizedIntent.rawPrompt, normalizedIntent });

  const parsed = parseReviewedIntentMarkdown(markdown);

  assert.equal(parsed.isReviewedIntentMarkdown, true);
  assert.equal(parsed.intent, normalizedIntent.businessIntent.statement);
  assert.equal(parsed.desiredOutcome, normalizedIntent.businessIntent.desiredOutcome);
  assert.equal(parsed.rawIntent, normalizedIntent.rawPrompt);
});

test("buildReviewedIntentPlanningPrompt converts reviewed draft markdown back into a plain planning prompt", () => {
  const markdown = [
    "## Intent",
    "",
    "Improve the Studio run indicator so it reflects active test execution.",
    "",
    "## Desired Outcome",
    "",
    "Show live test status and state codes in the Studio UI.",
    "",
    "## Raw Intent",
    "",
    "i need a visual test run indicator added to the ui",
    ""
  ].join("\n");

  const prompt = buildReviewedIntentPlanningPrompt({ prompt: markdown });

  assert.equal(
    prompt,
    [
      "Improve the Studio run indicator so it reflects active test execution.",
      "Desired outcome: Show live test status and state codes in the Studio UI.",
      "Original request context: i need a visual test run indicator added to the ui"
    ].join("\n\n")
  );
});