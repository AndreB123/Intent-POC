import { LibraryVariant } from "../model/types";

function componentCard(title: string, subtitle: string, toneClass?: string): string {
  return `<div class="tile ${toneClass ?? ""}"><strong>${title}</strong><div class="muted">${subtitle}</div></div>`;
}

export function renderComponent(id: string, variant: LibraryVariant): string {
  const changed = variant === "v2";

  switch (id) {
    case "component-button-primary":
      return `<div class="row"><button class="${changed ? "accent-strong" : "accent"}">${changed ? "Launch" : "Save"}</button></div>`;
    case "component-button-secondary":
      return `<div class="row"><button>${changed ? "Back" : "Cancel"}</button></div>`;
    case "component-button-danger":
      return `<div class="row"><button class="danger">Delete Campaign</button></div>`;
    case "component-card-highlight":
      return componentCard(changed ? "Alert Card" : "Highlight Card", "Priority signal for operators", changed ? "warning" : "accent");
    case "component-card-compact":
      return componentCard("Compact Card", "Small summary payload for dashboard rails");
    case "component-banner-info":
      return `<div class="callout"><strong>${changed ? "Migration Window Open" : "Information"}</strong><div class="muted">All write paths are healthy.</div></div>`;
    case "component-banner-warning":
      return `<div class="callout" style="border-left-color:var(--warning)"><strong>Warning</strong><div class="muted">One connector is running in degraded mode.</div></div>`;
    case "component-modal-shell":
      return `<div class="tile"><h3>Confirm Change</h3><div class="muted">This action will update all placements.</div><div class="row"><button>Cancel</button><button class="accent">Confirm</button></div></div>`;
    case "component-table-row":
      return `<table class="table"><thead><tr><th>Name</th><th>Status</th><th>Spend</th></tr></thead><tbody><tr><td>Launch-Alpha</td><td><span class="chip success">Active</span></td><td>$12,320</td></tr></tbody></table>`;
    case "component-search-bar":
      return `<div class="row"><input value="Search campaigns" readonly /><button class="accent">Search</button><button>Filters</button></div>`;
    case "component-stat-tile":
      return `<div class="tile stat"><strong>${changed ? "$1.34M" : "$1.20M"}</strong><div class="muted">Projected Quarterly Revenue</div></div>`;
    case "component-nav-tabs":
      return `<div class="tabs"><span class="tab active">Overview</span><span class="tab">Audiences</span><span class="tab">Rules</span><span class="tab">History</span></div>`;
    case "component-toast-success":
      return `<div class="tile success"><strong>Saved</strong><div class="muted">Your changes were applied.</div></div>`;
    case "component-toast-error":
      return `<div class="tile danger"><strong>Deploy Failed</strong><div class="muted">Check build logs and retry.</div></div>`;
    case "component-form-section":
      return `<div class="tile layout-stack"><div><strong>Campaign Name</strong><div class="row"><input value="Spring-Launch" readonly /></div></div><div><strong>Budget</strong><div class="row"><input value="$8,000" readonly /></div></div><div class="row"><button class="accent">Save</button><button>Discard</button></div></div>`;
    case "component-user-list-item":
      return `<div class="list-item row"><span class="avatar">AL</span><div><strong>Avery Lane</strong><div class="muted">Role: Admin</div></div><span class="chip">Online</span></div>`;
    default:
      return `<div class="tile">Unknown component</div>`;
  }
}