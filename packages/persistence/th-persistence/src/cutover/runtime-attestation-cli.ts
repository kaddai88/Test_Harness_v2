import path from "node:path";
import {
  captureRuntimeArtifactManifest,
  verifyRuntimeArtifact,
  writeRuntimeArtifactManifest,
  writeRuntimeAttestation,
} from "./runtime-attestation.js";

function args(values: readonly string[]): Record<string, string> {
  if (values.length % 2 !== 0) throw new TypeError("Arguments must be --name value pairs");
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]; const value = values[index + 1];
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
function spec(values: Record<string, string>) {
  const provider = values.provider;
  const topology = values.topology;
  if (provider !== "node" || topology !== "single-process") throw new TypeError("Only provider=node and topology=single-process are supported");
  return { runtimeRoot: required(values, "runtime-root"), entrypoint: values.entrypoint ?? "", provider, topology, targetPath: required(values, "target-path") } as const;
}

try {
  const values = args(process.argv.slice(2));
  const operation = values.operation;
  if (operation === "capture") {
    const manifest = captureRuntimeArtifactManifest(spec(values));
    const output = writeRuntimeArtifactManifest(manifest, required(values, "output"));
    process.stdout.write(`${JSON.stringify({ status: "captured", manifest: output, artifactIdentity: manifest.artifactIdentity }, null, 2)}\n`);
  } else if (operation === "verify") {
    const attestation = verifyRuntimeArtifact(required(values, "manifest"), spec(values), values["artifact-id"] ?? "");
    const output = writeRuntimeAttestation(attestation, required(values, "output"));
    process.stdout.write(`${JSON.stringify({ status: "verified", evidence: output, artifactIdentity: attestation.artifactIdentity }, null, 2)}\n`);
  } else {
    throw new TypeError("--operation must be capture or verify");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
