import path from "node:path";
import os from "node:os";

export function expandHome(filePath: string): string {
  if (!filePath.startsWith("~")) return filePath;
  return path.join(os.homedir(), filePath.slice(1));
}
