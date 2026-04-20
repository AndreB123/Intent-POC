import { AGENT_STAGE_DEFINITIONS, AGENT_STAGE_SEQUENCE, GEMINI_MODEL_OPTIONS } from "../../intent/agent-stage-config";
import { renderSelectionCard } from "../shared/render-content-cards";
import { renderButton, renderTextInput } from "../shared/render-controls";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAgentStageFields(): string {
  const modelOptions = GEMINI_MODEL_OPTIONS.map(
    (option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`
  ).join("");

  return AGENT_STAGE_SEQUENCE.map((stageId) => {
    const stage = AGENT_STAGE_DEFINITIONS[stageId];
    return `
                <div class="field">
                  <div class="field-head">
                    <label for="${stage.id}-model-select">
                      ${escapeHtml(stage.label)}
                      <span class="info-icon" id="${stage.id}-info" data-tooltip="${escapeHtml(stage.description)}">ⓘ</span>
                    </label>
                    <label class="field-toggle">
                      <input
                        id="${stage.id}-enabled"
                        type="checkbox"
                        data-default-enabled="${stage.defaultEnabled ? "true" : "false"}"
                        ${stage.defaultEnabled ? "checked" : ""}
                      />
                      <span>Enable stage</span>
                    </label>
                  </div>
                  <select id="${stage.id}-model-select">
                    <option value="">Use config default</option>
                    ${modelOptions}
                  </select>
                </div>`;
  }).join("");
}

export function renderIntentStudioPage(input: { configPath: string }): string {
  const configPath = escapeHtml(input.configPath);
  const agentStageFields = renderAgentStageFields();
  const stageIdsJson = JSON.stringify(AGENT_STAGE_SEQUENCE);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Intent Studio</title>
    <style>
      :root {
        --bg: #f6f2e8;
        --bg-accent: #dce7ef;
        --panel: rgba(255, 252, 246, 0.92);
        --panel-strong: #fffaf1;
        --line: rgba(25, 54, 70, 0.14);
        --text: #16212b;
        --muted: #586975;
        --accent: #0f766e;
        --accent-strong: #0b5b55;
        --success: #1f7a46;
        --warning: #b96a13;
        --danger: #b44534;
        --shadow: 0 22px 44px rgba(19, 35, 44, 0.1);
        --radius-lg: 28px;
        --radius-md: 18px;
        --radius-sm: 12px;
        --font-body: "IBM Plex Sans", "Segoe UI", sans-serif;
        --font-heading: "Azeret Mono", "IBM Plex Sans", sans-serif;
      }

      .dark-mode {
        --bg: #16212b;
        --bg-accent: #1e293b;
        --panel: rgba(30, 41, 59, 0.92);
        --panel-strong: #2d3748;
        --line: rgba(255, 255, 255, 0.1);
        --text: #f8fafc;
        --muted: #94a3b8;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: var(--font-body);
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.12), transparent 30%),
          radial-gradient(circle at bottom right, rgba(191, 106, 19, 0.12), transparent 34%),
          linear-gradient(180deg, var(--bg), var(--bg-accent));
      }

      a {
        color: var(--accent-strong);
        text-decoration: none;
      }

      a:hover { text-decoration: underline; }

      .shell {
        max-width: 1480px;
        margin: 0 auto;
        padding: 28px;
      }

      .masthead {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1fr) 380px;
        margin-bottom: 24px;
      }

      .hero,
      .meta,
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
        animation: rise 280ms ease-out;
      }

      .hero {
        padding: 28px;
        position: relative;
      }

      .dark-mode-toggle {
        position: absolute;
        top: 28px;
        right: 28px;
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      .hero h1,
      .panel h2,
      .meta h2 {
        margin: 0;
        font-family: var(--font-heading);
        letter-spacing: -0.03em;
      }

      .hero p {
        margin: 12px 0 0;
        max-width: 780px;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.5;
      }

      .hero-actions,
      .meta-grid,
      .prompt-grid,
      .plan-grid,
      .status-strip,
      .results-grid,
      .target-list,
      .capture-grid,
      .recent-list {
        display: grid;
        gap: 14px;
      }

      .hero-actions {
        margin-top: 22px;
        grid-template-columns: repeat(3, minmax(0, max-content));
      }

      .hero-link,
      .ghost-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 11px 14px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
        font-size: 14px;
        font-weight: 600;
      }

      .meta {
        padding: 22px;
      }

      .meta-grid {
        margin-top: 18px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .meta-card,
      .metric,
      .artifact-card,
      .capture-card,
      .recent-card,
      .target-card,
      .selection-card,
      .plan-card,
      .plan-item,
      .empty-card,
      .timeline-item {
        border: 1px solid var(--line);
        border-radius: var(--radius-md);
        background: var(--panel-strong);
      }

      .meta-card,
      .metric,
      .artifact-card,
      .target-card,
      .recent-card,
      .selection-card,
      .plan-card,
      .empty-card {
        padding: 16px;
      }

      .meta-label,
      .metric-label,
      .artifact-label,
      .capture-meta,
      .recent-meta,
      .target-meta,
      .panel-copy,
      .notice,
      .timeline-meta {
        color: var(--muted);
        overflow-wrap: break-word;
      }

      .meta-value,
      .metric-value,
      .artifact-value,
      .capture-title,
      .recent-title,
      .target-title {
        display: block;
        margin-top: 8px;
        font-size: 15px;
        font-weight: 700;
      }

      .workspace {
        font-family: var(--font-heading);
        font-size: 12px;
        color: var(--muted);
      }

      .layout {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1fr) 380px;
      }

      .main-stack,
      .side-stack {
        display: grid;
        gap: 18px;
      }

      .panel {
        padding: 24px;
      }

      .panel-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 18px;
      }

      .panel-copy {
        margin-top: 8px;
        font-size: 14px;
        line-height: 1.5;
      }

      .prompt-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .field,
      .field-wide {
        display: grid;
        gap: 8px;
      }

      .field-note {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .field-wide {
        grid-column: 1 / -1;
      }

      .field-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }

      .field-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .field-toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
      }

      .field-toggle input {
        margin: 0;
        accent-color: var(--accent);
      }

      label {
        font-size: 13px;
        font-weight: 700;
        color: var(--muted);
      }

      textarea,
      select,
      button,
      input[type="checkbox"],
      input[type="text"] {
        font: inherit;
      }

      textarea,
      select,
      input[type="text"] {
        width: 100%;
        border: 1px solid rgba(25, 54, 70, 0.18);
        border-radius: var(--radius-md);
        background: white;
        padding: 14px 16px;
        color: var(--text);
      }

      textarea {
        min-height: 140px;
        resize: vertical;
        line-height: 1.5;
      }

      .form-actions {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-top: 18px;
      }

      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.76);
        font-size: 13px;
        font-weight: 700;
      }

      .submit-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        min-height: 44px;
      }

      .primary-button {
        border: none;
        border-radius: 999px;
        padding: 13px 20px;
        background: linear-gradient(135deg, var(--accent), #17817c);
        color: white;
        font-weight: 700;
        cursor: pointer;
      }

      .primary-button:disabled {
        opacity: 0.55;
        cursor: progress;
      }

      .ghost-button {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 13px 20px;
        background: rgba(255, 255, 255, 0.72);
        color: var(--text);
        font-weight: 700;
        cursor: pointer;
      }

      .ghost-button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .status-pill,
      .event-badge,
      .capture-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 7px 11px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .status-ready,
      .event-info,
      .capture-captured {
        background: rgba(15, 118, 110, 0.12);
        color: var(--accent-strong);
      }

      .status-running {
        background: rgba(185, 106, 19, 0.12);
        color: var(--warning);
      }

      .status-failed,
      .event-error,
      .capture-failed {
        background: rgba(180, 69, 52, 0.12);
        color: var(--danger);
      }

      .status-completed {
        background: rgba(31, 122, 70, 0.12);
        color: var(--success);
      }

      .event-warn {
        background: rgba(185, 106, 19, 0.12);
        color: var(--warning);
      }

      .status-strip,
      .results-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .timeline {
        display: grid;
        gap: 14px;
      }

      .timeline-item {
        padding: 16px 18px;
        min-width: 0;
        overflow-wrap: break-word;
      }

      .timeline-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .timeline-message {
        margin-top: 12px;
        font-weight: 700;
        line-height: 1.45;
        overflow-wrap: break-word;
      }

      .timeline-details {
        margin-top: 12px;
        padding: 12px;
        border-radius: var(--radius-sm);
        background: #f3efe7;
        color: #425462;
        overflow-x: auto;
        font-size: 12px;
      }

      .artifact-card {
        display: grid;
        gap: 10px;
      }

      .plan-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .plan-column,
      .plan-list {
        display: grid;
        gap: 14px;
      }

      .plan-card {
        display: grid;
        gap: 12px;
      }

      .plan-intent-text,
      .plan-intent-outcome,
      .plan-item-copy,
      .plan-meta,
      .plan-step,
      .plan-note {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
        overflow-wrap: break-word;
      }

      .plan-item {
        padding: 14px;
        display: grid;
        gap: 8px;
        min-width: 0;
        overflow-wrap: break-word;
      }

      .plan-item-title {
        font-weight: 700;
      }

      .plan-item-tag-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .plan-tag {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(15, 118, 110, 0.08);
        color: var(--accent-strong);
        font-size: 12px;
        font-weight: 700;
      }

      .artifact-links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .capture-grid {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .capture-card {
        overflow: hidden;
      }

      .capture-card img {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 10;
        object-fit: cover;
        background: #e7ecef;
      }

      .capture-body {
        padding: 14px;
        display: grid;
        gap: 10px;
      }

      .capture-links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .selection-card,
      .target-card {
        display: grid;
        gap: 10px;
      }

      .scope-list {
        display: grid;
        gap: 12px;
      }

      .scope-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 14px;
        align-items: flex-start;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: var(--radius-md);
        background: var(--panel-strong);
        cursor: pointer;
        transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }

      .scope-card:hover {
        border-color: rgba(15, 118, 110, 0.28);
        transform: translateY(-1px);
      }

      .scope-card-selected {
        border-color: rgba(15, 118, 110, 0.38);
        box-shadow: inset 0 0 0 1px rgba(15, 118, 110, 0.16);
      }

      .scope-checkbox {
        width: 18px;
        height: 18px;
        margin-top: 4px;
        accent-color: var(--accent);
      }

      .scope-card-body,
      .scope-card-copy {
        display: grid;
        gap: 8px;
      }

      .scope-card-head,
      .scope-card-title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .scope-card-title {
        font-weight: 700;
        color: var(--text);
      }

      .scope-card-subtitle,
      .scope-card-summary,
      .scope-card-meta {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }

      .editor-form,
      .editor-grid {
        display: grid;
        gap: 14px;
      }

      .editor-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .editor-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }

      .selection-title,
      .target-status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .target-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .target-ready {
        background: rgba(31, 122, 70, 0.12);
        color: var(--success);
      }

      .target-attention {
        background: rgba(185, 106, 19, 0.12);
        color: var(--warning);
      }

      .selection-summary,
      .target-summary,
      .target-detail,
      .target-note,
      .target-issue {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }

      .target-detail strong,
      .target-note strong,
      .target-issue strong {
        color: var(--text);
      }

      .target-issue {
        color: var(--warning);
      }

      .recent-card,
      .target-card {
        display: grid;
        gap: 10px;
      }

      .notice {
        font-size: 13px;
      }

      .error-banner {
        display: none;
        margin-top: 14px;
        padding: 14px 16px;
        border-radius: var(--radius-md);
        border: 1px solid rgba(180, 69, 52, 0.24);
        background: rgba(180, 69, 52, 0.08);
        color: var(--danger);
        font-weight: 700;
      }

      .info-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgba(25, 54, 70, 0.1);
        color: var(--muted);
        font-size: 10px;
        font-weight: bold;
        cursor: help;
        margin-left: 6px;
        vertical-align: middle;
        position: relative;
      }

      .info-icon:hover::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 125%;
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        color: white;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 11px;
        font-weight: 500;
        line-height: 1.4;
        width: 240px;
        text-align: center;
        white-space: normal;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        z-index: 100;
        pointer-events: none;
      }

      .info-icon:hover::before {
        content: "";
        position: absolute;
        bottom: 110%;
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: #1e293b;
        z-index: 100;
        pointer-events: none;
      }

      .agent-stages-section {
        grid-column: 1 / -1;
        display: grid;
        gap: 14px;
        margin-top: 14px;
        padding-top: 24px;
        border-top: 1px solid var(--line);
      }

      .agent-stages-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: 1fr;
      }

      .run-snapshot-mini {
        margin-top: 18px;
        padding-top: 14px;
        border-top: 1px solid var(--line);
        display: grid;
        gap: 8px;
      }

      .mini-metric {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
      }

      .mini-label {
        color: var(--muted);
        font-weight: 600;
        white-space: nowrap;
      }

      .mini-value {
        font-weight: 700;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .muted-link {
        font-size: 13px;
        color: var(--muted);
      }

      .lifecycle-stack {
        display: grid;
        gap: 0;
        position: relative;
        margin-top: 8px;
      }

      .lifecycle-step {
        position: relative;
        padding-bottom: 22px;
        padding-left: 28px;
        border-left: 2px solid var(--line);
      }

      .lifecycle-step:last-child {
        border-left-color: transparent;
        padding-bottom: 0;
      }

      .lifecycle-step::before {
        content: "";
        position: absolute;
        left: -9px;
        top: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--panel-strong);
        border: 2px solid var(--line);
        z-index: 1;
        transition: all 160ms ease;
      }

      .lifecycle-step.active::before {
        border-color: var(--accent);
        background: var(--accent);
        box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.14);
      }

      .lifecycle-step.completed::before {
        border-color: var(--success);
        background: var(--success);
      }

      .lifecycle-step-title {
        font-family: var(--font-heading);
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .lifecycle-step-status {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 76px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
        color: var(--muted);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.04em;
      }

      .lifecycle-step-status[data-state="pending"] {
        color: var(--muted);
      }

      .lifecycle-step-status[data-state="preview"] {
        color: var(--warning);
        border-color: rgba(185, 106, 19, 0.24);
        background: rgba(185, 106, 19, 0.08);
      }

      .lifecycle-step-status[data-state="running"] {
        color: var(--accent-strong);
        border-color: rgba(15, 118, 110, 0.28);
        background: rgba(15, 118, 110, 0.1);
      }

      .lifecycle-step-status[data-state="completed"] {
        color: var(--success);
        border-color: rgba(31, 122, 70, 0.24);
        background: rgba(31, 122, 70, 0.08);
      }

      .lifecycle-step.active .lifecycle-step-title {
        color: var(--accent-strong);
      }

      .lifecycle-step-content {
        display: grid;
        gap: 12px;
      }

      .lifecycle-step-content .plan-item {
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.4);
        border-radius: var(--radius-sm);
        border: 1px solid var(--line);
      }

      .lifecycle-step-content .plan-item-title {
        font-size: 13px;
      }

      .lifecycle-step-content .empty-card {
        padding: 10px;
        font-size: 12px;
        background: transparent;
        border: 1px dashed var(--line);
        color: var(--muted);
      }

      .tabs-nav {
        display: flex;
        gap: 8px;
        margin-bottom: 24px;
        border-bottom: 1px solid var(--line);
        padding-bottom: 12px;
      }

      .tab-link {
        padding: 10px 20px;
        border-radius: var(--radius-md);
        font-weight: 700;
        font-size: 15px;
        color: var(--muted);
        cursor: pointer;
        background: transparent;
        border: 1px solid transparent;
        transition: all 160ms ease;
      }

      .tab-link:hover {
        background: rgba(255, 255, 255, 0.4);
      }

      .tab-link.active {
        background: var(--panel-strong);
        border-color: var(--line);
        color: var(--accent-strong);
        box-shadow: 0 4px 12px rgba(19, 35, 44, 0.05);
      }

      .tab-content {
        display: none;
      }

      .tab-content.active {
        display: grid;
        gap: 18px;
        animation: rise 280ms ease-out;
      }

      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 1120px) {
        .masthead,
        .layout,
        .prompt-grid,
        .plan-grid,
        .status-strip,
        .results-grid,
        .editor-grid {
          grid-template-columns: 1fr;
        }

        .hero-actions,
        .meta-grid {
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (max-width: 720px) {
        .shell {
          padding: 18px;
        }

        .hero,
        .meta,
        .panel {
          padding: 18px;
        }

        .hero-actions,
        .meta-grid {
          grid-template-columns: 1fr;
        }

        .form-actions,
        .timeline-head,
        .field-head,
        .scope-card,
        .scope-card-head,
        .scope-card-title-row {
          flex-direction: column;
          align-items: stretch;
        }

        .submit-row {
          justify-content: space-between;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="masthead">
        <section class="hero">
          <button class="dark-mode-toggle" id="dark-mode-toggle">Toggle Dark Mode</button>
          <div class="workspace">Config: <span id="config-path">${configPath}</span></div>
          <h1>Intent Studio</h1>
          <p>Prompt-driven control surface for the intent runner. Start a run, watch the orchestration timeline, and inspect captures, diffs, summaries, and Linear activity as the workflow progresses. Work scope cards come from the active YAML config so the Studio stays aligned with the repos you actually want to work on.</p>
          <div class="hero-actions">
            <a class="hero-link" href="/library">Browse Asset Library</a>
            <a class="hero-link" href="/health">Health Check</a>
            <span class="hero-link" id="connection-state">Connecting stream…</span>
          </div>
          <div class="error-banner" id="config-error"></div>
        </section>
        <aside class="meta">
          <div class="panel-head">
            <h2>Session</h2>
            <span class="muted-link" id="run-id">No active run</span>
          </div>
          <div class="meta-grid">
            <div class="meta-card">
              <span class="meta-label">Runner status</span>
              <span class="meta-value" id="runner-status">Ready</span>
            </div>
            <div class="meta-card">
              <span class="meta-label">Linear</span>
              <span class="meta-value" id="linear-state">Checking config…</span>
            </div>
            <div class="meta-card">
              <span class="meta-label">Work scope</span>
              <span class="meta-value" id="selected-source">—</span>
            </div>
            <div class="meta-card">
              <span class="meta-label">Last update</span>
              <span class="meta-value" id="last-update">—</span>
            </div>
          </div>
          <div class="run-snapshot-mini" id="metrics"></div>
        </aside>
      </header>

      <main class="layout">
        <div class="main-stack">
          <nav class="tabs-nav">
            <button type="button" class="tab-link active" data-tab="tab-run">Run Workspace</button>
            <button type="button" class="tab-link" data-tab="tab-guide">Studio Guide</button>
          </nav>

          <div id="tab-run" class="tab-content active">
            <section class="panel">
              <div class="panel-head">
                <div>
                  <h2>Prompt Run</h2>
                  <div class="panel-copy">Define the business intent first. The system will turn it into BDD, TDD, execution sources, and run behavior before anything launches. Use work scope when you need to keep the run inside the current app or a specific set of configured repos.</div>
                </div>
                <span class="status-pill status-ready" id="current-status-pill">Ready</span>
              </div>

              <form id="run-form">
                <div class="prompt-grid">
                  <div class="field-wide">
                    <label for="prompt-input">Intent prompt</label>
                    <textarea id="prompt-input" placeholder="Describe the business intent, what sources or tools it should touch, and what outcome should be verified."></textarea>
                    <div class="field-note">Work scope is config-backed. Leave every checkbox clear when the planner should infer sources from your prompt, or keep the default scope checked when the run should stay inside the current app. Run behavior is inferred from prompt phrases such as &quot;create baseline&quot; or &quot;approve baseline&quot;, then falls back to <code>run.mode</code>.</div>
                    <div class="form-actions prompt-actions">
                      <label class="toggle">
                        <input id="dry-run-input" type="checkbox" />
                        Dry run only
                      </label>
                      <div class="submit-row">
                        <span class="notice" id="form-note">No run in progress.</span>
                        ${renderButton({ label: "Run intent", className: "primary-button", id: "submit-button", type: "submit" })}
                      </div>
                    </div>
                  </div>
                  <div class="field">
                    <div class="field-head">
                      <label>Work scope</label>
                      <div class="field-actions">
                        ${renderButton({ label: "Collapse", className: "ghost-link", id: "toggle-work-scope-visibility", type: "button" })}
                        ${renderButton({ label: "Edit Source Metadata", className: "ghost-link", id: "toggle-source-editor", type: "button" })}
                        <a class="ghost-link" id="config-editor-link" href="#">Open config in editor</a>
                        <a class="ghost-link" id="config-file-link" href="#">View YAML</a>
                      </div>
                    </div>
                    <div id="work-scope-panel">
                      <div class="field-note">These cards come from the <code>sources</code> block in the active YAML config. Every configured source stays visible here. Use the Source Metadata editor for labels and context, and use YAML for structural source changes.</div>
                      <div class="scope-list" id="source-scope"></div>
                      <div class="field-note" id="source-visibility-note">All configured sources are visible in work scope.</div>
                    </div>
                  </div>
                </div>

                <div class="agent-stages-section">
                  <div class="field-head">
                    <label>AI Orchestration Stages</label>
                    ${renderButton({ label: "Collapse", className: "ghost-link", id: "toggle-stages-visibility", type: "button" })}
                  </div>
                  <div id="steps-panel">
                    <div class="agent-stages-grid" id="agent-stages-grid">
                      ${agentStageFields}
                    </div>
                  </div>
                </div>
              </form>
            </section>

            <section class="panel" id="source-metadata-panel" style="display: none;">
              <div class="panel-head">
                <div>
                  <h2>Source Metadata</h2>
                  <div class="panel-copy">Edit the user-facing name and repo context for a configured source without leaving Studio. This writes back to the active YAML config; add or remove full sources in YAML when the source structure changes.</div>
                </div>
                <span class="notice" id="source-editor-status">Ready</span>
              </div>

              <form class="editor-form" id="source-editor-form">
                <div class="editor-grid">
                  <div class="field">
                    <label for="source-editor-select">Configured source</label>
                    <select id="source-editor-select"></select>
                    <div class="field-note">Pick the source whose Studio label and context you want to edit.</div>
                  </div>
                  <div class="field">
                    <label for="source-editor-display-name">Display name</label>
                    ${renderTextInput({ id: "source-editor-display-name", placeholder: "Current app" })}
                    <div class="field-note">Shown on work scope cards and plan summaries. Leave blank to fall back to the repo label or configured id.</div>
                  </div>
                  <div class="field">
                    <label for="source-editor-repo-label">Repo label</label>
                    ${renderTextInput({ id: "source-editor-repo-label", placeholder: "Intent POC" })}
                    <div class="field-note">Short repo or app label shown as secondary context.</div>
                  </div>
                  <div class="field">
                    <label for="source-editor-role">Role</label>
                    ${renderTextInput({ id: "source-editor-role", placeholder: "current app" })}
                    <div class="field-note">Describe why this source exists in the workflow.</div>
                  </div>
                  <div class="field-wide">
                    <label for="source-editor-summary">Summary</label>
                    <textarea id="source-editor-summary" placeholder="Explain what this source represents and when it should be used."></textarea>
                    <div class="field-note" id="source-editor-location">Source metadata writes back to the active config file.</div>
                  </div>
                </div>
                <div class="editor-actions">
                  ${renderButton({ label: "Save source metadata", className: "primary-button", id: "source-editor-save", type: "submit" })}
                  ${renderButton({ label: "Reload selected source", className: "ghost-button", id: "source-editor-reset", type: "button" })}
                </div>
              </form>
            </section>

            <section class="panel">
              <div class="panel-head">
                <div>
                  <h2>Activity Timeline</h2>
                  <div class="panel-copy">Live orchestration events from config load through artifacts and Linear updates.</div>
                </div>
                <span class="muted-link" id="event-count">0 events</span>
              </div>
              <div class="timeline" id="timeline"></div>
            </section>

            <section class="panel">
              <div class="panel-head">
                <div>
                  <h2>Artifacts & Captures</h2>
                  <div class="panel-copy">Direct links to generated summaries, manifests, logs, and the latest image outputs.</div>
                </div>
              </div>
              <div class="results-grid" id="artifacts"></div>
              <div class="capture-grid" id="captures"></div>
            </section>
          </div>

          <div id="tab-guide" class="tab-content">
            <section class="panel">
              <div class="panel-head">
                <div>
                  <h2>Studio Guide</h2>
                  <div class="panel-copy">How to use the Intent Studio to manage your development workflow.</div>
                </div>
              </div>
              <div class="prompt-grid">
                <div class="field-wide">
                  ${renderSelectionCard({
                    title: "How Work Scope Works",
                    badge: { label: "guide", toneClass: "target-ready" },
                    lines: [
                      { html: "<strong>Work scope</strong> constrains which configured repos or apps can participate in the run. It does not change how screenshots are handled after capture." },
                      { text: "Rename cards and update repo context directly in the Source Metadata editor. Use the YAML config when you need to add, remove, or structurally rewire sources." },
                      { text: "When multiple sources are checked, the planner creates one evidence lane per selected source inside the same business run." }
                    ]
                  })}
                </div>
                <div class="field-wide">
                  ${renderSelectionCard({
                    title: "Default work scope",
                    titleId: "selection-title",
                    badge: { label: "optional", toneClass: "target-ready", id: "selection-status" },
                    lines: [
                      { text: "The runner can choose sources from your prompt, then fall back to the config default if needed.", id: "selection-summary" },
                      { text: "Blank work scope falls back to prompt matching, business-wide expansion, then config default.", id: "selection-defaults" },
                      { text: "Use the Work Scope selector in the Run Workspace tab to understand what each source actually does before you constrain the run.", id: "selection-details" }
                    ]
                  })}
                </div>
              </div>
            </section>
          </div>
        </div>

        <aside class="side-stack">
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Intent Lifecycle</h2>
                <div class="panel-copy">Business run stages from prompt to delivery.</div>
              </div>
            </div>
            <div class="lifecycle-stack">
              <div class="lifecycle-step" id="step-normalization">
                <div class="lifecycle-step-title">1. Prompt Interpretation <span class="lifecycle-step-status" id="step-normalization-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content">
                  <div class="plan-intent-text" id="plan-intent-text"></div>
                  <div class="plan-intent-outcome" id="plan-intent-outcome"></div>
                  <div class="plan-note" id="plan-plan-notes"></div>
                </div>
              </div>
              <div class="lifecycle-step" id="step-linear">
                <div class="lifecycle-step-title">2. Linear Scoping <span class="lifecycle-step-status" id="step-linear-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content" id="plan-linear"></div>
              </div>
              <div class="lifecycle-step" id="step-bdd">
                <div class="lifecycle-step-title">3. BDD Planning <span class="lifecycle-step-status" id="step-bdd-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content">
                  <div id="plan-criteria"></div>
                  <div id="plan-scenarios"></div>
                </div>
              </div>
              <div class="lifecycle-step" id="step-tdd">
                <div class="lifecycle-step-title">4. TDD Planning <span class="lifecycle-step-status" id="step-tdd-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content" id="plan-work-items"></div>
              </div>
              <div class="lifecycle-step" id="step-plan">
                <div class="lifecycle-step-title">5. Planned Execution <span class="lifecycle-step-status" id="step-plan-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content">
                  <div class="plan-note" id="plan-execution-note"></div>
                  <div id="plan-sources"></div>
                  <div id="plan-tools"></div>
                  <div id="plan-destinations"></div>
                </div>
              </div>
              <div class="lifecycle-step" id="step-implementation">
                <div class="lifecycle-step-title">6. Implementation <span class="lifecycle-step-status" id="step-implementation-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content" id="plan-implementation"></div>
              </div>
              <div class="lifecycle-step" id="step-qa">
                <div class="lifecycle-step-title">7. QA Verification <span class="lifecycle-step-status" id="step-qa-status" data-state="pending">Pending</span></div>
                <div class="lifecycle-step-content" id="plan-qa"></div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Recent Runs</h2>
                <div class="panel-copy">Completed or failed sessions from this studio process.</div>
              </div>
            </div>
            <div class="recent-list" id="recent-runs"></div>
          </section>
        </aside>
      </main>
    </div>

    <script>
      (function () {
        const darkModeToggle = document.getElementById("dark-mode-toggle");
        darkModeToggle.addEventListener("click", function() {
          document.body.classList.toggle("dark-mode");
        });

        function wireCollapseToggle(toggleId, panelId, expandedDisplay) {
          const toggle = document.getElementById(toggleId);
          const panel = document.getElementById(panelId);
          if (!toggle || !panel) {
            return;
          }

          toggle.addEventListener("click", function() {
            const isHidden = panel.style.display === "none";
            panel.style.display = isHidden ? expandedDisplay : "none";
            toggle.textContent = isHidden ? "Collapse" : "Expand";
          });
        }

        wireCollapseToggle("toggle-work-scope-visibility", "work-scope-panel", "block");
        wireCollapseToggle("toggle-stages-visibility", "steps-panel", "block");

        const promptInput = document.getElementById("prompt-input");
        const sourceScope = document.getElementById("source-scope");
        const sourceVisibilityNote = document.getElementById("source-visibility-note");
        const configEditorLink = document.getElementById("config-editor-link");
        const configFileLink = document.getElementById("config-file-link");
        const dryRunInput = document.getElementById("dry-run-input");
        const submitButton = document.getElementById("submit-button");
        const formNote = document.getElementById("form-note");
        const configError = document.getElementById("config-error");
        const connectionState = document.getElementById("connection-state");
        const runnerStatus = document.getElementById("runner-status");
        const linearState = document.getElementById("linear-state");
        const selectedSource = document.getElementById("selected-source");
        const lastUpdate = document.getElementById("last-update");
        const currentStatusPill = document.getElementById("current-status-pill");
        const runIdNode = document.getElementById("run-id");
        const eventCount = document.getElementById("event-count");
        const metrics = document.getElementById("metrics");
        const timeline = document.getElementById("timeline");
        const artifacts = document.getElementById("artifacts");
        const captures = document.getElementById("captures");
        const recentRuns = document.getElementById("recent-runs");
        const sourceEditorForm = document.getElementById("source-editor-form");
        const sourceEditorSelect = document.getElementById("source-editor-select");
        const sourceEditorDisplayName = document.getElementById("source-editor-display-name");
        const sourceEditorRepoLabel = document.getElementById("source-editor-repo-label");
        const sourceEditorRole = document.getElementById("source-editor-role");
        const sourceEditorSummary = document.getElementById("source-editor-summary");
        const sourceEditorStatus = document.getElementById("source-editor-status");
        const sourceEditorLocation = document.getElementById("source-editor-location");
        const sourceEditorSave = document.getElementById("source-editor-save");
        const sourceEditorReset = document.getElementById("source-editor-reset");
        const selectionTitle = document.getElementById("selection-title");
        const selectionStatus = document.getElementById("selection-status");
        const selectionSummary = document.getElementById("selection-summary");
        const selectionDefaults = document.getElementById("selection-defaults");
        const selectionDetails = document.getElementById("selection-details");
        const planIntentText = document.getElementById("plan-intent-text");
        const planIntentOutcome = document.getElementById("plan-intent-outcome");
        const planPlanNotes = document.getElementById("plan-plan-notes");
        const planExecutionNote = document.getElementById("plan-execution-note");
        const planCriteria = document.getElementById("plan-criteria");
        const planScenarios = document.getElementById("plan-scenarios");
        const planWorkItems = document.getElementById("plan-work-items");
        const planSources = document.getElementById("plan-sources");
        const planDestinations = document.getElementById("plan-destinations");
        const planTools = document.getElementById("plan-tools");
        const planLinear = document.getElementById("plan-linear");
        const planImplementation = document.getElementById("plan-implementation");
        const planQa = document.getElementById("plan-qa");
        const form = document.getElementById("run-form");
        const stageIds = ${stageIdsJson};
        const stageControls = Object.fromEntries(stageIds.map(function (stageId) {
          return [
            stageId,
            {
              enabled: document.getElementById(stageId + "-enabled"),
              select: document.getElementById(stageId + "-model-select"),
              info: document.getElementById(stageId + "-info")
            }
          ];
        }));

        let promptTouched = false;
        let lastState = null;
        let previewPlan = null;
        let planRequestId = 0;
        let planRequestTimer = null;
        let editorSourceId = null;
        let editorDirty = false;
        let editorSaving = false;

        promptInput.addEventListener("input", function () {
          promptTouched = true;
          schedulePlanPreview();
        });

        function create(tag, className, text) {
          const node = document.createElement(tag);
          if (className) {
            node.className = className;
          }
          if (text !== undefined) {
            node.textContent = text;
          }
          return node;
        }

        function clear(node) {
          while (node.firstChild) {
            node.removeChild(node.firstChild);
          }
        }

        function formatTime(value) {
          if (!value) {
            return "—";
          }

          try {
            return new Date(value).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            });
          } catch {
            return String(value);
          }
        }

        function formatStatusClass(status) {
          if (status === "running") {
            return "status-running";
          }

          if (status === "failed") {
            return "status-failed";
          }

          if (status === "completed") {
            return "status-completed";
          }

          return "status-ready";
        }

        function fileUrl(relativePath) {
          return relativePath ? "/files/" + encodeURIComponent(relativePath) : "#";
        }

        function findSource(state, sourceId) {
          if (!state || !state.sources || !sourceId) {
            return null;
          }

          return state.sources.find(function (source) {
            return source.id === sourceId;
          }) || null;
        }

        function formatSourceLabel(state, sourceId) {
          const source = findSource(state, sourceId);
          return source ? source.label : sourceId;
        }

        function formatSourceReference(state, sourceId) {
          const source = findSource(state, sourceId);
          return source ? source.label + " (" + source.id + ")" : sourceId;
        }

        function sourceEditorFields() {
          return [
            sourceEditorDisplayName,
            sourceEditorRepoLabel,
            sourceEditorRole,
            sourceEditorSummary
          ];
        }

        function selectedSourceIds() {
          return Array.from(sourceScope.querySelectorAll("input[type='checkbox']:checked"))
            .map(function (input) { return input.value; })
            .filter(function (value) { return Boolean(value); });
        }

        function buildAgentOverrides() {
          const stages = {};

          stageIds.forEach(function (stageId) {
            const controls = stageControls[stageId];
            if (!controls) {
              return;
            }

            const model = controls.select.value || undefined;
            const defaultEnabled = controls.enabled.dataset.defaultEnabled === "true";
            const stageOverride = {};

            if (controls.enabled.checked !== defaultEnabled) {
              stageOverride.enabled = controls.enabled.checked;
            }

            if (model) {
              stageOverride.model = model;
            }

            if (Object.keys(stageOverride).length > 0) {
              stages[stageId] = stageOverride;
            }
          });

          return Object.keys(stages).length > 0 ? { stages: stages } : undefined;
        }

        function syncScopeCardSelection() {
          Array.from(sourceScope.querySelectorAll(".scope-card")).forEach(function (card) {
            const checkbox = card.querySelector("input[type='checkbox']");
            card.classList.toggle("scope-card-selected", Boolean(checkbox && checkbox.checked));
          });
        }

        function ensureScopeCards(options, selectedValues, defaultSourceId, applyDefaultSelection) {
          const selectedValueSet = new Set(selectedValues || []);

          if (applyDefaultSelection && selectedValueSet.size === 0 && defaultSourceId) {
            selectedValueSet.add(defaultSourceId);
          }

          clear(sourceScope);

          if (!options || options.length === 0) {
            sourceScope.appendChild(
              create(
                "div",
                "empty-card",
                "No work-scope sources are visible. Open the config and mark at least one source visible in Studio."
              )
            );
            return;
          }

          options.forEach(function (source) {
            const card = create("label", "scope-card");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "scope-checkbox";
            checkbox.value = source.id;
            checkbox.checked = selectedValueSet.has(source.id);

            const body = create("div", "scope-card-body");
            const head = create("div", "scope-card-head");
            const copy = create("div", "scope-card-copy");
            const titleRow = create("div", "scope-card-title-row");
            const title = create("div", "scope-card-title", source.label);
            const titleBadges = create("div", "field-actions");
            const statusBadge = create(
              "span",
              "target-badge " + (source.status === "attention" ? "target-attention" : "target-ready"),
              source.status
            );

            titleRow.appendChild(title);
            if (source.defaultScope) {
              titleBadges.appendChild(create("span", "target-badge target-ready", "default"));
            }

            titleBadges.appendChild(statusBadge);
            titleRow.appendChild(titleBadges);

            const subtitleBits = [source.repoLabel || source.repoId || source.id, source.sourceLocation];
            if (source.role) {
              subtitleBits.push(source.role);
            }

            copy.appendChild(titleRow);
            copy.appendChild(create("div", "scope-card-subtitle", subtitleBits.join(" • ")));
            head.appendChild(copy);
            body.appendChild(head);
            body.appendChild(create("div", "scope-card-summary", source.summary));
            body.appendChild(
              create(
                "div",
                "scope-card-meta",
                "Configured id: " + source.id + " • " + source.captureCount + " capture" + (source.captureCount === 1 ? "" : "s")
              )
            );

            if (source.notes && source.notes.length > 0) {
              body.appendChild(create("div", "scope-card-meta", source.notes[0]));
            }

            if (source.issues && source.issues.length > 0) {
              body.appendChild(create("div", "scope-card-meta", source.issues[0]));
            }

            card.appendChild(checkbox);
            card.appendChild(body);
            sourceScope.appendChild(card);
          });

          syncScopeCardSelection();
        }

        function selectedSourceRecords(state) {
          if (!state || !state.sources) {
            return [];
          }

          const selectedIds = new Set(selectedSourceIds());
          if (selectedIds.size === 0) {
            return [];
          }

          return state.sources.filter(function (source) {
            return selectedIds.has(source.id);
          });
        }

        function resolveEditorSourceId(state, preferredSourceId) {
          if (!state || !state.sources || state.sources.length === 0) {
            return null;
          }

          if (preferredSourceId && findSource(state, preferredSourceId)) {
            return preferredSourceId;
          }

          if (editorSourceId && findSource(state, editorSourceId)) {
            return editorSourceId;
          }

          if (state.defaultSourceId && findSource(state, state.defaultSourceId)) {
            return state.defaultSourceId;
          }

          return state.sources[0].id;
        }

        function populateSourceEditor(state, sourceId) {
          const source = findSource(state, sourceId);

          if (!source) {
            editorSourceId = null;
            sourceEditorSelect.value = "";
            sourceEditorFields().forEach(function (field) {
              field.value = "";
              field.disabled = true;
            });
            sourceEditorSave.disabled = true;
            sourceEditorReset.disabled = true;
            sourceEditorStatus.textContent = "No sources loaded";
            sourceEditorLocation.textContent = "Load a config with at least one source to edit metadata here.";
            return;
          }

          editorSourceId = source.id;
          sourceEditorSelect.value = source.id;
          sourceEditorDisplayName.value = source.label === source.id ? "" : source.label;
          sourceEditorRepoLabel.value = source.repoLabel || "";
          sourceEditorRole.value = source.role || "";
          sourceEditorSummary.value = source.summary || "";
          sourceEditorFields().forEach(function (field) {
            field.disabled = false;
          });
          sourceEditorSave.disabled = editorSaving;
          sourceEditorReset.disabled = editorSaving;
          sourceEditorStatus.textContent = editorSaving
            ? "Saving…"
            : editorDirty
              ? "Unsaved changes"
              : "Editing " + source.label;
          sourceEditorLocation.textContent =
            "Writes to sources." +
            source.id +
            ".studio.displayName and sources." +
            source.id +
            ".planning.{repoLabel, role, summary} in " +
            state.configPath +
            ".";
        }

        function renderSourceEditor(state, options) {
          const renderOptions = options || {};
          const preferredSourceId = renderOptions.preferredSourceId;
          const forceReload = renderOptions.forceReload === true;
          const sourceList = state && state.sources ? state.sources : [];
          const nextSourceId = resolveEditorSourceId(state, preferredSourceId);

          clear(sourceEditorSelect);
          if (sourceList.length === 0) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No configured sources";
            sourceEditorSelect.appendChild(option);
            populateSourceEditor(state, null);
            return;
          }

          sourceList.forEach(function (source) {
            const option = document.createElement("option");
            option.value = source.id;
            option.textContent = source.label + " (" + source.id + ")";
            sourceEditorSelect.appendChild(option);
          });

          const shouldReload = forceReload || !editorDirty || editorSourceId !== nextSourceId;
          if (shouldReload) {
            editorDirty = false;
            populateSourceEditor(state, nextSourceId);
            return;
          }

          sourceEditorSelect.value = editorSourceId;
          sourceEditorStatus.textContent = editorSaving ? "Saving…" : "Unsaved changes";
        }

        function updateConfigLinks(state) {
          if (state.configEditorUrl) {
            configEditorLink.href = state.configEditorUrl;
            configEditorLink.style.display = "inline-flex";
          } else {
            configEditorLink.removeAttribute("href");
            configEditorLink.style.display = "none";
          }

          if (state.configFileUrl) {
            configFileLink.href = state.configFileUrl;
            configFileLink.style.display = "inline-flex";
          } else {
            configFileLink.removeAttribute("href");
            configFileLink.style.display = "none";
          }

          sourceVisibilityNote.textContent =
            "Every configured source in " +
            state.configPath +
            " stays visible here. Use the Source Metadata panel for names and context, and use YAML to add or remove full sources.";
        }

        function updateSelectionGuidance(state) {
          const selectedSources = selectedSourceRecords(state);
          const defaultSourceText = state.defaultSourceId ? formatSourceReference(state, state.defaultSourceId) : "none";

          if (selectedSources.length === 0) {
            selectionTitle.textContent = "No work scope selected";
            selectionStatus.textContent = "optional";
            selectionStatus.className = "target-badge target-ready";
            selectionSummary.textContent = "The runner can infer sources from your prompt by matching configured source ids or aliases, then fall back to the config default source if needed.";
            selectionDefaults.textContent = "Blank work scope falls back to prompt matching and business-wide expansion, then config default: " + defaultSourceText + ".";
            selectionDetails.textContent = "Leave every card clear when the prompt should decide. Check cards only when you want to constrain the run.";
            return;
          }

          const hasAttention = selectedSources.some(function (source) { return source.status === "attention"; });
          const selectedIds = selectedSources.map(function (source) { return formatSourceReference(state, source.id); });
          const source = selectedSources[0];
          const issues = selectedSources.flatMap(function (entry) { return entry.issues || []; });
          const notes = selectedSources.flatMap(function (entry) { return entry.notes || []; });

          selectionTitle.textContent = selectedSources.length === 1
            ? source.label
            : selectedSources.length + " sources selected";
          selectionStatus.textContent = hasAttention ? "attention" : "scoped";
          selectionStatus.className = "target-badge " + (hasAttention ? "target-attention" : "target-ready");
          selectionSummary.textContent = selectedSources.length === 1
            ? source.summary
            : "The planner will stay inside the selected source scope and create one evidence lane per selected source.";
          selectionDefaults.textContent = "In scope: " + selectedIds.join(", ") + ". Clear the list to fall back to prompt matching and config default: " + defaultSourceText + ".";
          selectionDetails.textContent = issues.length > 0
            ? issues.join(" ")
            : notes.length > 0 && selectedSources.length === 1
              ? notes.join(" ")
              : selectedSources.map(function (entry) {
                  const context = [entry.repoLabel || entry.repoId || entry.id, entry.sourceLocation];
                  if (entry.role) {
                    context.push(entry.role);
                  }
                  return context.join(" • ");
                }).join(" | ");
        }

        function updateAgentStageNotes(state) {
          if (!state || !state.agentStages) {
            return;
          }

          state.agentStages.forEach(function (stage) {
            const controls = stageControls[stage.id];
            if (!controls) {
              return;
            }

            controls.enabled.dataset.defaultEnabled = stage.enabled ? "true" : "false";
            if (!controls.enabled.dataset.dirty) {
              controls.enabled.checked = stage.enabled;
            }

            const status = stage.enabled ? "Enabled by config." : "Disabled by config.";
            const configInfo = stage.provider ? " Config default: " + stage.provider + " / " + stage.model + ". " + status : " No provider configured. Deterministic until Gemini enabled.";
            controls.info.setAttribute("data-tooltip", stage.description + configInfo);
          });
        }

        function renderMetrics(run) {
          clear(metrics);

          if (!run) {
            return;
          }

          const primarySource = run.sourceId ? formatSourceReference(lastState, run.sourceId) : "—";
          const aiStages = run.intentPlan ? run.intentPlan.normalizationMeta.stages.map(function (s) {
            return s.label + ": " + s.status;
          }).join(", ") : "Planning…";

          const items = [
            ["Primary", primarySource],
            ["AI Stages", aiStages],
            ["Result", run.error || (run.hasDrift ? "Drift" : run.status === "completed" ? "Success" : run.status)]
          ];

          items.forEach(function (item) {
            const card = create("div", "mini-metric");
            card.appendChild(create("span", "mini-label", item[0]));
            card.appendChild(create("span", "mini-value", item[1]));
            metrics.appendChild(card);
          });
        }

        function renderPlanList(container, items, buildItem, emptyText) {
          clear(container);

          if (!items || items.length === 0) {
            container.appendChild(create("div", "empty-card", emptyText));
            return;
          }

          items.forEach(function (item) {
            container.appendChild(buildItem(item));
          });
        }

        function renderPlanItem(title, metaLines, copyLines, tags) {
          const item = create("div", "plan-item");
          item.appendChild(create("div", "plan-item-title", title));

          if (tags && tags.length > 0) {
            const tagRow = create("div", "plan-item-tag-row");
            tags.forEach(function (tag) {
              tagRow.appendChild(create("span", "plan-tag", tag));
            });
            item.appendChild(tagRow);
          }

          (metaLines || []).forEach(function (line) {
            item.appendChild(create("div", "plan-meta", line));
          });

          (copyLines || []).forEach(function (line) {
            item.appendChild(create("div", "plan-step", line));
          });

          return item;
        }

        function appendLatestChunkMeta(meta, sourceRun) {
          if (!sourceRun) {
            return;
          }

          if (sourceRun.latestCompletedInAttemptWorkItemIds && sourceRun.latestCompletedInAttemptWorkItemIds.length > 0) {
            meta.push("Completed in latest attempt: " + sourceRun.latestCompletedInAttemptWorkItemIds.join(", "));
          }

          if (sourceRun.latestPendingTargetedWorkItemIds && sourceRun.latestPendingTargetedWorkItemIds.length > 0) {
            meta.push("Pending batch: " + sourceRun.latestPendingTargetedWorkItemIds.join(", "));
          }

          if (sourceRun.attemptSummaries && sourceRun.attemptSummaries.length > 0) {
            const latestAttempt = sourceRun.attemptSummaries[sourceRun.attemptSummaries.length - 1];
            meta.push(
              "Latest attempt #" + latestAttempt.attemptNumber + ": " + latestAttempt.status + (latestAttempt.failureStage ? " (" + latestAttempt.failureStage + ")" : "")
            );
          }
        }

        function renderPlan(state) {
          const run = state && state.currentRun;
          const activePlan = run && run.intentPlan ? run.intentPlan : previewPlan;

          updateLifecycleProgress(activePlan, run);

          if (!activePlan) {
            planIntentText.textContent = "Type an intent to preview the plan.";
            planIntentOutcome.textContent = "";
            planPlanNotes.textContent = "";
            planExecutionNote.textContent = "";
            renderPlanList(planLinear, [], null, "Pending prompt…");
            renderPlanList(planCriteria, [], null, "Pending prompt…");
            renderPlanList(planScenarios, [], null, "Pending prompt…");
            renderPlanList(planWorkItems, [], null, "Pending prompt…");
            renderPlanList(planSources, [], null, "Pending prompt…");
            renderPlanList(planDestinations, [], null, "Pending prompt…");
            renderPlanList(planTools, [], null, "Pending prompt…");
            renderPlanList(planImplementation, [], null, "Pending prompt…");
            renderPlanList(planQa, [], null, "Pending prompt…");
            return;
          }

          // 1. Prompt Interpretation
          planIntentText.textContent = activePlan.summary || activePlan.businessIntent.statement;
          planIntentOutcome.textContent = "Workflow: change behavior • Source: " + formatSourceLabel(state, activePlan.sourceId);
          planPlanNotes.textContent = activePlan.planning.reviewNotes.length > 0 ? "Notes: " + activePlan.planning.reviewNotes.join(" ") : "";

          // 2. Linear Scoping
          const linearItems = [];
          if (activePlan.linear.createIssue) {
            linearItems.push({ title: "Target: Create new issue", meta: [activePlan.linear.issueTitle] });
          } else if (activePlan.planning.linearPlan.issueReference) {
            linearItems.push({ title: "Target: Resume issue", meta: [activePlan.planning.linearPlan.issueReference] });
          }
          renderPlanList(planLinear, linearItems, function(item) { return renderPlanItem(item.title, item.meta, [], []); }, "No Linear link planned.");

          // 3. BDD Planning
          renderPlanList(
            planCriteria,
            activePlan.businessIntent.acceptanceCriteria,
            function (criterion) {
              return renderPlanItem(criterion.description, [], [], []);
            },
            "No criteria defined."
          );

          renderPlanList(
            planScenarios,
            activePlan.businessIntent.scenarios,
            function (scenario) {
              return renderPlanItem(scenario.title, ["Sources: " + scenario.applicableSourceIds.join(", ")], [], []);
            },
            "No scenarios defined."
          );

          // 4. TDD Planning
          renderPlanList(
            planWorkItems,
            activePlan.businessIntent.workItems,
            function (workItem) {
              const meta = [
                "Verification: " + workItem.verification,
                "Order: " + workItem.execution.order,
                "Depends on: " + (workItem.execution.dependsOnWorkItemIds.length > 0 ? workItem.execution.dependsOnWorkItemIds.join(", ") : "none")
              ];
              return renderPlanItem(workItem.title, meta, [], []);
            },
            "No work items defined."
          );

          // 5. Planned Execution
          planExecutionNote.textContent = run
            ? "Execution snapshot for the current run. This is the planned source, tool, and destination graph; live work appears in Steps 6 and 7."
            : "Preview only. The source, tool, and destination graph below shows what will run after you start a session.";

          renderPlanList(
            planSources,
            activePlan.executionPlan.sources,
            function (source) {
              const meta = [
                source.captureScope && source.captureScope.mode === "subset"
                  ? "Captures: " + source.captureScope.captureIds.join(", ")
                  : "Captures: all configured"
              ].concat(source.warnings || []);
              return renderPlanItem(formatSourceLabel(state, source.sourceId), meta, [], source.sourceId === activePlan.executionPlan.primarySourceId ? ["primary"] : []);
            },
            "No sources planned."
          );

          renderPlanList(
            planTools,
            activePlan.executionPlan.tools.filter(function(t) { return t.enabled; }),
            function (tool) {
              return renderPlanItem(tool.label, [tool.type], [], []);
            },
            "No tools enabled."
          );

          renderPlanList(
            planDestinations,
            activePlan.executionPlan.destinations.filter(function(d) { return d.status !== "inactive"; }),
            function (destination) {
              return renderPlanItem(destination.label, [destination.status], [], []);
            },
            "No active destinations."
          );

          // 6. Implementation
          const implItems = [];
          if (run && run.sourceRuns) {
            run.sourceRuns.forEach(function(sr) {
              const meta = [sr.implementationStageStatus || sr.status, sr.latestImplementationSummary || (sr.implementationStageStatus === "running" ? "Implementation in progress…" : "Waiting…")];
              if (typeof sr.completedWorkItemCount === "number" || typeof sr.remainingWorkItemCount === "number") {
                meta.push((sr.completedWorkItemCount || 0) + " completed / " + (sr.remainingWorkItemCount || 0) + " remaining");
              }
              if (sr.targetedWorkItemIds && sr.targetedWorkItemIds.length > 0) {
                meta.push("Active batch: " + sr.targetedWorkItemIds.join(", "));
              }
              appendLatestChunkMeta(meta, sr);
              if (sr.captureScopeSummary) {
                meta.push(sr.captureScopeSummary);
              }
              if (sr.sourceWarnings && sr.sourceWarnings.length > 0) {
                meta.push(sr.sourceWarnings[0]);
              }
              implItems.push({ title: formatSourceLabel(state, sr.sourceId), meta: meta });
            });
          }
          renderPlanList(planImplementation, implItems, function(item) { return renderPlanItem(item.title, item.meta, [], []); }, "Implementation activity will show here after a run starts.");

          // 7. QA Verification
          const qaItems = [];
          if (run) {
            if (run.sourceRuns) {
              run.sourceRuns.forEach(function(sr) {
                const meta = [sr.qaVerificationStageStatus || sr.status];
                if (typeof sr.completedWorkItemCount === "number" || typeof sr.remainingWorkItemCount === "number") {
                  meta.push((sr.completedWorkItemCount || 0) + " completed / " + (sr.remainingWorkItemCount || 0) + " remaining");
                }
                if (typeof sr.executedCaptureCount === "number") {
                  meta.push(sr.executedCaptureCount + " captures executed");
                }
                appendLatestChunkMeta(meta, sr);
                if (sr.comparisonIssueSummary) {
                  meta.push(sr.comparisonIssueSummary);
                }
                qaItems.push({ title: formatSourceLabel(state, sr.sourceId), meta: meta });
              });
            }
            if (run.captures && run.captures.length > 0) {
              qaItems.push({ title: "Captures", meta: [run.captures.length + " screenshots"] });
            }
            if (run.hasDrift) {
              qaItems.push({ title: "Status", meta: ["Drift detected"] });
            } else if (run.status === "completed") {
              qaItems.push({ title: "Status", meta: ["Verified"] });
            }
          }
          renderPlanList(planQa, qaItems, function(item) { return renderPlanItem(item.title, item.meta, [], []); }, "QA results will show here after a run reaches verification.");
        }

        function hasImplementationActivity(run) {
          if (!run || !run.sourceRuns) {
            return false;
          }

          return run.sourceRuns.some(function (sourceRun) {
            return sourceRun.implementationStageStatus === "running"
              || sourceRun.implementationStageStatus === "completed"
              || sourceRun.implementationStageStatus === "failed"
              || Boolean(sourceRun.latestImplementationSummary)
              || Boolean(sourceRun.latestImplementationFileOperations && sourceRun.latestImplementationFileOperations.length > 0);
          });
        }

        function hasQaActivity(run) {
          if (!run) {
            return false;
          }

          if (run.captures && run.captures.length > 0) {
            return true;
          }

          if (!run.sourceRuns) {
            return false;
          }

          return run.sourceRuns.some(function (sourceRun) {
            return sourceRun.qaVerificationStageStatus === "running"
              || sourceRun.qaVerificationStageStatus === "completed"
              || sourceRun.qaVerificationStageStatus === "failed"
              || Boolean(sourceRun.latestFailureStage === "qaVerification")
              || Boolean(typeof sourceRun.remainingWorkItemCount === "number")
              || Boolean(sourceRun.comparisonIssueSummary);
          });
        }

        function isRunFullyImplemented(run) {
          if (!run || !run.sourceRuns || run.sourceRuns.length === 0) {
            return false;
          }

          return run.sourceRuns.every(function (sourceRun) {
            return sourceRun.implementationStageStatus === "completed"
              && (sourceRun.remainingWorkItemCount || 0) === 0;
          });
        }

        function isRunFullyVerified(run) {
          if (!run || !run.sourceRuns || run.sourceRuns.length === 0) {
            return false;
          }

          return run.sourceRuns.every(function (sourceRun) {
            return sourceRun.qaVerificationStageStatus === "completed"
              && (sourceRun.remainingWorkItemCount || 0) === 0;
          });
        }

        function setLifecycleStepBadge(stepId, state, label) {
          const badge = document.getElementById(stepId + "-status");
          if (!badge) {
            return;
          }

          badge.setAttribute("data-state", state);
          badge.textContent = label;
        }

        function updateLifecycleProgress(activePlan, run) {
          const previewPlanReady = !run && activePlan && activePlan.executionPlan.sources.length > 0;
          const steps = [
            { id: "step-normalization", data: activePlan && activePlan.summary },
            { id: "step-linear", data: activePlan && (activePlan.linear.createIssue || activePlan.planning.linearPlan.issueReference) },
            { id: "step-bdd", data: activePlan && (activePlan.businessIntent.acceptanceCriteria.length > 0 || activePlan.businessIntent.scenarios.length > 0) },
            { id: "step-tdd", data: activePlan && activePlan.businessIntent.workItems.length > 0 },
            { id: "step-plan", data: run && activePlan && activePlan.executionPlan.sources.length > 0 },
            { id: "step-implementation", data: run ? isRunFullyImplemented(run) : hasImplementationActivity(run) },
            { id: "step-qa", data: run ? isRunFullyVerified(run) : hasQaActivity(run) }
          ];

          let foundActive = false;
          steps.forEach(function (step) {
            const node = document.getElementById(step.id);
            if (!node) return;

            const isCompleted = Boolean(step.data);
            node.classList.toggle("completed", isCompleted);
            
            let isActive = !isCompleted && !foundActive;
            if (step.id === "step-plan" && previewPlanReady) {
              isActive = true;
            }
            if (step.id === "step-implementation" && run && run.status === "running") {
               isActive = true;
               foundActive = true;
            }

            node.classList.toggle("active", isActive);
            if (isCompleted) {
              setLifecycleStepBadge(step.id, "completed", "Completed");
            } else if (isActive) {
              setLifecycleStepBadge(step.id, step.id === "step-plan" && previewPlanReady ? "preview" : "running", step.id === "step-plan" && previewPlanReady ? "Preview" : "Running");
            } else {
              setLifecycleStepBadge(step.id, "pending", "Pending");
            }
            if (isActive) foundActive = true;
          });
        }

        function renderTimeline(run) {
          clear(timeline);
          const events = run ? run.events.slice().reverse() : [];
          eventCount.textContent = events.length + " events";

          if (events.length === 0) {
            timeline.appendChild(create("div", "empty-card", "The event stream is idle. Start a run to see orchestration activity."));
            return;
          }

          events.forEach(function (event) {
            const item = create("article", "timeline-item");
            const head = create("div", "timeline-head");
            const meta = create("span", "timeline-meta", event.phase + " • " + formatTime(event.timestamp));
            const badge = create("span", "event-badge event-" + event.level, event.level);
            head.appendChild(meta);
            head.appendChild(badge);
            item.appendChild(head);
            item.appendChild(create("div", "timeline-message", event.message));

            if (event.details) {
              const details = create("pre", "timeline-details");
              details.textContent = JSON.stringify(event.details, null, 2);
              item.appendChild(details);
            }

            timeline.appendChild(item);
          });
        }

        function renderArtifacts(run) {
          clear(artifacts);

          if (!run) {
            artifacts.appendChild(create("div", "empty-card", "Artifacts will appear here after a run produces outputs."));
            return;
          }

          const cards = [
            ["Normalized intent", run.artifacts && run.artifacts.normalizedIntentPath, "Intent plan written before execution."],
            ["Summary", run.artifacts && run.artifacts.summaryPath, "Markdown summary with outcome counts and artifact paths."],
            ["Manifest", run.artifacts && run.artifacts.manifestPath, "Capture manifest with output metadata."],
            ["Comparison", run.artifacts && run.artifacts.comparisonPath, "Comparison JSON for drift status and counts."],
            ["App log", run.artifacts && run.artifacts.appLogPath, "Background app startup logs for debugging source readiness."],
            ["Linear issue", run.linearIssue && run.linearIssue.url, run.linearIssue && run.linearIssue.identifier ? run.linearIssue.identifier : "No issue created for this run."]
          ];

          cards.forEach(function (cardInfo) {
            const card = create("div", "artifact-card");
            card.appendChild(create("span", "artifact-label", cardInfo[0]));
            card.appendChild(create("span", "artifact-value", cardInfo[2]));
            const links = create("div", "artifact-links");

            if (cardInfo[1]) {
              const link = create("a", "ghost-link", cardInfo[0] === "Linear issue" ? "Open Linear" : "Open file");
              link.href = cardInfo[0] === "Linear issue" ? cardInfo[1] : fileUrl(cardInfo[1]);
              if (cardInfo[0] === "Linear issue") {
                link.target = "_blank";
                link.rel = "noreferrer";
              }
              links.appendChild(link);
            } else {
              links.appendChild(create("span", "notice", "Not available yet."));
            }

            card.appendChild(links);
            artifacts.appendChild(card);
          });
        }

        function renderCaptures(run) {
          clear(captures);

          if (!run || !run.captures || run.captures.length === 0) {
            captures.appendChild(create("div", "empty-card", "Capture previews appear after screenshots are produced."));
            return;
          }

          run.captures.forEach(function (capture) {
            const card = create("article", "capture-card");

            if (capture.imagePath) {
              const image = document.createElement("img");
              image.loading = "lazy";
              image.alt = capture.captureId;
              image.src = fileUrl(capture.imagePath);
              card.appendChild(image);
            }

            const body = create("div", "capture-body");
            body.appendChild(create("div", "capture-title", capture.captureId));
            body.appendChild(create("div", "capture-meta", (capture.sourceId ? capture.sourceId + " • " : "") + (capture.url || "No URL captured.")));
            body.appendChild(create("span", "capture-badge capture-" + (capture.status === "captured" ? "captured" : "failed"), capture.status));

            if (capture.error) {
              body.appendChild(create("div", "notice", capture.error));
            }

            const links = create("div", "capture-links");

            if (capture.imagePath) {
              const imageLink = create("a", "ghost-link", "Screenshot");
              imageLink.href = fileUrl(capture.imagePath);
              links.appendChild(imageLink);
            }

            if (capture.diffImagePath) {
              const diffLink = create("a", "ghost-link", "Diff image");
              diffLink.href = fileUrl(capture.diffImagePath);
              links.appendChild(diffLink);
            }

            body.appendChild(links);
            card.appendChild(body);
            captures.appendChild(card);
          });
        }

        function renderRecent(state) {
          clear(recentRuns);

          if (!state.recentRuns || state.recentRuns.length === 0) {
            recentRuns.appendChild(create("div", "empty-card", "Completed runs will be kept here while this studio process stays open."));
            return;
          }

          state.recentRuns.forEach(function (run) {
            const card = create("div", "recent-card");
            const scopeText = run.requestedSourceIds && run.requestedSourceIds.length > 0
              ? run.requestedSourceIds.map(function (sourceId) {
                  return formatSourceReference(state, sourceId);
                }).join(", ")
              : "prompt/config decides";
            card.appendChild(create("div", "recent-title", run.prompt));
            card.appendChild(create("div", "recent-meta", "Scope: " + scopeText + " • Primary source: " + (run.sourceId ? formatSourceReference(state, run.sourceId) : "—") + " • " + run.status));
            card.appendChild(create("div", "recent-meta", "Finished: " + formatTime(run.finishedAt)));

            if (run.sourceRuns && run.sourceRuns.length > 0) {
              run.sourceRuns.forEach(function (sourceRun) {
                const latestAttempt = sourceRun.attemptSummaries && sourceRun.attemptSummaries.length > 0
                  ? sourceRun.attemptSummaries[sourceRun.attemptSummaries.length - 1]
                  : null;
                const parts = [
                  formatSourceReference(state, sourceRun.sourceId),
                  (sourceRun.attemptCount || 0) + " attempts"
                ];

                if (latestAttempt) {
                  parts.push("batch: " + (latestAttempt.targetedWorkItemIds.length > 0 ? latestAttempt.targetedWorkItemIds.join(", ") : "none"));
                  if (latestAttempt.pendingTargetedWorkItemIds.length > 0) {
                    parts.push("pending: " + latestAttempt.pendingTargetedWorkItemIds.join(", "));
                  }
                }

                card.appendChild(create("div", "recent-meta", parts.join(" • ")));
              });
            }

            if (run.artifacts && run.artifacts.summaryPath) {
              const link = create("a", "ghost-link", "Open summary");
              link.href = fileUrl(run.artifacts.summaryPath);
              card.appendChild(link);
            }

            recentRuns.appendChild(card);
          });
        }

        function updateTopLine(state) {
          const run = state.currentRun;
          const running = run && run.status === "running";
          const selectedSources = selectedSourceRecords(state);
          const scopedSourceIds = run && run.requestedSourceIds && run.requestedSourceIds.length > 0
            ? run.requestedSourceIds
            : selectedSources.map(function (source) { return source.id; });
          const hasVisibleSources = Boolean(state.sources && state.sources.length);

          runnerStatus.textContent = run ? run.status : "ready";
          linearState.textContent = state.linearEnabled ? "enabled" : "disabled";
          selectedSource.textContent = scopedSourceIds.length > 0
            ? scopedSourceIds.map(function (sourceId) {
                return formatSourceLabel(state, sourceId);
              }).join(", ")
            : run && run.sourceId
              ? "prompt/config -> " + formatSourceLabel(state, run.sourceId)
              : "prompt/config decides";
          lastUpdate.textContent = formatTime(state.serverTime);
          currentStatusPill.textContent = run ? run.status : "ready";
          currentStatusPill.className = "status-pill " + formatStatusClass(run ? run.status : "ready");
          runIdNode.textContent = run && run.runId ? run.runId : run ? "Run queued" : "No active run";
          submitButton.disabled = Boolean(running || state.configError || !hasVisibleSources);
          formNote.textContent = state.configError
            ? "Fix the config before starting a run."
            : !hasVisibleSources
              ? "Open the config and expose at least one work-scope source."
            : running
              ? "Run in progress. The timeline will continue updating live."
              : "Ready for the next prompt.";
        }

        function renderState(state) {
          const hadPreviousState = lastState !== null;
          lastState = state;
          document.getElementById("config-path").textContent = state.configPath;

          if (state.configError) {
            configError.style.display = "block";
            configError.textContent = state.configError;
          } else {
            configError.style.display = "none";
            configError.textContent = "";
          }

          const currentSelectedIds = hadPreviousState ? selectedSourceIds() : [];
          ensureScopeCards(state.sources || [], currentSelectedIds, state.defaultSourceId, !hadPreviousState);
          updateConfigLinks(state);
          renderSourceEditor(state, { forceReload: !hadPreviousState });
          updateAgentStageNotes(state);

          updateTopLine(state);
          updateSelectionGuidance(state);
          renderPlan(state);
          renderMetrics(state.currentRun);
          renderTimeline(state.currentRun);
          renderArtifacts(state.currentRun);
          renderCaptures(state.currentRun);
          renderRecent(state);
        }

        // Tab Switching Logic
        const tabLinks = document.querySelectorAll(".tab-link");
        const tabContents = document.querySelectorAll(".tab-content");
        const toggleSourceEditor = document.getElementById("toggle-source-editor");
        const sourceMetadataPanel = document.getElementById("source-metadata-panel");

        toggleSourceEditor.addEventListener("click", function () {
          const isHidden = sourceMetadataPanel.style.display === "none";
          sourceMetadataPanel.style.display = isHidden ? "block" : "none";
          toggleSourceEditor.textContent = isHidden ? "Close Source Editor" : "Edit Source Metadata";
        });

        tabLinks.forEach(function (link) {
          link.addEventListener("click", function () {
            const targetTab = link.dataset.tab;

            tabLinks.forEach(function (l) {
              l.classList.remove("active");
            });
            tabContents.forEach(function (c) {
              c.classList.remove("active");
            });

            link.classList.add("active");
            document.getElementById(targetTab).classList.add("active");
          });
        });

        async function fetchState() {
          const response = await fetch("/api/state");
          if (!response.ok) {
            throw new Error("Failed to load studio state.");
          }

          return response.json();
        }

        async function fetchPlanPreview() {
          const prompt = promptInput.value.trim();
          if (!prompt) {
            previewPlan = null;
            if (lastState) {
              renderPlan(lastState);
            }
            return;
          }

          const requestId = ++planRequestId;
          const response = await fetch("/api/plan", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              prompt,
              sourceIds: selectedSourceIds().length > 0 ? selectedSourceIds() : undefined,
              agentOverrides: buildAgentOverrides()
            })
          });

          const body = await response.json();
          if (requestId !== planRequestId) {
            return;
          }

          if (!response.ok) {
            previewPlan = null;
            formNote.textContent = body.error || "Failed to preview the execution plan.";
            if (lastState) {
              renderPlan(lastState);
            }
            return;
          }

          previewPlan = body.plan || null;
          if (lastState) {
            renderPlan(lastState);
          }
        }

        function schedulePlanPreview() {
          if (planRequestTimer !== null) {
            clearTimeout(planRequestTimer);
          }

          planRequestTimer = window.setTimeout(function () {
            void fetchPlanPreview();
          }, 180);
        }

        async function submitRun(event) {
          event.preventDefault();

          const scopedSourceIds = selectedSourceIds();

          const payload = {
            prompt: promptInput.value,
            sourceIds: scopedSourceIds.length > 0 ? scopedSourceIds : undefined,
            agentOverrides: buildAgentOverrides(),
            dryRun: dryRunInput.checked
          };

          formNote.textContent = "Submitting run…";

          const response = await fetch("/api/runs", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });

          const body = await response.json();
          if (!response.ok) {
            formNote.textContent = body.error || "Run request failed.";
            return;
          }

          dryRunInput.checked = false;
          formNote.textContent = "Run accepted. Waiting for timeline events…";
        }

        async function submitSourceMetadata(event) {
          event.preventDefault();

          if (!editorSourceId) {
            sourceEditorStatus.textContent = "Select a source first.";
            return;
          }

          editorSaving = true;
          renderSourceEditor(lastState, { forceReload: false });

          try {
            const response = await fetch("/api/source-metadata", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                sourceId: editorSourceId,
                displayName: sourceEditorDisplayName.value,
                repoLabel: sourceEditorRepoLabel.value,
                role: sourceEditorRole.value,
                summary: sourceEditorSummary.value
              })
            });

            const body = await response.json();
            if (!response.ok) {
              throw new Error(body.error || "Failed to save source metadata.");
            }

            editorDirty = false;
            const state = await fetchState();
            renderState(state);
            sourceEditorStatus.textContent = "Saved";
            schedulePlanPreview();
          } catch (error) {
            sourceEditorStatus.textContent = error instanceof Error ? error.message : String(error);
          } finally {
            editorSaving = false;
            if (lastState) {
              renderSourceEditor(lastState, { forceReload: false });
            }
          }
        }

        form.addEventListener("submit", function (event) {
          submitRun(event).catch(function (error) {
            formNote.textContent = error instanceof Error ? error.message : String(error);
          });
        });

        sourceEditorForm.addEventListener("submit", function (event) {
          submitSourceMetadata(event).catch(function (error) {
            sourceEditorStatus.textContent = error instanceof Error ? error.message : String(error);
          });
        });

        sourceEditorSelect.addEventListener("change", function () {
          editorDirty = false;
          editorSourceId = sourceEditorSelect.value || null;
          if (lastState) {
            renderSourceEditor(lastState, { forceReload: true });
          }
        });

        sourceEditorFields().forEach(function (field) {
          field.addEventListener("input", function () {
            editorDirty = true;
            if (lastState) {
              renderSourceEditor(lastState, { forceReload: false });
            }
          });
        });

        sourceEditorReset.addEventListener("click", function () {
          editorDirty = false;
          if (lastState) {
            renderSourceEditor(lastState, { forceReload: true });
          }
        });

        sourceScope.addEventListener("change", function () {
          syncScopeCardSelection();
          if (lastState) {
            const selectedIds = selectedSourceIds();
            if (!editorDirty && selectedIds.length === 1) {
              editorSourceId = selectedIds[0];
            }
            renderSourceEditor(lastState, {
              forceReload: !editorDirty && selectedIds.length === 1,
              preferredSourceId: selectedIds.length === 1 ? selectedIds[0] : undefined
            });
            updateTopLine(lastState);
            updateSelectionGuidance(lastState);
          }
          schedulePlanPreview();
        });

        stageIds.forEach(function (stageId) {
          const controls = stageControls[stageId];
          if (!controls) {
            return;
          }

          controls.enabled.addEventListener("change", function () {
            controls.enabled.dataset.dirty = "true";
            schedulePlanPreview();
          });

          controls.select.addEventListener("change", function () {
            schedulePlanPreview();
          });
        });

        fetchState()
          .then(renderState)
          .catch(function (error) {
            configError.style.display = "block";
            configError.textContent = error instanceof Error ? error.message : String(error);
          });

        const stream = new EventSource("/api/events");
        stream.addEventListener("state", function (event) {
          connectionState.textContent = "Live stream connected";
          renderState(JSON.parse(event.data));
        });
        stream.onerror = function () {
          connectionState.textContent = "Reconnecting stream…";
        };
      })();
    </script>
  </body>
</html>`;
}