import { strict as assert } from "node:assert";
import test from "node:test";
import {
  BUSINESS_PLAN_SECTION_ID,
  hasPlannerSection,
  sourceLaneSectionId,
  upsertPlannerSection
} from "./planner-sections";

test("upsertPlannerSection appends a new managed section when none exists", () => {
  const description = upsertPlannerSection("Existing manual context", {
    id: BUSINESS_PLAN_SECTION_ID,
    title: "IDD Plan",
    body: "Planner-owned content"
  });

  assert.match(description, /Existing manual context/);
  assert.match(description, /Planner-owned content/);
  assert.equal(hasPlannerSection(description, BUSINESS_PLAN_SECTION_ID), true);
});

test("upsertPlannerSection replaces only the managed section body", () => {
  const initial = upsertPlannerSection("Manual intro", {
    id: BUSINESS_PLAN_SECTION_ID,
    title: "IDD Plan",
    body: "Old content"
  });

  const updated = upsertPlannerSection(initial, {
    id: BUSINESS_PLAN_SECTION_ID,
    title: "IDD Plan",
    body: "New content"
  });

  assert.match(updated, /Manual intro/);
  assert.doesNotMatch(updated, /Old content/);
  assert.match(updated, /New content/);
});

test("sourceLaneSectionId stays deterministic per source", () => {
  assert.equal(sourceLaneSectionId("client-systems-roach-admin"), "idd-source-lane-client-systems-roach-admin");
});