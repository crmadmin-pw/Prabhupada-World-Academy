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

## Functional repair workflow

### Catch-up capture while Zite remains writable

The September 23 catch-up authorization differs from the original migration:
Zite wins business-data conflicts, while current roles, permissions, login
identities, and current-only records remain protected. LLP remains excluded;
legacy push subscriptions remain archive-only. Do not reuse the original
current-wins planner as an incremental source-wins importer.

`finalizeCatchupCapture.ts` is **offline only**. It combines previously exported
1,000-row keyset pages, rejects duplicate/missing pages and LLP tables, and
produces checksummed source files plus exact-email identity/collision reports.
It does not plan or execute database writes.

```bash
node --import tsx scripts/zite-firestore-migration/finalizeCatchupCapture.ts <catchup-run-dir>
node --import tsx scripts/zite-firestore-migration/snapshotAttachments.ts <catchup-run-dir>
node --import tsx --test tests/zite-catchup-capture.test.ts tests/zite-firestore-migration.test.ts
```

Inputs are `zite/capture-start.json`, `zite/page-index.json`, source page files,
and a fresh `firestore/manifest.json` with its Users snapshot. A page index must
contain exactly the 49 non-LLP tables, with `name`, `page` (page count), and
`count` for each table; source pages are named `<safe-table-name>-0000.jsonl`.
The capture-start file records `startedAt` and `replayFrom`.

With Zite still accepting writes, this is not a simultaneous point-in-time
snapshot or a final cut-over. Replay from the **capture start**, not its end,
on the next catch-up to cover writes made during pagination. Resolve new
identity/access decisions with the operator before importing affected data.

### Guarded catch-up pass

The incremental pass tools consume the private capture directory plus a pass
directory containing explicit identity decisions, a fresh Firestore/Auth
snapshot, refreshed source schema, and overlapping source deltas. They do not
change Zite or Firebase Auth, delete destination documents, merge by phone, or
change existing public USER numbers.

```bash
node --import tsx scripts/zite-firestore-migration/planCatchup.ts <capture-dir> <pass-dir>
node --import tsx scripts/zite-firestore-migration/executeCatchup.ts <pass-dir> migration-catchup-0923 prepare-rehearsal <plan-hash>
node --import tsx scripts/zite-firestore-migration/executeCatchup.ts <pass-dir> migration-catchup-0923 apply-rehearsal <plan-hash>
node --import tsx scripts/zite-firestore-migration/executeCatchup.ts <pass-dir> migration-catchup-0923 verify <plan-hash>
node --import tsx scripts/zite-firestore-migration/verifyCatchupFunctional.ts <pass-dir> migration-catchup-0923
node --import tsx scripts/zite-firestore-migration/verifyCatchupIdempotency.ts <pass-dir>
```

Only after the explicit source-wins authorization, a verified restore,
review-free plan, successful rehearsal/read-back, functional replay, and zero
operational changes on repeated planning:

```bash
node --import tsx scripts/zite-firestore-migration/executeCatchup.ts <pass-dir> '(default)' apply-production <plan-hash>
node --import tsx scripts/zite-firestore-migration/executeCatchup.ts <pass-dir> '(default)' verify <plan-hash>
node --import tsx scripts/zite-firestore-migration/verifyCatchupFunctional.ts <pass-dir> '(default)'
```

Incoming profile creation uses a transaction that rechecks current emails and
public USER numbers. Updates have read-back-checked before-values and live
update-time preconditions. A concurrent write stops its atomic batch. Re-running
the exact approved plan rechecks current state, skips already-matching writes,
and preserves new login activity; it must not bypass a changed business field.
Immutable `_MigrationCatchupHistory` records preserve the source and preimage
before operational changes. Raw typed preimages and append-only commit
journals are also saved privately in the pass directory.

Functional verification reads database documents, then replays the real local
profile/login/history/Guide handlers with **all model writes intercepted**.
It is not proof of an authenticated browser Google sign-in. Malformed source
detail JSON is retained verbatim and reported, never silently repaired or lost.
The first pass uses the original migration baseline; later passes must retain
overlap while Zite remains writable. No scheduler or final cut-off is implied.

### Original functional repair

The post-migration functional audit found relationship fields that were copied
as legacy display values instead of canonical destination document IDs. Repair
planning and rehearsal use a separate, production-disabled workflow:

```bash
node --import tsx scripts/zite-firestore-migration/snapshotFirebaseAuth.ts <repair-run-dir>
node --import tsx scripts/zite-firestore-migration/planFunctionalRepair.ts <base-run-dir> <repair-run-dir>
node --import tsx scripts/zite-firestore-migration/verifyFunctionalRepair.ts <repair-run-dir>
node --import tsx scripts/zite-firestore-migration/exportFirestore.ts <repair-run-dir> <gs://backup-prefix>
node --import tsx scripts/zite-firestore-migration/restoreFirestoreExport.ts <rehearsal-db> <gs://backup-prefix> [evidence-file]
node --import tsx scripts/zite-firestore-migration/rebaseFunctionalRepairForRehearsal.ts <repair-run-dir> <rehearsal-db> <repair-run-id> <source-plan-hash>
node --import tsx scripts/zite-firestore-migration/applyFunctionalRepair.ts <repair-run-dir> <rehearsal-db> <repair-run-id> <source-plan-hash> --execute --rehearsal
node --import tsx scripts/zite-firestore-migration/verifyAppliedFunctionalRepair.ts <repair-run-dir> <rehearsal-db> <repair-run-id> <source-plan-hash>
```

`applyFunctionalRepair.ts` has no production mode and rejects `(default)`.
Managed Firestore import changes document update times, so the source plan is
never weakened or edited: `rebaseFunctionalRepairForRehearsal.ts` first verifies
every captured before-value and then creates a database-bound rehearsal plan.

`snapshotWriter.mjs` and `mergeSnapshotDelta.mjs` are transport helpers used by the read-only Zite extraction. The source snapshot must use a fixed `T0`, followed by a bounded delta merge through that watermark.

## Apply prerequisites

Do not run the production apply path until all of these are true:

1. Every manual-review row and unresolved edge has an approved disposition.
2. A restorable managed Firestore export exists and has been restore-rehearsed.
3. The staged apply passes endpoint, report, role-login, count, checksum, relationship, attachment, and idempotency checks.
4. The final approved role manifest matches the live destination immediately before apply.
