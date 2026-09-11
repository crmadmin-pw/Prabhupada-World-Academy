# Zite to Current Application Data-Continuity Migration Strategy

Status: **Guarded implementation and zero-write dry-run completed; production apply blocked**  
Prepared: **2026-09-10 UTC**  
Zite source: **Prabhupada World Academy** (`1ab8f516ea1301be`)  
Current destination: Firebase project **bvpw108**, Firestore **(default)**, Standard edition, `nam5`

The user approved proceeding on 2026-09-10. That approval has been applied to safeguarded implementation and read-only dry-run work only. No production Firestore migration write, deployment, role change, or cutover has occurred.

## 1. Required outcome

The migration must produce one continuous history:

> Existing current application records + all non-LLP Zite history + future current-application activity

The current application remains the application of record. Its business logic, permissions, workflows, reports, and collection contracts are not redesigned. Migration adds data and migration provenance only.

Hard invariants:

1. No table whose name starts with `LLP` is exported into the migration input, matched, transformed, mapped, or written.
2. Current Gmail/account-email role assignments are authoritative.
3. Zite roles and permission-bearing flags never grant current privileges.
4. Current records win every field conflict; Zite fills only missing non-protected fields and contributes historical records.
5. No name-only automatic user merge is allowed.
6. Every source relationship is resolved through one deterministic ID ledger.
7. Every non-LLP Zite row is either merged, created, archived with provenance, or placed in manual review. Nothing is silently dropped.
8. Current-database records are never deleted by the migration.
9. Soft-deleted Zite records and deletion tombstones are audit/archive data only. They are never restored into operational collections and never affect application behavior.

## 2. Read-only preflight snapshot

The source contains **62 tables**:

- **49 non-LLP tables**, with approximately **20,570 visible records** at the latest read.
- **13 LLP tables**, with **42 visible records**, all excluded.

The source is still changing. `TagMango Sync Log` increased from 991 to 992 during this analysis. Counts in this document are therefore observations, not the final migration baseline. The execution must use a fixed snapshot watermark plus delta catch-up.

The current Firestore database had **20 `Users` documents** during the preflight. Fifteen match Zite users by exact normalized email. Five current users have no exact Zite user match and must remain untouched.

## 3. Authoritative protected role list

This is the current live `Users` role mapping observed during preflight. Matching is case-insensitive after trimming, but stored/current values are not overwritten.

| Gmail/account email | Current role | Final role |
|---|---|---|
| adpd@hkmmumbai.org | Guide | Guide |
| adrd@hkmmumbai.org | Guide | Guide |
| anhd@hkmmumbai.org | Guide | Guide |
| arap@hkmmumbai.org | Guide | Guide |
| asgd@hkmmumbai.org | Guide | Guide |
| ashteshk@outlook.com | Guide | Guide |
| ggud@hkmmumbai.org | Guide | Guide |
| gmnd@hkmmumbai.org | Super Guide | Super Guide |
| hnmd@hkmmumbai.org | Guide | Guide |
| hrvd@hkmmumbai.org | Super Admin | Super Admin |
| mmkd@hkmmumbai.org | Guide | Guide |
| mnkd@hkmmumbai.org | Guide | Guide |
| mtnd@hkmmumbai.org | Guide | Guide |
| rmtd@hkmmumbai.org | Guide | Guide |
| shnd@hkmmumbai.org | Guide | Guide |
| srgd@hkmmumbai.org | Guide | Guide |
| tvkd@hkmmumbai.org | Super Admin | Super Admin |
| urgd@hkmmumbai.org | Guide | Guide |
| vbmd@hkmmumbai.org | Guide | Guide |
| vdnd@hkmmumbai.org | Guide | Guide |

Observed role totals: **17 Guides, 1 Super Guide, 0 Admins, and 2 Super Admins**.

This list must be captured again from the destination immediately before the dry-run and frozen as the run's signed/checksummed `approved-role-map`. A migration must abort if its pre-write or post-write privileged email-to-role set differs from that manifest.

### 3.1 Role and permission firewall

For a matched current user:

- Preserve the current document ID, email/auth aliases, `role`, `status`, `segment`, and all current permission-bearing flags.
- Zite may fill only missing non-protected profile fields.
- Zite role/status history is retained under migration provenance, not applied as authorization.

