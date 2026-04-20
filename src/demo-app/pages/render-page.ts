import { renderView } from "../views/render-view";
import { LibraryVariant } from "../model/types";
import { renderStatusChip } from "../shared/render-display-primitives";
import { renderPageHeader, renderStack } from "../shared/render-layout";

export function renderPage(id: string, variant: LibraryVariant): string {
  const changed = variant === "v2";

  switch (id) {
    case "page-analytics-overview":
      return renderStack([
        renderPageHeader({ title: changed ? "Analytics + Alerts" : "Analytics Overview", badgeHtml: renderStatusChip({ label: "QA Ready", className: "success" }) }),
        renderView("view-revenue-kpis", variant),
        renderView("view-dashboard-summary", variant),
        renderView("view-campaign-table", variant)
      ]);
    case "page-account-list":
      return renderStack([
        renderPageHeader({ title: "Account List" }),
        renderView("view-user-directory", variant),
        renderView("view-list-overview", variant)
      ]);
    case "page-campaign-editor":
      return renderStack([
        renderPageHeader({ title: "Campaign Editor" }),
        renderView("view-settings-panel", variant),
        renderView("view-approval-queue", variant)
      ]);
    case "page-system-settings":
      return renderStack([
        renderPageHeader({ title: "System Settings" }),
        renderView("view-onboarding-checklist", variant),
        renderView("view-empty-results", variant)
      ]);
    case "page-operations-center":
      return renderStack([
        renderPageHeader({ title: "Operations Center" }),
        renderView("view-dashboard-summary", variant),
        renderView("view-notifications-center", variant),
        renderView("view-audit-log", variant)
      ]);
    case "page-user-management":
      return renderStack([
        renderPageHeader({ title: "User Management" }),
        renderView("view-user-directory", variant),
        renderView("view-approval-queue", variant)
      ]);
    case "page-incident-review":
      return renderStack([
        renderPageHeader({ title: "Incident Review" }),
        renderView("view-notifications-center", variant),
        renderView("view-audit-log", variant)
      ]);
    case "page-revenue-forecast":
      return renderStack([
        renderPageHeader({ title: "Revenue Forecast" }),
        renderView("view-revenue-kpis", variant),
        renderView("view-billing-overview", variant),
        renderView("view-campaign-table", variant)
      ]);
    default:
      return `<div class="tile">Unknown page</div>`;
  }
}