import path from "node:path";
import { promises as fs } from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { ensureDirectory } from "../shared/fs";

export interface PixelDiffResult {
  diffPixels: number;
  diffRatio: number;
  width: number;
  height: number;
  outputPath?: string;
  note?: string;
}

export async function generatePixelDiff(
  baselinePath: string,
  currentPath: string,
  outputPath: string,
  threshold: number,
  writeDiffImage: boolean
): Promise<PixelDiffResult> {
  const baselineBuffer = await fs.readFile(baselinePath);
  const currentBuffer = await fs.readFile(currentPath);
  const baseline = PNG.sync.read(baselineBuffer);
  const current = PNG.sync.read(currentBuffer);

  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      diffPixels: Math.max(baseline.width, current.width) * Math.max(baseline.height, current.height),
      diffRatio: 1,
      width: Math.max(baseline.width, current.width),
      height: Math.max(baseline.height, current.height),
      note: "Image dimensions differ; diff image was not generated."
    };
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const diffPixels = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold }
  );

  if (writeDiffImage) {
    await ensureDirectory(path.dirname(outputPath));
    await fs.writeFile(outputPath, PNG.sync.write(diff));
  }

  return {
    diffPixels,
    diffRatio: diffPixels / (baseline.width * baseline.height),
    width: baseline.width,
    height: baseline.height,
    outputPath: writeDiffImage ? outputPath : undefined
  };
}