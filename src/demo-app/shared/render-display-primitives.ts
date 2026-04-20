import { escapeHtml } from "./render-controls";

export interface RenderStatusChipInput {
  label: string;
  className?: string;
}

export interface RenderCalloutInput {
  title: string;
  description: string;
  borderColorVar?: string;
}

export interface RenderStatTileInput {
  value: string;
  label: string;
}

export interface RenderTabStripInput {
  tabs: string[];
  activeTab: string;
}

export interface RenderPersonListItemInput {
  initials: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusClassName?: string;
}

export interface RenderChecklistRowInput {
  statusLabel: string;
  statusClassName?: string;
  text: string;
}

export function renderStatusChip(input: RenderStatusChipInput): string {
  const className = input.className ? ` ${escapeHtml(input.className)}` : "";
  return `<span class="chip${className}">${escapeHtml(input.label)}</span>`;
}

export function renderCallout(input: RenderCalloutInput): string {
  const style = input.borderColorVar ? ` style="border-left-color:var(${escapeHtml(input.borderColorVar)})"` : "";
  return `<div class="callout"${style}><strong>${escapeHtml(input.title)}</strong><div class="muted">${escapeHtml(input.description)}</div></div>`;
}

export function renderStatTile(input: RenderStatTileInput): string {
  return `<div class="tile stat"><strong>${escapeHtml(input.value)}</strong><div class="muted">${escapeHtml(input.label)}</div></div>`;
}

export function renderTabStrip(input: RenderTabStripInput): string {
  const tabs = input.tabs
    .map((tab) => `<span class="tab${tab === input.activeTab ? " active" : ""}">${escapeHtml(tab)}</span>`)
    .join("");
  return `<div class="tabs">${tabs}</div>`;
}

export function renderPersonListItem(input: RenderPersonListItemInput): string {
  return `<div class="list-item row"><span class="avatar">${escapeHtml(input.initials)}</span><div><strong>${escapeHtml(input.title)}</strong><div class="muted">${escapeHtml(input.subtitle)}</div></div>${renderStatusChip({ label: input.statusLabel, className: input.statusClassName })}</div>`;
}

export function renderChecklistRow(input: RenderChecklistRowInput): string {
  return `<div class="list-item row">${renderStatusChip({ label: input.statusLabel, className: input.statusClassName })}<span>${escapeHtml(input.text)}</span></div>`;
}