import { LibraryVariant } from "../model/types";
import { renderSelectionCard } from "../shared/render-content-cards";
import {
  renderCallout,
  renderPersonListItem,
  renderStatTile,
  renderStatusChip,
  renderTabStrip
} from "../shared/render-display-primitives";
import { renderButton, renderTextInput } from "../shared/render-controls";

function componentCard(title: string, subtitle: string, toneClass?: string): string {
  return renderSelectionCard({
    title,
    badge: { label: toneClass === "warning" ? "alert" : "summary", toneClass: toneClass === "warning" ? "target-attention" : "target-ready" },
    lines: [{ text: subtitle }],
    className: `selection-card ${toneClass ?? ""}`.trim()
  });
}

export function renderComponent(id: string, variant: LibraryVariant): string {
  const changed = variant === "v2";

  switch (id) {
    case "component-button-primary":
      return `<div class="row">${renderButton({ label: changed ? "Launch" : "Save", className: changed ? "accent-strong" : "accent" })}</div>`;
    case "component-button-secondary":
      return `<div class="row">${renderButton({ label: changed ? "Back" : "Cancel" })}</div>`;
    case "component-button-danger":
      return `<div class="row">${renderButton({ label: "Delete Campaign", className: "danger" })}</div>`;
    case "component-card-highlight":
      return componentCard(changed ? "Alert Card" : "Highlight Card", "Priority signal for operators", changed ? "warning" : "accent");
    case "component-card-compact":
      return componentCard("Compact Card", "Small summary payload for dashboard rails");
    case "component-banner-info":
      return renderCallout({ title: changed ? "Migration Window Open" : "Information", description: "All write paths are healthy." });
    case "component-banner-warning":
      return renderCallout({ title: "Warning", description: "One connector is running in degraded mode.", borderColorVar: "--warning" });
    case "component-modal-shell":
      return `<div class="tile"><h3>Confirm Change</h3><div class="muted">This action will update all placements.</div><div class="row">${renderButton({ label: "Cancel" })}${renderButton({ label: "Confirm", className: "accent" })}</div></div>`;
    case "component-table-row":
      return `<table class="table"><thead><tr><th>Name</th><th>Status</th><th>Spend</th></tr></thead><tbody><tr><td>Launch-Alpha</td><td>${renderStatusChip({ label: "Active", className: "success" })}</td><td>$12,320</td></tr></tbody></table>`;
    case "component-search-bar":
      return `<div class="row">${renderTextInput({ className: "input-field", value: "Search campaigns" })}${renderButton({ label: "Search", className: "accent" })}${renderButton({ label: "Filters" })}</div>`;
    case "component-stat-tile":
      return renderStatTile({ value: changed ? "$1.34M" : "$1.20M", label: "Projected Quarterly Revenue" });
    case "component-nav-tabs":
      return renderTabStrip({ tabs: ["Overview", "Audiences", "Rules", "History"], activeTab: "Overview" });
    case "component-toast-success":
      return renderSelectionCard({
        title: "Saved",
        badge: { label: "success", toneClass: "target-ready" },
        lines: [{ text: "Your changes were applied." }],
        className: "selection-card success"
      });
    case "component-toast-error":
      return renderSelectionCard({
        title: "Deploy Failed",
        badge: { label: "error", toneClass: "target-attention" },
        lines: [{ text: "Check build logs and retry." }],
        className: "selection-card danger"
      });
    case "component-form-section":
      return `<div class="tile layout-stack"><div><strong>Campaign Name</strong><div class="row">${renderTextInput({ className: "input-field", value: "Spring-Launch" })}</div></div><div><strong>Budget</strong><div class="row">${renderTextInput({ className: "input-field", value: "$8,000" })}</div></div><div class="row">${renderButton({ label: "Save", className: "accent" })}${renderButton({ label: "Discard" })}</div></div>`;
    case "component-user-list-item":
      return renderPersonListItem({ initials: "AL", title: "Avery Lane", subtitle: "Role: Admin", statusLabel: "Online" });
    case "component-activity-timeline":
      return `<div class="tile"><details><summary><strong>Activity Timeline</strong></summary><div class="muted">No recent activity.</div></details></div>`;
    default:
      return `<div class="tile">Unknown component</div>`;
  }
}