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
  assert.doesNotMatch(html, /\sid="theme-toggle"/);
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
  assert.doesNotMatch(html, /\sid="theme-toggle"/);
  assert.match(html, /Primitive\/Component\/View\/Page Catalog/);
});

test("renderSurfacePage Given a shared summary-card surface When rendered Then it reuses the Studio selection-card structure", () => {
  const html = renderSurfacePage(
    {
      id: "component-card-highlight",
      title: "Highlight Card",
      testId: "component-card-highlight",
      layer: "component",
      changesInV2: true
    },
    "v1"
  );

  assert.match(html, /data-testid="component-card-highlight"/);
  assert.match(html, /class="selection-card accent"/);
  assert.match(html, /class="selection-title"/);
  assert.match(html, /class="target-badge target-ready">summary<\/span>/);
});

test("renderSurfacePage Given a shared display-primitive surface When rendered Then it reuses the shared tabs structure", () => {
  const html = renderSurfacePage(
    {
      id: "component-nav-tabs",
      title: "Nav Tabs",
      testId: "component-nav-tabs",
      layer: "component",
      changesInV2: true
    },
    "v1"
  );

  assert.match(html, /data-testid="component-nav-tabs"/);
  assert.match(html, /class="tabs"/);
  assert.match(html, /class="tab active">Overview<\/span>/);
  assert.match(html, /class="tab">History<\/span>/);
});

test("renderSurfacePage Given a page surface When rendered Then it reuses the shared page header structure", () => {
  const html = renderSurfacePage(
    {
      id: "page-analytics-overview",
      title: "Analytics Overview",
      testId: "page-analytics-overview",
      layer: "page",
      changesInV2: true
    },
    "v1"
  );

  assert.match(html, /data-testid="page-analytics-overview"/);
  assert.match(html, /class="page-header"/);
  assert.match(html, /class="chip success">QA Ready<\/span>/);
});

test("renderSurfacePage Given an empty-results view When rendered Then it reuses the shared section header structure", () => {
  const html = renderSurfacePage(
    {
      id: "view-empty-results",
      title: "Empty Results",
      testId: "view-empty-results",
      layer: "view",
      changesInV2: true
    },
    "v1"
  );

  assert.match(html, /data-testid="view-empty-results"/);
  assert.match(html, /class="section-header"/);
  assert.match(html, /class="section-subtitle">Try broadening your filters\.<\/div>/);
});