import { strict as assert } from "node:assert";
import test from "node:test";
import { renderSurfaceCatalogIndex, renderSurfacePage } from "./render-surface-page";

test("renderSurfacePage Given a catalog surface When rendered Then it does not include the Studio dark mode toggle", () => {
  const html = renderSurfacePage(
    {
      id: "component-button-primary",
      title: "Primary Button",
      testId: "component-button-primary",
      layer: "component",
      changesInV2: true
    },
    "v1"
  );

  assert.doesNotMatch(html, /dark-mode-toggle/);
  assert.doesNotMatch(html, /id="theme-toggle"/);
  assert.match(html, /data-testid="component-button-primary"/);
});

test("renderSurfaceCatalogIndex Given the library landing page When rendered Then it stays free of the Studio dark mode toggle", () => {
  const html = renderSurfaceCatalogIndex(
    [
      {
        id: "component-button-primary",
        title: "Primary Button",
        testId: "component-button-primary",
        layer: "component",
        changesInV2: true
      }
    ],
    "v1"
  );

  assert.doesNotMatch(html, /dark-mode-toggle/);
  assert.doesNotMatch(html, /id="theme-toggle"/);
  assert.match(html, /Primitive\/Component\/View\/Page Catalog/);
});