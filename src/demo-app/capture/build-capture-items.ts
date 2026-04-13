import { CaptureItemConfig } from "../../config/schema";
import { SurfaceDefinition } from "../model/types";
import { getDemoSurfaceScreenshotPath } from "./screenshot-paths";

export function buildCaptureItemsFromCatalog(catalog: SurfaceDefinition[]): CaptureItemConfig[] {
  return catalog.map((surface) => ({
    id: surface.id,
    name: surface.title,
    path: `/library/${surface.id}`,
    relativeOutputPath: getDemoSurfaceScreenshotPath(surface),
    locator: `[data-testid='${surface.testId}']`,
    waitForSelector: `[data-testid='${surface.testId}']`,
    maskSelectors: [],
    delayMs: 0
  }));
}