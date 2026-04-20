import { LibraryVariant, SurfaceLayer } from "../model/types";
import { getThemeTokens, getThemeToggleState } from "../theme/theme";

function layerLabel(layer: SurfaceLayer): string {
  return layer;
}

export function renderSurfaceFrame(input: {
  title: string;
  testId: string;
  layer: SurfaceLayer;
  body: string;
  variant: LibraryVariant;
  isDark?: boolean;
}): string {
  const theme = getThemeTokens(input.variant);
  const toggleState = getThemeToggleState(!!input.isDark);

  return `
    <section data-testid="${input.testId}" class="surface-frame ${input.isDark ? "dark-mode" : ""}">
      <header class="surface-header">
        <div class="header-left">
          <h1>${input.title}</h1>
        </div>
        <div class="header-right">
          <button data-testid="theme-toggle" aria-label="${toggleState.label}" onclick="window.location.search = '?dark=' + ${!input.isDark}">${toggleState.icon}</button>
          <span class="chip chip-${input.layer}">${layerLabel(input.layer)}</span>
        </div>
      </header>
      <div class="surface-content">
        ${input.body}
      </div>
    </section>
    <style>
      :root {
        --bg: ${theme.background};
        --surface: ${theme.surface};
        --text: ${theme.text};
        --muted: ${theme.textMuted};
        --accent: ${theme.accent};
        --accent-strong: ${theme.accentStrong};
        --success: ${theme.success};
        --warning: ${theme.warning};
        --danger: ${theme.danger};
        --border: ${theme.border};
        --border-strong: ${theme.borderStrong};
        --radius-md: ${theme.radiusMd};
        --radius-lg: ${theme.radiusLg};
        --space-sm: ${theme.spaceSm};
        --space-md: ${theme.spaceMd};
        --space-lg: ${theme.spaceLg};
        --font-body: ${theme.fontBody};
        --font-heading: ${theme.fontHeading};
      }
      html, body {
        margin: 0;
        padding: 0;
        background: var(--bg);
        color: var(--text);
        font-family: var(--font-body);
      }
      .dark-mode {
        background: #1a1a1a;
        color: #e0e0e0;
      }
      .page {
        padding: var(--space-lg);
      }
      .surface-frame {
        max-width: 1100px;
        background: var(--surface);
        border: 2px solid var(--border);
        border-radius: var(--radius-lg);
        padding: var(--space-lg);
        box-shadow: 0 10px 24px rgba(28, 36, 46, 0.08);
      }
      .surface-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-md);
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: var(--space-md);
      }
      .header-right {
        display: flex;
        align-items: center;
        gap: var(--space-md);
      }
      .surface-header h1,
      h2,
      h3 {
        margin: 0;
        font-family: var(--font-heading);
      }
      .chip {
        border-radius: 999px;
        border: 1px solid var(--border);
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 700;
      }
      .chip-primitive { background: rgba(45, 103, 176, 0.08); }
      .chip-component { background: rgba(45, 103, 176, 0.12); }
      .chip-view { background: rgba(42, 139, 93, 0.12); }
      .chip-page { background: rgba(191, 84, 84, 0.12); }
      .selection-card {
        display: grid;
        gap: 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 12px;
        background: var(--surface);
      }
      .selection-title {
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
        background: rgba(42, 139, 93, 0.12);
        color: var(--success);
      }
      .target-attention {
        background: rgba(191, 84, 84, 0.12);
        color: var(--warning);
      }
      .selection-summary {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      .page-header,
      .section-header {
        display: grid;
        gap: 6px;
      }
      .page-subtitle,
      .section-subtitle {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      .row { display: flex; gap: var(--space-sm); align-items: center; flex-wrap: wrap; }
      .tile {
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 12px;
        background: var(--surface);
      }
      .accent { background: var(--accent); color: white; }
      .accent-strong { background: var(--accent-strong); color: white; }
      .success { background: var(--success); color: white; }
      .warning { background: var(--warning); color: white; }
      .danger { background: var(--danger); color: white; }
      .selection-card.accent,
      .selection-card.accent-strong,
      .selection-card.success,
      .selection-card.warning,
      .selection-card.danger {
        color: white;
      }
      .selection-card.accent .selection-summary,
      .selection-card.accent-strong .selection-summary,
      .selection-card.success .selection-summary,
      .selection-card.warning .selection-summary,
      .selection-card.danger .selection-summary {
        color: rgba(255, 255, 255, 0.88);
      }
      .stat { min-width: 120px; text-align: center; }
      .muted { color: var(--muted); font-size: 12px; }
      .input-field {
        width: 320px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border);
        padding: 10px;
        font-size: 14px;
        color: var(--text);
        background: var(--surface);
      }
      .dark-mode .input-field {
        color: #ffffff;
        border-color: #666;
        background: #333;
      }
      button {
        border: none;
        border-radius: var(--radius-md);
        padding: 10px 14px;
        font-weight: 700;
        cursor: pointer;
        background: #e7edf6;
        color: var(--text);
      }
      .layout-stack { display: grid; gap: var(--space-md); }
      .layout-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }
      .layout-three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-md); }
      .avatar {
        width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--surface);
        background: var(--accent); color: white; display: inline-flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 700;
      }
      .avatar-stack { display: flex; }
      .avatar-stack .avatar + .avatar { margin-left: -8px; background: var(--accent-strong); }
      .tabs { display: flex; gap: 6px; }
      .tab { border: 1px solid var(--border); border-radius: var(--radius-md); padding: 6px 10px; font-weight: 700; }
      .tab.active { border-color: var(--border-strong); background: rgba(45, 103, 176, 0.15); }
      .list { display: grid; gap: 8px; }
      .list-item { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); padding: 10px; }
      .divider { height: 1px; background: var(--border); }
      .table { width: 100%; border-collapse: collapse; }
      .table th, .table td { border-bottom: 1px solid var(--border); text-align: left; padding: 8px; }
      .callout { border-left: 4px solid var(--accent); background: rgba(45, 103, 176, 0.08); border-radius: var(--radius-md); padding: 10px 12px; }
      details summary { cursor: pointer; font-weight: 600; padding: 8px 0; }
      details[open] .details-content { padding-top: 8px; }
    </style>
  `;
}