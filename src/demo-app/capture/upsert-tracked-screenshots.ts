import path from "node:path";
import { CaptureOutcome } from "../../capture/capture-target";
import { CaptureItemConfig } from "../../config/schema";
import { copyFile } from "../../shared/fs";

export function getCaptureItemOutputRelativePath(item: CaptureItemConfig): string {
  return item.relativeOutputPath ?? `${item.id}.png`;
}

export async function upsertTrackedScreenshots(input: {
  captures: CaptureOutcome[];
  captureItems: CaptureItemConfig[];
  trackedRoot: string;
}): Promise<string[]> {
  const captureItemsById = new Map(input.captureItems.map((item) => [item.id, item]));
  const updatedFiles: string[] = [];

  for (const capture of input.captures) {
    if (capture.status !== "captured") {
      continue;
    }

    const captureItem = captureItemsById.get(capture.captureId);
    if (!captureItem) {
      throw new Error(`Tracked screenshot destination is not configured for capture '${capture.captureId}'.`);
    }

    const destinationPath = path.resolve(input.trackedRoot, getCaptureItemOutputRelativePath(captureItem));
    await copyFile(capture.outputPath, destinationPath);
    updatedFiles.push(destinationPath);
  }

  return updatedFiles.sort();
}