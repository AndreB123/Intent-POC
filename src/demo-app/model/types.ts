export type LibraryVariant = "v1" | "v2";
export type SurfaceLayer = "primitive" | "component" | "view" | "page";

export interface SurfaceDefinition {
  id: string;
  title: string;
  testId: string;
  layer: SurfaceLayer;
  changesInV2: boolean;
}

export interface ThemeTokens {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  accentStrong: string;
  success: string;
  border: string;
  borderStrong: string;
  warning: string;
  danger: string;
  radiusMd: string;
  radiusLg: string;
  spaceSm: string;
  spaceMd: string;
  spaceLg: string;
  fontBody: string;
  fontHeading: string;
}