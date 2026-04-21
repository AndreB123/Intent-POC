import { LoadedConfig } from "../config/load-config";
import { createReviewedIntentDraftPaths, ReviewedIntentDraftPaths } from "../evidence/paths";
import { readJsonFile, writeJsonFile } from "../shared/fs";
import { NormalizedIntent, ReviewedIntentArtifact } from "./intent-types";

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