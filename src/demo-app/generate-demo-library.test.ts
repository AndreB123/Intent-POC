import { strict as assert } from "node:assert";
import test from "node:test";
import { getLegacyDemoArtifactPaths } from "./generate-demo-library";

test("getLegacyDemoArtifactPaths includes obsolete top-level demo library roots", () => {
  assert.deepEqual(getLegacyDemoArtifactPaths("/repo"), [
    "/repo/artifacts/runs/demo-baseline-captures",
    "/repo/artifacts/runs/demo-baseline-diffs",
    "/repo/artifacts/runs/demo-compare-captures",
    "/repo/artifacts/runs/demo-compare-diffs",
    "/repo/artifacts/library/demo-catalog",
    "/repo/artifacts/library/demo-components",
    "/repo/artifacts/library/components",
    "/repo/artifacts/library/pages",
    "/repo/artifacts/library/views"
  ]);
});