import { strict as assert } from "node:assert";
import test from "node:test";
import { renderIntentStudioPage } from "./render-intent-studio-page";

test("renderIntentStudioPage Given the default studio shell When rendered Then it includes the dark mode toggle and closes the HTML document", () => {
  const html = renderIntentStudioPage({ configPath: "intent-poc.local-no-linear.yaml" });

  assert.match(html, /<button class="dark-mode-toggle" id="dark-mode-toggle">Toggle Dark Mode<\/button>/);
  assert.match(html, /document.body.classList.toggle\("dark-mode"\);/);
  assert.match(html, /<\/html>\s*$/);
});