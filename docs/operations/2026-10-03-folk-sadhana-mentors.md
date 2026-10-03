# FOLK Sadhana Mentor residency access — 3 October 2026

Requested assignment:

| Member | Login | User ID | Report residency | Existing FOLK guide |
| --- | --- | --- | --- | --- |
| Madhushrava Bohra | theshyambohra@gmail.com | USER-019 | FOLK Powai | Sreesh Govind Das |
| Ashtesh Kumar | ashteshk@gmail.com | USER-082 | FOLK Vashi | Sreesh Govind Das |

The separate Ashtesh Guide profile (GUIDE-013, Outlook login) is excluded from this change.

## Access rule

`Users.sadhanaMentorResidencyIds` is a server-managed, explicit FOLK assignment. A currently active Sadhana Mentor with this setting can read Sadhana Report, Missing Report, and the mentor Members List for active, registered members whose `residency` matches an assigned active FOLK residency. Residency document IDs, public IDs, and names are normalized. Other guide assignments and resident/non-resident approval status do not remove members from this scope.

The mentor's own row, guides/admins, PW members, incomplete profiles, and inactive/pending/rejected users are excluded. An invalid or revoked explicit assignment returns no rows. Unconfigured mentors and PW mentors retain their existing access paths. The new helper is used only by these Sadhana report endpoints, without changing general management authorization or anyone's guide, Auth identity, or history.

FOLK mentor dashboards now include a Missing Report tab.

## Validation

- 17 initial focused tests passed, covering report scope, existing hierarchy rules, and PW mentor isolation; 2 further fallback/isolation checks passed.
- TypeScript check and isolated production build passed.
- Replay of the three actual report handlers over the 3 October live roster agreed exactly: Powai 57 rows; Vashi 7 rows. These counts exclude the mentor's own row. Including themselves, the active member rosters contain 58 and 8 respectively.
- Madhushrava has an existing verified Firebase Auth account. Ashtesh's Gmail member profile has no matching Firebase Auth account at preflight; he must first sign in with that email.

Deployment and data-write verification are recorded below after completion.