For a Zite-only user:

- Create the operational user as `role: User`.
- Set every permission-bearing flag to `false` unless that exact email is in the approved manifest.
- Preserve the Zite lifecycle status (`Active`, `Inactive`, `Rejected`, or `Pending Approval`) because status is historical continuity, while ensuring it cannot restore an old privileged role.
- Preserve the original Zite role as historical metadata only.

Protected fields include at minimum:

`role`, `segment`, Firebase/auth IDs, `isBvAdmin`, `isBvSuperAdmin`, `isBvSupervisor`, `isBvMentor`, `isBvFacilitator`, `isBvSubFacilitator`, `isBvsl`, `isSadhanaMentor`, `isServiceAllocator`, `isCleanlinessManager`, `isFolkLead`, and `isTripCoordinator`.

The `Guides` collection is also an authorization surface because login resolution can detect active guide emails. Therefore:

- An existing approved Guide/Super Guide keeps the current `Guides` record and activity state.
- A Zite-only historical guide may be preserved in `Guides` for relationship/report resolution only with `isActive: false` and migration provenance.
- No Zite-only guide email may become an active `Guides` record.

### 3.2 Observed role conflicts

| Email | Current role | Zite role | Final role | Decision |
|---|---|---|---|---|
| adpd@hkmmumbai.org | Guide | User | Guide | Current wins |
| tvkd@hkmmumbai.org | Super Admin | User | Super Admin | Current wins |
| vdnd@hkmmumbai.org | Guide | Super Guide | Guide | Current wins; no elevation |

Four Zite-only elevated users are not in the approved list. Their historical roles are retained, but their final operational role is `User`:

| Email | Zite role | Final role |
|---|---|---|
| aggd.hkm@gmail.com | Super Guide | User |
| ajkd@hkmmumbai.org | Guide | User |
| anantprajapat2311@gmail.com | Super Guide | User |
| krishnakant.n.mishra1@gmail.com | Super Guide | User |

## 4. User matching strategy

Normalization never changes stored source values; it produces comparison keys only.

1. **Exact Gmail/account email:** trim and lowercase. A unique match is an automatic merge.
2. **Exact secondary email:** if a distinct secondary-email field exists in the final export, trim/lowercase and require uniqueness on both sides. A unique match is an automatic merge but is labelled separately.
3. **Phone:** normalize to E.164 where country information exists and compare the final ten digits only as supporting evidence. Phone never causes an automatic merge.
4. **Name:** Unicode-normalize, collapse whitespace, and compare only after another independent identifier agrees. Name alone always goes to manual review.

Automatic merge is rejected when an identifier is duplicated on either side, when one source user points to multiple current users, or when two source users point to one current user without an approved alias decision.

### 4.1 Preliminary user matching report

| Classification | Count | Proposed action |
|---|---:|---|
| Exact normalized email match | 15 | Merge into current user; current fields and permissions win |
| Phone-supported candidate | 1 | Manual review; no automatic merge |
| Name-only candidate | 0 | Manual review if any appear in final snapshot |
| No current candidate | 216 | Create normal `User`, subject to validation |
| Total Zite application users | 232 | Reconcile to 232 decisions |

The phone-supported case is:

- Zite `ashteshk@gmail.com` and current `ashteshk@outlook.com` have the same name and phone.
- Zite also contains a separate exact `ashteshk@outlook.com` user that matches the current Guide.
- **Decision recorded 2026-09-10:** do not merge the Gmail identity into the Outlook identity. Create `ashteshk@gmail.com` as a separate normal `User`. It must not inherit the Guide role or any permission-bearing flags from `ashteshk@outlook.com`.

Three exact-email matches have harmless spelling differences. They remain exact-email merges, and the current name wins:

- `adpd@hkmmumbai.org`: Advaita Prana Dasa / Adwaita Prana Das
- `asgd@hkmmumbai.org`: Ashesh Govind Das / Ashesha Govind Das
- `tvkd@hkmmumbai.org`: Tattvavit Krishna Dasa / Tattvavit Krishna Das

### 4.2 Source identity quality findings

- No duplicate nonblank normalized Zite emails were found.
- One Zite user row is completely blank, including email, name, phone, role, and status. **Decision recorded 2026-09-10:** preserve it in the immutable server-only migration archive and do not create an operational or login-capable user.
- Twenty-one Zite users have no `User ID`.
- Thirty-three Zite users have no phone.
- Seven phone numbers occur on two Zite user rows each. These are possible aliases or duplicates, never automatic merges.

