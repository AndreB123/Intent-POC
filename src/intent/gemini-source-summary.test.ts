import { strict as assert } from "node:assert";
import test from "node:test";
import { buildGeminiSourceSummary, GeminiSourceDescriptor } from "./gemini-source-summary";

const availableSources: Record<string, GeminiSourceDescriptor> = {
  "intent-poc-app": {
    aliases: ["surface library", "surface-library", "library"],
    source: {
      type: "local",
      localPath: "."
    },
    planning: {
      repoId: "intent-poc",
      repoLabel: "Intent POC",
      role: "controller-and-demo-source",
      summary: "Current workspace source for Intent Studio and surface library evidence flows.",
      notes: ["Use this source for prompt planning and surface library evidence."],
      verificationNotes: ["Verify requested UI state before trusting screenshots."],
      uiStates: [
        {
          id: "theme-mode",
          label: "Theme mode",
          description: "The demo app supports light and dark themes that affect screenshot evidence.",
          activation: [
            {
              type: "ui-control",
              target: "[data-testid='theme-toggle']",
              values: {
                light: "false",
                dark: "true"
              },
              notes: ["The toggle must be applied before capture."]
            }
          ],
          verificationStrategies: ["ui-interaction-playwright"],
          notes: ["Do not assume the URL alone implies theme state."]
        }
      ]
    },
    capture: {
      catalog: undefined,
      basePathPrefix: "",
      publishToLibrary: false,
      waitAfterLoadMs: 0,
      injectCss: [],
      defaultFullPage: false,
      items: [
        {
          id: "primitive-input-field",
          path: "/library/primitive-input-field",
          maskSelectors: [],
          delayMs: 0
        }
      ]
    }
  }
};

test("buildGeminiSourceSummary includes reusable UI-state planning metadata for Gemini stages", () => {
  const summary = JSON.parse(buildGeminiSourceSummary(availableSources));

  assert.equal(summary[0].sourceId, "intent-poc-app");
  assert.equal(summary[0].summary, "Current workspace source for Intent Studio and surface library evidence flows.");
  assert.deepEqual(summary[0].verificationNotes, ["Verify requested UI state before trusting screenshots."]);
  assert.equal(summary[0].uiStates[0].id, "theme-mode");
  assert.equal(summary[0].uiStates[0].activation[0].type, "ui-control");
  assert.equal(summary[0].uiStates[0].verificationStrategies[0], "ui-interaction-playwright");
  assert.equal(summary[0].captures[0].id, "primitive-input-field");
});