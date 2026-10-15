# Prabhupada World Academy — Comprehensive Application Audit (Re-run)

**Date:** 2026-10-10
**Auditor:** Buffy (senior QA / full-stack / security / UX pass)
**Scope:** entire repository — Next.js 16 App Router shell + React 19 SPA, custom `/api/run/[endpoint]` router (308 endpoint modules), Firebase Admin/Firestore data layer, Auth, Storage, Cloud Functions, App Hosting config, rules, and the existing test suites.
**Rule followed:** no application code was modified. Fixes are **not** applied; they are proposed for approval.

> **Relationship to the previous audit.** `docs/audit-report-2026-10.md` (2026-10-05) is the prior pass. This run **re-verified every prior finding against the current tree**: a large majority of the earlier CRITICAL/HIGH items have since been fixed (see §11). The findings below are the ones that **still reproduce today**, plus new issues found in this pass. Prior findings that are now fixed are listed in §11 so the delta is explicit.

---

## 0. Environment, method, and honesty statement

| Area | What was actually executed | Result |
|---|---|---|
| Type check | `tsc --noEmit` (TS 5.9.3) | **Pass for `src`.** 2 errors, both in `tests/` only (`directory-role-refresh.test.ts`, `group-facilitator-name.test.ts`). |
| Lint | `eslint src` and `eslint .` | **Fail.** 3,790 problems in `src` (3,067 errors, 723 warnings) and 4,344 repo-wide. Dominated by `@typescript-eslint/no-explicit-any`. Not a functional blocker but a real quality gate failure. |
| Unit/behavior tests | `node --test` + tsx over `tests/*.test.ts` (excluding emulator suites) | **341 / 351 pass, 10 fail.** Details in §3. |
| Production build | `next build` | **Could not run.** Turbopack panics creating a junction point under `\\wsl.localhost\...\.next\node_modules` (OS error 1). This is a WSL-from-Windows filesystem limitation, not a code verdict. |
| Live dev server + browser | attempted | **Not possible in this environment.** No Linux Node in WSL; the Windows Node driving a Linux `node_modules` can't load the framework's native binaries by default, and Next dev over a UNC path is unsupported. Browser interaction (buttons, spinners, responsive layout) is therefore **UNTESTED — treat as "unknown", not "passing".** |
| Direct API testing | not possible | Auth requires real Firebase ID tokens; the old `mock_token_for_*` bypass was removed (a fix), so the Playwright suite's login helper is now stale and the suite cannot run without real credentials/emulator. |

**To make the unit suite runnable at all**, I copied the matching Windows native binaries (`@next/swc-win32-x64-msvc`, `@esbuild/win32-x64`) into `node_modules` and pointed tsx at `tsconfig.json` (`TSX_TSCONFIG_PATH`). No source file, `package.json`, or lockfile was changed. This only affects local tooling, not the app.

**Verification vocabulary used below:** *Confirmed* = reproduced by executing a test or reading the exact code path. *Suspected* = strong code-level evidence, not reproduced end-to-end. *Untested* = not executed here.

---

## 1. Executive summary

The application is a **server-mediated** platform (Firestore/Storage are default-deny; all business data flows through the authenticated router), and the last few days of work closed most of the previous audit's headline security holes — the mock-token auth bypass, client-trusted scoring, the `includes('super')` destructive-delete, and the unauthenticated `getBvGroupDetail`/`getUserCrmData`/`getBvslMembers` reads are all fixed.

**Remaining risk clusters into three themes:**

