import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSnapshotArtifactBindingUnchanged, captureFinalLiveSourceVerification,
  capturePonrAuditBinding, captureSnapshotArtifactBinding, verifyFinalLiveSourcesNow,
  verifyRehearsalEvidenceBindings, type RehearsalEvidenceBindings,
} from './evidence-bindings.js';
import { captureRehearsalSnapshot, rawFileSha256 } from './snapshot.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-evidence-'));
  directories.push(root);
  const datastore = path.join(root, 'live', 'data.json');
  const cognition = path.join(root, 'live', '.cognition');
  const profiles = path.join(root, 'live', '.site-profiles');
  const resolution = path.join(root, 'live', 'resolution.json');
  fs.mkdirSync(cognition, { recursive: true });
  fs.mkdirSync(profiles, { recursive: true });
  fs.writeFileSync(datastore, '{"value":1}\n');
  fs.writeFileSync(path.join(cognition, 'episodes.json'), '[]\n');
  fs.writeFileSync(path.join(cognition, 'semantic.json'), '[{"id":"one"}]\n');
  fs.writeFileSync(path.join(cognition, 'q-values.json'), '{}\n');
  fs.writeFileSync(path.join(profiles, 'example.com.json'), '{"name":"Example"}\n');
  fs.writeFileSync(resolution, '{"format":"fixture"}\n');
  const snapshotRoot = path.join(root, 'rehearsal', 'snapshot');
  captureRehearsalSnapshot([
    { id: 'datastore', kind: 'datastore', sourcePath: datastore },
    { id: 'legacy-cognition', kind: 'legacy-cognition', sourcePath: cognition },
    { id: 'legacy-site-profiles', kind: 'legacy-site-profiles', sourcePath: profiles },
    { id: 'resolution-manifest', kind: 'resolution-manifest', sourcePath: resolution },
  ], snapshotRoot);
  const auditPath = path.join(root, 'rehearsal', 'success-clone', 'p6-ponr-audit.jsonl');
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(auditPath, '{"state":"LIVE_POST_PONR","outcome":"accepted"}\n');
  return { root, datastore, cognition, snapshotRoot, auditPath };
}

function bindings(target: ReturnType<typeof fixture>): RehearsalEvidenceBindings {
  const snapshot = captureSnapshotArtifactBinding(target.snapshotRoot);
  return {
    snapshot: snapshot.binding,
    finalLiveSourceVerification: captureFinalLiveSourceVerification(snapshot.manifest),
    ponrAudit: capturePonrAuditBinding(target.auditPath),
  };
}

describe('P6 rehearsal evidence bindings', () => {
  it('captures every designated live file and verifies all bindings', () => {
    const target = fixture();
    const value = bindings(target);
    expect(value.finalLiveSourceVerification).toMatchObject({
      snapshotId: value.snapshot.snapshotId,
      allMatchSnapshotBefore: true,
    });
    expect(value.finalLiveSourceVerification.files).toHaveLength(6);
    expect(value.snapshot.manifestSha256).toBe(rawFileSha256(value.snapshot.manifestPath));
    expect(value.ponrAudit?.auditSha256).toBe(rawFileSha256(target.auditPath));
    expect(() => verifyRehearsalEvidenceBindings(value)).not.toThrow();
  });

  it('rejects a live source changed after snapshot capture', () => {
    const target = fixture();
    const snapshot = captureSnapshotArtifactBinding(target.snapshotRoot);
    fs.writeFileSync(target.datastore, '{"value":2}\n');
    const value: RehearsalEvidenceBindings = {
      snapshot: snapshot.binding,
      finalLiveSourceVerification: captureFinalLiveSourceVerification(snapshot.manifest),
      ponrAudit: capturePonrAuditBinding(target.auditPath),
    };
    expect(value.finalLiveSourceVerification.allMatchSnapshotBefore).toBe(false);
    expect(() => verifyRehearsalEvidenceBindings(value)).toThrow('did not match snapshot-before hashes');
  });

  it('fails when a designated live source is missing at final verification', () => {
    const target = fixture();
    const snapshot = captureSnapshotArtifactBinding(target.snapshotRoot);
    fs.rmSync(path.join(target.cognition, 'semantic.json'));
    expect(() => captureFinalLiveSourceVerification(snapshot.manifest)).toThrow();
  });

  it('fails when the final live-source inventory contains an added file', () => {
    const target = fixture();
    const snapshot = captureSnapshotArtifactBinding(target.snapshotRoot);
    fs.writeFileSync(path.join(target.cognition, 'added.json'), '{}\n');
    expect(() => captureFinalLiveSourceVerification(snapshot.manifest))
      .toThrow('file inventory does not match the snapshot manifest');
  });

  it('detects snapshot manifest tampering after binding', () => {
    const target = fixture();
    const value = bindings(target);
    fs.appendFileSync(value.snapshot.manifestPath, ' ');
    expect(() => verifyRehearsalEvidenceBindings(value)).toThrow('Snapshot manifest SHA-256 binding mismatch');
  });

  it('rejects a snapshot manifest changed between initial binding and finalization', () => {
    const target = fixture();
    const initial = captureSnapshotArtifactBinding(target.snapshotRoot);
    fs.appendFileSync(initial.binding.manifestPath, ' ');
    const final = captureSnapshotArtifactBinding(target.snapshotRoot);
    expect(() => assertSnapshotArtifactBindingUnchanged(initial.binding, final.binding))
      .toThrow('Snapshot manifest changed during rehearsal');
  });

  it('detects PONR audit tampering after binding', () => {
    const target = fixture();
    const value = bindings(target);
    fs.appendFileSync(target.auditPath, '{"tampered":true}\n');
    expect(() => verifyRehearsalEvidenceBindings(value)).toThrow('PONR audit SHA-256 binding mismatch');
  });

  it('requires a PONR audit binding for PASS verification by default', () => {
    const target = fixture();
    const value = { ...bindings(target), ponrAudit: null };
    expect(() => verifyRehearsalEvidenceBindings(value)).toThrow('PONR audit binding is required');
    expect(() => verifyRehearsalEvidenceBindings(value, false)).not.toThrow();
  });

  it('keeps historical bindings verifiable after live state changes', () => {
    const target = fixture();
    const snapshot = captureSnapshotArtifactBinding(target.snapshotRoot);
    const value = bindings(target);
    fs.writeFileSync(target.datastore, '{"value":2}\n');

    expect(() => verifyRehearsalEvidenceBindings(value)).not.toThrow();
    expect(() => verifyFinalLiveSourcesNow(snapshot.manifest, value.finalLiveSourceVerification))
      .toThrow('Current live source differs from final verification');
  });
});
