import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function readEnvironmentFile(filePath: string): Record<string, string> {
  try {
    return dotenv.parse(fs.readFileSync(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function loadServerEnvironment(
  rootDir: string,
  processEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const defaults = {
    ...readEnvironmentFile(path.join(rootDir, ".env")),
    ...readEnvironmentFile(path.join(rootDir, ".env.local")),
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (processEnvironment[key] === undefined) processEnvironment[key] = value;
  }

  return processEnvironment;
}
