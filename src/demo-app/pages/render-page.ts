import { renderView } from "../views/render-view";
import { LibraryVariant } from "../model/types";

export function renderPage(id: string, variant: LibraryVariant): string {
  const changed = variant === "v2";

  switch (id) {
    case "page-analytics-overview":
      return `<div class="layout-stack"><h2>${changed ? "Analytics + Alerts" : "Analytics Overview"} <span class="chip success">QA Ready</span></h2>${renderView("view-revenue-kpis", variant)}${renderView("view-dashboard-summary", variant)}${renderView("view-campaign-table", variant)}</div>`;
    case "page-account-list":
      return `<div class="layout-stack"><h2>Account List</h2>${renderView("view-user-directory", variant)}${renderView("view-list-overview", variant)}</div>`;
    case "page-campaign-editor":
      return `<div class="layout-stack"><h2>Campaign Editor</h2>${renderView("view-settings-panel", variant)}${renderView("view-approval-queue", variant)}</div>`;
    case "page-system-settings":
      return `<div class="layout-stack"><h2>System Settings</h2>${renderView("view-onboarding-checklist", variant)}${renderView("view-empty-results", variant)}</div>`;
    case "page-operations-center":
      return `<div class="layout-stack"><h2>Operations Center</h2>${renderView("view-dashboard-summary", variant)}${renderView("view-notifications-center", variant)}${renderView("view-audit-log", variant)}</div>`;
    case "page-user-management":
      return `<div class="layout-stack"><h2>User Management</h2>${renderView("view-user-directory", variant)}${renderView("view-approval-queue", variant)}</div>`;
    case "page-incident-review":
      return `<div class="layout-stack"><h2>Incident Review</h2>${renderView("view-notifications-center", variant)}${renderView("view-audit-log", variant)}</div>`;
    case "page-revenue-forecast":
      return `<div class="layout-stack"><h2>Revenue Forecast</h2>${renderView("view-revenue-kpis", variant)}${renderView("view-billing-overview", variant)}${renderView("view-campaign-table", variant)}</div>`;
    default:
      return `<div class="tile">Unknown page</div>`;
  }
}