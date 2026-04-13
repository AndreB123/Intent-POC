import { renderComponent } from "../components/render-component";
import { LibraryVariant } from "../model/types";

export function renderView(id: string, variant: LibraryVariant): string {
  const changed = variant === "v2";

  switch (id) {
    case "view-dashboard-summary":
      return `<div class="layout-stack"><div class="tile"><strong>${changed ? "Revenue Operations" : "Growth Operations"}</strong><div class="muted">Dashboard summary</div></div><div class="layout-row">${renderComponent("component-stat-tile", variant)}${renderComponent("component-card-highlight", variant)}</div>${renderComponent("component-banner-info", variant)}</div>`;
    case "view-list-overview":
      return `<div class="layout-stack"><div class="list">${renderComponent("component-user-list-item", variant)}${renderComponent("component-user-list-item", variant)}${renderComponent("component-user-list-item", variant)}</div></div>`;
    case "view-settings-panel":
      return `<div class="layout-stack">${renderComponent("component-form-section", variant)}<div class="row">${renderComponent("component-button-primary", variant)}${renderComponent("component-button-secondary", variant)}${renderComponent("component-button-danger", variant)}</div></div>`;
    case "view-empty-results":
      return `<div class="tile"><strong>No placements found</strong><div class="muted">Try broadening your filters.</div><div class="row">${renderComponent("component-button-primary", variant)}${renderComponent("component-search-bar", variant)}</div></div>`;
    case "view-campaign-table":
      return `<div class="layout-stack">${renderComponent("component-nav-tabs", variant)}${renderComponent("component-table-row", variant)}${renderComponent("component-table-row", variant)}</div>`;
    case "view-notifications-center":
      return `<div class="layout-stack">${renderComponent("component-toast-success", variant)}${renderComponent("component-toast-error", variant)}${renderComponent("component-banner-warning", variant)}</div>`;
    case "view-user-directory":
      return `<div class="layout-stack">${renderComponent("component-search-bar", variant)}<div class="list">${renderComponent("component-user-list-item", variant)}${renderComponent("component-user-list-item", variant)}${renderComponent("component-user-list-item", variant)}</div></div>`;
    case "view-revenue-kpis":
      return `<div class="layout-three">${renderComponent("component-stat-tile", variant)}${renderComponent("component-stat-tile", variant)}${renderComponent("component-stat-tile", variant)}</div>`;
    case "view-onboarding-checklist":
      return `<div class="layout-stack"><div class="tile"><strong>Onboarding</strong><div class="muted">Complete these tasks for launch readiness.</div></div><div class="list"><div class="list-item row"><span class="chip success">done</span><span>Connect data feed</span></div><div class="list-item row"><span class="chip warning">pending</span><span>Define budget guardrails</span></div><div class="list-item row"><span class="chip warning">pending</span><span>Enable alert notifications</span></div></div></div>`;
    case "view-approval-queue":
      return `<div class="layout-stack">${renderComponent("component-card-compact", variant)}${renderComponent("component-card-compact", variant)}${renderComponent("component-modal-shell", variant)}</div>`;
    case "view-audit-log":
      return `<div class="layout-stack"><div class="tile"><strong>Audit Log</strong><div class="muted">Recent critical events</div></div><table class="table"><thead><tr><th>Time</th><th>Actor</th><th>Event</th></tr></thead><tbody><tr><td>09:41</td><td>system</td><td>Theme updated</td></tr><tr><td>09:43</td><td>andre</td><td>Campaign budget modified</td></tr><tr><td>09:46</td><td>agent</td><td>Intent run completed</td></tr></tbody></table></div>`;
    case "view-billing-overview":
      return `<div class="layout-stack"><div class="layout-row"><div class="tile stat"><strong>$248,330</strong><div class="muted">Month to Date</div></div><div class="tile stat"><strong>$19,882</strong><div class="muted">Outstanding</div></div></div>${renderComponent("component-banner-info", variant)}</div>`;
    default:
      return `<div class="tile">Unknown view</div>`;
  }
}