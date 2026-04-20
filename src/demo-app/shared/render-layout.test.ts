import { strict as assert } from "node:assert";
import test from "node:test";
import {
  renderGridRow,
  renderGridThree,
  renderList,
  renderPageHeader,
  renderRow,
  renderSectionHeader,
  renderStack
} from "./render-layout";

test("render layout containers preserve shared wrapper structure", () => {
  assert.equal(renderStack(["<span>a</span>", "<span>b</span>"]), '<div class="layout-stack"><span>a</span><span>b</span></div>');
  assert.equal(renderList(["<span>a</span>"]), '<div class="list"><span>a</span></div>');
  assert.equal(renderGridRow(["<span>a</span>", "<span>b</span>"]), '<div class="layout-row"><span>a</span><span>b</span></div>');
  assert.equal(renderGridThree(["<span>a</span>"]), '<div class="layout-three"><span>a</span></div>');
  assert.equal(renderRow(["<span>a</span>", "<span>b</span>"]), '<div class="row"><span>a</span><span>b</span></div>');
});

test("render page and section headers preserve the shared header structure", () => {
  assert.equal(
    renderPageHeader({ title: "Analytics Overview", badgeHtml: '<span class="chip success">QA Ready</span>' }),
    '<div class="page-header"><h2>Analytics Overview <span class="chip success">QA Ready</span></h2></div>'
  );

  assert.equal(
    renderSectionHeader({ title: "No placements found", subtitle: "Try broadening your filters.", bodyHtml: '<div class="row"><span>actions</span></div>' }),
    '<div class="tile layout-stack"><div class="section-header"><strong>No placements found</strong><div class="section-subtitle">Try broadening your filters.</div></div><div class="row"><span>actions</span></div></div>'
  );
});