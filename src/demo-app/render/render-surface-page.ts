import { renderComponent } from "../components/render-component";
import { renderPage } from "../pages/render-page";
import { renderPrimitive } from "../primitives/render-primitive";
import { SurfaceDefinition, LibraryVariant } from "../model/types";
import { renderSurfaceFrame } from "./render-surface-frame";
import { renderView } from "../views/render-view";
import { renderLibraryArchitectureDocsPage, renderLibraryPlanningDocsPage } from "./render-library-docs-page";

function renderBody(definition: SurfaceDefinition, variant: LibraryVariant): string {
  const effectiveVariant: LibraryVariant = definition.changesInV2 ? variant : "v1";

  if (definition.layer === "primitive") {
    return renderPrimitive(definition.id, effectiveVariant);
  }

  if (definition.layer === "component") {
    return renderComponent(definition.id, effectiveVariant);
  }

  if (definition.layer === "view") {
    return renderView(definition.id, effectiveVariant);
  }

  return renderPage(definition.id, effectiveVariant);
}

export function renderSurfacePage(definition: SurfaceDefinition, variant: LibraryVariant): string {
  const body = renderBody(definition, variant);
  const frame = renderSurfaceFrame({ title: definition.title, testId: definition.testId, layer: definition.layer, body, variant });
  const injectedFrame = frame.replace('data-testid="theme-toggle"', 'id="dark-mode-toggle" data-testid="theme-toggle"');
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${definition.title}</title></head><body><div class="page">${injectedFrame}</div></body></html>`;
}

export function renderSurfaceLibraryIndex(catalog: SurfaceDefinition[], variant: LibraryVariant): string {
  const groups = ["primitive", "component", "view", "page"] as const;
  const sections = groups
    .map((group) => {
      const items = catalog
        .filter((item) => item.layer === group)
        .map((item) => `<li><a href="/library/${item.id}?variant=${variant}">${item.title}</a></li>`)
        .join("");
      return `<section><h2>${group}</h2><ul>${items}</ul></section>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Surface Library</title><style>body{font-family:Segoe UI,Helvetica Neue,sans-serif;padding:24px;background:#f2f6fc;color:#223449}section{background:#fff;border:1px solid #c4d0df;border-radius:12px;padding:16px;margin-bottom:14px}a{color:#1f5ea7;text-decoration:none}li{margin:6px 0}.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:20px;padding:14px 16px;background:#fff;border:1px solid #c4d0df;border-radius:12px}.toolbar strong{font-size:14px}.toolbar-spacer{flex:1}</style></head><body><h1>Primitive/Component/View/Page Library</h1><div class="toolbar"><strong>Variant:</strong><a href="/library?variant=v1">v1</a><a href="/library?variant=v2">v2</a><span class="toolbar-spacer"></span><a href="/library/planning-docs?variant=${variant}">Planning Docs</a><a href="/library/architecture-docs?variant=${variant}">Architecture Docs</a></div>${sections}</body></html>`;
}

export { renderLibraryArchitectureDocsPage, renderLibraryPlanningDocsPage };