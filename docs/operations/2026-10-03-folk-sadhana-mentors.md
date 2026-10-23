# FOLK Sadhana Mentor residency access — 3 October 2026

Requested assignment:

| Member | Login | User ID | Report residency | Existing FOLK guide |
| --- | --- | --- | --- | --- |
| Madhushrava Bohra | theshyambohra@gmail.com | USER-019 | FOLK Powai | Sreesh Govind Das |
| Ashtesh Kumar | ashteshk@gmail.com | USER-082 | FOLK Vashi | Sreesh Govind Das |

The separate Ashtesh Guide profile (GUIDE-013, Outlook login) is excluded from this change.

## Current access rule — 23 October 2026

A currently active FOLK Sadhana Mentor inherits the read-only Sadhana audience of their linked FOLK guide. The same hostel resolver used for guide reports determines the guide's current active centers and all peer guides assigned there. The mentor can read the Sadhana of boys under any of those guides, including non-residents without a residency on their own profile, as well as residents and enabled temporary visitors in the center.

For example, a mentor linked to Sreesha Govind Das at FOLK Powai can also read boys under Aditya Ram Das, Manmohan Krishna Das, and Mathuranath Das when those guides are assigned to Powai. This is derived from stored relationships and applies to every FOLK mentor; no per-mentor residency grant is needed.

`Users.sadhanaMentorResidencyIds` remains a supplementary, server-managed residency assignment for existing explicit grants. Document IDs, public IDs, emails, and unambiguous guide names are resolved through the existing guide identities. Explicit hostel-side guide assignments override stale links on a guide's profile.

Report, Missing Report, Stats, Leaderboard, the mentor Members List, and Sadhana entry/profile detail access use this audience. Report and Missing Report can be narrowed to a peer guide. Guides/admins, PW members, incomplete profiles, and inactive/pending/rejected users are excluded. The mentor's own Sadhana remains visible in reports and excluded from the Members List. Revoking the mentor flag or deactivating the mentor removes inherited access. This read permission does not extend general management authorization or change member assignments, Auth identities, or history. PW mentors retain their existing explicitly assigned member access.

FOLK mentor dashboards now include a Missing Report tab.

## Historical validation — 3 October 2026

- 17 initial focused tests passed, covering report scope, existing hierarchy rules, and PW mentor isolation; 2 further fallback/isolation checks passed.
- TypeScript check and isolated production build passed.
- Replay of the three actual report handlers over the 3 October live roster agreed exactly: Powai 57 rows; Vashi 7 rows. These counts exclude the mentor's own row. Including themselves, the active member rosters contain 58 and 8 respectively.
- Madhushrava has an existing verified Firebase Auth account. Ashtesh's Gmail member profile has no matching Firebase Auth account at preflight; he must first sign in with that email.

Deployment and data-write verification are recorded below after completion.

## Validation of the hostel inheritance change

The focused mocked regression suite covers peer-guide non-residents, residents and temporary visitors; consistent Report/Missing/Members/Stats audiences; peer-guide filters and foreign selectors; entry and profile detail authorization; leaderboard consistency; current hostel assignment revocation; mentor revocation; pagination past 2,000 records; and PW isolation. These checks do not establish deployed or authenticated live behavior.

- All 26 focused mentor/hostel/PW mentor checks passed.
- The expanded seven-file regression run passed 59 of 60 checks. The existing test expecting a PW admin to open a profile explicitly marked FOLK fails at the department guard; the same failure was reproduced using the original `HEAD` profile handler.
- `npx tsc --noEmit` and `git diff --check` passed. Deployment and Madhushrava's authenticated live acceptance remain unverified for this change.