1. **Authorization is still not one enforced layer (the same theme as the prior audit, now smaller but real).** ~223 of 308 authenticated endpoints declare no `requiredCapabilities`; safety depends entirely on hand-written checks inside each handler. Several handlers have **no check at all** (`exportUserData`, `getGroupMembers`, `getEntryDetail`, `approveAshrayUpgrade`, `getPendingBvJoinRequests`, `createService`, `deleteService`, `manageCatalogSkill`) and several more check *role* but not *scope* (`addRentPayment`, `addTrip`, `approveRentCorrection`, `deleteBvGroup`, `createBvGroup`). One endpoint's super-admin guard is **provably dead code** because its inner `if` contradicts its outer `if` (BUG-001).
2. **A handful of confirmed behavioral regressions**, surfaced by the repo's own test suite failing today (10 failures): BV approval without a group no longer activates/links the member; one-to-one context returns a null score; PW entry detail drops `precedingMinutes`; the reminder dispatcher no longer writes its in-app fallback; supervisor group card metrics are null; and the PW member directory blocks on label reads (latency).
3. **Verification gap.** No browser or live-API testing was possible here, and the e2e suite is stale. It is **not** safe to assume the UI is healthy.

Overall health: **backend logic and security posture are materially better than last week; the app is not release-clean.** Address the P1 security items before rollout, then the regression cluster, then close the verification gap with a real browser/emulator run.

---

## 2. Complete bug list

Severity: **P0** blocker · **P1** high · **P2** medium · **P3** low. "Status" = Confirmed / Suspected / Untested.

