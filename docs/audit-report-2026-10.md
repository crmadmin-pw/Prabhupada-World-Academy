# Prabhupada World Academy — End-to-End Application Audit

**Date:** 2026-10-05
**Scope:** entire repository (Next.js 16 App Router + React 19 SPA, Firebase Auth, Firestore via Admin SDK, Cloud Functions, App Hosting)
**Method:** static trace of UI → endpoint SDK → `/api/run/[endpoint]` router → `Table` adapter → Firestore, plus security rules, storage rules, deployment config, tests, and legacy Zite artifacts.
**Rule followed:** no code was modified. Every finding is tied to a file, function, or rule.

---

## Executive Summary

**Overall quality.** This is an unusually mature codebase for its size. Unlike the typical "client talks straight to Firebase" app, all business data is server-mediated: Firestore and Storage rules are a hard default-deny (`firestore.rules`, `storage.rules`), the API router requires an explicit `authenticated: true` / `public: true` declaration, and permissions are derived server-side from the database record rather than from client claims. Most of the obvious "textbook" vulnerabilities are already closed, and the previous security pass documented in `scratch/firestore_security_analysis.md` is real.

The remaining problems cluster in four areas, and they share root causes:

1. **A two-tier authorization model that is only half-applied.** The precise hierarchy engine in `src/lib/hierarchyUtils.ts` is used by ~24 report endpoints, but a handful of high-value endpoints (`getBvGroupDetail`, `getBvslMembers`, `getUserCrmData`, `approveAndAssignBvMember`, `deleteBvGroup`, `hardDeleteBvGroups`) bypass it with ad-hoc string/flag checks. That inconsistency is the single largest security theme.
2. **Business rules that are still computed on the client.** `submitSadhana` accepts per-field points and `maxScore` from the browser and trusts them for non-resident scoring. Server-authoritative scoring is claimed in comments but does not hold for the main FOLK use case.
3. **`Users` documents used as the universal join table.** Identity is matched by a shotgun of `id | userId | email | uid | authUid | …` aliases, and several write paths create **documents keyed by email/userId**. This is the root cause of the duplicate-user symptoms the code dedupes in at least five places.
4. **Per-request whole-database scans for authorization.** `getScopedHierarchyUserIds` reads every Users / BvGroups / BvGroupMembers / Guides / FolkResidencies document in memory on *every* scoped call.

**Biggest architectural problem.** Authorization scope is recomputed by loading entire collections into memory per request (`getScopedHierarchyUserIds`), while duplicate identity is patched by ad-hoc alias matching in each endpoint. Both should be one enforced layer (Server Actions / an auth-scoped repository), not repeated logic.

**Biggest security risk.** `submitSadhana` server-trust of client scoring plus `getBvGroupDetail` / `getUserCrmData` / `getBvslMembers` cross-hierarchy PII reads. Individually High; the scoring one is business-critical because it drives leaderboards, Ashray eligibility and reports.

**Biggest data-integrity problem.** `entryIdCounter` and `userIdGen` both advertise "race-condition-proof" uniqueness but are process-local / TOCTOU, so concurrent submissions and concurrent registrations can mint duplicate `ENTRY-N` / `USER-NNN` values — the exact identifiers reports and role resolution rely on.

**Biggest UX problem.** Every transactional email is a no-op. `Email.send` in `src/lib/app-backend-sdk.ts` only `console.log`s. Registration-received, approval, guide-notification, and reminder emails are never delivered, while the UI copy explicitly promises them.

**Biggest scalability concern.** Unbounded / whole-collection reads: `getScopedHierarchyUserIds` (full collections per call), `getUserDashboardData` (all-time entries per user, no date bound), `getGuideUsers` / `getMentorMembers` (up to 6000+ entries with in-memory filtering), `getAllBvGroupsAdmin`, `deleteAccount` (`findAll({limit:5000})` × 11 tables). At 10× data these become the Firestore cost and latency ceiling.

---

## 🔴 CRITICAL

### [CRITICAL] Client-supplied scoring is trusted for Sadhana scores and leaderboards

**Category:** Security / Business Logic / Data Integrity
**Location:** `src/api/submitSadhana.ts` → `buildEntryRecord()` (NR branch), and its `inputSchema` (`maxScore: z.number().int().min(0).max(10000).optional()`).

**Current implementation.** For non-resident entries the function computes:

```ts
const chantingPts  = Number(fv._pts_chanting ?? perField.chanting ?? fv._nr_pts_chanting ?? 0);
...
correctedTotalScore = chantingPts + readingPts + hearingPts + nrFillingSameDayFinal + ...
correctedMaxScore   = input.maxScore ?? getNRMaxScore(ashrayLevel);
```

`fv` is `input.fieldValues` (a free-form `z.record(z.string().any())`) supplied by the browser. `_per_field` is also client-supplied ("set by enrichFieldValues() on frontend"). Only `fillingSameDay` is overridden server-side. The comment even states: *"server trusts frontend for individual field pts"*.

**Problem.** A student can send arbitrary per-field points (and a small `maxScore`) and obtain any `totalScore`/`scorePercent` they want. `scorePercent` is clamped to 100 but `totalScore` is not bounded relative to what the form can produce.

**Why it matters.** Scores feed leaderboards, `AshrayUpgradeRequests`, guide/mentor reports, streak badges and progression criteria. This is gameable by any authenticated student with a proxy — no admin access required.

