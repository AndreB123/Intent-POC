import { AGENT_STAGE_DEFINITIONS, AGENT_STAGE_SEQUENCE, GEMINI_MODEL_OPTIONS } from "../../intent/agent-stage-config";

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
                  <label for="${stage.id}-model-select">${escapeHtml(stage.label)} model</label>
                  <select id="${stage.id}-model-select">
                    <option value="">Use config default</option>
                    ${modelOptions}
                  </select>
                  <input id="${stage.id}-model-custom" placeholder="Optional custom Gemini model id" />
                  <div class="field-note" id="${stage.id}-model-note">${escapeHtml(stage.description)}</div>
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
        grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.8fr);
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
        grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.82fr);
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
        align-items: center;
        justify-content: space-between;
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
        display: inline-flex;
        align-items: center;
        gap: 14px;
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
      }

      .plan-item {
        padding: 14px;
        display: grid;
        gap: 8px;
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

      .muted-link {
        font-size: 13px;
        color: var(--muted);
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
          <h2>Session</h2>
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
        </aside>
      </header>

      <main class="layout">
        <div class="main-stack">
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
                </div>
                <div class="field">
                  <div class="field-head">
                    <label>Work scope</label>
                    <div class="field-actions">
                      <a class="ghost-link" id="config-editor-link" href="#">Open config in editor</a>
                      <a class="ghost-link" id="config-file-link" href="#">View YAML</a>
                    </div>
                  </div>
                  <div class="field-note">These cards come from the <code>sources</code> block in the active YAML config. Every configured source stays visible here. Use the metadata editor below for labels and context, and use YAML for structural source changes.</div>
                  <div class="scope-list" id="source-scope"></div>
                  <div class="field-note" id="source-visibility-note">All configured sources are visible in work scope.</div>
                </div>
${agentStageFields}
                <div class="field-wide">
                  <div class="selection-card">
                    <div class="selection-title">
                      <strong>How Work Scope Works</strong>
                      <span class="target-badge target-ready">guide</span>
                    </div>
                    <div class="selection-summary"><strong>Work scope</strong> constrains which configured repos or apps can participate in the run. It does not change how screenshots are handled after capture.</div>
                    <div class="selection-summary">Rename cards and update repo context directly in the Source Metadata panel. Use the YAML config when you need to add, remove, or structurally rewire sources.</div>
                    <div class="selection-summary">When multiple sources are checked, the planner creates one evidence lane per selected source inside the same business run.</div>
                  </div>
                </div>
                <div class="field-wide">
                  <div class="selection-card">
                    <div class="selection-title">
                      <strong id="selection-title">Default work scope</strong>
                      <span class="target-badge target-ready" id="selection-status">optional</span>
                    </div>
                    <div class="selection-summary" id="selection-summary">The runner can choose sources from your prompt, then fall back to the config default if needed.</div>
                    <div class="selection-summary" id="selection-defaults">Blank work scope falls back to prompt matching, business-wide expansion, then config default.</div>
                    <div class="selection-summary" id="selection-details">Use the Scope Sources panel on the right to understand what each source actually does before you constrain the run.</div>
                  </div>
                </div>
              </div>

              <div class="form-actions">
                <label class="toggle">
                  <input id="dry-run-input" type="checkbox" />
                  Dry run only
                </label>
                <div class="submit-row">
                  <span class="notice" id="form-note">No run in progress.</span>
                  <button class="primary-button" id="submit-button" type="submit">Run intent</button>
                </div>
              </div>
            </form>
          </section>

          <section class="panel">
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
                  <input id="source-editor-display-name" type="text" placeholder="Current app" />
                  <div class="field-note">Shown on work scope cards and plan summaries. Leave blank to fall back to the repo label or configured id.</div>
                </div>
                <div class="field">
                  <label for="source-editor-repo-label">Repo label</label>
                  <input id="source-editor-repo-label" type="text" placeholder="Intent POC" />
                  <div class="field-note">Short repo or app label shown as secondary context.</div>
                </div>
                <div class="field">
                  <label for="source-editor-role">Role</label>
                  <input id="source-editor-role" type="text" placeholder="current app" />
                  <div class="field-note">Describe why this source exists in the workflow.</div>
                </div>
                <div class="field-wide">
                  <label for="source-editor-summary">Summary</label>
                  <textarea id="source-editor-summary" placeholder="Explain what this source represents and when it should be used."></textarea>
                  <div class="field-note" id="source-editor-location">Source metadata writes back to the active config file.</div>
                </div>
              </div>
              <div class="editor-actions">
                <button class="primary-button" id="source-editor-save" type="submit">Save source metadata</button>
                <button class="ghost-button" id="source-editor-reset" type="button">Reload selected source</button>
              </div>
            </form>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Intent Lifecycle</h2>
                <div class="panel-copy">This preview shows how the current prompt is translated into business intent, BDD scenarios, TDD work items, execution sources, and distribution outputs.</div>
              </div>
            </div>
            <div class="plan-grid">
              <div class="plan-column">
                <div class="plan-card">
                  <span class="artifact-label">Business intent</span>
                  <div class="plan-intent-text" id="plan-intent-text">Type an intent to preview the plan.</div>
                  <div class="plan-intent-outcome" id="plan-intent-outcome">Desired outcome will appear here.</div>
                  <div class="plan-note" id="plan-plan-notes">Planner notes and orchestration strategy will appear here.</div>
                </div>
                <div class="plan-card">
                  <span class="artifact-label">Acceptance criteria</span>
                  <div class="plan-list" id="plan-criteria"></div>
                </div>
                <div class="plan-card">
                  <span class="artifact-label">BDD scenarios</span>
                  <div class="plan-list" id="plan-scenarios"></div>
                </div>
              </div>
              <div class="plan-column">
                <div class="plan-card">
                  <span class="artifact-label">TDD work items</span>
                  <div class="plan-list" id="plan-work-items"></div>
                </div>
                <div class="plan-card">
                  <span class="artifact-label">Execution sources</span>
                  <div class="plan-list" id="plan-sources"></div>
                </div>
                <div class="plan-card">
                  <span class="artifact-label">Destinations</span>
                  <div class="plan-list" id="plan-destinations"></div>
                </div>
                <div class="plan-card">
                  <span class="artifact-label">AI stages</span>
                  <div class="plan-list" id="plan-ai-stages"></div>
                </div>
                <div class="plan-card">
                  <span class="artifact-label">Tools</span>
                  <div class="plan-list" id="plan-tools"></div>
                </div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Run Snapshot</h2>
                <div class="panel-copy">Current run metadata and high-level result counters.</div>
              </div>
              <span class="muted-link" id="run-id">No active run</span>
            </div>
            <div class="status-strip" id="metrics"></div>
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

        <aside class="side-stack">
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Scope Sources</h2>
                <div class="panel-copy">Configured repo and workspace sources loaded from YAML, with readiness details and setup notes.</div>
              </div>
            </div>
            <div class="target-list" id="sources"></div>
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
        const sources = document.getElementById("sources");
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
        const planCriteria = document.getElementById("plan-criteria");
        const planScenarios = document.getElementById("plan-scenarios");
        const planWorkItems = document.getElementById("plan-work-items");
        const planSources = document.getElementById("plan-sources");
        const planDestinations = document.getElementById("plan-destinations");
        const planAiStages = document.getElementById("plan-ai-stages");
        const planTools = document.getElementById("plan-tools");
        const form = document.getElementById("run-form");
        const stageIds = ${stageIdsJson};
        const stageControls = Object.fromEntries(stageIds.map(function (stageId) {
          return [
            stageId,
            {
              select: document.getElementById(stageId + "-model-select"),
              custom: document.getElementById(stageId + "-model-custom"),
              note: document.getElementById(stageId + "-model-note")
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

            const customModel = controls.custom.value.trim();
            const selectedModel = controls.select.value || undefined;
            const model = customModel || selectedModel;

            if (model) {
              stages[stageId] = { model: model };
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
          const defaultModeText = state.defaultMode ? state.defaultMode : "none";

          if (selectedSources.length === 0) {
            selectionTitle.textContent = "No work scope selected";
            selectionStatus.textContent = "optional";
            selectionStatus.className = "target-badge target-ready";
            selectionSummary.textContent = "The runner can infer sources from your prompt by matching configured source ids or aliases, then fall back to the config default source if needed.";
            selectionDefaults.textContent = "Blank work scope falls back to prompt matching and business-wide expansion, then config default: " + defaultSourceText + ". Run behavior still falls back to config mode: " + defaultModeText + ".";
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

            controls.note.textContent = stage.provider
              ? stage.description + " Config default: " + stage.provider + " / " + stage.model + ". " + (stage.enabled ? "Enabled." : "Disabled.")
              : stage.description + " No provider is configured in the current YAML, so this stage stays deterministic until Gemini is enabled.";
          });
        }

        function renderMetrics(run) {
          clear(metrics);

          if (!run) {
            const empty = create("div", "empty-card", "No run has started in this studio session yet.");
            metrics.appendChild(empty);
            return;
          }

          const requestedScope = run.requestedSourceIds && run.requestedSourceIds.length > 0
            ? run.requestedSourceIds.map(function (sourceId) {
                return formatSourceReference(lastState, sourceId);
              }).join(", ")
            : "Prompt/config decides";
          const primarySource = run.sourceId ? formatSourceReference(lastState, run.sourceId) : "—";

          const items = [
            ["Requested scope", requestedScope],
            ["Primary source", primarySource],
            ["Mode", run.mode || "—"],
            ["AI stages", run.intentPlan ? run.intentPlan.normalizationMeta.stages.map(function (stage) {
              return stage.label + ": " + stage.status + (stage.model ? " (" + stage.model + ")" : "");
            }).join(" | ") : "Waiting for planning…"],
            ["Prompt", run.prompt || "—"],
            ["Normalized summary", run.normalizedSummary || "Waiting for normalization…"],
            ["Run ID", run.runId || "Pending"],
            ["Source lanes", run.sourceRuns && run.sourceRuns.length > 0 ? run.sourceRuns.map(function (sourceRun) {
              const attemptLabel = sourceRun.attemptCount && sourceRun.attemptCount > 0
                ? " (" + sourceRun.attemptCount + " attempt" + (sourceRun.attemptCount === 1 ? "" : "s") + (sourceRun.latestFailureStage ? ", " + sourceRun.latestFailureStage : "") + ")"
                : "";
              return sourceRun.sourceId + ": " + sourceRun.status + attemptLabel;
            }).join(" | ") : "Waiting for source planning…"],
            ["Result", run.error || (run.hasDrift ? "Drift detected" : run.status === "completed" ? "No blocking errors" : "In progress")]
          ];

          items.forEach(function (item) {
            const card = create("div", "metric");
            card.appendChild(create("span", "metric-label", item[0]));
            card.appendChild(create("span", "metric-value", item[1]));
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

        function renderPlan(state) {
          const activePlan = state && state.currentRun && state.currentRun.intentPlan
            ? state.currentRun.intentPlan
            : previewPlan;

          if (!activePlan) {
            planIntentText.textContent = "Type an intent to preview the plan.";
            planIntentOutcome.textContent = "Desired outcome will appear here.";
            planPlanNotes.textContent = "The planner will show BDD, Playwright-first TDD, workflow stages, sources, destinations, and tools before execution starts.";
            renderPlanList(planCriteria, [], function () { return create("div", "empty-card", ""); }, "Acceptance criteria will appear once the planner has a prompt.");
            renderPlanList(planScenarios, [], function () { return create("div", "empty-card", ""); }, "BDD scenarios will appear once the planner has a prompt.");
            renderPlanList(planWorkItems, [], function () { return create("div", "empty-card", ""); }, "Playwright-first TDD work items will appear once the planner has a prompt.");
            renderPlanList(planSources, [], function () { return create("div", "empty-card", ""); }, "Execution sources will appear once the planner has a prompt.");
            renderPlanList(planDestinations, [], function () { return create("div", "empty-card", ""); }, "Destinations will appear once the planner has a prompt.");
            renderPlanList(planAiStages, [], function () { return create("div", "empty-card", ""); }, "Workflow stage details will appear once the planner has a prompt.");
            renderPlanList(planTools, [], function () { return create("div", "empty-card", ""); }, "Tools will appear once the planner has a prompt.");
            return;
          }

          planIntentText.textContent = activePlan.businessIntent.statement;
          planIntentOutcome.textContent = "Desired outcome: " + activePlan.businessIntent.desiredOutcome;
          planPlanNotes.textContent = "Strategy: " + activePlan.executionPlan.orchestrationStrategy + " • " + (activePlan.executionPlan.reviewNotes.length > 0 ? activePlan.executionPlan.reviewNotes.join(" ") : "No planner warnings.");

          renderPlanList(
            planCriteria,
            activePlan.businessIntent.acceptanceCriteria,
            function (criterion) {
              return renderPlanItem(criterion.description, ["Origin: " + criterion.origin], [], []);
            },
            "Acceptance criteria will appear once the planner has a prompt."
          );

          renderPlanList(
            planScenarios,
            activePlan.businessIntent.scenarios,
            function (scenario) {
              return renderPlanItem(
                scenario.title,
                ["Goal: " + scenario.goal, "Sources: " + scenario.applicableSourceIds.join(", ")],
                [].concat(
                  scenario.given.map(function (entry) { return "Given " + entry; }),
                  scenario.when.map(function (entry) { return "When " + entry; }),
                  scenario.then.map(function (entry) { return "Then " + entry; })
                ),
                []
              );
            },
            "BDD scenarios will appear once the planner has a prompt."
          );

          renderPlanList(
            planWorkItems,
            activePlan.businessIntent.workItems,
            function (workItem) {
              var checkpointCount = workItem.playwright.specs.reduce(function (count, spec) {
                return count + spec.checkpoints.length;
              }, 0);
              var specPaths = workItem.playwright.specs.map(function (spec) {
                return spec.sourceId + ":" + spec.relativeSpecPath;
              });
              return renderPlanItem(
                workItem.title,
                [
                  "Sources: " + workItem.sourceIds.join(", "),
                  "Verification: " + workItem.verification,
                  "Playwright specs: " + workItem.playwright.specs.length,
                  "Checkpoints: " + checkpointCount
                ],
                [workItem.description, "Visible outcome: " + workItem.userVisibleOutcome].concat(
                  specPaths.length > 0 ? ["Spec paths: " + specPaths.join(", ")] : []
                ),
                workItem.scenarioIds
              );
            },
            "Playwright-first TDD work items will appear once the planner has a prompt."
          );

          renderPlanList(
            planSources,
            activePlan.executionPlan.sources,
            function (source) {
              const sourceRecord = findSource(state, source.sourceId);
              const captureDescription = source.captureScope.mode === "subset"
                ? "Captures: " + source.captureScope.captureIds.join(", ")
                : "Captures: all configured captures";
              return renderPlanItem(
                formatSourceLabel(state, source.sourceId),
                [
                  "Configured id: " + source.sourceId,
                  "Run mode: " + source.runMode
                ].concat(sourceRecord && sourceRecord.role ? ["Role: " + sourceRecord.role] : []),
                [source.selectionReason, captureDescription].concat(source.warnings || []),
                source.sourceId === activePlan.executionPlan.primarySourceId ? ["primary"] : []
              );
            },
            "Execution sources will appear once the planner has a prompt."
          );

          renderPlanList(
            planDestinations,
            activePlan.executionPlan.destinations,
            function (destination) {
              return renderPlanItem(destination.label, ["Status: " + destination.status, "Type: " + destination.type], [destination.reason].concat(destination.details || []), []);
            },
            "Destinations will appear once the planner has a prompt."
          );

          renderPlanList(
            planAiStages,
            activePlan.normalizationMeta.stages,
            function (stage) {
              const executionSource = stage.provider ? stage.provider + " / " + (stage.model || "default-model") : "deterministic";
              return renderPlanItem(
                stage.label,
                ["Status: " + stage.status, "Execution: " + executionSource],
                [stage.description].concat(stage.warnings || []),
                []
              );
            },
            "Workflow stage details will appear once the planner has a prompt."
          );

          renderPlanList(
            planTools,
            activePlan.executionPlan.tools,
            function (tool) {
              return renderPlanItem(tool.label, ["State: " + (tool.enabled ? "enabled" : "planned"), "Type: " + tool.type], [tool.reason].concat(tool.details || []), []);
            },
            "Tools will appear once the planner has a prompt."
          );
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

        function renderSources(state) {
          clear(sources);

          if (!state.sources || state.sources.length === 0) {
            sources.appendChild(create("div", "empty-card", "No configured sources are available. Open the config and add at least one source."));
            return;
          }

          state.sources.forEach(function (source) {
            const card = create("div", "target-card");
            const statusRow = create("div", "target-status-row");
            statusRow.appendChild(create("div", "target-title", source.label));
            statusRow.appendChild(create("span", "target-badge " + (source.status === "attention" ? "target-attention" : "target-ready"), source.status));
            card.appendChild(statusRow);
            if (source.defaultScope) {
              card.appendChild(create("div", "target-note", "Default Studio scope from the current config."));
            }
            card.appendChild(create("div", "target-summary", source.summary));
            card.appendChild(create("div", "target-detail", "Configured id: " + source.id));
            if (source.repoLabel || source.repoId) {
              card.appendChild(create("div", "target-detail", "Repo: " + (source.repoLabel || source.repoId)));
            }
            if (source.role) {
              card.appendChild(create("div", "target-detail", "Role: " + source.role));
            }
            card.appendChild(create("div", "target-detail", "Source: " + source.sourceLocation));
            card.appendChild(create("div", "target-detail", "Startup: " + source.startCommand));
            card.appendChild(create("div", "target-detail", "Readiness: " + source.readiness));
            card.appendChild(create("div", "target-detail", source.sourceType + " source • " + source.captureCount + " captures • Aliases: " + (source.aliases.length > 0 ? source.aliases.join(", ") : "none")));

            if (source.notes && source.notes.length > 0) {
              source.notes.forEach(function (note) {
                card.appendChild(create("div", "target-note", note));
              });
            }

            if (source.issues && source.issues.length > 0) {
              source.issues.forEach(function (issue) {
                card.appendChild(create("div", "target-issue", issue));
              });
            }

            sources.appendChild(card);
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
            card.appendChild(create("div", "recent-meta", "Scope: " + scopeText + " • Primary source: " + (run.sourceId ? formatSourceReference(state, run.sourceId) : "—") + " • " + run.mode + " • " + run.status));
            card.appendChild(create("div", "recent-meta", "Finished: " + formatTime(run.finishedAt)));

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
          renderSources(state);
          renderRecent(state);
        }

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

          controls.select.addEventListener("change", function () {
            schedulePlanPreview();
          });

          controls.custom.addEventListener("input", function () {
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