## 5. ID preservation and relationship strategy

Create one immutable mapping ledger before constructing destination records:

| Ledger field | Meaning |
|---|---|
| `sourceSystem` | `zite:pwa:1ab8f516ea1301be` |
| `sourceTable` | Exact Zite table name |
| `sourceRecordId` | Zite system UUID |
| `sourceBusinessId` | `User ID`, `Entry ID`, `Group ID`, autonumber, etc. |
| `destinationCollection` | Existing operational collection or migration archive |
| `destinationDocumentId` | Final Firestore document ID |
| `matchRule` | email, source ID, business key, composite key, create, or manual |
| `action` | no-op, enrich, create, archive, exclude, or review |
| `sourceChecksum` | Canonical source-row checksum |
| `runId` / watermark | Reproducibility and delta tracking |

ID rules:

1. A matched user always maps to the existing current Firestore user document ID.
2. Otherwise preserve the Zite system UUID as the Firestore document ID when valid and collision-free.
3. Preserve all Zite business IDs as fields even when the document ID differs.
4. If a source ID collides with a different destination entity, derive a deterministic ID from `SHA-256(source workspace + table + source record ID)` and record it in the ledger.
5. Never generate related IDs independently. All user, guide, residency, group, session, quiz, service, room, and registration references resolve through the ledger.
6. A relationship is written only after both endpoints have a resolved mapping. Unresolved edges go to manual review and the source row remains in the archive.

Each source row receives an immutable archival representation separate from the operational document. This avoids Firestore's document-size limit, preserves fields the current UI does not use, and keeps operational schemas unchanged. The archive must be server-only/default-deny.

### 5.1 Soft-deleted records and tombstones

**Decision recorded 2026-09-10:** preserve deleted history wherever Zite provides access, but never reactivate it.

- The currently available read-only SQL interface automatically hides soft-deleted rows, so proceed with visible active rows and record the missing history as a limitation. If later required, obtain a PITR or administrative export and reconcile it only into archive history.
- Store deleted records only in the server-only immutable migration archive, with the original table, source ID, deletion timestamp, deletion actor/reason when available, original relationships, source checksum, and `operationallyRestored: false`.
- Do not create or update an operational `Users`, `BvGroups`, `SadhanaEntries`, `BvAttendance`, or other application document from a deleted source row.
- Do not use deleted rows for identity matching, duplicate resolution, role mapping, relationship selection, aggregate counts, report reconciliation, or current-state enrichment.
- If an active Zite row references a deleted row, preserve the original edge in the archive and report it as an unresolved/deleted-target relationship. Do not point the active operational record at a deleted entity.
- If the same source ID has both a deleted historical version and a later active version, archive the deleted version and process only the active version operationally. The versions must remain distinguishable by source timestamp/checksum.
- Security rules and migration tooling must deny application clients access to tombstone/archive collections. Existing reports and endpoints must continue querying only current operational collections.

### 5.2 Legacy Push Subscription isolation

**Decision recorded 2026-09-10:** all old Zite Push Subscription records are historical audit data only.

- Preserve the original Zite records only in the server-only migration archive.
- Never copy legacy endpoints, tokens, `p256dh` keys, auth keys, device identifiers, or subscription IDs into operational `PushSubscriptions`.
- Never send a notification through a legacy Zite subscription or use one to infer user identity, account state, role, permission, reporting scope, or dashboard state.
- Leave all existing current-application subscriptions unchanged.
- A user receives an operational subscription only by logging in and enabling notifications through the current application's existing notification system.
- Reconciliation must prove that the set of operational subscriptions after migration equals the pre-migration current set plus fresh subscriptions created by normal current-application activity, with zero contribution from Zite.

## 6. Table-by-table migration mapping

Counts are live observations and will be regenerated from the fixed migration snapshot. `0` under Current means the operational collection is absent/empty at preflight. Current-only records always remain.

### 6.1 Non-LLP tables: migrate or archive with an explicit decision

