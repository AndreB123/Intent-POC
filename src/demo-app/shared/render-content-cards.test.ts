import { strict as assert } from "node:assert";
import test from "node:test";
import { renderSelectionCard, renderTargetBadge } from "./render-content-cards";

test("renderTargetBadge preserves the Studio badge contract", () => {
  assert.equal(
    renderTargetBadge({ label: "guide", toneClass: "target-ready", id: "selection-status" }),
    '<span class="target-badge target-ready" id="selection-status">guide</span>'
  );
});

test("renderSelectionCard preserves the Studio guide-card structure", () => {
  assert.equal(
    renderSelectionCard({
      title: "Default work scope",
      titleId: "selection-title",
      badge: { label: "optional", toneClass: "target-ready", id: "selection-status" },
      lines: [
        { text: "The runner can choose sources from your prompt, then fall back to the config default if needed.", id: "selection-summary" },
        { text: "Blank work scope falls back to prompt matching, business-wide expansion, then config default.", id: "selection-defaults" }
      ]
    }),
    '<div class="selection-card"><div class="selection-title"><strong id="selection-title">Default work scope</strong><span class="target-badge target-ready" id="selection-status">optional</span></div><div class="selection-summary" id="selection-summary">The runner can choose sources from your prompt, then fall back to the config default if needed.</div><div class="selection-summary" id="selection-defaults">Blank work scope falls back to prompt matching, business-wide expansion, then config default.</div></div>'
  );
});