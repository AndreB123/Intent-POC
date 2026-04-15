import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyImplementationChangeSet } from "./apply-changes";

test("applyImplementationChangeSet Given a forbidden target When changes are applied Then it rejects without writing files", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "intent-poc-apply-changes-"));

  try {
    await fs.mkdir(path.join(rootDir, "artifacts"), { recursive: true });

    await assert.rejects(
      () =>
        applyImplementationChangeSet({
          rootDir,
          operations: [
            {
              operation: "create",
              filePath: "artifacts/blocked.txt",
              rationale: "Should never be allowed."
            }
          ],
          materializedFiles: [
            {
              filePath: "artifacts/blocked.txt",
              content: "blocked"
            }
          ],
          forbiddenAbsolutePaths: [path.join(rootDir, "artifacts")]
        }),
      /forbidden path/
    );

    const blockedPath = path.join(rootDir, "artifacts", "blocked.txt");
    const blockedExists = await fs.stat(blockedPath).then(() => true).catch(() => false);
    assert.equal(blockedExists, false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});