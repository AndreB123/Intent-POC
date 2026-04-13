import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return hashBuffer(buffer);
}