**Example / Reproduction.**
```http
POST /api/run/submitSadhana
Authorization: Bearer <student id token>
{
  "userId":"USER-042","entryDate":"2026-10-05","totalScore":0,"maxScore":1,
  "templateMode":"Non-Resident","fieldValues":{
    "_per_field":{"chanting":50,"reading":50,"hearing":50,"wakeUptime":50,
                  "sleepTime":50,"seva":50,"bhaktiVriksha":50},
    "chanting":1
  }
}
```
→ stored entry with a 100% score for a day the student barely practised.

**Recommended solution.** Score entirely on the server from raw field values using `src/lib/scoring.ts`, clamped by the level's real maximum from `config/sadhanaFields.ts`; reject unknown `_pts_*` / `_per_field` keys; ignore `input.maxScore` (derive it). Treat the FOLK NR path exactly like the PW path already does in the same function (`scorePwSadhana`).

**Confidence:** High.

---

### [CRITICAL] Authentication token verification has signature-bypass branches, one gated by a *public* env var

**Category:** Security / Authentication
**Location:** `src/app/api/run/[endpoint]/route.ts` → `verifyToken()`.

**Current implementation.** Three non-signature-verified paths exist:
1. `token.startsWith('mock_token_for_')` returns `{email, uid: email}`; blocked in production **only if `NEXT_PUBLIC_USE_AUTH_EMULATOR !== 'true'`**.
2. If `process.env.FIREBASE_AUTH_EMULATOR_HOST` is set, the JWT payload is base64-decoded with no signature check.
3. If Admin is not initialized and `NODE_ENV === 'development'`, the JWT payload is decoded with no signature check.

**Problem.** Branch 1 is gated by `NEXT_PUBLIC_USE_AUTH_EMULATOR`, a *client-visible* variable. A single mis-set App Hosting env var converts the deployment into "anyone can authenticate as any email". Branch 2 keys off `FIREBASE_AUTH_EMULATOR_HOST`, which Firebase tooling can set in a container.

**Why it matters.** With `mock_token_for_<any email>` an attacker becomes any user, including the Super Admin identified by `resolveDatabaseUser`'s email fallback — full data and admin access.

**Example / Reproduction.**
```
NEXT_PUBLIC_USE_AUTH_EMULATOR=true   # set once "just for testing"
Authorization: Bearer mock_token_for_admin@example.org
→ context.user resolved from that email; capabilities ['*'] if the record is SUPER_ADMIN.
```

**Recommended solution.** Delete the mock path from production code (keep it behind an explicit `NODE_ENV !== 'production' && EMULATOR` guard that cannot be reached via `NEXT_PUBLIC_*`), and verify config at boot (fail fast if emulator vars are present with `NODE_ENV=production`).

**Confidence:** High (code), Medium (that a deployment is currently mis-configured).

---

### [CRITICAL] `hardDeleteBvGroups` treats any role containing the substring "super" as Super Admin and can wipe every BV group

**Category:** Security / Privilege Escalation / Data Loss
**Location:** `src/api/hardDeleteBvGroups.ts` (`isSuperAdmin`, `deleteAll`).

**Current implementation.**
```ts
const isSuperAdmin = !!(context.user.isBvSuperAdmin || (context.user.role || '').toLowerCase().includes('super'));
if (!isSuperAdmin) throw ...
if (input.deleteAll === true) { /* delete every BvGroups + BvGroupMembers document */ }
```
No `requiredCapabilities` is declared.

**Problem.** `"supervisor".includes('super')` and `"superviser".includes('super')` are both `true`. The endpoint performs an irreversible, unbounded delete of all groups and memberships.

**Why it matters.** A privilege-escalation typo in one guard deletes the entire Bhakti Vriksha structure. `getDashboardHierarchyScope`/`ProtectedRoute` elsewhere treat `SUPERVISOR`/`BV_SUPERVISOR` as non-admin, so this guard contradicts them.

**Example / Reproduction.** A legacy record with `role: "Supervisor"` calls `{ "deleteAll": true }` and removes all groups — no confirmation required at the API layer.

**Recommended solution.** Require `capabilities.includes('*')` or `isBvSuperAdmin`, never a substring; add an explicit `confirmText: "DELETE ALL"`; log to an audit collection.

**Confidence:** High (that the check is wrong), Medium (current exploitability depends on legacy role strings).

---

### [CRITICAL] `getBvGroupDetail` has no authorization at all — any authenticated user can read any group's member PII and join token

**Category:** Security / IDOR / PII
**Location:** `src/api/getBvGroupDetail.ts` (`execute: async ({ input })`, no `requiredCapabilities`). Reachable from `/bvsl/groups/:groupId` and `/guide/bv-group/:groupId`, whose `allowedRoles` include `'USER'` (`src/App.tsx`).

**Current implementation.** `execute` never reads `context.user`. It fetches the group by the caller-supplied `groupId`, then returns every active membership with `fullName`, `phone`, `ashrayLevel`, `attendanceRate`, plus `group.joinToken` and `group.whatsAppLink`.

**Problem.** A plain member — or any authenticated account — can enumerate groups and harvest member phone numbers and the group join token.

**Why it matters.** PII disclosure of the entire membership base, plus token leakage that lets attackers self-enrol.

**Example / Reproduction.**
```http
POST /api/run/getBvGroupDetail { "groupId": "<any groupId>" }
→ { group:{ joinToken, whatsAppLink }, members:[{ phone, ... }] }
```

**Recommended solution.** Add `requiredCapabilities: 'bv.manage'` **and** a scope check (`getScopedHierarchyUserIds`) that the group belongs to the caller; return `joinToken` only to the group owner/admin.

**Confidence:** High.

---

## 🟠 HIGH

### [HIGH] `getUserCrmData` lets mentors/facilitators/trip coordinators read any user's rent, trip and Ashray records

