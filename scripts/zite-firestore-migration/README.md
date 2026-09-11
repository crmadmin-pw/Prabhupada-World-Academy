# Zite to Firestore migration tooling

This directory replaces the legacy `mergeZyteAndFirestore.ts` path for the data-continuity migration. The legacy script is not safe for this migration because it can match users by phone, allow newer Zite values to overwrite current values, and lacks the role, LLP, archive, and precondition firewalls.

The workflow is intentionally split into snapshot, planning, independent verification, guarded apply, and post-apply verification stages. `applyMigration.ts` is the only script in this directory that can write to Firestore; it requires an approval-ready plan, exact run ID, verified managed backup, frozen live role manifest, explicit `--execute`, and an additional `--production` flag for the default database.

## Guardrails

- All `LLP*` tables are rejected before row export and must produce zero planned writes.
- Users match automatically only by a unique normalized email.
- Current user roles, statuses, auth aliases, segment, and permission flags are protected.
- A Zite-only user is always created with `role: User` and all permission flags false.
- Legacy Zite push subscriptions are archive-only; their credentials never enter operational `PushSubscriptions`.
- Current nonempty fields win every conflict.
- Every update carries the destination document's captured `updateTime` precondition.
- Every non-LLP source row gets an immutable archive record and ID-ledger record.
- Rows whose required targets are unavailable in the active-row view are an
  archive-only limitation and do not recreate those targets. Other malformed
  active rows with absent required links are also preserved archive-only rather
  than creating incomplete operational documents.
- Soft-deleted records unavailable from Zite's active-row interface are a
  documented limitation, not a migration blocker. They are never recreated or
  written as active data; a future PITR/admin export may be reconciled into
  archive-only history.
- The apply tool uses create/update preconditions, phase barriers, bounded commits, and a durable resume checkpoint.
- Operator-confirmed display names are keyed by exact normalized email in
  `CANONICAL_USER_NAMES_BY_EMAIL`; this affects names only and cannot grant a
  role or permission flag.

## Local commands

The run directory contains private source and destination snapshots and is ignored by git.

```bash
node --import tsx scripts/zite-firestore-migration/buildZiteManifest.ts <run-dir> <T0> <capture-start>
node --import tsx scripts/zite-firestore-migration/snapshotFirestore.ts <run-dir>
node --import tsx scripts/zite-firestore-migration/snapshotAttachments.ts <run-dir>
node --import tsx scripts/zite-firestore-migration/verifyRestoredFirestore.ts <run-dir> <restored-db> <bucket> <prefix> <export-op> <import-op>
node --import tsx scripts/zite-firestore-migration/restoreFirestoreExport.ts <temporary-database-id> <gs://verified-export-prefix>
node --import tsx scripts/zite-firestore-migration/attachBackupVerification.ts <final-run-dir> <verified-backup-evidence.json>
node --import tsx scripts/zite-firestore-migration/planMigration.ts <run-dir>
node --import tsx scripts/zite-firestore-migration/verifyDryRun.ts <run-dir>
node --import tsx scripts/zite-firestore-migration/applyMigration.ts <run-dir> <database-id> <run-id> --execute (--rehearsal|--production)
node --import tsx scripts/zite-firestore-migration/verifyAppliedMigration.ts <run-dir> <database-id> <run-id>
```

`snapshotWriter.mjs` and `mergeSnapshotDelta.mjs` are transport helpers used by the read-only Zite extraction. The source snapshot must use a fixed `T0`, followed by a bounded delta merge through that watermark.

## Apply prerequisites

Do not run the production apply path until all of these are true:

1. Every manual-review row and unresolved edge has an approved disposition.
2. A restorable managed Firestore export exists and has been restore-rehearsed.
3. The staged apply passes endpoint, report, role-login, count, checksum, relationship, attachment, and idempotency checks.
4. The final approved role manifest matches the live destination immediately before apply.
