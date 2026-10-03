# Zite catch-up migration — October 1, 2026

Applied to project `bvpw108`, Firestore `(default)`, at **13:01:19 UTC**.
Production verification completed at **13:03:26 UTC**; the server-side receipt
was committed at **13:04:42 UTC**.

| Collection | Added | Updated |
| --- | ---: | ---: |
| SadhanaEntries | 407 | 14 |
| BvslPreachingEntries | 33 | 0 |
| TagMangoSyncLog | 56 | 0 |
| Total operational changes | 496 | 14 |

The 14 overlapping Sadhana entries use Zite's values, as explicitly requested.
Existing document IDs, entry IDs, owners, and relationships were retained.
The affected Sadhana records cover 57 people and September 20–October 1.
Two other source entries in the overlapping replay window already matched.

All **908 records across nine service-related tables** were already mapped and
present. No service changes were needed. All 49 mapped non-LLP source tables
were examined, comprising 22,276 active source rows. The previous completed
catch-up was September 23; replay overlapped from `2026-09-23T05:59:33Z`.

## Data preservation

- All pre-existing records in the three changed collections remain present.
- Two new-app Sadhana entries created during this work were preserved. Final
  observed totals: 14,654 Sadhana entries, 2,888 preaching entries, and 1,157
  sync-log records.
- No existing profiles, roles, permissions, Auth accounts, app counters, or
  operational push subscriptions were written by the migration. All 58 Auth
  identities and 68 notification subscriptions passed preservation checks.
- Normal app activity updated one login timestamp and one streak timestamp;
  those changes were retained.
- Imported Sadhana and preaching entries use deterministic IDs beginning with
  `ZITE-ENTRY-` and `ZITE-BV-ENTRY-`. Original source numbers are retained in
  `legacyEntryId`. This avoids collisions with both apps' sequential counters;
  137 incoming Sadhana numbers would otherwise have collided with existing
  entry numbers. Existing destination entry IDs were not renumbered.
- Imported dates use `YYYY-MM-DD`, matching exact-date submission queries and
  inclusive missing-Sadhana report queries.
- 587 immutable source-history records preserve source versions and preimages.
- No Zite writes, destination deletes, account merges, or application deployment
  were performed. LLP remained excluded; legacy push data remained archive-only.

## Verification

A managed production export containing 67,886 documents was restored into the
fresh isolated database `migration-catchup-20261001`. The selected migration
inventory of 62,990 documents passed restored collection-count checks.

Rehearsal and production both matched **1,097 of 1,097 planned writes**.
Replanning the verified rehearsal produced **zero operational writes**.
Production database reads were replayed through the real local application
handlers with model writes and email delivery intercepted:

- 243 registered profile/login routes checked.
- All 421 affected Sadhana entries passed history, detail, and submission-status
  checks.
- All 413 affected entries whose owners are eligible for the missing-Sadhana
  report appeared as filled or late, rather than missed. The other eight are
  outside that report's current membership eligibility.
- Guide visibility checks passed for nine Guide accounts.
- No source-detail JSON warnings or functional errors were found.

These are database and handler checks, not an authenticated browser sign-in test.

## Existing limitations and continuing writes

118 older Sadhana source records lack resolvable owners and remain archive-only.
All 118 were already archived before this pass; none changed since the last
catch-up. Two source Users rows lack email identities and remain excluded from
operational account creation. No ownership was guessed or deleted identity
recreated.

Source capture began at `2026-10-01T12:30:56.290Z`. A live recheck at
`2026-10-01T12:56:13.909Z` found no additional business-table changes during
capture; the only source change was an existing user's login timestamp.
Zite remains writable. This is a completed catch-up pass, not a final cutover
or an automatic synchronization service. Future source writes need another pass;
retain overlap from the capture start.

## Audit artifacts

Run: `catchup_22e6478f55d88f15b5b5a133`.

Plan SHA-256:
`4aa1e731541f6d8db208af8138a38f1ce881ec331a288f8e9c7433ae53ab0bb9`.

Private snapshots, row-level comparisons, source mappings, backup evidence,
commit journals, and verification reports are under the git-ignored directory
`docs/migration-analysis/runs/20261001T123100Z-catchup/`.
The pass directory is `pass/`; the completion receipt is
`pass/completion-receipt.json`. A matching checkpoint is stored in
`_MigrationCatchupRuns/catchup_22e6478f55d88f15b5b5a133`.