**Category:** Security / IDOR (financial PII)
**Location:** `src/api/getUserCrmData.ts`.

**Current implementation.**
```ts
const isGuide = ['Guide','Super Guide','BVSL','Sadhana Mentor'].includes(context.user.role || '')
  || !!(context.user.isBvsl || context.user.isSadhanaMentor)
  || !!context.user.isFolkLead || !!context.user.isTripCoordinator;
if (!isOwnData && !isGuide) throw FORBIDDEN;
```
There is no hierarchy check on `input.userId`.

**Problem.** Any BVSL / Sadhana Mentor / Folk Lead / Trip Coordinator can pass an arbitrary `userId` and read that person's `RentPayments`, `Trips` and `AshrayUpgradeRequests`.

**Why it matters.** Financial records of every resident are exposed to a broad class of roles across all centres.

**Example / Reproduction.** A newly-tagged `isTripCoordinator` sends `{ "userId": "<any resident>" }` and receives full rent/trip history.

**Recommended solution.** Replace the role list with `getScopedHierarchyUserIds`/`isUserInHierarchy`, or restrict rent/trip reads to `isFolkLead`/`isTripCoordinator` for their own centre.

**Confidence:** High.

---

### [HIGH] `getBvslMembers` accepts an arbitrary `bvslId` and returns that group's member contacts

**Category:** Security / IDOR / PII
**Location:** `src/api/getBvslMembers.ts`.

**Current implementation.** No `requiredCapabilities`. When `input.bvslId` is provided the function resolves groups led by that id and returns their members' `fullName`, `phone`, `email`, `ashrayLevel`. The only role check (`isSuperGuide`) applies to the *fallback* path.

**Why it matters.** Same PII class as the item above, reachable by any authenticated user.

**Example / Reproduction.** `{ "bvslId": "<other RGF's id>" }` → member phone/email list of a group the caller has no relationship with.

**Recommended solution.** Require `bv.manage` and constrain `bvslId` to the caller or their hierarchy; drop email/phone from the payload unless it is the caller's own group.

**Confidence:** High.

---

### [HIGH] `markSessionAttendance` marks attendance for any member from an unauthenticated page

**Category:** Security / Data Integrity
**Location:** `src/api/markSessionAttendance.ts` (phone branch).

**Current implementation.** Public endpoint; the only proof is the session `shareToken`. The phone branch looks the number up in `Users` and writes an `AttendanceRecords` row owned by the matched user, with no verification that the submitter owns that phone.

**Problem.** Attendance (and challenge streaks, which drive `ChallengeEnrollments`) can be forged for other members by anyone who has the shared link and knows a phone number.

**Why it matters.** Attendance integrity is a core program metric; phone numbers are not secrets.

**Example / Reproduction.** With the WhatsApp-shared `/attend/<token>` link, POST `{ "phone": "<member's number>" }` repeatedly for each member.

**Recommended solution.** Require the caller to be authenticated for registered-user marking, or send an OTP to the phone; keep the anonymous path limited to `registerAndAttend` (new participants only).

**Confidence:** High.

---

### [HIGH] All transactional email is a no-op (`Email.send` only logs)

**Category:** Functional / UX / Data Flow
**Location:** `src/lib/app-backend-sdk.ts` → `Email.send` ("Email Mock"); used by `registerUser`, `approveUser`, `approveAshrayUpgrade`, `sendSadhanaReminders`, `sendServiceReminders`, etc.

**Current implementation.**
```ts
export const Email = { send: async (params) => { console.log(...); return { success: true }; } };
// In production, configure nodemailer/SMTP here.
```
`nodemailer` is a declared dependency but is imported nowhere in `src` (verified by search).

**Problem.** Registration-received, guide-notification, approval and reminder emails are silently never delivered while the API returns success and the UI text promises them.

**Why it matters.** Guides never learn a member is awaiting approval; devotees never get approval confirmations or reminders; `sendSadhanaReminders`/`sendServiceReminders` — entire cron features — are no-ops that report `sent: N`.

**Recommended solution.** Implement `Email.send` with a real provider (SMTP or a transactional email service) and fail loudly when delivery fails; or remove the features and their copy.

**Confidence:** High.

---

### [HIGH] Duplicate `userId` / `entryId` generation under concurrency

**Category:** Data Integrity / Race Condition
**Location:** `src/lib/userIdGen.ts` (`generateUniqueUserId`) and `src/lib/entryIdCounter.ts` (`nextSadhanaEntryId` / `nextBvEntryId`).

**Current implementation.**
- `generateUniqueUserId` reads `Users.findAll({fields:['userId'], limit:2000})`, computes the max, checks a *snapshot* set, and retries against that same snapshot. The doc-comment claims it is "race-condition-proof"; it is a TOCTOU check against stale data, and the `limit: 2000` means once the collection exceeds 2000 documents the max can be computed from an incomplete page.
- `entryIdCounter` keeps `sadhanaN` in module scope and persists it fire-and-forget to a `Config` row. With App Hosting `maxInstances: 10`, two instances start from the same `Config` value and each mint the same `ENTRY-N`; the last write wins, so the persisted counter can also regress and re-issue old ids.

**Why it matters.** `userId` is the human-facing identity used by approval/role resolution; `entryId` is displayed as the entry's unique number. Duplicates make records ambiguous and break the user-facing ID contract that `resolveUser`/`resolveRegistrationUser` depend on.

**Example / Reproduction.** Two registrations land on two instances: both read max `USER-044`, both return `USER-045`. Minutes later `getUserDetailForGuide('USER-045')` resolves to whichever row Firestore returns first.