| Zite table | Zite count | Current destination | Current count | Migration decision |
|---|---:|---|---:|---|
| Users | 232 | Users | 20 | Email-first merge/create through role firewall; archive raw source |
| Guides | 17 | Guides | 20 | Merge approved current guides; Zite-only guides historical/inactive |
| Folk Residencies | 6 | FolkResidencies | 6 | Match residency ID, then verified name; merge current-wins |
| Sadhana Entries | 13,336 | SadhanaEntries | 12 | Preserve source ID; dedupe entry ID then user+date; migrate all attributed history |
| Sadhana Fields | 25 | SadhanaFields | 25 | Match field key plus guide/residency scope; current config wins; archive versions |
| BV Groups | 19 | BvGroups | 6 | Match Group ID, then verified name+guide; preserve historical links |
| BV Group Members | 57 | BvGroupMembers | 58 | Match source ID or mapped user+group; preserve joined date; do not infer privilege |
| BV Group Requests | 0 | BvGroupRequests | 0 | No rows; retain explicit zero-count decision |
| BV Sessions | 3 | BvSessions | 14 | Match Session ID, else group+date+topic; current wins |
| BV Attendance | 14 | BvAttendance | 25 | Match source ID, else mapped session+user; preserve date/presence |
| BVSL Preaching Entries | 2,679 | BvslPreachingEntries | 2,360 | Match Entry ID; rewire user and Sadhana entry; migrate history |
| Services | 20 | Services | 38 | Match Service ID, else verified name+scope; current active config wins |
| Service Allocations | 765 | ServiceAllocations | 765 | Match Allocation ID/source ID; rewire user/service/backup/verifier |
| Service Availability | 68 | ServiceAvailability | 68 | Match Availability ID/source ID; rewire user |
| Service Swaps | 9 | ServiceSwaps | 9 | Match Swap ID/source ID; rewire allocation/from/to users |
| Skill Catalog | 1 | SkillCatalog | 1 | Match Skill ID, then exact name; current active state wins |
| User Skills | 1 | UserSkills | 1 | Match source ID or mapped user+skill |
| Ashray Checklist | 56 | AshrayChecklist | 55 | Match Checklist ID/source ID; rewire user; preserve JSON and timestamp |
| Residency Transfer Requests | 5 | ResidencyTransferRequests | 12 | Match Request ID/source ID; rewire user/from/to residency |
| Guide Transfer Requests | 3 | GuideTransferRequests | 11 | Match Request ID/source ID; rewire user/from/to guide |
| Config | 15 | Config | 18 | Match config key; never overwrite current operational values; archive Zite value/version |
| AshrayLevels | 7 | AshrayLevels | 14 | Match level name/order; current criteria win; archive Zite criteria |
| AshrayUpgradeRequests | 17 | AshrayUpgradeRequests | 0 | Create historical requests using mapped user/reviewer |
| ServicePreferences | 28 | ServicePreferences | 28 | Match preference ID or mapped user+service; current wins |
| BvQuizzes | 6 | BvQuizzes | 10 | Match source ID/composite; rewire group/creator; preserve questions JSON |
| BvQuizSubmissions | 8 | BvQuizSubmissions | 8 | Match submission ID or mapped quiz+user+submitted time |
| ServiceRatings | 12 | ServiceRatings | 12 | Match rating ID/source ID; rewire service; preserve rater hash |
| Unavailability Requests | 3 | UnavailabilityRequests | 3 | Match Request ID/source ID; rewire user/allocation/reviewer |
| Sadhana Monthly Summaries | 3 | SadhanaMonthlySummaries | 3 | Match Summary ID or mapped user+month+template |
| One To One Meetings | 3 | OneToOneMeetings | 4 | Match Meeting ID/source ID; independently map Guide and Member fields |
| Preaching Report Goals | 9 | PreachingReportGoals | 9 | Match Goal ID or center+year+metric; current goal wins |
| Trips | 0 | Trips | 0 | No rows; retain explicit zero-count decision |
| Rent Payments | 0 | RentPayments | 0 | No rows; retain explicit zero-count decision |
| Push Subscriptions | 63 | Server-only migration archive; current PushSubscriptions remains operational | 67 | Archive-only by approval; no legacy token, endpoint, or key enters the operational collection |
| BVSL Weekly Plans | 4 | BvslWeeklyPlans | 2 | Match source ID or mapped user+week; migrate historical plans |
| TagMango Sync Log | 992 latest | TagMangoSyncLog | 831 | Match Order ID/source ID; rewire matched user when resolvable; preserve raw payload |
| Attendance Events | 0 | AttendanceEvents | 0 | No rows; retain explicit zero-count decision |
| Attendance Sessions | 0 | AttendanceSessions | 0 | No rows; retain explicit zero-count decision |
| Attendance Participants | 0 | AttendanceParticipants | 0 | No rows; retain explicit zero-count decision |
| Attendance Records | 0 | AttendanceRecords | 0 | No rows; retain explicit zero-count decision |
| Attendance Volunteers | 0 | AttendanceVolunteers | 0 | No rows; retain explicit zero-count decision |
| Challenge Enrollments | 0 | ChallengeEnrollments | 0 | No rows; retain explicit zero-count decision |
| Cleanliness Rooms | 14 | CleanlinessRooms | 15 | Match source ID or residency+room number; map occupants separately |
| Cleanliness Inspections | 346 | CleanlinessInspections | 346 | Match Inspection ID/source ID; rewire residency/room/inspector; copy attachment bytes |
| Jigyasa Registrations | 764 | JigyasaRegistrations | 763 | Match source ID, then registration business keys; not application-user identity matching |
| Jigyasa Session Attendance | 671 | JigyasaSessionAttendance | 671 | Match Record Key/source ID; rewire registration |
| Jigyasa Processed Files | 12 | JigyasaProcessedFiles | 12 | Match source ID/file+date; preserve processing metadata |
| Cleanliness Review Requests | 20 | CleanlinessReviewRequests | 20 | Match Request ID/source ID; independently map requester and reviewer |
| Zite Users | 257 | Server-only migration archive | 0 | Preserve workspace-account metadata; never use for app identity, roles, or relationships |

