import { LibraryVariant } from "../model/types";
import { renderButton, renderTextInput } from "../shared/render-controls";

export function renderInputField(value: string): string {
  return renderTextInput({ className: "input-field", value });
}

export function renderPrimitive(id: string, variant: LibraryVariant): string {
  const changed = variant === "v2";

  switch (id) {
    case "primitive-color-chip":
      return `<div class="row"><span class="chip">neutral</span><span class="chip accent">accent</span><span class="chip success">success</span><span class="chip warning">warning</span></div>`;
    case "primitive-typography":
      return `<div><h2>${changed ? "Narrative Heading" : "Heading Example"}</h2><p>Body copy for typography testing.</p><div class="muted">caption text</div></div>`;
    case "primitive-pill-tag":
      return `<div class="row"><span class="chip">alpha</span><span class="chip">beta</span><span class="chip">stable</span></div>`;
    case "primitive-input-field":
      return `<div class="row">${renderInputField("Search users")}${renderButton({ label: "Find", className: "accent" })}${renderButton({ label: "Clear" })}</div>`;
    case "primitive-button-set":
      return `<div class="row">${renderButton({ label: "Primary", className: "accent" })}${renderButton({ label: "Secondary" })}${renderButton({ label: "Danger", className: "danger" })}</div>`;
    case "primitive-avatar-stack":
      return `<div class="avatar-stack"><span class="avatar">AA</span><span class="avatar">BM</span><span class="avatar">CH</span><span class="avatar">DK</span></div>`;
    case "primitive-status-indicator":
      return `<div class="row"><span class="chip success">Healthy</span><span class="chip warning">Degraded</span><span class="chip danger">Critical</span></div>`;
    case "primitive-spacing-scale":
      return `<div class="layout-stack"><div class="tile" style="padding:8px">space-sm</div><div class="tile" style="padding:14px">space-md</div><div class="tile" style="padding:22px">space-lg</div></div>`;
    case "primitive-icon-list":
      return `<div class="row"><span class="chip">i</span><span class="chip">?</span><span class="chip">!</span><span class="chip">*</span></div>`;
    case "primitive-kpi-block":
      return `<div class="layout-row"><div class="tile stat"><strong>${changed ? "19.2%" : "18.4%"}</strong><div class="muted">Conversion</div></div><div class="tile stat"><strong>4m 21s</strong><div class="muted">Avg Session</div></div></div>`;
    default:
      return `<div class="tile">Unknown primitive</div>`;
  }
}