**Recommended solution.** Use a Firestore transaction / `FieldValue.increment` on a counter document (Admin SDK supports this atomically) or a UUID; if a readable sequential id is required, allocate it in a transaction and enforce uniqueness with a claim document keyed by the id.

**Confidence:** High.

---

### [HIGH] `assignBvRole` writes `Users` documents keyed by email/userId, creating duplicate identity documents

**Category:** Data Integrity / Architecture
**Location:** `src/api/assignBvRole.ts` (end of `execute`).

**Current implementation.**
```ts
await Users.update({ id: dbId, record: updates });
if (targetUser.id && targetUser.id !== dbId) await Users.update({ id: targetUser.id, record: updates });
if (targetUser.userId && targetUser.userId !== dbId) await Users.update({ id: targetUser.userId, record: updates });
if (targetUser.email) await Users.update({ id: targetUser.email.toLowerCase(), record: updates });
```
`Table.update` uses `collection.doc(id).set(data, { merge:true })`, so `id = "someone@example.com"` **creates a new Users document whose id is the email** when none exists.

**Problem.** This manufactures the exact duplicate-user state that other code spends hundreds of lines deduplicating by alias sets (see comments in `getGuideDetailedReport`, `getGuideUsers`, `getUserProfile`). Two documents for one person also desynchronise role flags.

**Why it matters.** Duplicate records are a root cause of the reported "role did not apply", "member not found", and "duplicate row" symptoms, and they inflate `getScopedHierarchyUserIds` reads.

**Example / Reproduction.** Re-run `assignBvRole` for a member with no legacy alias documents → a new doc `Users/email@x` appears alongside `Users/<uid>`.

**Recommended solution.** Resolve one canonical document id and update only that. Never use a non-document-id value as a `Table.update` id.

**Confidence:** High.

---

### [HIGH] `approveAndAssignBvMember` and `deleteBvGroup` are not hierarchy-scoped

**Category:** Security / Broken Access Control
**Location:** `src/api/approveAndAssignBvMember.ts` (`isAuthorized` includes `GUIDE`, `isBvSupervisor`), `src/api/deleteBvGroup.ts` (`canDelete` includes `GUIDE`, `ADMIN`, …).

**Current implementation.** Both check only a role/flag and then act on a caller-supplied `registrationId` / `groupId` with no `isUserInHierarchy`/`getScopedHierarchyUserIds` verification.

**Problem.** A GUIDE or Supervisor from one centre can approve, assign to any group, or delete any group anywhere.

**Why it matters.** Cross-tenant (cross-centre) mutation of the membership graph; `deleteBvGroup` additionally unassigns every member.

**Recommended solution.** Add the shared scope check used by the report endpoints.

**Confidence:** High.

---

### [HIGH] Whole-database in-memory authorization on every scoped request

**Category:** Performance / Firebase Cost / Architecture
**Location:** `src/lib/hierarchyUtils.ts` → `getScopedHierarchyUserIds` (reads Users + BvGroups + BvGroupMembers + Guides + FolkResidencies in 2000-doc pages), called per request by ~24 endpoints.

**Current implementation.** `Promise.all([readAll(Users, …), readAll(BvGroups, …), readAll(BvGroupMembers, …), readAll(Guides, …), readAll(FolkResidencies, …)])` then `resolveHierarchyScope`.

**Problem.** Compute and read cost grow linearly with the *entire* user base for every report invocation, even when the caller only needs their own handful of members.

**Why it matters.** This is the dominant Firestore read and latency cost. At 10× users (≈5 000 Users, ≈5 000 memberships) one page load issues tens of thousands of document reads; at 100× it is unsustainable.

**Recommended solution.** Maintain a materialised scope (e.g. `scope`/`reportingChain` array on `Users`, or a `UserScope` collection) updated on role changes, and query it with `in`.

**Confidence:** High.

---

### [HIGH] Unbounded per-user read of all Sadhana entries

**Category:** Performance / Firebase Cost
**Location:** `src/api/getUserDashboardData.ts` (one `findAll({filters:{user:ownerId}})` with **no date bound and no limit** per owner alias), and `src/api/getUserHistory`/`getUserProgressStats` similarly.

**Problem.** A user with years of entries pulls their entire history on every dashboard load, then filters in memory.

**Why it matters.** Directly increases Firestore reads and response size over time.

**Recommended solution.** Add `entryDate >= <window>` (with the composite index) and a hard `limit`.

**Confidence:** High.

---

### [HIGH] Route guards explicitly allow `USER` on admin dashboard routes

**Category:** Security / Defense in Depth / UX
**Location:** `src/App.tsx` (`/folk-guide/dashboard`, `/pw-admin/dashboard`, `/super-admin/dashboard` all list `allowedRoles` containing `'USER'`); `ProtectedRoute.hasAccess` returns `true` for any allowed list containing `USER`.

**Problem.** A plain active member passes the route guard into admin dashboard shells; security then depends entirely on each endpoint's capability check and each component's internal role logic. As shown above, several endpoints behind those tabs have no capability, so the guard is the only thing that would have stopped them.

**Recommended solution.** Remove `'USER'` from admin routes; keep the endpoint checks as the second layer.

**Confidence:** High.

---

### [HIGH] `deleteAccount` cascade is incomplete and trivially triggerable

**Category:** Data Integrity / UX
**Location:** `src/api/deleteAccount.ts`.

**Current implementation.** Deletes records in 11 tables plus the Firebase Auth user. The confirmation gate is `if (!input.confirm && input.confirmText !== 'DELETE') return { success:false }` — **`confirm: true` alone is sufficient**.

