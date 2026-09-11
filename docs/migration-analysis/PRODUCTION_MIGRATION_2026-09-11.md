# Zite to Firestore production migration

Status: **storage migration complete; functional repair pending production approval**

The original write/read-back verification below proves storage-level delivery,
not application-level relationship integrity. A later read-only functional
audit found canonical-ID and access-continuity gaps. The repair has passed an
isolated rehearsal, but no repair writes have been made to production.

- Production run: `mig_634969d4291d52ed01beb0b8`
- Zite active-row watermark: `2026-09-11T00:54:54Z`
- Active non-LLP source rows: 20,625
- Production writes committed: 61,370
- Production writes read back and verified: 61,370
- Missing or mismatched writes: 0
- Operational creates: 14,082
- Operational enrichments: 6,037
- Immutable archive records: 20,625
- Immutable mapping-ledger records: 20,625
- Active Firestore users after migration: 236
- New normal-user documents: 216, all forced to role `User` with permission flags off
- Existing-user enrichments: 15; protected roles, status, segment, Auth IDs, and permission flags were unchanged
- Privileged-role manifest unchanged: yes
- LLP source rows written: 0
- Delete operations: 0
- Legacy Zite push subscriptions written operationally: 0

## Identity corrections

- `arap@hkmmumbai.org`: Arjunacharya Das (existing role retained)
- `vbmd@hkmmumbai.org`: Vaibhav Mohan Das (existing role retained)

## Backup and rehearsal

- Restore-rehearsed backup: `gs://bvpw108-firestore-migration-backups-20260910/pre-migration/20260910T182306Z`
- Backup objects: 58
- Backup bytes: 7,032,329
- Full isolated rehearsal: 61,367/61,367 writes verified before production
- Temporary Firestore databases were deleted after production verification; only `(default)` remains
- The backup export is retained for recovery and possible future PITR reconciliation

## Limitations retained by policy

- Zite soft-deleted rows were unavailable through the active-row export. They were not recreated or written as active application data.
- 157 active rows with unavailable required targets and 28 malformed active rows were preserved archive-only.
- Three optional unresolved links were omitted from operational fields and retained as archive/reconciliation limitations.
- A future Point-in-Time Restore or administrative export can be reconciled into archive-only history if required.

## Evidence

- Final plan: `runs/20260910T174452Z/production-cutover/dry-run/reconciliation-summary.json`
- Independent plan verification: `runs/20260910T174452Z/production-cutover/dry-run/verification.json`
- Apply checkpoint: `runs/20260910T174452Z/production-cutover/apply/_default_.json`
- Production read-back verification: `runs/20260910T174452Z/production-cutover/apply/_default_-verification.json`
- Backup restore verification: `runs/20260910T174452Z/firestore/backup-verification.json`

The production executor was rerun after completion and exited successfully from its completed checkpoint without issuing additional writes, confirming resumable idempotent behavior.
