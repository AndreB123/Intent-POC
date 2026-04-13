import { strict as assert } from "node:assert";
import test from "node:test";
import { SURFACE_CATALOG } from "../model/catalog";
import { getDemoScreenshotRoot, getDemoSurfaceScreenshotPath } from "./screenshot-paths";

test("maps demo surfaces into layer-based screenshot paths", () => {
  const primitive = SURFACE_CATALOG.find((surface) => surface.id === "primitive-color-chip");
  const component = SURFACE_CATALOG.find((surface) => surface.id === "component-button-primary");
  const view = SURFACE_CATALOG.find((surface) => surface.id === "view-list-overview");
  const page = SURFACE_CATALOG.find((surface) => surface.id === "page-analytics-overview");

  assert.ok(primitive);
  assert.ok(component);
  assert.ok(view);
  assert.ok(page);

  assert.equal(getDemoSurfaceScreenshotPath(primitive), "primitives/primitive-color-chip.png");
  assert.equal(getDemoSurfaceScreenshotPath(component), "components/component-button-primary.png");
  assert.equal(getDemoSurfaceScreenshotPath(view), "views/view-list-overview.png");
  assert.equal(getDemoSurfaceScreenshotPath(page), "pages/page-analytics-overview.png");
});

test("builds the tracked demo screenshot root under evidence baselines", () => {
  assert.equal(
    getDemoScreenshotRoot("/repo"),
    "/repo/evidence/baselines/demo-components"
  );
});