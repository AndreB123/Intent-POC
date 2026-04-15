import { strict as assert } from "node:assert";
import test from "node:test";
import { classifyChangedPaths } from "./test-impact-detector";

test("classifyChangedPaths escalates demo theme changes to the full workflow", () => {
  const decision = classifyChangedPaths(["src/demo-app/theme/theme.ts"]);

  assert.equal(decision.scope, "full");
  assert.equal(decision.command, "npm test");
  assert.equal(decision.matchedPaths.includes("src/demo-app/theme/theme.ts"), true);
});

test("classifyChangedPaths escalates deterministic screenshot artifact changes to the full workflow", () => {
  const decision = classifyChangedPaths([
    "artifacts/library/components/primitive-color-chip.png"
  ]);

  assert.equal(decision.scope, "full");
  assert.equal(decision.command, "npm test");
});

test("classifyChangedPaths escalates orchestrator changes to the full workflow", () => {
  const decision = classifyChangedPaths(["src/orchestrator/run-intent.ts"]);

  assert.equal(decision.scope, "full");
  assert.equal(decision.command, "npm test");
});

test("classifyChangedPaths keeps isolated intent changes on the deterministic code suite", () => {
  const decision = classifyChangedPaths([
    "src/intent/normalize-intent.ts",
    "src/intent/normalize-intent.test.ts"
  ]);

  assert.equal(decision.scope, "code");
  assert.equal(decision.command, "npm run test:code");
});

test("classifyChangedPaths defaults unknown source changes to the full workflow", () => {
  const decision = classifyChangedPaths(["src/shared/process.ts"]);

  assert.equal(decision.scope, "full");
  assert.equal(decision.command, "npm test");
});

test("classifyChangedPaths defaults to the deterministic code suite when no files are changed", () => {
  const decision = classifyChangedPaths([]);

  assert.equal(decision.scope, "code");
  assert.equal(decision.command, "npm run test:code");
  assert.equal(decision.changedPaths.length, 0);
});