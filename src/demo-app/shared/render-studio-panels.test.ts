import { strict as assert } from "node:assert";
import test from "node:test";
import { renderStudioGuideCards, renderStudioLifecyclePanel } from "./render-studio-panels";

test("renderStudioGuideCards Given the shared Studio docs cards When rendered Then it preserves work-scope guidance selectors", () => {
  const html = renderStudioGuideCards();

  assert.match(html, /How Work Scope Works/);
  assert.match(html, /id="selection-title"/);
  assert.match(html, /id="selection-status"/);
  assert.match(html, /id="selection-summary"/);
  assert.match(html, /id="selection-defaults"/);
  assert.match(html, /id="selection-details"/);
});

test("renderStudioLifecyclePanel Given the shared lifecycle docs panel When rendered Then it preserves BDD and TDD containers", () => {
  const html = renderStudioLifecyclePanel();

  assert.match(html, /id="step-bdd"/);
  assert.match(html, /id="step-bdd-status"/);
  assert.match(html, /id="plan-criteria"/);
  assert.match(html, /id="plan-scenarios"/);
  assert.match(html, /id="step-tdd"/);
  assert.match(html, /id="step-tdd-status"/);
  assert.match(html, /id="plan-decomposition"/);
  assert.match(html, /id="plan-work-items"/);
  assert.match(html, /5\. Planned Execution/);
});