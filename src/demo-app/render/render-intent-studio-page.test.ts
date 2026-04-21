import { strict as assert } from "node:assert";
import test from "node:test";
import { renderIntentStudioPage } from "./render-intent-studio-page";

test("renderIntentStudioPage Given the default studio shell When rendered Then it includes the dark mode toggle and closes the HTML document", () => {
  const html = renderIntentStudioPage({ configPath: "intent-poc.local-no-linear.yaml" });
  const promptInputIndex = html.indexOf('id="prompt-input"');
  const submitButtonIndex = html.indexOf('id="submit-button"');
  const workScopeIndex = html.indexOf('id="work-scope-panel"');
  const stepsPanelIndex = html.indexOf('id="steps-panel"');

  assert.match(html, /<button class="dark-mode-toggle" id="dark-mode-toggle">Toggle Dark Mode<\/button>/);
  assert.match(html, /document.body.classList.toggle\("dark-mode"\);/);
  assert.match(html, /id="toggle-work-scope-visibility"[^>]*>Collapse<\/button>/);
  assert.match(html, /id="toggle-stages-visibility"[^>]*>Collapse<\/button>/);
  assert.match(html, /wireCollapseToggle\("toggle-work-scope-visibility", "work-scope-panel", "block"\);/);
  assert.match(html, /wireCollapseToggle\("toggle-stages-visibility", "steps-panel", "block"\);/);
  assert.ok(promptInputIndex >= 0);
  assert.ok(submitButtonIndex > promptInputIndex);
  assert.ok(workScopeIndex > submitButtonIndex);
  assert.ok(stepsPanelIndex > submitButtonIndex);
  assert.match(html, /id="step-bdd"/);
  assert.match(html, /id="plan-criteria"/);
  assert.match(html, /id="step-tdd"/);
  assert.match(html, /id="plan-work-items"/);
  assert.match(html, /id="selection-title"/);
  assert.match(html, /id="selection-defaults"/);
  assert.match(html, /<\/html>\s*$/);
});