### 6.2 LLP tables: complete exclusion

The exclusion is prefix-based, not only a fixed-name list. Any newly discovered table starting with `LLP` is automatically rejected before export and must have zero destination writes.

| Zite table | Zite count | Decision |
|---|---:|---|
| LLP Guides | 5 | Exclude |
| LLP Users | 2 | Exclude |
| LLP Sadhana Entries | 5 | Exclude |
| LLP Form Config | 3 | Exclude |
| LLP BV Groups | 3 | Exclude |
| LLP BV Group Members | 3 | Exclude |
| LLP BV Sessions | 3 | Exclude |
| LLP BV Attendance | 3 | Exclude |
| LLP Service Types | 3 | Exclude |
| LLP Service Log | 3 | Exclude |
| LLP Appointment Slots | 3 | Exclude |
| LLP Bookings | 3 | Exclude |
| LLP Service Allocations | 3 | Exclude |

## 7. Preliminary data-conflict and loss-risk report

| Severity | Finding | Required treatment |
|---|---|---|
| Blocker | Source changed during analysis (`TagMango Sync Log` 991 to 992) | Snapshot watermark, repeatable baseline, delta passes, and final Zite write freeze |
| Limitation | Read-only Zite SQL automatically hides soft-deleted rows | Proceed with visible active rows; never recreate deleted records; retain an optional future PITR/admin archive-only reconciliation path |
| Critical | Existing merge script allows phone-based automatic matching | Do not use it; phone is supporting evidence only |
| Critical | Existing merge script can prefer a newer Zite field over current data | Do not use it; current destination always wins conflicts |
| Critical | Existing merge script has no complete role/flag firewall or LLP prefix rejection | Replace with manifest-based abort invariants before any write |
| Critical | `Guides.isActive` can participate in login/guide detection | Never activate a Zite-only Guide record |
| High | 115 Sadhana entries lack a visible User link | Preserve all 115 in archive; attempt recovery only through deterministic evidence; unresolved rows remain unattributed/manual review |
| High | 2 BV membership rows and 2 BV attendance rows lack User links | Preserve and manually resolve; never guess by name |
| High | 1 BVSL preaching row lacks a User link | Resolve through linked Sadhana entry only if unique; otherwise review |
| High | One completely blank Zite user exists | Archive and review; no operational/login user |
| High | 21 Zite users lack `User ID` | Use Zite UUID as source identity; do not invent business IDs without a deterministic policy |
| High | Seven duplicated phone numbers exist across Zite users | Manual alias review; no phone-only merges |
| High | One phone-supported cross-email candidate exists | Explicit identity decision required before execution |
| Medium | 3 Ashray checklists, 1 residency transfer, and 1 guide transfer lack a User link | Preserve, attempt deterministic relationship recovery, then review |
| Medium | The three monthly summaries and three one-to-one rows lack the generic observed User link | Export field-level linked values and independently validate each relationship; do not rely on a collapsed generic link table |
| Medium | 947 of 992 TagMango logs have no matched User link | Expected for external/sync logs may be valid; preserve raw records and link only uniquely resolvable identities |
| Resolved policy | Old Push Subscription endpoints and keys may be stale or device-specific | Archive only; never copy them into operational `PushSubscriptions`; keep current subscriptions unchanged |
| Medium | Current Firestore PITR and delete protection were disabled at preflight | A restorable managed export is mandatory immediately before migration |
| Medium | Several collections have equal counts but equality does not prove record equality | Compare stable IDs and canonical checksums row by row |
| Medium | Attachments may be URL-backed and expire | Download permitted non-LLP attachment bytes, checksum them, and verify readability before cutover |

