/* eslint-disable @typescript-eslint/no-explicit-any -- verification manifests are external JSON evidence */
import path from 'node:path';
import { canonicalJson, readJson, sha256, writeJson } from './common';

function main(): void {
  const [targetRunArg, evidenceArg] = process.argv.slice(2);
  if (!targetRunArg || !evidenceArg) throw new Error('Usage: attachBackupVerification.ts <target-run-dir> <verified-backup-evidence.json>');
  const targetRun = path.resolve(targetRunArg);
  const sourceEvidencePath = path.resolve(evidenceArg);
  const evidence = readJson<any>(sourceEvidencePath);
  const unsignedEvidence = { ...evidence };
  delete unsignedEvidence.checksum;
  if (evidence.kind !== 'firestore-backup-restore-verification' || evidence.checksum !== sha256(canonicalJson(unsignedEvidence))) {
    throw new Error('Backup verification evidence checksum is invalid');
  }
  const manifestPath = path.join(targetRun, 'firestore', 'manifest.json');
  const manifest = readJson<any>(manifestPath);
  if (manifest.databaseId !== evidence.sourceDatabaseId) throw new Error('Backup source database does not match target snapshot');
  const outputEvidence = {
    ...evidence,
    attachedToSnapshotAt: new Date().toISOString(),
    targetSnapshotChecksumBeforeAttachment: manifest.checksum,
    note: 'Restore-rehearsed backup captured before the final pre-migration snapshot; destination preconditions protect intervening live changes.',
  };
  const relativeEvidence = 'backup-verification.json';
  writeJson(path.join(targetRun, 'firestore', relativeEvidence), outputEvidence);
  const unsignedManifest = { ...manifest };
  delete unsignedManifest.checksum;
  const updated = {
    ...unsignedManifest,
    managedBackupVerified: true,
    backupVerificationFile: relativeEvidence,
    backupVerificationChecksum: evidence.checksum,
  };
  writeJson(manifestPath, { ...updated, checksum: sha256(canonicalJson(updated)) });
  process.stdout.write(`${JSON.stringify({ managedBackupVerified: true, outputUriPrefix: evidence.outputUriPrefix, evidenceChecksum: evidence.checksum }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
