# FOLK hostel Sadhana visibility

FOLK Guides can read Sadhana for their own assigned members, members assigned to
other guides in the same hostel, and members residing in their hostel even when
assigned to a guide elsewhere. This is a read permission, not an expansion of
member-editing permissions. Prabhupada World report scopes are unchanged.

The detailed daily/weekly/monthly report, missing report, member profile history
and entry details use the FOLK hostel scope. Guide filters contain only the
viewer's hostel guides. Filters narrow an already-authorized result; a supplied
foreign guide ID cannot expand access. Guides without a hostel retain direct
member access. Super Guides retain their existing department-wide scope.

Hostel `guideIds` is authoritative, including an empty list. Legacy links and
names are supported when that field is absent. Reads validate current active
FOLK guide profiles and active FOLK hostels. Ambiguous guide aliases grant no
access. Member residence continues to use the existing residential records;
there is no automatic reassignment of members based on their guide's hostel.

In **Residencies / Hostels**, a Super FOLK Guide can create a hostel and assign
guides. PW accounts cannot use these mutation endpoints. BKC retains Sion's
existing document ID; legacy Sion names remain recognized by report access.

## Confirmed assignments

| Hostel | Guides |
| --- | --- |
| Powai | Aditya Ram Das; Manmohan Krishna Das; Mathuranath Das; Sreesh Govind Das |
| Thane | Adwaita Prana Das; Arjunacharya Das; Ashesha Govind Das; Sahasranaam Das; Urukrama Gauranga Das |
| BKC (formerly Sion) | Anuttam Hari Das; Vedanarayana Das |
| Vashi | Ashtesh Kumar |
| Airoli | Gopal Gauranga Das; Harinamamrta Das; Ram Tilak Das; Vaibhav Mohan Das |

Gaurmandal Das remains a Super FOLK Guide without a hostel. Mohan Krishna Das
is marked hidden from the FOLK guide directory; his account is not deleted.
Tattvavit Krishna Das remains PW personnel and is excluded from this feature.

## Live configuration work

`scripts/folkHostelSetup.py` is the one-time setup tool for the confirmed roster.
Its default mode reads and plans; `--apply` uses field masks and update-time
preconditions, saves a local before-image, and verifies written fields. Do not
rerun with `--apply` after subsequent administrator changes without reviewing its
plan, since it restores the roster above.

The approved production pass committed 40 document updates and deleted one
orphaned historical 1:1 meeting linked to Vedanarayana Das. His Auth identity
was verified and preserved. His account had already been converted externally
to FOLK Guide before this pass. The pass added BKC and removed six stale PW
member-to-guide links without deleting those members or their reports.

The initial readback stopped at the hierarchy marker, which a live request had
already rebuilt. Subsequent read-only planning returned no patches, deletions,
or remaining PW guide links. The tool now accepts a rebuilt `ready:2` marker.
The private before-image is in `/tmp/folk-hostel-setup-receipt.json.before.json`;
the no-op verification is `/tmp/folk-hostel-plan-after.json`.

## Validation and deployment status

- TypeScript and `git diff --check` passed.
- Report, entry-detail and department-isolation regression tests passed.
- Hostel tests cover direct access, hostel peers, residential exceptions,
  revocation, foreign filters, inactive records, ambiguous aliases, Sion names,
  creation authorization, and assignment synchronization.
- A production Webpack build passed. The default Turbopack build encountered an
  environment port restriction.
- `tests/folk-hostel-sadhana.browser.cjs` passed for a regular FOLK Guide and
  Super FOLK Guide against the built app with mocked APIs. It makes no live writes.
- One broader pre-existing test expects a PW admin to open a FOLK member profile.
  It fails with the same department-denial error against the original HEAD file.
  This feature does not relax that boundary.

Application code has **not been deployed**. Live authenticated browser acceptance
is still required after deployment. Other concurrent workspace edits are present
and must be reviewed separately when preparing a release.

```sh
node --import tsx --test tests/folk-hostel-sadhana-scope.test.ts tests/entry-detail-access.test.ts tests/folk-mentor-residency-scope.test.ts tests/pw-facilitator-sadhana-scope.test.ts tests/supervisor-sadhana-report.test.ts tests/folk-pw-segment-isolation.test.ts
npx tsc --noEmit
npm run build -- --webpack
# With the built server running on port 3135:
node tests/folk-hostel-sadhana.browser.cjs
```
