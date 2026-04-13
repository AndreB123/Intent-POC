function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderIntentStudioPage(input: { configPath: string }): string {
  const configPath = escapeHtml(input.configPath);

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

      label {
        font-size: 13px;
        font-weight: 700;
        color: var(--muted);
      }

      textarea,
      select,
      button,
      input[type="checkbox"] {
        font: inherit;
      }

      textarea,
      select {
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
        .results-grid {
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
        .timeline-head {
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
          <p>Prompt-driven control surface for the intent runner. Start a run, watch the orchestration timeline, and inspect captures, diffs, summaries, and Linear activity as the workflow progresses.</p>
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
              <span class="meta-label">Active source</span>
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
                <div class="panel-copy">Define the business intent first. The system will turn it into BDD, TDD, execution sources, and run behavior before anything launches. Use overrides only when you need to pin the target source or the evidence workflow.</div>
              </div>
              <span class="status-pill status-ready" id="current-status-pill">Ready</span>
            </div>

            <form id="run-form">
              <div class="prompt-grid">
                <div class="field-wide">
                  <label for="prompt-input">Intent prompt</label>
                  <textarea id="prompt-input" placeholder="Describe the business intent, what sources or tools it should touch, and what outcome should be verified."></textarea>
                  <div class="field-note">Source and mode overrides are optional. Blank source: the planner tries to match source ids or aliases in your prompt, then falls back to <code>run.sourceId</code> from config. Blank mode: the planner infers the run type from phrases like &quot;create baseline&quot; or &quot;approve baseline&quot;, then falls back to <code>run.mode</code>.</div>
                </div>
                <div class="field">
                  <label for="source-select">Source override</label>
                  <select id="source-select"></select>
                  <div class="field-note">A source is one configured target under <code>sources</code>, such as a local app or a cloned repo. Pick one when you want to pin the run to that target instead of letting the prompt choose.</div>
                </div>
                <div class="field">
                  <label for="mode-select">Mode override</label>
                  <select id="mode-select">
                    <option value="">Infer from prompt or config</option>
                    <option value="baseline">baseline</option>
                    <option value="compare">compare</option>
                    <option value="approve-baseline">approve-baseline</option>
                  </select>
                  <div class="field-note">Mode controls what the run does with captured evidence. <code>baseline</code> writes current captures as the baseline, <code>compare</code> diffs current captures against the baseline, and <code>approve-baseline</code> captures current state and writes it into the approved baseline set. Use it when your prompt is generic and you need to tell the runner which evidence workflow to use.</div>
                </div>
                <div class="field-wide">
                  <div class="selection-card">
                    <div class="selection-title">
                      <strong>How Overrides Work</strong>
                      <span class="target-badge target-ready">guide</span>
                    </div>
                    <div class="selection-summary"><strong>Source override</strong> changes which configured source runs. It does not change how screenshots are handled after capture.</div>
                    <div class="selection-summary"><strong>Mode override</strong> sets the expected evidence workflow for the run. It is most useful when your prompt is generic; explicit prompt phrases like create baseline, approve baseline, or report drift can still steer the planner.</div>
                    <div class="selection-summary">Leave both blank when your prompt already says what to do. The planner will still try to infer source and mode from the prompt before using config defaults.</div>
                  </div>
                </div>
                <div class="field-wide">
                  <div class="selection-card">
                    <div class="selection-title">
                      <strong id="selection-title">No source override selected</strong>
                      <span class="target-badge target-ready" id="selection-status">optional</span>
                    </div>
                    <div class="selection-summary" id="selection-summary">The runner can choose sources from your prompt, then fall back to the config default if needed.</div>
                    <div class="selection-summary" id="selection-defaults">Blank source falls back to config default. Blank mode falls back to prompt inference, then config mode.</div>
                    <div class="selection-summary" id="selection-details">Use the Sources panel on the right to understand what each source actually does before you pick one.</div>
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
                <h2>Sources</h2>
                <div class="panel-copy">Configured evidence sources available to the runner right now, with startup, readiness, and any obvious setup problems.</div>
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
        const sourceSelect = document.getElementById("source-select");
        const modeSelect = document.getElementById("mode-select");
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
        const planTools = document.getElementById("plan-tools");
        const form = document.getElementById("run-form");

        let promptTouched = false;
        let lastState = null;
        let previewPlan = null;
        let planRequestId = 0;
        let planRequestTimer = null;

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

        function ensureOptions(options, selectedValue) {
          clear(sourceSelect);

          const blankOption = document.createElement("option");
          blankOption.value = "";
          blankOption.textContent = "Use prompt or config";
          if (!selectedValue) {
            blankOption.selected = true;
          }
          sourceSelect.appendChild(blankOption);

          options.forEach(function (source) {
            const option = document.createElement("option");
            option.value = source.id;
            option.textContent = source.label + " (" + source.id + ")";
            if (source.id === selectedValue) {
              option.selected = true;
            }
            sourceSelect.appendChild(option);
          });
        }

        function selectedSourceRecord(state) {
          if (!state || !state.sources) {
            return null;
          }

          if (!sourceSelect.value) {
            return null;
          }

          return state.sources.find(function (source) {
            return source.id === sourceSelect.value;
          }) || null;
        }

        function updateSelectionGuidance(state) {
          const source = selectedSourceRecord(state);
          const defaultSourceText = state.defaultSourceId ? state.defaultSourceId : "none";
          const defaultModeText = state.defaultMode ? state.defaultMode : "none";

          if (!source) {
            selectionTitle.textContent = "No source override selected";
            selectionStatus.textContent = "optional";
            selectionStatus.className = "target-badge target-ready";
            selectionSummary.textContent = "The runner can infer sources from your prompt by matching configured source ids or aliases, then fall back to the config default source if needed.";
            selectionDefaults.textContent = "Blank source falls back to config default: " + defaultSourceText + ". Blank mode falls back to prompt inference based on phrases like create baseline or approve baseline, then config mode: " + defaultModeText + ".";
            selectionDetails.textContent = "Pick a source when you need to pin the run to one target. Pick a mode when your prompt is generic and you need to tell the runner whether this should write a baseline or compare against one.";
            return;
          }

          selectionTitle.textContent = source.label + " (" + source.id + ")";
          selectionStatus.textContent = source.status === "attention" ? "attention" : "ready";
          selectionStatus.className = "target-badge " + (source.status === "attention" ? "target-attention" : "target-ready");
          selectionSummary.textContent = source.summary;
          selectionDefaults.textContent = "Source: " + source.sourceLocation + " • Readiness: " + source.readiness + " • Base URL: " + source.baseUrl;
          selectionDetails.textContent = source.issues && source.issues.length > 0
            ? source.issues.join(" ")
            : source.notes && source.notes.length > 0
              ? source.notes.join(" ")
              : "No obvious setup issues detected from config alone.";
        }

        function renderMetrics(run) {
          clear(metrics);

          if (!run) {
            const empty = create("div", "empty-card", "No run has started in this studio session yet.");
            metrics.appendChild(empty);
            return;
          }

          const items = [
            ["Source", run.sourceId || "—"],
            ["Mode", run.mode || "—"],
            ["Prompt", run.prompt || "—"],
            ["Normalized summary", run.normalizedSummary || "Waiting for normalization…"],
            ["Run ID", run.runId || "Pending"],
            ["Source lanes", run.sourceRuns && run.sourceRuns.length > 0 ? run.sourceRuns.map(function (sourceRun) { return sourceRun.sourceId + ": " + sourceRun.status; }).join(" | ") : "Waiting for source planning…"],
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
            planPlanNotes.textContent = "The planner will show BDD, TDD, sources, destinations, and tools before execution starts.";
            renderPlanList(planCriteria, [], function () { return create("div", "empty-card", ""); }, "Acceptance criteria will appear once the planner has a prompt.");
            renderPlanList(planScenarios, [], function () { return create("div", "empty-card", ""); }, "BDD scenarios will appear once the planner has a prompt.");
            renderPlanList(planWorkItems, [], function () { return create("div", "empty-card", ""); }, "TDD work items will appear once the planner has a prompt.");
            renderPlanList(planSources, [], function () { return create("div", "empty-card", ""); }, "Execution sources will appear once the planner has a prompt.");
            renderPlanList(planDestinations, [], function () { return create("div", "empty-card", ""); }, "Destinations will appear once the planner has a prompt.");
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
              return renderPlanItem(
                workItem.title,
                ["Sources: " + workItem.sourceIds.join(", "), "Verification: " + workItem.verification],
                [workItem.description, "Visible outcome: " + workItem.userVisibleOutcome],
                workItem.scenarioIds
              );
            },
            "TDD work items will appear once the planner has a prompt."
          );

          renderPlanList(
            planSources,
            activePlan.executionPlan.sources,
            function (source) {
              const captureDescription = source.captureScope.mode === "subset"
                ? "Captures: " + source.captureScope.captureIds.join(", ")
                : "Captures: all configured captures";
              return renderPlanItem(
                source.sourceId,
                ["Run mode: " + source.runMode],
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
            sources.appendChild(create("div", "empty-card", "No sources are available because the current config could not be loaded."));
            return;
          }

          state.sources.forEach(function (source) {
            const card = create("div", "target-card");
            const statusRow = create("div", "target-status-row");
            statusRow.appendChild(create("div", "target-title", source.label + " (" + source.id + ")"));
            statusRow.appendChild(create("span", "target-badge " + (source.status === "attention" ? "target-attention" : "target-ready"), source.status));
            card.appendChild(statusRow);
            card.appendChild(create("div", "target-summary", source.summary));
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
            card.appendChild(create("div", "recent-title", run.prompt));
            card.appendChild(create("div", "recent-meta", "Source: " + run.sourceId + " • " + run.mode + " • " + run.status));
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
          const source = selectedSourceRecord(state);

          runnerStatus.textContent = run ? run.status : "ready";
          linearState.textContent = state.linearEnabled ? "enabled" : "disabled";
          selectedSource.textContent = run && run.sourceId
            ? run.sourceId
            : source
              ? source.label + " (" + source.id + ")"
              : "prompt/config decides";
          lastUpdate.textContent = formatTime(state.serverTime);
          currentStatusPill.textContent = run ? run.status : "ready";
          currentStatusPill.className = "status-pill " + formatStatusClass(run ? run.status : "ready");
          runIdNode.textContent = run && run.runId ? run.runId : run ? "Run queued" : "No active run";
          submitButton.disabled = Boolean(running || state.configError || !(state.sources && state.sources.length));
          formNote.textContent = state.configError
            ? "Fix the config before starting a run."
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

          ensureOptions(state.sources || [], sourceSelect.value || "");

          if (!hadPreviousState) {
            sourceSelect.value = "";
            modeSelect.value = "";
          }

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
              sourceId: sourceSelect.value || undefined,
              mode: modeSelect.value || undefined
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

          const payload = {
            prompt: promptInput.value,
            sourceId: sourceSelect.value || undefined,
            mode: modeSelect.value || undefined,
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

        form.addEventListener("submit", function (event) {
          submitRun(event).catch(function (error) {
            formNote.textContent = error instanceof Error ? error.message : String(error);
          });
        });

        sourceSelect.addEventListener("change", function () {
          if (lastState) {
            updateTopLine(lastState);
            updateSelectionGuidance(lastState);
          }
          schedulePlanPreview();
        });

        modeSelect.addEventListener("change", function () {
          if (lastState) {
            updateSelectionGuidance(lastState);
          }
          schedulePlanPreview();
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