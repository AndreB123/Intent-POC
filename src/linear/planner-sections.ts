import { sanitizeFileSegment } from "../shared/fs";

export interface PlannerSectionTemplate {
  id: string;
  title: string;
  body: string;
}

export const BUSINESS_PLAN_SECTION_ID = "idd-plan";

function getSectionStartMarker(sectionId: string): string {
  return `<!-- intent-poc:${sectionId}:start -->`;
}

function getSectionEndMarker(sectionId: string): string {
  return `<!-- intent-poc:${sectionId}:end -->`;
}

export function getPlannerSectionStartMarker(sectionId: string): string {
  return getSectionStartMarker(sectionId);
}

export function sourceLaneSectionId(sourceId: string): string {
  return `idd-source-lane-${sanitizeFileSegment(sourceId)}`;
}

export function hasPlannerSection(description: string | undefined, sectionId: string): boolean {
  if (!description) {
    return false;
  }

  return description.includes(getSectionStartMarker(sectionId)) && description.includes(getSectionEndMarker(sectionId));
}

export function wrapPlannerSection(template: PlannerSectionTemplate): string {
  const body = template.body.trim();

  return [
    getSectionStartMarker(template.id),
    `## ${template.title}`,
    "",
    body,
    getSectionEndMarker(template.id)
  ].join("\n");
}

export function upsertPlannerSection(
  existingDescription: string | undefined,
  template: PlannerSectionTemplate
): string {
  const section = wrapPlannerSection(template);
  if (!existingDescription || existingDescription.trim().length === 0) {
    return section;
  }

  const startMarker = getSectionStartMarker(template.id);
  const endMarker = getSectionEndMarker(template.id);
  const startIndex = existingDescription.indexOf(startMarker);
  const endIndex = existingDescription.indexOf(endMarker);

  if (startIndex >= 0 && endIndex >= 0 && endIndex >= startIndex) {
    const before = existingDescription.slice(0, startIndex).trimEnd();
    const after = existingDescription.slice(endIndex + endMarker.length).trimStart();

    return [before, section, after].filter((part) => part.length > 0).join("\n\n");
  }

  return `${existingDescription.trimEnd()}\n\n${section}`;
}