**Problems.**
1. Not deleted: `RentPayments`, `Trips`, `ServiceAllocations`, `ServiceRatings`, `AttendanceRecords`, `BvslPreachingEntries`, `AshrayUpgradeRequests`, `JigyasaRegistrations`, `ChallengeEnrollments`, `OneToOneMeetings` (partially), plus all Firebase Storage uploads. Orphaned financial and service records remain, still addressed by the deleted user's old id.
2. The `belongsToUser` sweep iterates `findAll({limit:5000})` per table (cost).
3. A single boolean destroys the account with no typed confirmation, no re-auth, and no grace period.

**Why it matters.** Orphaned records corrupt reporting and re-registration; accidental deletion (a stray `confirm:true`) loses data permanently.

**Recommended solution.** Soft-delete + scheduled purge; cascade or anonymise all tables that reference the user; require typed confirmation and a fresh re-auth; rate-limit.

**Confidence:** High.

---

## 🟡 MEDIUM

### [MEDIUM] Two competing client caches for the same server state
**Category:** State Management / Correctness — `src/utils/cache.ts` + `src/hooks/useQuery.ts` (SWR-style, used by `FolkUserDashboard`, `PwUserDashboard`, `HistoryPage`) run alongside the endpoint cache in `src/lib/app-endpoints-sdk.ts`. The realtime invalidation stream only knows about the SDK cache, so `useQuery` pages can display stale data after a mutation until their TTL expires. **Fix:** delete `utils/cache.ts`/`useQuery` and use the SDK cache + `useRealtime` everywhere. **Confidence:** High.

### [MEDIUM] `offlineQueue.ts` is dead code that promises sync it never performs
**Category:** Code Quality / UX — `enqueueOfflinePayload`/`processOfflineQueue` have no callers (verified by search). The module still registers an `online` listener that toasts "Syncing N pending record(s)…" and stores payloads (potentially PII) in `localStorage`. **Fix:** remove or wire it up. **Confidence:** High.

### [MEDIUM] Version checker is legacy Vite code and can never fire; if repaired as written it would discard drafts
**Category:** Deployment / UX — `App.tsx` `getLocalScriptPath()` matches `script[src]` at `/assets/index-*.js` and `fetchRemoteScriptPath()` regexes the same path out of `index.html`. This is a Next.js app: `public/assets` does not exist and Next emits `/_next/static/chunks/*`. The mechanism is therefore inert (users can run stale bundles indefinitely). If it were made to match, its `visibilitychange` handler reloads the page whenever a new deploy exists (30 s cooldown), which would discard in-progress long forms (quiz, sadhana). **Confidence:** High.

### [MEDIUM] In-memory rate limiting is non-distributed, duplicated, and leaks memory
**Category:** Security / Performance — `src/app/api/run/[endpoint]/route.ts` `rateLimitMap` and `src/utils/rateLimit.ts` `rateLimitStore` are per-instance `Map`s that never evict entries. With multiple App Hosting instances an attacker gets N× the limit; the maps grow unbounded under token/IP churn. Public write endpoints (`registerAndAttend`) have no endpoint-level quota beyond the global IP bucket. **Confidence:** High.

### [MEDIUM] `serverCache` is per-instance; cross-instance invalidation is impossible
**Category:** Architecture / Correctness — `src/lib/serverCache.ts` `serverCacheInvalidate()` clears only the local process. Role/profile/reference caches (`getGuides` TTL 10 s, residencies 5 s, `bvslMembers` 5 min) can serve stale data on other instances after an admin change. `getGuides` caches the public directory, and per-caller scoping happens after retrieval, which is correct but still exposes the divergence for reference data. **Confidence:** Medium-High.

### [MEDIUM] Firestore errors silently degrade to empty results
**Category:** Error Handling — `Table.findOneUncached`/`findAllUncached` swallow Firestore errors and fall through to the (empty in production) mock store; `ensureFirestoreInProduction` only checks that credentials exist. A missing composite index or transient error therefore returns `null`/`[]` instead of an error, producing blank dashboards with no surfaced cause. `Table.deleteUncached` additionally does **not** rethrow in production (unlike create/update), so a failed delete returns success. **Confidence:** High.

### [MEDIUM] `updateUserProfile` lets a user silently change their own department
**Category:** Business Logic — `input.guideId` sets `updates.segment` / `isPrabhupadaWorldUser` from the chosen guide. A user can move themselves between FOLK and PW, which changes which Sadhana form, dashboards and reports apply. The `email` field in the schema is accepted but never written (dead input). **Fix:** only allow guide/segment changes through the approval or transfer flows. **Confidence:** High.

### [MEDIUM] `deleteAccount` and other endpoints scan whole collections in memory
**Category:** Performance — `deleteAccount` (11 × `findAll({limit:5000})`), `getUserProfile` (`Users.findAll({limit:200})` email fallback), `getGuideUsers` (up to 6 000 entries), `getMentorMembers` (paged full scan), `resolveRegistrationUser` (`Users.findAll({limit:5000})`). **Fix:** index-backed lookups. **Confidence:** High.

### [MEDIUM] Test coverage leaves the highest-risk paths untested
**Category:** Testing — `tests/security-policy.test.mjs` asserts *source strings* (`assert.match(source, /requiredCapabilities:…/)`), not behaviour. There is no test that a non-owner receives 403 from `getBvGroupDetail`, `getBvslMembers`, `getUserCrmData`, or that `submitSadhana` rejects tampered `_per_field`. Realtime/authz emulator tests exist and are a good foundation. **Fix:** add authorization-matrix tests against the emulator for these endpoints plus a scoring-tamper test. **Confidence:** High.

