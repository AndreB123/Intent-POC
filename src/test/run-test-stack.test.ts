import { strict as assert } from "node:assert";
import test from "node:test";
import { selectTestStackCommand } from "./run-test-stack";

test("selectTestStackCommand Given explicit test targets When npm test receives them Then it forwards only those code tests", () => {
  const selection = selectTestStackCommand([
    "--test-name-pattern",
    "intent studio",
    "src/tdd/write-generated-playwright-tests.test.ts",
    "src/intent/normalize-intent.test.ts"
  ]);

  assert.equal(selection.command, "npm");
  assert.deepEqual(selection.args, [
    "run",
    "test:code",
    "--",
    "--test-name-pattern",
    "intent studio",
    "src/tdd/write-generated-playwright-tests.test.ts",
    "src/intent/normalize-intent.test.ts"
  ]);
});

test("selectTestStackCommand Given no explicit test targets When npm test runs Then it keeps the full stack workflow", () => {
  const selection = selectTestStackCommand([]);

  assert.equal(selection.command, "npm");
  assert.deepEqual(selection.args, ["run", "test:stack:all", "--"]);
});