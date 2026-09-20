import path from "node:path";
import { captureFinalBackup } from "./final-backup.js";

function args(values: readonly string[]): Record<string, string> {
  if (values.length % 2 !== 0) throw new TypeError("Arguments must be --name value pairs");
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value) throw new TypeError("Arguments must be --name value pairs");
    result[name.slice(2)] = value;
  }
  return result;
}
function required(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (!value) throw new TypeError(`Missing --${name}`);
  return path.resolve(value);
}

try {
  const values = args(process.argv.slice(2));
  const result = captureFinalBackup([
    { id: "datastore", kind: "datastore", sourcePath: required(values, "datastore") },
    { id: "legacy-cognition", kind: "legacy-cognition", sourcePath: required(values, "cognition") },
    { id: "legacy-site-profiles", kind: "legacy-site-profiles", sourcePath: required(values, "profiles") },
    ...(values.resolutions ? [{ id: "resolution-manifest", kind: "resolution-manifest" as const, sourcePath: required(values, "resolutions") }] : []),
  ], required(values, "output"));
  process.stdout.write(`${JSON.stringify({ status: "captured", evidence: result.evidencePath, snapshot: result.evidence.snapshot }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