The missing-user-link counts identify absent visible links, not automatically corrupt data. Optional relationships remain valid. Required relationships are resolved according to each table's contract and reported separately.

## 8. Dry-run design

The dry-run uses frozen read-only exports and performs **zero Firestore writes**.

### 8.1 Inputs

1. Firestore managed export with manifest and object checksums.
2. Zite schema, all 49 non-LLP tables, field-level linked records, system IDs/timestamps, attachments, and tombstones if available.
3. Approved Gmail/account-email role manifest captured from current `Users`.
4. Destination collection snapshot including document IDs, update times, and canonical checksums.

### 8.2 Dry-run outputs

1. `user-matching.csv`: Zite user, current user, match type, confidence evidence, action, review reason.
2. `role-validation.csv`: email, current role/flags, Zite role/flags, final role/flags.
3. `table-migration.csv`: source count, current count, create, enrich, no-op, archive, review, exclude, expected final count.
4. `id-mapping.csv`: every source record ID to destination document ID.
5. `relationship-reconciliation.csv`: relationship type, source edge count, mapped edge count, unresolved edge count.
6. `field-conflicts.csv`: current value hash, Zite value hash, winning source, resolution.
7. `data-loss-risk.csv`: rows without destinations, unresolved links, duplicates, missing fields, attachment failures.
8. `planned-writes.jsonl`: exact create/update operations with preconditions, but not executed.
9. `reconciliation-summary.json`: source checksums, destination checksums, invariants, and pass/fail status.

### 8.3 Mandatory dry-run assertions

- Source tables = 62 decisions exactly.
- LLP source rows considered for migration = 0.
- LLP planned writes = 0.
- Non-LLP source rows = migrated/archive/review decisions with no unexplained remainder.
- Final privileged email-to-role mapping exactly equals the approved current manifest.
- Every Zite-only user has `role: User` and all permission flags false.
- Every mapped relationship points to an existing or planned destination ID.
- No current document is deleted.
- No deleted/tombstoned source row produces an operational create or update.
- Deleted/tombstoned rows are absent from identity matching, current-state counts, reports, dashboards, permissions, and role calculations.
- Zite Push Subscription rows produce zero operational `PushSubscriptions` writes, and no legacy endpoint, token, `p256dh` key, or auth key appears in the operational plan.
- No current nonempty field is overwritten by Zite.
- A second identical dry-run yields the same ID map and plan.
- Running the plan against a restored staging copy, then dry-running again, yields zero additional writes except source deltas.

## 9. Execution and continuous-history sequence

Execution begins only after written approval of the dry-run artifacts and all manual identity decisions.