### [MEDIUM] `enforceRateLimit` and the router limiter throw generic `Error`
**Category:** Error Handling — `enforceRateLimit` throws `new Error('Rate limit exceeded…')` with no `code`, so the router maps it to HTTP 500 (only `AppError` codes are mapped). A rate-limited caller sees "Internal Server Error"/500 instead of 429. **Confidence:** High.

### [MEDIUM] `getSadhanaLeaderboard` recomputes streaks and scans entries for all users on every call
**Category:** Performance — for historical ranges it pages through every Sadhana entry in the window; also mixes `scorePercent` and `totalScore` math. **Fix:** precompute monthly summaries (`SadhanaMonthlySummaries` already exists but appears unused for this). **Confidence:** Medium.

### [MEDIUM] `resolveDatabaseUser` email-links and deletes documents automatically
**Category:** Correctness / Security — on first login for a bulk-created profile it writes `firebaseUid` onto the matched record and `Users.delete`s the uid-keyed record. This is a silent identity merge triggered by request timing; a duplicate or mis-keyed record can attach a Firebase uid to the wrong profile. **Fix:** link through an explicit, audited flow. **Confidence:** Medium.

### [MEDIUM] `getAllResidencies` substring filter is case-sensitive and over-broad
**Category:** Business Logic — `!r.residencyName.includes('Prabhupada World') && !r.residencyName.includes('PW')` hides any FOLK residency containing "PW" and misses lowercase variants. **Confidence:** High.

### [MEDIUM] `sanitizeInputText` sanitizer is unused
**Category:** Code Quality / Security — `src/lib/sanitize.ts` is imported nowhere (verified search; only match is in an exported docs JSON). Freeform text (`fullName`, meeting titles, notes) is stored raw and later interpolated into HTML email bodies in `registerUser`/`approveUser` (`<strong>${guideRecord.fullName}</strong>`). **Fix:** either remove the file or apply provider-side HTML escaping at the mail boundary. **Confidence:** High (unused), Medium (XSS would become real once email is implemented).

### [MEDIUM] `lookupPhone` status oracle
**Category:** Security — authenticated `lookupPhone` returns whether a phone is registered and its status. Rate limited only per phone (10/min) and only in-process; with multiple instances it is a usable enumeration oracle for phone numbers. **Confidence:** Medium.

---

## 🔵 LOW

- **[LOW] Deprecated / missing security headers** — `next.config.ts` sets `X-XSS-Protection: 1; mode=block` (ignored by modern browsers, can introduce issues) and ships **no** `Content-Security-Policy`. Add a CSP with nonces and drop `X-XSS-Protection`.
- **[LOW] `/api/push-events` is a 410 tombstone** (`src/app/api/push-events/route.ts`) — dead endpoint retained for old service workers; harmless but undocumented in the API surface.
- **[LOW] `AuthCallbackGuard` hard 20 s `window.location.href = '/dashboard'`** (`src/layouts/RouteGuards.tsx`) — a forced navigation that bypasses the normal routing decisions and can drop a user on the wrong page.
- **[LOW] `getVapidPublicKey` / `sadhanaNotification.ts` hardcode the same fallback public key** in two places — public keys are not secret, but the duplication will drift.
- **[LOW] `Table.create` id fallback uses `Math.random()`** (`rec_${Math.random()...}`) — collision-prone and non-sortable; use `crypto.randomUUID`.
- **[LOW] `getBvslMembers` contains a hardcoded `'hiranya'` special case** (`input.bvslId.toLowerCase().includes('hiranya')`) — a name-based data workaround embedded in authorization logic.
- **[LOW] Exact-string role comparisons** in `bulkUpdateUserFlags` (`'Super Guide'`, `'Guide'`, `'BVSL'`), `getUserCrmData`, `getBvslMembers`, `updateUserStatus` — brittle across legacy casing ("Super Guide" vs "SUPER_GUIDE").
- **[LOW] PII in server logs** — `Email.send` logs recipient address and full body; `deleteAccount` logs Firebase uid. Add log scrubbing.
- **[LOW] `markSessionAttendance` compares `shareToken` with `!==`** (not timing-safe) — acceptable for a low-entropy share link, but note it.
- **[LOW] `getSessionByToken` returns `event.customFields` raw** — any future HTML rendering of that field must escape it.
- **[LOW] `.env` contains working VAPID private keys** (git-ignored, and different from the App Hosting secret) — ensure the production pair is never mirrored into a tracked file; `apphosting.yaml` correctly references Secret Manager and only exposes the *public* VAPID key and the Firebase client config (not a vulnerability).
- **[LOW] `scratch/firestore_security_analysis.md` and `docs/Prabhupada World Academy App Code.json`** are committed working artifacts (the latter is a full Zite export containing the legacy schema) — move out of the repo or document their status.

---

## Root-cause map

```
Symptom A: cross-centre reads/writes        →  Root cause: two-tier authorization
Symptom B: member PII exposed by endpoints  →  (hierarchyUtils used by reports,
Symptom C: admin shells reachable by USER   →   ad-hoc role checks elsewhere)
        ↓
Root cause: authorization is not a single enforced layer

Symptom D: duplicate/"wrong" user rows      →  Root cause: Users used as universal join table,
Symptom E: role change didn't apply         →   writes keyed by email/userId, alias matching
Symptom F: member not found                 →   duplicated in ~5 endpoints
        ↓
Root cause: identity resolution by alias heuristic instead of one canonical id

Symptom G: dashboard blank after deploy     →  Root cause: Firestore errors degraded to
Symptom H: silent empty reports             →   empty arrays; missing-index failures hidden

Symptom I: leaderboard/score inflation      →  Root cause: business rules still computed
                                               on the client and trusted server-side

Symptom J: rising Firestore bill / latency  →  Root cause: whole-collection scans per request
```