| ID | Page / Feature | Issue | Sev | Status | Reproduction | Root cause | Recommended fix |
|---|---|---|---|---|---|---|---|
| BUG-001 | BV reports (`/api/run/getGuideGroupStats`) | Super-admin guard is unreachable dead code; a **normal PW admin can request department-wide (`guideId:"ALL"`) reports** | **P1** | Confirmed (executed) | Run `tests/supervisor-groups.test.ts` → "normal PW admins see only groups under their reporting RGFs" fails with *Missing expected rejection*; or POST `{guideId:"ALL",segment:"PW"}` as a non-super PW admin | `src/api/getGuideGroupStats.ts`: `if (guideId==='ALL' && segment && isBvSuperAdminUser(user)) { if (!isBvSuperAdminUser(user)) throw ... }` — the inner `if` can never be true | Change the outer condition to not require super-admin, or reject when `guideId==='ALL'` and the caller is **not** super admin; add a capability + a real (non-dead) test |
| BUG-002 | API surface (multiple) | **No authorization at all** on several authenticated endpoints: `exportUserData` (dumps up to 2000 users' name/phone/email/level to any signed-in account), `getGroupMembers` (any group's member phones), `getEntryDetail` (any user's sadhana entry, by `entryId` or `userId`+date), `approveAshrayUpgrade` (any account can approve/pass/fail an upgrade and change a member's `ashrayLevel`), `getPendingBvJoinRequests` (any group's pending join requests incl. name/phone), `createService`, `deleteService`, `manageCatalogSkill` | **P1** | Confirmed (code) | Read the handlers: `execute` never reads `context.user`/capabilities. e.g. `POST /api/run/exportUserData {}` with any valid token | The router treats `authenticated: true` as sufficient; these handlers declare no `requiredCapabilities` and perform no in-handler role/scope/ownership check | Add `requiredCapabilities` (+ hierarchy/ownership checks) to each; `getEntryDetail` must verify the caller owns the entry; `exportUserData` should be admin-only and scoped |
| BUG-003 | Member directory (`/api/run/getGuideUsers`, PW branch) | Directory read **waits on unrelated display-label reads** before starting the scoped history query → slower load; the repo's own timeout test fails | P2 | Confirmed (executed) | `tests/cold-report-concurrency.test.ts` → "cold member directory starts scoped history before dropdown labels finish" fails with *Report reads waited for unrelated display labels* | `src/api/getGuideUsers.ts`: the `directoryDepartment === 'PW'` branch does `await Guides.findAll(...)` **before** `historyPromise` is created, so the `SadhanaEntries` read is gated on label resolution | Kick off the history read (and `getReportReferenceData`) first / in parallel; never `await` label reads on the critical path |
| BUG-004 | BV approval (`/api/run/approveAndAssignBvMember`, no-group branch) | Approving a BV registration **without assigning a group no longer marks the member `Active` or links them to the admin directory** | P2 | Confirmed (executed) | `tests/bv-approval-without-group.test.ts` fails: expected `status === 'Active'`, got `undefined`; also missing `guide`/`selectedGuideId`/`bvReportingAdminId` | The `else` (no-group) branch writes only `bvRegistrationStatus`, `isBvMember:false`, `bvGroupId/Name`, `pendingBvApprovalNotice` — it omits `status:'Active'` and the reporting/guide fields the test (and directory listing) expect | Restore the intended fields in the no-group branch (or update the contract deliberately); decide whether approval implies activation |
| BUG-005 | One-to-one tracker (`getOneToOneContext`) | Alternate identities resolve but the **stored score percentage comes back `null`** | P2 | Confirmed (executed) | `tests/one-to-one-sadhana-context.test.ts` fails: `null !== 85` | Identity/score lookup in `getOneToOneContext` no longer maps the entry's stored `scorePercent` for a matched alternate id | Trace the alias→entry lookup and restore the score mapping |
| BUG-006 | PW entry detail (`getEntryDetail`) | PW progress/detail fields **omit `preachingMinutes`** | P2 | Confirmed (executed) | `tests/sadhana-department-fields.test.ts` → "PW progress and entry details use the member department…" fails: `assert.ok(fields.includes('preachingMinutes'))` | The PW field-set filter (`PW_SADHANA_FORM_KEYS` / field defs) excludes the preaching field for PW entries | Add the missing PW field to the entry-detail field set |
| BUG-007 | Sadhana reminders (`sendPushNotifications`) | In-app/fallback dispatch **no longer writes the broadcast file**, so members with zero native subscriptions get nothing | P2 | Confirmed (executed) | `tests/sadhana-push-delivery.test.ts` fails: `TypeError: Cannot read properties of undefined (reading 'inviteeIds')` (the mocked `writeFileSync` is never called) | The fallback broadcast write path in `sendPushNotifications` is no longer reached/committed for the local (non-realtime) case | Restore the fallback write (or replace with the real inbox write) and return the documented result shape |
| BUG-008 | Supervisor/BV groups (`getGuideGroupStats`) | RGF card **metric is `null`** instead of the computed value (e.g. 135) | P2 | Confirmed (executed) | `tests/supervisor-groups.test.ts` → "supervisor groups include only groups led by reporting RGFs…" fails: `null !== 135` | Metric aggregation for the supervisor card path not populated | Populate the card metric from the same aggregate the other reports use |
| BUG-009 | Rent/Trips/BV admin mutations | **Role check without scope check**: a Guide anywhere can edit any user's rent/trips, approve any correction, delete any BV group, or create a group for any facilitator (cross-centre mutation) | P2 | Confirmed (code) | `addRentPayment`/`addTrip`/`approveRentCorrection` gate on `role ∈ {Guide, Super Guide, …}` + flags only; `deleteBvGroup` on role/flags only; `createBvGroup` accepts any `bvslId` | No `isUserInHierarchy`/`getScopedHierarchyUserIds` (or centre) check on the caller-supplied `userId`/`groupId`/`bvslId` | Apply the shared hierarchy-scope helper used by the report endpoints |
| BUG-010 | Public attendance (`/api/run/markSessionAttendance`) | **Anonymous attendance forgery**: with a public `/attend/<token>` link, sending `{phone:"<member>"}` marks attendance for a registered member with no ownership proof (also drives challenge streaks) | P2 | Confirmed (code); carried from prior audit #7 | Public endpoint; the `phone` branch looks the number up in `Users` and writes an `AttendanceRecords` row for that user | No verification that the submitter owns the phone / no OTP | Require auth for registered-user marking or add OTP; keep anonymous path limited to new-participant registration |
| BUG-011 | ID generation (`userIdGen`, `entryIdCounter`) | **Duplicate `USER-N` / `ENTRY-N` under concurrency**: `userIdGen` is a TOCTOU check against a `limit:2000` snapshot; `entryIdCounter` is per-process in-memory with fire-and-forget persistence (duplicates across App Hosting instances, counter can regress) | P2 | Confirmed (code); carried from prior audit #8 | Two concurrent registrations/submissions on different instances | Non-atomic read-then-write; per-instance counter | Allocate via a Firestore transaction / `FieldValue.increment` on a counter doc (or UUID + uniqueness claim) |
| BUG-012 | Email notifications | **All transactional email is a no-op** — `Email.send` only `console.log`s and returns `{success:true}`; registration/approval/reminder flows report success while nothing is delivered | P2 | Confirmed (code); carried from prior audit #12 | Any register/approve/reminder path → console only | `src/lib/app-backend-sdk.ts` `Email` is a mock (`nodemailer` is a dependency but unused) | Implement a real provider or remove the features and their copy |
| BUG-013 | Sadhana scoring (`submitSadhana`, NR path) | **Residual client-trust loophole**: server now validates per-field points and the percent ceiling, but still stores `maxScore = input.maxScore ?? …` for Non-Resident entries — a small client `maxScore` (with `scorePercent` omitted) inflates the stored `scorePercent` while passing the new checks | P2 | Confirmed (code reasoning) | POST `submitSadhana` with valid raw answers but `maxScore: 1` and no `scorePercent` | `buildEntryRecord` NR branch uses client `maxScore` for the stored percent; `assertScoresMatchAnswers` only compares a client-supplied `scorePercent` | Derive `maxScore` server-side from the level/field set; ignore client `maxScore` |
| BUG-014 | Profile (`updateUserProfile`) | `email` is accepted by the input schema but **never written** (dead input / misleading API) | P3 | Confirmed (code) | Call with `email` → returns success, no change | Field accepted but no branch handles it | Remove from schema or implement with verification |
| BUG-015 | Data layer (`Table.create`) | Fallback document id uses `Math.random()` (`rec_…`) — collision-prone, non-sortable | P3 | Confirmed (code); carried from prior audit #30 | Create a record without an explicit id | `Math.random()` fallback | Use `crypto.randomUUID()` |
| BUG-016 | Transport security headers (`next.config.ts`) | No `Content-Security-Policy`; ships deprecated `X-XSS-Protection` | P3 | Confirmed (code); carried from prior audit #29 | Inspect response headers | Config only sets XFO/nosniff/referrer/HSTS/XSS | Add a CSP (nonces); drop `X-XSS-Protection` |
| BUG-017 | Build/quality gate | `eslint .` fails with 4,344 problems (3,790 in `src`); 2 TS errors in `tests/` | P3 | Confirmed (executed) | `eslint .` / `tsc --noEmit` | Mostly `no-explicit-any`; two test type errors | Tighten types incrementally; fix the two test type errors; make CI fail on new violations |

---

## 3. Test-results appendix (executed)

Command: `TSX_TSCONFIG_PATH=./tsconfig.json node --import ./node_modules/tsx/dist/loader.mjs --test --test-concurrency=4 tests/*.test.ts` (emulator suites excluded).

**Total: 351 tests · 341 pass · 10 fail (9 distinct cases).**

| Failing test | File | Classification |
|---|---|---|
| API and upload routes reject forged tokens before any profile lookup | `auth-token-verification.test.ts` | **Environment** — no Firebase Admin default app / no ADC credentials in this sandbox; the route correctly returns 401 but the test's async ADC load rejects afterward |
| server preview accepts a form-valid row and resolves a residency name | `bulk-user-management.test.ts` | **Environment/data** — `docs/zite-backups` contains no CSV fixtures, so the mock `FolkResidencies` store is empty and the residency can't resolve. Not a code verdict |
| cold member directory starts scoped history before dropdown labels finish | `cold-report-concurrency.test.ts` | **Confirmed defect** (BUG-003) |
| BV approval without a group keeps the member unassigned and in the admin directory | `bv-approval-without-group.test.ts` | **Confirmed defect** (BUG-004) |
| one-to-one Sadhana context resolves alternate user identities and stored score percentages | `one-to-one-sadhana-context.test.ts` | **Confirmed defect** (BUG-005) |
| PW progress and entry details use the member department, not the viewer | `sadhana-department-fields.test.ts` | **Confirmed defect** (BUG-006) |
| in-app dispatch reaches missing members with zero native subscriptions… | `sadhana-push-delivery.test.ts` | **Confirmed defect** (BUG-007) |
| supervisor groups include only groups led by reporting RGFs with RGF card metrics | `supervisor-groups.test.ts` | **Confirmed defect** (BUG-008) |
| normal PW admins see only groups under their reporting RGFs | `supervisor-groups.test.ts` | **Confirmed defect** (BUG-001) |

Not runnable here: all `*.emulator.test.ts` (Firestore/Auth emulator required), `tests/e2e/*` (Playwright needs a dev server; and its helper still uses the removed `mock_token_for_*` auth), and the assorted `.js`/`.cjs` browser scripts.

---

## 4. Feature inventory & testing status

309 files in `src/api` (308 endpoints). 1,139 route/endpoint references resolved during the prior audit. Page inventory from `src/App.tsx` (SPA routes):

| Group | Features / routes | Static review | Executed tests | Browser |
|---|---|---|---|---|
| Auth | `/`, `/login`, `/signup`, `/pw`, `/auth-callback`, `/account-link-pending`, `/guide-login`, `/register`, `/pending`, `/rejected`, `/inactive`, `/account-deletion` | Reviewed; token verification fixed to fail-closed (no mock/emulator bypass) | auth test partially (env-blocked) | **Untested** |
| User | `/user/*`, `/sadhana`, `/history`, `/bhaktivriksha`, `/profile` | Reviewed endpoints: `submitSadhana` hardened but residual maxScore loophole (BUG-013); `getUserDashboardData` now windowed | Unit coverage good (sadhana, history window, pw-sadhana) | **Untested** |
| Guide/Super | `/folk-guide/dashboard`, `/super/dashboard`, `/guide/field-setup`, `/guide/users/:id`, `/guide/bv-group/:id`, `/service-management` | Reviewed; directory latency bug (BUG-003) | Partial | **Untested** |
| Admin | `/pw-admin/dashboard`, `/super-admin/dashboard`, `/guide/group stats` | Dead super-admin guard (BUG-001); scope gaps (BUG-009) | supervisor-groups failing | **Untested** |
| BV | `/bvsl/*`, `/rgf/dashboard`, `/rgsf/dashboard`, `/bv-supervisor/dashboard`, `/mentor/dashboard`, `/bv/join`, `/join/:token/pw`, `/join-group` | Reviewed; `getBvGroupDetail` now authorized; `getGroupMembers` still not (BUG-002) | BV suite largely passing | **Untested** |
| Attendance | `/attend/:token`, `/attendance/manage`, `/attendance/dashboard` | Public-forgery gap (BUG-010) | Public/DB tests partial | **Untested** |
| Push/reminders | Service worker, `sendPushNotifications`, reminder schedules | Fallback dispatch defect (BUG-007); email mock (BUG-012) | push-delivery failing | **Untested** |
| Uploads/Storage | `/api/upload`, storage rules | Reviewed; purpose→capability mapping tested and passing; rules default-deny | Passing | **Untested** |

---

## 5. Infinite-loading / stuck-UI report

**Confirmed:** none from live interaction (UI could not be run — see §0). 

**Code-level causes that can produce stuck or slow surfaces (Suspected unless noted):**
- **BUG-003 (Confirmed via test):** the member directory can be delayed indefinitely in this model because it `await`s reference-label reads before starting the data read; if those reads are slow/failing, the directory waits.
- **Firestore-read failure surfacing:** `Table` was hardened to **throw** on read/delete failures (no more "empty collection"). This is a fix, but it means a missing composite index now surfaces as an error state in the UI rather than a blank list — verify the UI's error states are wired (untested here).
- **Offline queue:** `src/lib/offlineQueue.ts` is now actually wired (`sendOrQueue`) instead of dead code — retries/backoff tested and passing.

No endpoint was observed to hang in the executed suites; router-level timeouts are not evident, so a hung upstream read can still leave a request pending — recommend a server-side deadline (there is a `withDeadline` helper already in `src/lib`).

---

## 6. Security & logic loopholes

- **BUG-001** – dead super-admin guard → department-wide report access by a normal admin (P1).
- **BUG-002** – eight endpoints with no authorization check, including a full-user PII export and an Ashray-level mutation (P1).
- **BUG-009** – role-only (unscoped) mutations across centres (P2).
- **BUG-010** – anonymous attendance forgery via public link (P2).
- **BUG-013** – residual client-controlled `maxScore` in NR scoring (P2).
- **BUG-011** – ID generation races (P2).
- Positive findings (fixed since the prior audit, verified): default-deny Firestore/Storage rules; no mock/unsigned token path (`verifyFirebaseIdToken` fails closed and forbids the emulator var in production); `hardDeleteBvGroups` requires wildcard capability + typed confirmation + audit; `getBvGroupDetail`/`getBvslMembers`/`getUserCrmData` now hierarchy-scoped; `assignBvRole` no longer writes email-keyed docs; rate limiting is now shared Firestore-backed (not per-instance); Firestore read/delete errors rethrow instead of masquerading as empty data.

---

## 7. UI/UX problems

**Not executable here — recorded as untested.** Static observations only: deprecated `X-XSS-Protection` and missing CSP (BUG-016); 4,344 lint problems (BUG-017) which correlate with fragile `any`-typed UI state; response headers otherwise reasonable (XFO DENY, nosniff, HSTS, referrer policy). Responsive layout, focus states, contrast, dark/light mode, empty/error/loading states, and keyboard navigation were **not** evaluated and must not be assumed healthy. `test-results/` and `docs/mobile-evidence/` exist and suggest prior mobile work, but I did not validate them.

---

## 8. Performance bottlenecks

- **BUG-003** (Confirmed) – directory blocks on label reads.
- Whole-collection in-memory authorization (`getScopedHierarchyUserIds` reads all Users/Groups/Members/Guides/Residencies per scoped call) — **still present** (prior audit #14), the dominant Firestore cost.
- `deleteAccount` and other sweeps still page whole collections; `getGuideUsers`/`getMentorMembers` still scan large windows.
- Positive: `getUserDashboardData` is now date-windowed and capped; leaderboards read stored period summaries rather than rescanning entries; `serverCache` request-level dedupe works (tests pass).

---

## 9. Root-cause analysis

| Symptom | Root cause | Where |
|---|---|---|
| Cross-centre reads/writes | Authorization is not one enforced layer; `authenticated:true` is treated as sufficient | 223 endpoints without `requiredCapabilities`; handlers in BUG-002/BUG-009 |
| Department-wide report leak | A guard that can never fire (contradictory nested `if`) | `getGuideGroupStats.ts` (BUG-001) |
| Slow member directory | Independent reads serialized behind reference labels | `getGuideUsers.ts` (BUG-003) |
| "Approval did nothing" | No-group branch omits activation/link fields | `approveAndAssignBvMember.ts` (BUG-004) |
| Missing/mislabeled scores & fields | Department/identity resolution drift between viewer and subject | BUG-005/006/008 |
| Silent missing notifications | Fallback dispatch write removed; `Email` still a mock | BUG-007/012 |
| Duplicate IDs | Non-atomic allocation | BUG-011 |

---

## 10. Prioritized fix roadmap

**Phase 0 — before rollout (P1 security):**
1. BUG-001 (dead guard in `getGuideGroupStats`).
2. BUG-002 (add capabilities/scope/ownership to the eight unauthenticated handlers; start with `exportUserData`, `approveAshrayUpgrade`, `getEntryDetail`, `getGroupMembers`).

**Phase 1 — correctness regressions (P2):**
3. BUG-004, BUG-005, BUG-006, BUG-007, BUG-008 (each has a failing test to flip green).
4. BUG-003 (directory latency).
5. BUG-009 (hierarchy scope on financial/BV mutations), BUG-010 (attendance proof), BUG-011 (transactional IDs), BUG-012 (email delivery or remove copy), BUG-013 (server-derived maxScore).

**Phase 2 — hardening & quality:**
6. BUG-014, BUG-015, BUG-016; BUG-017 (lint/type gate).
7. Materialised authorization scope to replace whole-collection scans.
8. Add a real authorization-matrix test per endpoint (not source-string assertions).

**Phase 3 — close the verification gap:**
9. Run the app in a Linux environment (or a proper Linux Node) and execute the browser/e2e flows; refresh the e2e auth helper off the removed mock token and onto the emulator; capture screenshots for UI/UX.

---

## 11. Prior-audit reconciliation (delta since 2026-10-05)

**Fixed / no longer reproduces:** auth token bypass (mock/emulator #1); client-trusted scoring mostly (`submitSadhana` now validates — only the `maxScore` residual remains, BUG-013); `hardDeleteBvGroups` `includes('super')` (#3); `getBvGroupDetail` no-auth (#4); `getUserCrmData` cross-user reads (#5); `getBvslMembers` arbitrary id (#6); `assignBvRole` email-keyed docs (#9); admin routes allowing `USER` (#13); Firestore errors degrading to empty + failed deletes returning success (#21); `updateUserProfile` self department switch (#22); rate-limit throwing 500 (#23); in-memory rate limiting (#19); `sanitize`/email HTML escaping and upload policy (now tested); `offlineQueue` dead code (#17); legacy Vite version checker (#18); unbounded dashboard entry reads (#15); residency substring filter (#28); `getBvGroupDetail`/#6 etc.

**Still open from the prior report:** attendance forgery (#7 → BUG-010); ID-generation races (#8 → BUG-011); unscoped BV approval/deletion (#10 → BUG-009); email no-op (#12 → BUG-012); whole-DB authorization scans (#14, §8); `Math.random` ids (#30 → BUG-015); CSP/X-XSS (#29 → BUG-016).

**New this run:** BUG-001, BUG-002, BUG-003, BUG-004, BUG-005, BUG-006, BUG-007, BUG-008, BUG-013, BUG-014.

---

## 12. Regression test checklist (after fixes)

1. `tsc --noEmit` clean for `src` (and the 2 test type errors fixed).
2. `node --test tests/*.test.ts` (non-emulator) → all green, including the 6 currently failing code tests (BUG-001/003/004/005/006/007/008).
3. Emulator suites: authorization matrix for every endpoint the router exposes — assert 401/403 for an outsider and correct scoping for an insider (esp. BUG-001/002/009).
4. New tests: `getEntryDetail`/`exportUserData`/`getGroupMembers` refuse non-owners; `approveAshrayUpgrade` refuses non-admins; `submitSadhana` with tampered `maxScore` stores the correct percent.
5. Attendance: anonymous phone marking for a registered member is rejected (BUG-010).
6. Browser run: directory/ dashboard load times; no stuck spinners on Firestore errors; responsive + a11y pass.
7. Re-run prior-audit phase-0 tests to confirm the fixes above stay fixed.