1. **Back up current Firestore:** managed export to a versioned bucket; record checksum; perform a restore rehearsal in an isolated project/database.
2. **Back up Zite:** full schema/data/link/attachment export with a baseline watermark `T0`; verify 62-table manifest and LLP exclusion.
3. **Freeze the approved role manifest:** record exact privileged email/role/flags and checksum it.
4. **Run the dry-run:** produce every report above; resolve blockers and manual matches.
5. **Stage rehearsal:** restore a copy of current Firestore and apply the plan there; run endpoint/report regression tests against the staged copy.
6. **Begin production baseline:** write only with destination update-time preconditions. If a current row changed after snapshot, re-read it and recompute a current-wins merge.
7. **Dependency order:** reference/config archives, identity ledger, Users, Guides, residencies, groups/services/skills/rooms, relationship tables, sessions/quizzes, high-volume activity, summaries/logs, then attachment verification.
8. **Delta catch-up:** repeatedly import non-LLP rows created or updated after `T0`. The migration is idempotent, so retries are safe.
9. **Final cutover window:** briefly make Zite read-only, record final watermark `Tfinal`, apply the last delta, verify checksums/counts/relationships/roles/reports, then direct all future activity to the current application.
10. **Post-cutover audit:** verify no late Zite writes after `Tfinal`; if any exist, run one final bounded delta before closing the source.
11. **Rollback rule:** before final acceptance, rollback restores the Firestore export and removes only documents tagged with the migration run ID. Never use broad collection deletion.

Future current-application writes always win. Migration batches must use optimistic preconditions and retry by re-reading current state, not by replaying stale snapshots.

## 10. Validation and acceptance matrix

Validation must cover data and actual application reports separately:

| Area | Validation |
|---|---|
| LLP | Search source manifest, ID ledger, archive, and operational collections; all LLP write counts must be zero |
| Deleted history | Verify tombstones exist only in the server-only archive, have `operationallyRestored: false`, and contribute zero operational writes/report rows |
| Push subscriptions | Verify all 63 observed Zite rows are archive-only and that operational notification credentials come exclusively from fresh current-application subscriptions |
| Roles | Compare exact privileged email/role/flag set before and after; exercise login routes for approved and unapproved elevated Zite users |
| Users | Reconcile 232 Zite decisions plus 20 current users; verify no duplicate normalized emails after approved alias decisions |
| Sadhana | Count/checksum by user and date; sample oldest/newest entries; verify dashboard historical date ranges |
| BV | Reconcile groups, memberships, sessions, attendance, quizzes, submissions, preaching, and weekly plans through mapped IDs |
| Residency/Ashray | Verify current residency, transfer history, checklists, levels, and upgrade requests |
| Meetings | Validate one-to-one Guide and Member independently; keep current Meetings/MoM untouched |
| Services | Reconcile services, allocations, availability, swaps, preferences, ratings, unavailability, skills, trips, and payments |
| Cleanliness/Jigyasa | Count/checksum and relationship validation; verify attachment retrieval |
| Reports | Compare representative historical totals in Zite export, staged Firestore, and existing application endpoints/UI |
| Idempotency | Re-run after baseline and after delta; expect zero duplicate creates and stable destination IDs |
| Current activity | Create controlled current-app activity during rehearsal and prove the migration neither overwrites nor duplicates it |

Final acceptance requires all 19 business criteria in the migration request, every invariant in this document, and zero unresolved critical findings. Manual-review rows may remain only if their raw history is preserved and the user explicitly approves their operational disposition.

## 11. Decisions required before migration code

1. **Resolved:** `ashteshk@gmail.com` remains separate and is created as a normal `User`; it is not mapped to the approved `ashteshk@outlook.com` Guide identity.
2. **Resolved:** preserve the completely blank Zite `Users` row in the server-only migration archive only; do not create an operational user.
3. **Resolved 2026-09-10:** migrate all currently visible active rows without waiting for soft-deleted rows. The current SQL interface cannot expose deleted rows, so their absence is a documented limitation rather than a blocker. Never recreate them or write them to active collections. A future PITR or administrative export may be reconciled into server-only archive history.
4. **Resolved:** old Zite Push Subscriptions are archive-only. Legacy device tokens, endpoints, and encryption keys are never activated or used. Users must create fresh subscriptions through the current application's notification system.
5. **Resolved 2026-09-10:** the user approved proceeding with the role manifest and table mapping. The implementation and zero-write dry-run may proceed; production apply still requires all acceptance gates below.

## 12. Execution checkpoint: 2026-09-10

### Operator-confirmed identity corrections

The following exact-email display names were confirmed on 2026-09-10 and are
frozen in the migration configuration:

| Email | Canonical full name |
|---|---|
| arap@hkmmumbai.org | Arjunacharya Das |
| vbmd@hkmmumbai.org | Vaibhav Mohan Das |

