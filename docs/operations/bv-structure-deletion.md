# Bhakti Vriksha hard deletion

`hardDeleteBvGroups` requires the active user's server-derived `*` capability,
both in the API route policy and in the handler. Capability derivation grants
this only to an exact normalized `SUPER_ADMIN` role or the stored boolean
`isBvSuperAdmin === true`. Supervisor, Superviser, Super Guide, and Admin titles
alone do not qualify.

The client SDK prompts the person to type `DELETE BV GROUPS`, with an explicit
warning about the selected or complete deletion scope. Cancellation and any
nonexact input stop the request. Direct API clients must supply the exact
`confirmationPhrase` themselves; the server never defaults it. There is no
existing wipe button in the application.

Each authorized, confirmed operation first creates `auditLogs/{auditId}` with
the verified Firebase UID, profile ID, email, scope, selectors, and server time.
Deletion uses direct Admin SDK writes, without the table adapter's memory
fallback. Each batch of up to 400 deletions commits atomically with an immutable
`auditLogs/{auditId}/batches/{batchNumber}` receipt listing the deleted document
paths. A failed audit write therefore prevents that batch's deletions. Existing
default-deny Firestore rules keep the audit collection server-only.

The parent record ends with `completed` and group/membership counts, or
`failed_or_partial`. A terminated process can leave `started`. For interrupted
operations, inspect the committed batch receipts to determine exactly which
documents were removed; a network error can arrive after a successful commit.
The successful API response includes `auditId`. Audit receipts are not backups.

Full deletion includes all groups and memberships observed when planning,
including orphan memberships. Selected deletion preserves unrelated groups and
matches membership references against document IDs and legacy group IDs.
Snapshot update-time preconditions reject changes to planned documents. The
operation is atomic per batch, not across the entire structure, and does not
lock concurrent group or membership creation. Other collections are outside
this endpoint's scope.

Local verification:

```sh
npx tsx --test tests/hard-delete-bv-groups.test.ts tests/security-policy.test.mjs
npm run typecheck
```

The deletion tests use an isolated database double and never delete live data.
