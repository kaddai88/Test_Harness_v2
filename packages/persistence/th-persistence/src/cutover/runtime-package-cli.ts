import path from "node:path";
import {
  buildRuntimePackage,
  captureRuntimePackageManifest,
  verifyRuntimePackage,
  writeRuntimePackageAttestation,
  writeRuntimePackageManifest,
} from "./runtime-package.js";
import { rawFileSha256 } from "./snapshot.js";

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
function requiredValue(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (!value) throw new TypeError(`Missing --${name}`);
  return value;
}
function spec(values: Record<string, string>) {
  if (values.provider !== "node" || values.topology !== "single-process") {
    throw new TypeError("Only provider=node and topology=single-process are supported");
  }
  return {
    packageRoot: required(values, "package-root"),
    entrypoint: values.entrypoint ?? "",
    provider: "node" as const,
    topology: "single-process" as const,
    authorityDatastorePath: requiredValue(values, "authority-datastore"),
  };
}

try {
  const values = args(process.argv.slice(2));
  switch (values.operation) {
    case "package": {
      const packageRoot = buildRuntimePackage({ workspaceRoot: required(values, "workspace-root"), outputRoot: required(values, "output") });
      process.stdout.write(`${JSON.stringify({ status: "packaged", packageRoot, entrypoint: "dist/index.js" }, null, 2)}\n`);
      break;
    }
    case "capture": {
      const manifest = captureRuntimePackageManifest(spec(values));
      const output = writeRuntimePackageManifest(manifest, required(values, "output"));
      process.stdout.write(`${JSON.stringify({
        status: "captured",
        manifest: output,
        manifestSha256: rawFileSha256(output),
        artifactIdentity: manifest.artifactIdentity,
      }, null, 2)}\n`);
      break;
    }
    case "verify": {
      const attestation = verifyRuntimePackage(
        required(values, "manifest"),
        spec(values),
        requiredValue(values, "artifact-id"),
        requiredValue(values, "manifest-sha256"),
      );
      const output = writeRuntimePackageAttestation(attestation, required(values, "output"));
      process.stdout.write(`${JSON.stringify({ status: "verified", evidence: output, artifactIdentity: attestation.artifactIdentity }, null, 2)}\n`);
      break;
    }
    default:
      throw new TypeError("--operation must be package, capture, or verify");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
