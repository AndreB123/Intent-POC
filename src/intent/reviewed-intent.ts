import { promises as fs } from "node:fs";
import { LoadedConfig } from "../config/load-config";
import { createReviewedIntentDraftPaths, ReviewedIntentDraftPaths } from "../evidence/paths";
import { readJsonFile, writeJsonFile } from "../shared/fs";
import { NormalizedIntent, ReviewedIntentArtifact } from "./intent-types";

const DEFAULT_RESUMABLE_REVIEWED_INTENT_STATUSES: ReviewedIntentArtifact["status"][] = ["draft"];

export async function persistReviewedIntentDraft(input: {
  loadedConfig: LoadedConfig;
  normalizedIntent: NormalizedIntent;
  prompt: string;
  requestedSourceIds?: string[];
  resumeIssue?: string;
}): Promise<{
  artifact: ReviewedIntentArtifact;
  paths: ReviewedIntentDraftPaths;
}> {
  const timestamp = new Date().toISOString();
  const artifact: ReviewedIntentArtifact = {
    reviewedIntentId: input.normalizedIntent.intentId,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    prompt: input.prompt,
    requestedSourceIds: input.requestedSourceIds,
    resumeIssue: input.resumeIssue,
    normalizedIntent: input.normalizedIntent
  };
  const paths = createReviewedIntentDraftPaths(input.loadedConfig, artifact.reviewedIntentId);

  await writeJsonFile(paths.draftPath, artifact);

  return {
    artifact,
    paths
  };
}

export async function loadReviewedIntentDraft(input: {
  loadedConfig: LoadedConfig;
  reviewedIntentId: string;
}): Promise<{
  artifact: ReviewedIntentArtifact;
  paths: ReviewedIntentDraftPaths;
}> {
  const paths = createReviewedIntentDraftPaths(input.loadedConfig, input.reviewedIntentId);
  const artifact = await readJsonFile<ReviewedIntentArtifact>(paths.draftPath);

  if (!artifact) {
    throw new Error(`Reviewed intent draft '${input.reviewedIntentId}' was not found.`);
  }

  return {
    artifact,
    paths
  };
}

export async function loadLatestResumableReviewedIntentDraft(input: {
  loadedConfig: LoadedConfig;
  statuses?: ReviewedIntentArtifact["status"][];
}): Promise<
  | {
      artifact: ReviewedIntentArtifact;
      paths: ReviewedIntentDraftPaths;
    }
  | null
> {
  const draftPaths = createReviewedIntentDraftPaths(input.loadedConfig, "studio-active-draft");
  const allowedStatuses = new Set(input.statuses ?? DEFAULT_RESUMABLE_REVIEWED_INTENT_STATUSES);

  let fileNames: string[];
  try {
    fileNames = await fs.readdir(draftPaths.draftsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }

  const drafts = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => {
        const reviewedIntentId = fileName.replace(/\.json$/u, "");
        return await loadReviewedIntentDraft({
          loadedConfig: input.loadedConfig,
          reviewedIntentId
        });
      })
  );

  const resumableDrafts = drafts.filter((draft) => allowedStatuses.has(draft.artifact.status));
  resumableDrafts.sort((left, right) => {
    const rightTimestamp = Date.parse(right.artifact.updatedAt || right.artifact.createdAt || "");
    const leftTimestamp = Date.parse(left.artifact.updatedAt || left.artifact.createdAt || "");

    if (rightTimestamp !== leftTimestamp) {
      return rightTimestamp - leftTimestamp;
    }

    return right.artifact.reviewedIntentId.localeCompare(left.artifact.reviewedIntentId);
  });

  return resumableDrafts[0] ?? null;
}

export async function updateReviewedIntentDraftStatus(input: {
  loadedConfig: LoadedConfig;
  reviewedIntentId: string;
  status: ReviewedIntentArtifact["status"];
}): Promise<{
  artifact: ReviewedIntentArtifact;
  paths: ReviewedIntentDraftPaths;
}> {
  const { artifact, paths } = await loadReviewedIntentDraft(input);
  const nextArtifact: ReviewedIntentArtifact = {
    ...artifact,
    status: input.status,
    updatedAt: new Date().toISOString()
  };

  await writeJsonFile(paths.draftPath, nextArtifact);

  return {
    artifact: nextArtifact,
    paths
  };
}

export async function replaceReviewedIntentDraft(input: {
  loadedConfig: LoadedConfig;
  reviewedIntentId: string;
  prompt: string;
  normalizedIntent: NormalizedIntent;
  requestedSourceIds?: string[];
  resumeIssue?: string;
  status?: ReviewedIntentArtifact["status"];
}): Promise<{
  artifact: ReviewedIntentArtifact;
  paths: ReviewedIntentDraftPaths;
}> {
  const { artifact, paths } = await loadReviewedIntentDraft({
    loadedConfig: input.loadedConfig,
    reviewedIntentId: input.reviewedIntentId
  });

  const nextArtifact: ReviewedIntentArtifact = {
    ...artifact,
    status: input.status ?? "draft",
    updatedAt: new Date().toISOString(),
    prompt: input.prompt,
    requestedSourceIds: input.requestedSourceIds,
    resumeIssue: input.resumeIssue,
    normalizedIntent: {
      ...input.normalizedIntent,
      intentId: input.reviewedIntentId
    }
  };

  await writeJsonFile(paths.draftPath, nextArtifact);

  return {
    artifact: nextArtifact,
    paths
  };
}