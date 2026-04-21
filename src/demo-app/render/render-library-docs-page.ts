import { renderStudioGuideCards, renderStudioLifecyclePanel } from "../shared/render-studio-panels";
import { renderSurfaceFrame } from "./render-surface-frame";
import { LibraryVariant } from "../model/types";

function renderLibraryDocsNav(variant: LibraryVariant): string {
  return `
    <nav class="library-docs-nav" aria-label="Library docs sections">
      <a href="/library/planning-docs?variant=${variant}">Planning Docs</a>
      <a href="/library/architecture-docs?variant=${variant}">Architecture Docs</a>
      <a href="/library?variant=${variant}">Surface Library</a>
    </nav>`;
}

function renderPlanningDocsBody(): string {
  return `
    <div class="library-docs-shell">
      <section class="tile library-docs-section">
        <div class="library-docs-head">
          <h2>Lifecycle Planning</h2>
          <div class="muted">BDD, TDD, and planned execution docs stay visible under /library as a dedicated planning surface.</div>
        </div>
        ${renderStudioLifecyclePanel()}
      </section>
    </div>`;
}

function renderArchitectureDocsBody(): string {
  return `
    <div class="library-docs-shell">
      <section class="tile library-docs-section">
        <div class="library-docs-head">
          <h2>Work Scope And Shared Features</h2>
          <div class="muted">Architecture-facing guidance for source selection, scope defaults, and how shared demo surfaces fit into the same run.</div>
        </div>
        <div class="library-docs-grid">${renderStudioGuideCards()}</div>
      </section>
      <section class="tile library-docs-section">
        <div class="library-docs-head">
          <h2>Architectural Impact</h2>
          <div class="muted">Use this split to keep planning work separate from broader renderer and feature guidance during the cleanup.</div>
        </div>
        <div class="library-docs-grid library-docs-grid-single">
          <div class="selection-card">
            <div class="selection-title">
              <span>Planning vs feature surfaces</span>
              <span class="target-badge target-ready">architecture</span>
            </div>
            <div class="selection-summary">Planning docs cover prompt interpretation, BDD, TDD, execution, implementation, and QA sequencing.</div>
            <div class="selection-summary">Feature and work-scope docs explain which sources participate, how the shared library is organized, and which renderer seams are compatibility-only during migration.</div>
            <div class="selection-summary">Keeping these concerns separate reduces the chance that demo-library cleanup accidentally rewrites planning guidance or vice versa.</div>
          </div>
        </div>
      </section>
    </div>`;
}

function renderLibraryDocsStyles(): string {
  return `<style>
    .library-docs-shell { display: grid; gap: var(--space-lg); }
    .library-docs-nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: var(--space-md); }
    .library-docs-nav a { color: inherit; text-decoration: none; border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px; font-weight: 700; }
    .library-docs-section { display: grid; gap: var(--space-md); }
    .library-docs-head { display: grid; gap: 6px; }
    .library-docs-grid { display: grid; gap: 14px; }
    .library-docs-grid-single { grid-template-columns: minmax(0, 1fr); }
    .field-wide { min-width: 0; }
    .lifecycle-stack { display: grid; gap: 14px; }
    .lifecycle-step { display: grid; gap: 10px; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px; background: var(--surface); }
    .lifecycle-step-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 700; }
    .lifecycle-step-status { display: inline-flex; align-items: center; justify-content: center; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; font-weight: 700; }
    .lifecycle-step-status[data-state="pending"] { background: rgba(45, 103, 176, 0.08); color: var(--muted); }
    .lifecycle-step-content { display: grid; gap: 10px; }
    .plan-intent-text { font-weight: 700; }
    .plan-intent-outcome, .plan-note { color: var(--muted); }
    .plan-item, .empty-card { display: grid; gap: 8px; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px; background: var(--surface); }
    .plan-item-title { font-weight: 700; }
    .plan-item-tag-row { display: flex; flex-wrap: wrap; gap: 8px; }
    @media (min-width: 900px) {
      .library-docs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>`;
}

function renderLibraryDocsPage(input: {
  variant: LibraryVariant;
  title: string;
  testId: string;
  body: string;
}): string {
  const body = `${renderLibraryDocsNav(input.variant)}${input.body}`;
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${input.title}</title>${renderLibraryDocsStyles()}</head><body><div class="page">${renderSurfaceFrame({ title: input.title, testId: input.testId, layer: "page", body, variant: input.variant })}</div></body></html>`;
}

export function renderLibraryPlanningDocsPage(variant: LibraryVariant): string {
  return renderLibraryDocsPage({
    variant,
    title: "Library Planning Docs",
    testId: "library-planning-docs",
    body: renderPlanningDocsBody()
  });
}

export function renderLibraryArchitectureDocsPage(variant: LibraryVariant): string {
  return renderLibraryDocsPage({
    variant,
    title: "Library Architecture Docs",
    testId: "library-architecture-docs",
    body: renderArchitectureDocsBody()
  });
}