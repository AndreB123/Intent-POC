import { renderComponent } from "../components/render-component";
import { LibraryVariant } from "../model/types";
import { renderSelectionCard } from "../shared/render-content-cards";
import { renderChecklistRow, renderStatTile } from "../shared/render-display-primitives";
import { renderGridRow, renderGridThree, renderList, renderRow, renderSectionHeader, renderStack } from "../shared/render-layout";
import { renderButton, renderTextInput } from "../shared/render-controls";

export function renderView(id: string, variant: LibraryVariant): string {
  const changed = variant === "v2";

  switch (id) {
    case "view-login-form":
      return renderStack([
        renderSectionHeader({ title: "Sign In", subtitle: "Enter your credentials to continue." }),
        `<div class="tile">`,
        `<div><strong>Username</strong>${renderTextInput({ className: "input-field", value: "" })}</div>`,
        `<div><strong>Password</strong>${renderTextInput({ className: "input-field", value: "" })}</div>`,
        renderButton({ label: "Sign In", className: "accent" }),
        `</div>`
      ]);
    case "view-dashboard-summary":
      return renderStack([
        renderComponent("component-toast-success", variant),
        renderSelectionCard({ title: changed ? "Revenue Operations" : "Growth Operations", badge: { label: "overview", toneClass: "target-ready" }, lines: [{ text: "Dashboard summary" }] }),
        renderGridRow([renderComponent("component-stat-tile", variant), renderComponent("component-card-highlight", variant)]),
        renderComponent("component-banner-info", variant)
      ]);
    case "view-list-overview":
      return renderStack([
        renderList([
          renderComponent("component-user-list-item", variant),
          renderComponent("component-user-list-item", variant),
          renderComponent("component-user-list-item", variant)
        ])
      ]);
    case "view-settings-panel":
      return renderStack([
        renderComponent("component-form-section", variant),
        renderRow([
          renderComponent("component-button-primary", variant),
          renderComponent("component-button-secondary", variant),
          renderComponent("component-button-danger", variant)
        ])
      ]);
    case "view-empty-results":
      return renderSectionHeader({
        title: "No placements found",
        subtitle: "Try broadening your filters.",
        bodyHtml: renderRow([renderComponent("component-button-primary", variant), renderComponent("component-search-bar", variant)])
      });
    case "view-campaign-table":
      return renderStack([
        renderComponent("component-nav-tabs", variant),
        renderComponent("component-table-row", variant),
        renderComponent("component-table-row", variant)
      ]);
    case "view-notifications-center":
      return renderStack([
        renderComponent("component-toast-success", variant),
        renderComponent("component-toast-error", variant),
        renderComponent("component-banner-warning", variant)
      ]);
    case "view-user-directory":
      return renderStack([
        renderComponent("component-search-bar", variant),
        renderList([
          renderComponent("component-user-list-item", variant),
          renderComponent("component-user-list-item", variant),
          renderComponent("component-user-list-item", variant)
        ])
      ]);
    case "view-revenue-kpis":
      return renderGridThree([
        renderComponent("component-stat-tile", variant),
        renderComponent("component-stat-tile", variant),
        renderComponent("component-stat-tile", variant)
      ]);
    case "view-onboarding-checklist":
      return renderStack([
        renderSelectionCard({ title: "Onboarding", badge: { label: "checklist", toneClass: "target-ready" }, lines: [{ text: "Complete these tasks for launch readiness." }] }),
        renderList([
          renderChecklistRow({ statusLabel: "done", statusClassName: "success", text: "Connect data feed" }),
          renderChecklistRow({ statusLabel: "pending", statusClassName: "warning", text: "Define budget guardrails" }),
          renderChecklistRow({ statusLabel: "pending", statusClassName: "warning", text: "Enable alert notifications" })
        ])
      ]);
    case "view-approval-queue":
      return renderStack([
        renderComponent("component-card-compact", variant),
        renderComponent("component-card-compact", variant),
        renderComponent("component-modal-shell", variant)
      ]);
    case "view-audit-log":
      return renderStack([
        renderSelectionCard({ title: "Audit Log", badge: { label: "recent", toneClass: "target-ready" }, lines: [{ text: "Recent critical events" }] }),
        '<table class="table"><thead><tr><th>Time</th><th>Actor</th><th>Event</th></tr></thead><tbody><tr><td>09:41</td><td>system</td><td>Theme updated</td></tr><tr><td>09:43</td><td>andre</td><td>Campaign budget modified</td></tr><tr><td>09:46</td><td>agent</td><td>Intent run completed</td></tr></tbody></table>'
      ]);
    case "view-billing-overview":
      return renderStack([
        renderGridRow([
          renderStatTile({ value: "$248,330", label: "Month to Date" }),
          renderStatTile({ value: "$19,882", label: "Outstanding" })
        ]),
        renderComponent("component-banner-info", variant)
      ]);
    default:
      return `<div class="tile">Unknown view</div>`;
  }
}