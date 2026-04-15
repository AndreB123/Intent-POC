import path from "node:path";
import { SurfaceDefinition, SurfaceLayer } from "../model/types";

const LAYER_DIRECTORIES: Record<SurfaceLayer, string> = {
  primitive: "components",
  component: "components",
  view: "views",
  page: "pages"
};

export function getDemoScreenshotLayerDirectory(layer: SurfaceLayer): string {
  return LAYER_DIRECTORIES[layer];
}

export function getDemoSurfaceScreenshotPath(surface: SurfaceDefinition): string {
  return path.join(getDemoScreenshotLayerDirectory(surface.layer), `${surface.id}.png`);
}

export function getDemoScreenshotRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, "artifacts", "library");
}