Only `Users.fullName` is corrected by this mapping. Roles, permissions, status,
segment, identifiers, and historical raw/archive payloads are not changed. The
two matching live Firestore profiles were updated with update-time preconditions
and read back successfully. Consequently, the earlier destination snapshot and
its planned update preconditions are historical evidence only; a fresh
destination snapshot is mandatory before any migration apply.

The new guarded tooling is under `scripts/zite-firestore-migration/`. It has no Firestore write capability. The previous `mergeZyteAndFirestore.ts` path remains explicitly disallowed for this migration.

Read-only run `20260910T161808Z` produced a fixed active-row watermark of `2026-09-10T16:24:04Z`:

- 20,608 non-LLP source rows frozen and checksummed.
- 0 LLP rows exported and 0 LLP writes planned.
- 223 attachment references downloaded and verified, representing 222 unique files and 299,355,984 bytes.
- 20 current Firestore users protected by a checksummed approved-role manifest.
- 15 exact normalized-email user matches, 216 separate normal-user creates, and the one blank user archived only.
- All 2,685 BVSL preaching rows linked deterministically to a unique same-user/same-date Sadhana entry.
- 185 records held for manual review because required relationships are absent or point to source entities unavailable in the active-row view.
- 3 additional optional relationship edges remain unresolved and are omitted from operational writes while preserved in the archive.
- 61,319 total planned writes: 20,608 immutable archive writes, 20,608 ledger writes, 14,065 operational creates, 6,037 current-wins enrichments, plus the run marker.
- 10,640 field conflicts resolved in favor of the current destination.

Independent verification passed every plan-integrity firewall: no deletes, no duplicate write targets, no nonempty-current-field overwrite, no legacy push credential leakage, no role elevation, complete archive/ledger coverage, update-time preconditions on every update, and Firestore document-size headroom.

At that earlier checkpoint, the dry run was **not approval-ready** under the
original classification below. Section 13 supersedes this classification:

1. Approved dispositions for the 185 manual-review rows and 3 optional unresolved edges.
2. A restorable managed Firestore export plus isolated restore rehearsal. Firestore backup listing returned no existing managed backups at this checkpoint; PITR and delete protection are disabled.

Unavailable soft-deleted rows are now a **non-blocking limitation**. They will
not be recreated, restored, matched into active data, or included in active
application counts. The migration keeps a future archive-only reconciliation
path open for a Point-in-Time Restore or official administrative export.

## 13. Active-data refresh checkpoint: 2026-09-10

Read-only run `20260910T174452Z` supersedes the earlier destination snapshot and
uses a final active-row watermark of `2026-09-10T17:55:14Z`:

- The current 62-table schema was captured and matched exactly to all 62
  configured decisions; all 187 linked-record fields resolve to known tables.
- 20,622 visible non-LLP rows were exported and checksummed.
- A bounded delta overlay reconciled 7 during-capture changes: 3 Users, 3
  Sadhana Entries, and 1 Config row.
- All 13 LLP tables remained count-only: 42 active LLP rows observed and 0 LLP
  rows exported or planned.
- 223 attachment references were downloaded and verified, representing 222
  unique files and 299,355,984 bytes.
- A fresh Firestore baseline captured 20 Users; the canonical names for
  `arap@hkmmumbai.org` and `vbmd@hkmmumbai.org` are present.
- Dry-run `mig_2176dc5cde8cfa55a91817ef` contains 61,361 planned writes: 20,622
  archive writes, 20,622 ledger writes, 14,079 operational creates, 6,037
  preconditioned current-wins updates, and the run marker.
- Independent verification reports `planValid: true`: no deletes, duplicate
  targets, nonempty-current overwrites, legacy push activation, credential
  leakage, role elevation, LLP writes, or missing source archive/ledger rows.

Missing soft-deleted history is explicitly non-blocking and contributes zero
active writes. Of the earlier 185 review rows, 157 point to targets unavailable
from the active-row view and are now classified as non-blocking archive-only
limitations; their targets will not be recreated. The 3 unresolved optional
relationships are likewise preserved in the archive and omitted without
blocking. The remaining 28 malformed active rows are also preserved under an
explicit archive-only disposition rather than producing incomplete operational
documents. The only remaining approval gate is verification of a restorable
managed Firestore export.
