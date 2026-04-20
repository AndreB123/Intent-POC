import { escapeHtml } from "./render-controls";

export interface RenderBadgeInput {
  label: string;
  toneClass?: string;
  id?: string;
}

export interface RenderSummaryLineInput {
  text?: string;
  html?: string;
  id?: string;
}

export interface RenderSelectionCardInput {
  title: string;
  titleId?: string;
  badge?: RenderBadgeInput;
  lines: RenderSummaryLineInput[];
  className?: string;
}

function renderIdAttribute(id: string | undefined): string {
  return id ? ` id="${escapeHtml(id)}"` : "";
}

export function renderTargetBadge(input: RenderBadgeInput): string {
  const toneClass = input.toneClass ?? "target-ready";
  return `<span class="target-badge ${escapeHtml(toneClass)}"${renderIdAttribute(input.id)}>${escapeHtml(input.label)}</span>`;
}

export function renderSelectionCard(input: RenderSelectionCardInput): string {
  const className = escapeHtml(input.className ?? "selection-card");
  const badge = input.badge ? renderTargetBadge(input.badge) : "";
  const lines = input.lines
    .map((line) => {
      const content = typeof line.html === "string"
        ? line.html
        : escapeHtml(line.text ?? "");
      return `<div class="selection-summary"${renderIdAttribute(line.id)}>${content}</div>`;
    })
    .join("");

  return `<div class="${className}"><div class="selection-title"><strong${renderIdAttribute(input.titleId)}>${escapeHtml(input.title)}</strong>${badge}</div>${lines}</div>`;
}