export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderButtonInput {
  label: string;
  className?: string;
  id?: string;
  type?: "button" | "submit" | "reset";
  attributes?: Record<string, string | undefined>;
}

export interface RenderTextInputInput {
  className?: string;
  id?: string;
  type?: "text" | "search";
  value?: string;
  placeholder?: string;
}

function renderExtraAttributes(attributes: Record<string, string | undefined> | undefined): string {
  if (!attributes) {
    return "";
  }

  return Object.entries(attributes)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([name, value]) => ` ${name}="${escapeHtml(value!)}"`)
    .join("");
}

export function renderButton(input: RenderButtonInput): string {
  const classAttr = input.className ? ` class="${escapeHtml(input.className)}"` : "";
  const idAttr = input.id ? ` id="${escapeHtml(input.id)}"` : "";
  const typeAttr = input.type ? ` type="${input.type}"` : "";
  const extraAttrs = renderExtraAttributes(input.attributes);

  return `<button${classAttr}${idAttr}${typeAttr}${extraAttrs}>${escapeHtml(input.label)}</button>`;
}

export function renderTextInput(input: RenderTextInputInput): string {
  const classAttr = input.className ? ` class="${escapeHtml(input.className)}"` : "";
  const idAttr = input.id ? ` id="${escapeHtml(input.id)}"` : "";
  const typeAttr = ` type="${input.type ?? "text"}"`;
  const valueAttr = input.value !== undefined ? ` value="${escapeHtml(input.value)}"` : "";
  const placeholderAttr = input.placeholder ? ` placeholder="${escapeHtml(input.placeholder)}"` : "";

  return `<input${classAttr}${idAttr}${typeAttr}${valueAttr}${placeholderAttr} />`;
}