import { LibraryVariant, ThemeTokens } from "../model/types";

const V1_THEME: ThemeTokens = {
  background: "#eef3f9",
  surface: "#ffffff",
  text: "#20324a",
  textMuted: "#60758f",
  accent: "#2d67b0",
  accentStrong: "#1f4f8f",
  success: "#2a8b5d",
  border: "#b8c6d8",
  borderStrong: "#8ea6bf",
  warning: "#bf5454",
  danger: "#a93c3c",
  radiusMd: "10px",
  radiusLg: "14px",
  spaceSm: "8px",
  spaceMd: "14px",
  spaceLg: "22px",
  fontBody: "'Segoe UI', 'Helvetica Neue', sans-serif",
  fontHeading: "'Trebuchet MS', 'Segoe UI', sans-serif"
};

const V2_THEME: ThemeTokens = {
  background: "#f7f1e7",
  surface: "#fffaf1",
  text: "#26211a",
  textMuted: "#6b5c4d",
  accent: "#b0531a",
  accentStrong: "#8f3f0f",
  success: "#326f46",
  border: "#d2b89b",
  borderStrong: "#b7906d",
  warning: "#c27a17",
  danger: "#a54526",
  radiusMd: "8px",
  radiusLg: "12px",
  spaceSm: "8px",
  spaceMd: "14px",
  spaceLg: "22px",
  fontBody: "'Gill Sans', 'Trebuchet MS', sans-serif",
  fontHeading: "'Georgia', 'Palatino Linotype', serif"
};

export function getThemeTokens(variant: LibraryVariant): ThemeTokens {
  return variant === "v2" ? V2_THEME : V1_THEME;
}