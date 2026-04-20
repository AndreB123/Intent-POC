import { escapeHtml } from "./render-controls";

export interface RenderPageHeaderInput {
  title: string;
  badgeHtml?: string;
  subtitle?: string;
}

export interface RenderSectionHeaderInput {
  title: string;
  subtitle?: string;
  bodyHtml?: string;
  className?: string;
}

export function renderStack(items: string[], className = "layout-stack"): string {
  return `<div class="${escapeHtml(className)}">${items.join("")}</div>`;
}

export function renderList(items: string[]): string {
  return renderStack(items, "list");
}

export function renderGridRow(items: string[]): string {
  return renderStack(items, "layout-row");
}

export function renderGridThree(items: string[]): string {
  return renderStack(items, "layout-three");
}

export function renderRow(items: string[], className = "row"): string {
  return `<div class="${escapeHtml(className)}">${items.join("")}</div>`;
}

export function renderPageHeader(input: RenderPageHeaderInput): string {
  const subtitle = input.subtitle
    ? `<div class="page-subtitle">${escapeHtml(input.subtitle)}</div>`
    : "";
  const badge = input.badgeHtml ? ` ${input.badgeHtml}` : "";

  return `<div class="page-header"><h2>${escapeHtml(input.title)}${badge}</h2>${subtitle}</div>`;
}

export function renderSectionHeader(input: RenderSectionHeaderInput): string {
  const subtitle = input.subtitle
    ? `<div class="section-subtitle">${escapeHtml(input.subtitle)}</div>`
    : "";
  const body = input.bodyHtml ?? "";
  const className = escapeHtml(input.className ?? "tile layout-stack");

  return `<div class="${className}"><div class="section-header"><strong>${escapeHtml(input.title)}</strong>${subtitle}</div>${body}</div>`;
}