import { strict as assert } from "node:assert";
import test from "node:test";
import {
  renderCallout,
  renderChecklistRow,
  renderPersonListItem,
  renderStatTile,
  renderStatusChip,
  renderTabStrip
} from "./render-display-primitives";

test("renderStatusChip preserves the shared chip contract", () => {
  assert.equal(renderStatusChip({ label: "QA Ready", className: "success" }), '<span class="chip success">QA Ready</span>');
});

test("renderCallout preserves the banner structure", () => {
  assert.equal(
    renderCallout({ title: "Warning", description: "One connector is running in degraded mode.", borderColorVar: "--warning" }),
    '<div class="callout" style="border-left-color:var(--warning)"><strong>Warning</strong><div class="muted">One connector is running in degraded mode.</div></div>'
  );
});

test("renderStatTile and renderTabStrip preserve the display-shell structure", () => {
  assert.equal(
    renderStatTile({ value: "$1.20M", label: "Projected Quarterly Revenue" }),
    '<div class="tile stat"><strong>$1.20M</strong><div class="muted">Projected Quarterly Revenue</div></div>'
  );

  assert.equal(
    renderTabStrip({ tabs: ["Overview", "Audiences", "Rules"], activeTab: "Overview" }),
    '<div class="tabs"><span class="tab active">Overview</span><span class="tab">Audiences</span><span class="tab">Rules</span></div>'
  );
});

test("renderPersonListItem and renderChecklistRow preserve shared list-row structure", () => {
  assert.equal(
    renderPersonListItem({ initials: "AL", title: "Avery Lane", subtitle: "Role: Admin", statusLabel: "Online" }),
    '<div class="list-item row"><span class="avatar">AL</span><div><strong>Avery Lane</strong><div class="muted">Role: Admin</div></div><span class="chip">Online</span></div>'
  );

  assert.equal(
    renderChecklistRow({ statusLabel: "pending", statusClassName: "warning", text: "Define budget guardrails" }),
    '<div class="list-item row"><span class="chip warning">pending</span><span>Define budget guardrails</span></div>'
  );
});