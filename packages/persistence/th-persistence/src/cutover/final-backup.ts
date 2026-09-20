import fs from "node:fs";
import path from "node:path";
import {
  captureRehearsalSnapshot,
  rawFileSha256,
  type RehearsalSnapshotManifest,
  type RehearsalSnapshotSource,
} from "./snapshot.js";

export interface FinalBackupCaptureEvidence {
  readonly format: "p6-final-backup-capture-v1";
  readonly capturedAt: string;
  readonly snapshot: {
    readonly snapshotId: string;
    readonly manifestPath: string;
    readonly manifestSha256: string;
    readonly files: number;
    readonly allBeforeCopyAfterHashesMatch: boolean;
  };
  readonly execution: {
    readonly cloneRestore: false;
    readonly preflightImport: false;
    readonly rehearsal: false;
    readonly liveMutation: "none";
  };
}

export interface FinalBackupCapture {
  readonly manifest: RehearsalSnapshotManifest;
  readonly evidencePath: string;
  readonly evidence: FinalBackupCaptureEvidence;
}

/**
 * Captures a create-new immutable live backup. It intentionally does not
 * restore clones, run preflight, import data, or invoke the rehearsal runner.
 */
export function captureFinalBackup(
  sources: readonly RehearsalSnapshotSource[],
  outputRootInput: string,
): FinalBackupCapture {
  const outputRoot = path.resolve(outputRootInput);
  if (fs.existsSync(outputRoot)) {
    throw new Error(`Final backup output must not already exist: ${outputRoot}`);
  }
  const manifest = captureRehearsalSnapshot(sources, outputRoot);
  const manifestPath = path.join(outputRoot, "snapshot-manifest.json");
  const evidence: FinalBackupCaptureEvidence = {
    format: "p6-final-backup-capture-v1",
    capturedAt: new Date().toISOString(),
    snapshot: {
      snapshotId: manifest.snapshotId,
      manifestPath,
      manifestSha256: rawFileSha256(manifestPath),
      files: manifest.files.length,
      allBeforeCopyAfterHashesMatch: manifest.files.every((file) =>
        file.sourceSha256Before === file.copySha256 && file.copySha256 === file.sourceSha256After),
    },
    execution: {
      cloneRestore: false,
      preflightImport: false,
      rehearsal: false,
      liveMutation: "none",
    },
  };
  const evidencePath = path.join(outputRoot, "final-backup-evidence.json");
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { manifest, evidencePath, evidence };
}