---

## Attack simulation (authenticated member, lowest privilege)

| Attempt | Works today? | Where |
| --- | --- | --- |
| Read any group's member phones + join token | **Yes** | `getBvGroupDetail` (no authz) |
| Read any RGF's member emails/phones | **Yes** | `getBvslMembers({bvslId})` |
| Read any user's rent/trips/Ashray | **Yes, if tagged** `isTripCoordinator`/`isFolkLead`/`isBvsl`/`isSadhanaMentor` | `getUserCrmData` |
| Inflate own score to 100% | **Yes** | `submitSadhana` NR branch |
| Approve/assign any BV member anywhere | **Yes, if** `GUIDE`/`isBvSupervisor` | `approveAndAssignBvMember` |
| Delete any BV group anywhere | **Yes, if** `GUIDE` | `deleteBvGroup` |
| Wipe all BV groups | Yes if any role string contains "super" | `hardDeleteBvGroups` |
| Open admin dashboard shells | **Yes** | `App.tsx` routes allow `USER` |
| Read another user's profile | No | `getUserProfile` self-scoped |
| Move selection of another guide | No | `updateUserProfile` acts on `context.user.id` |
| Query Firestore/Storage directly | No | default-deny rules |

## Attack simulation (unauthenticated)

| Attempt | Works today? | Where |
| --- | --- | --- |
| Enumerate guides/residencies | Yes (by design) | `getGuides`, `getAllResidencies` (emails stripped for public callers) |
| Forge attendance for a member | **Yes**, with a session share link | `markSessionAttendance` |
| Spam participant creation | Yes, per IP bucket | `registerAndAttend` |
| Trigger reminder/push blasts | No | internal `cronSecret` / `APP_REMINDER_SECRET` checks |
| TagMango webhook | No | `publicSecretEnv: APP_TAGMANGO_WEBHOOK_SECRET` |
| Impersonate via mock token | Only if `NEXT_PUBLIC_USE_AUTH_EMULATOR=true` | `verifyToken` |

---

## Remediation roadmap

### Phase 0 — Immediate, before any further deployment
1. Remove the `mock_token_for_*` path (or hard-gate on `NODE_ENV !== 'production'` **and** an emulator var that is not `NEXT_PUBLIC_*`), and add a boot-time assertion that emulator vars are absent in production. *(Blocks everything else.)*
2. `hardDeleteBvGroups`: replace the `includes('super')` check with `capabilities.includes('*') || isBvSuperAdmin`, require `confirmText`, add an audit log.
3. `getBvGroupDetail`: add `requiredCapabilities: 'bv.manage'` + scope check; stop returning `joinToken`.
4. Make `submitSadhana` compute NR scores server-side from raw values; ignore client `maxScore` and `_per_field`.

### Phase 1 — Data integrity & critical correctness
5. `getUserCrmData`, `getBvslMembers`: enforce hierarchy scope.
6. `markSessionAttendance`: OTP or authenticated-only registered marking.
7. Replace `userIdGen`/`entryIdCounter` with transactional allocation; add a uniqueness claim.
8. Fix `assignBvRole` to write only the canonical document id.
9. Fix `deleteAccount`: soft delete, full cascade/anonymisation, typed confirmation, Storage cleanup.
10. Implement real email delivery (or remove the features/copy).
11. `approveAndAssignBvMember`/`deleteBvGroup`: add hierarchy scope.

*Depends on:* 1 (token fix) so that identity is trustworthy while 5–11 are validated.

### Phase 2 — Architecture & backend
12. Materialise authorization scope; replace `getScopedHierarchyUserIds` whole-collection scans.
13. Add a shared `assertUserInScope(context, targetId)` helper and adopt it in every endpoint; delete ad-hoc role string checks.
14. Surface Firestore errors (do not degrade to empty arrays); rethrow failed deletes in production.
15. Move rate limiting to a shared store (Firestore/Upstash) with a bounded TTL.
16. Remove `'USER'` from admin routes.

*Depends on:* 12 before 13 can be efficient; 13 depends on 1 and Phase 1 items for correctness.

