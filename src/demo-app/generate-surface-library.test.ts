import { strict as assert } from "node:assert";
import test from "node:test";
import { getLegacyLibraryArtifactPaths } from "./generate-surface-library";

test("getLegacyLibraryArtifactPaths includes obsolete top-level library roots", () => {
  assert.deepEqual(getLegacyLibraryArtifactPaths("/repo"), [
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