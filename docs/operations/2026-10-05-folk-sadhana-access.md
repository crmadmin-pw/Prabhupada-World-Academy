# FOLK Sadhana reports and historical editing — 5 October 2026

FOLK mentor Sadhana and Missing reports include the mentor's own active member row. They also include active members in the mentor's explicitly assigned residencies and boys directly linked to the mentor's current FOLK guide, including non-residents and boys in other residencies. Guide aliases resolve through Guides and Users identities; request filters cannot substitute a different parent guide. PW members, inactive profiles and guide/admin report administrators remain excluded from this FOLK scope.

This supersedes the residency-only scope and report self-exclusion described in the 3 October operation. The mentor Members List continues to exclude the mentor himself.

FOLK mentor reports default to all residence types and all residencies. The previous hidden profile-residency filter and automatic single-residency selection no longer hide boys returned by the mentor's guide scope.

FOLK members can submit or edit their own Sadhana for today or any earlier date. Future dates are rejected using the current date in India. The seven-day lower bound is removed from both the date picker and server for FOLK. Authenticated entry ownership and update-in-place behavior remain enforced. PW retains its existing edit window, scoring and mentor assignment rules.

Validation: 36 focused and broader report tests passed in an isolated checkout based on the serving production commit `877f251c8cf3f24d52d3b67798afb2c36bc239c7`. Tests cover self inclusion, guide aliases, cross-residency guide members, foreign-guide and PW isolation, old-entry edits, owner preservation, no duplicate creation, and FOLK future-date rejection.

The isolated release also preserves the newer production dashboard fix from `626bc2485602c9178a18881dc07bd59be406c10a`. Production builds and the combined-source TypeScript check passed. A browser check against the deployed frontend, using mocked authentication and API responses, confirmed self, same-guide cross-residency and non-resident rows in both reports. This is not an authenticated end-user session check.

A fresh projected live roster read on 5 October, evaluated with the updated scope helper, includes 71 members for Madhushrava Bohra (`theshyambohra@gmail.com`) and 27 for Ashtesh Kumar (`ashteshk@gmail.com`), including their own rows. These are accessible roster counts, not counts of submitted entries on a particular date.

Deployment: Firebase App Hosting rollout `build-2026-10-05-006` succeeded on 5 October 2026; traffic read-back confirmed 100% serving this combined release. No live user roles or Sadhana entries were modified by this operation.