### Phase 3 — UX / UI
17. Remove `VersionChecker` (or port it to Next's build id) and ensure any update prompt never discards an in-progress form.
18. Delete `offlineQueue.ts` or wire it to real submission retry.
19. Unify to one client cache; remove `useQuery`/`utils/cache.ts`.
20. Fix rate-limit error surfacing (429 with a friendly message).
21. Replace forced `/dashboard` navigation in `AuthCallbackGuard` with normal routing.

*Independent of Phases 0–2 but should follow Phase 0 for consistent auth messages.*

### Phase 4 — Performance & Firebase cost
22. Bound `getUserDashboardData`/history queries by date + limit.
23. Precompute leaderboard/streak aggregates (`SadhanaMonthlySummaries`).
24. Page and cache reference data; make `serverCache` shared or instance-agnostic (or accept cache-per-instance with shorter TTLs).
25. Reduce `Users` alias fan-out queries via the canonical-id fix (Phase 1 #8).

*Depends on:* 12 for the biggest single win.

### Phase 5 — Code quality & long-term
26. Add an authorization-matrix emulator test suite + scoring-tamper test; stop asserting on source strings.
27. Escape user text at HTML boundaries; delete or use `sanitize.ts`.
28. Add CSP; remove `X-XSS-Protection`; configure error reporting.
29. Move `scratch/` and the exported app JSON out of the repository.
30. Normalise role strings to one enum everywhere.

---

## Master table

| # | Severity | Category | Problem | Location | Impact | Effort | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Critical | Security | Auth token signature bypass (mock/emulator paths) | `app/api/run/[endpoint]/route.ts` `verifyToken` | Full account impersonation | S | P0 |
| 2 | Critical | Security | Client-trusted Sadhana scoring | `api/submitSadhana.ts` | Score/leaderboard fraud | M | P0 |
| 3 | Critical | Security | `includes('super')` grants destructive super-admin | `api/hardDeleteBvGroups.ts` | Wipe all BV groups | S | P0 |
| 4 | Critical | Security | `getBvGroupDetail` has no authorization | `api/getBvGroupDetail.ts` | Member PII + join token leak | S | P0 |
| 5 | High | Security | `getUserCrmData` cross-user financial reads | `api/getUserCrmData.ts` | Rent/trip PII disclosure | S | P1 |
| 6 | High | Security | `getBvslMembers` arbitrary `bvslId` | `api/getBvslMembers.ts` | Member contact disclosure | S | P1 |
| 7 | High | Security | Attendance forgery by phone | `api/markSessionAttendance.ts` | Attendance/streak integrity | M | P1 |
| 8 | High | Data | Duplicate `userId`/`entryId` under concurrency | `lib/userIdGen.ts`, `lib/entryIdCounter.ts` | Ambiguous identity | M | P1 |
| 9 | High | Data | `assignBvRole` creates email-keyed Users docs | `api/assignBvRole.ts` | Duplicate identities | S | P1 |
| 10 | High | Security | BV approval/group deletion unscoped | `api/approveAndAssignBvMember.ts`, `api/deleteBvGroup.ts` | Cross-centre mutation | M | P1 |
| 11 | High | Data | `deleteAccount` incomplete cascade + weak confirmation | `api/deleteAccount.ts` | Orphans, accidental loss | M | P1 |
| 12 | High | Functional | Email delivery is a no-op | `lib/app-backend-sdk.ts` `Email` | No notifications at all | M | P1 |
| 13 | High | Security | Admin routes allow `USER` | `App.tsx` | Defense-in-depth loss | S | P1 |
| 14 | High | Perf/Cost | Whole-DB scan per scoped request | `lib/hierarchyUtils.ts` | Cost + latency ceiling | L | P2 |
| 15 | High | Perf/Cost | Unbounded all-time entry reads | `api/getUserDashboardData.ts` | Firestore read growth | S | P2 |
| 16 | Medium | State | Two competing client caches | `utils/cache.ts`, `hooks/useQuery.ts` | Stale UI | M | P3 |
| 17 | Medium | Code | Dead `offlineQueue` with false sync promise | `lib/offlineQueue.ts` | Misleading UX, dead code | S | P3 |
| 18 | Medium | Deploy/UX | Version checker is legacy Vite code | `App.tsx` | Stale bundles; draft loss if fixed naively | S | P3 |
| 19 | Medium | Security | In-memory rate limiting, unbounded map | router, `utils/rateLimit.ts` | Bypass across instances | M | P2 |
| 20 | Medium | Arch | Per-instance server cache | `lib/serverCache.ts` | Cross-instance staleness | M | P2 |
| 21 | Medium | Error | Firestore errors degrade to empty results | `lib/app-backend-sdk.ts` | Silent blank data | M | P2 |
| 22 | Medium | Business | Self-service department switch | `api/updateUserProfile.ts` | Wrong form/dashboards | S | P1 |
| 23 | Medium | Error | Rate-limit throws → HTTP 500 | `utils/rateLimit.ts` + router | Wrong status, poor UX | S | P3 |
| 24 | Medium | Testing | Security tests assert source strings only | `tests/security-policy.test.mjs` | Regressions uncaught | M | P5 |
| 25 | Medium | Security | `sanitize.ts` unused; raw HTML in emails | `lib/sanitize.ts`, `api/registerUser.ts` | Stored XSS once email works | S | P5 |
| 26 | Medium | Perf | Leaderboard recompute whole windows | `api/getSadhanaLeaderboard.ts` | Cost | M | P4 |
| 27 | Medium | Data | Auto email-link/delete in user resolution | `app/api/run/[endpoint]/route.ts` | Wrong-profile attachment | M | P2 |
| 28 | Medium | Logic | Residency name substring filter | `api/getAllResidencies.ts` | Missing/hidden centers | S | P3 |
| 29 | Low | Security | No CSP; `X-XSS-Protection` set | `next.config.ts` | Weaker browser defenses | S | P5 |
| 30 | Low | Code | `Math.random()` document ids | `lib/app-backend-sdk.ts` | Collisions | S | P5 |
| 31 | Low | Privacy | PII in server logs | `Email.send`, `deleteAccount` | Log exposure | S | P5 |
| 32 | Low | Code | Hardcoded `'hiranya'` authorization branch | `api/getBvslMembers.ts` | Fragile logic | S | P5 |
| 33 | Low | Code | Exact-string role comparisons | several endpoints | Brittle matching | M | P5 |
| 34 | Low | UX | Forced `/dashboard` navigation on timeout | `layouts/RouteGuards.tsx` | Wrong landing page | S | P3 |
| 35 | Low | Code | Committed Zite export + scratch analysis | `docs/`, `scratch/` | Repo hygiene / legacy schema exposure | S | P5 |

*Priority key: P0 = before next deploy, P1 = current sprint, P2 = architecture/backend, P3 = UX, P4 = performance, P5 = long-term.*
*Effort key: S = < half a day, M = 1–3 days, L = multi-day refactor.*
