# Performance audit — 16 October 2026

Measured optimization pass. Business rules, roles, permissions, approval workflows, calculations, and validation were not changed. No production load test was run, and no production data was written by the benchmarks.

## How this was measured

| Check | Environment |
|---|---|
| Browser lab | Production build (`next build`, `next start` on `127.0.0.1:3100`). Playwright, CPU throttle 1×. Every `/api` response delayed **250 ms**. One run per role before the changes and one run after. |
| Live reads | Firestore REST `runQuery` as the signed-in Firebase CLI user, project `bvpw108`. Reads only. Writes throw. Round-trip from this WSL machine is about **0.5–2 s per query**, so these times are not App Hosting times. |
| Output check | SHA-256 of the JSON response, first 16 hex characters. Two visits in the same run were compared with each other. |

Local TTFB in the browser lab is 16–33 ms. That does not describe production App Hosting. Landing LCP moved by hundreds of milliseconds between single runs, including a colder first sample, so landing LCP is not treated as an improvement or a regression.

## A. Twelve-dimension scorecard

| Dimension | Before | After | What changed | Status |
|---|---|---|---|---|
| Page loading | Dashboard data ready 942–1540 ms. LCP 900–1520 ms. FCP 316–580 ms. TTFB 16–33 ms. | Data ready 930–1519 ms. LCP 892–1564 ms. FCP 312–372 ms. TTFB 16–33 ms. | One fewer API call on every measured dashboard. Timings stayed inside the 250 ms mock noise. | Lab timing unchanged. Duplicate call removed. |
| Interaction | Admin tab revisit average 148–181 ms, 0 refetches. Event duration p95 104–128 ms. | Revisit average 143–159 ms, 0 refetches. p95 112–120 ms. | Same cache behavior. | Meets INP ≤ 200 ms in this lab. |
| Frontend rendering | CLS ≤ 0.0012. TBT ≤ 87 ms. Heap flat after the first tab cycle. | CLS ≤ 0.0012. TBT ≤ 20 ms on the admin sample that had been 87 ms. Heap still flat after the first cycle. | No bundle-size change (JS transfer 591–694 KB). | CLS ≤ 0.1. No leak found. |
| Backend / API | See section C. Slowest measured calls were 7–13 s of REST time. | Same outputs where the hash matched. Several calls about halved. | Independent reads run together. Per-group attendance reads are batched. | Improved on the measured endpoints. |
| Database | `getBvslGroups` 28–40 queries. `getUserBvStatus` up to 27. `getBvSupervisorOverview` 14. | RGF groups 24. FOLK member BV status 8. Supervisor overview 10. | Fewer attendance and membership queries. `getUserProfile` does about 2 more queries and much less waiting. | Fewer reads on the batched endpoints. |
| Network / cache | Every dashboard sent `getUserProfile` twice. Logo and favicon were `/logo.png` (249,313 bytes each reference). | Duplicate profile calls: 0. Display mark 20,764 bytes. Favicon 5,192 bytes. | Client cache keeps the profile read that established the permission scope. | Duplicate calls removed. Image bytes reduced. |
| Real-time sync | A scope change dropped the profile registration and started the loader again. | The profile query, token, and revision move to the new cache key. Loader does not rerun when every one of its keys was retained. | Realtime client test passed, including scope reattachment. | Improved. Live Firestore listener latency: not measured. |
| Scalability | Not load tested. | Not load tested. | No capacity change. | Not measured. |
| Reliability | Not a crash survey. | Browser lab page errors: 0 on all 8 roles. | Console noise is the lab blocking Google and Firestore, present before and after. | No new page errors in the lab. |
| Security / resource efficiency | Unchanged authorization. | Same hierarchy and supervisor tests pass. | No rule, role, or security-rule edits. | No permission change. |
| UI / accessibility | Landing logo alt text already named the academy. Connecting state had visible text only. | Connecting state is `role="status"`. Small logos name the academy. | No full audit. | Partial. |
| Architecture | Reactive reads bypass the server cache on purpose, so dependency capture stays correct. | That bypass is unchanged. | Batching and parallelism sit inside the existing endpoint and cache design. | No architecture replacement. |

Targets hit in the browser lab: CLS ≤ 0.1, event p95 ≤ 200 ms, TBT ≤ 200 ms, local TTFB ≤ 800 ms, cached tab revisit under 300 ms with zero refetches. LCP ≤ 2.5 s and FCP ≤ 1.8 s held on these local runs. Production field LCP, INP, and TTFB were **not measured**.

## B. Page-by-page browser lab

API delay 250 ms. `dup` is the number of duplicate client calls on the dashboard load.

| Page | Data ready | LCP | API calls | Duplicates | JS transfer |
|---|---|---|---|---|---|
| PW member dashboard | 1434 → 1444 ms | 1268 → 1236 ms | 7 → 6 | 1 → 0 | 692 → 693 KB |
| FOLK member dashboard | 1447 → 1432 ms | 1252 → 1260 ms | 7 → 6 | 1 → 0 | 694 KB |
| PW admin dashboard | 1540 → 1474 ms | 1220 → 932 ms | 15 → 13 | 2 → 0 | 598 KB |
| PW super admin dashboard | 1457 → 1507 ms | 928 → 924 ms | 14 → 13 | 1 → 0 | 598 KB |
| FOLK guide dashboard | 1510 → 1503 ms | 1496 ms | 13 → 12 | 1 → 0 | 597 KB |
| FOLK super guide dashboard | 1493 → 1519 ms | 1220 → 1276 ms | 13 → 12 | 1 → 0 | 597 KB |
| PW RGF dashboard | 949 → 930 ms | 1520 → 1564 ms | 7 → 6 | 1 → 0 | 616 KB |
| PW supervisor dashboard | 942 → 954 ms | 900 → 892 ms | 3 → 2 | 1 → 0 | 591 KB |

The removed call was a second `getUserProfile` for the same email. It was in flight beside the first one, so dropping it does not shrink the 250 ms mock’s critical path. That is why data-ready barely moved in this lab.

Second visit to each admin tab still sends **0** requests. Average revisit time stayed 143–159 ms. After 10 rapid tab cycles, heap and DOM node counts stayed at the post-first-cycle plateau (admin nodes about 3,600–4,100; member nodes about 420).

Member Sadhana charts used to wait until the dashboard summary finished rendering. The default 45-day trend, the daily insight, and the guide card now start as soon as the member id is known and are reused from the client cache. The lab’s data-ready marker is the summary, so this overlap does not show up in that number.

Landing and favicon previously both pointed at `/logo.png` (249,313 bytes, 800×800, shown at 112 px or as a favicon). They now point at `/logo-mark.webp` (20,764 bytes, 336×336) and `/favicon.png` (5,192 bytes, 64×64). HTTP GET of all three returned 200 from the production server. `/logo.png` is still served for anything that asks for it directly.

## C. API and database

Live REST, first visit unless noted. “Same” means the response hash matched the morning baseline.

| Call | Who | Queries | Rows read | Endpoint time | Response |
|---|---|---|---|---|---|
| `getUserProfile` | 8 of 9 roles | 11–13 → 13–15 | unchanged order of magnitude | 4.7–6.5 s → 1.6–3.4 s | Same hash |
| `getUserProfile` | FOLK super guide | 9 → 9 | — | 2217 → 1813 ms | Hash differs. This profile’s hash already changed between visits in the morning baseline (a time-varying field). |
| `getBvslGroups` | PW RGF | 28 → 24 | 308 → 308 | 13.3 s → 7.3 s | Same hash |
| `getBvslGroups` | PW super admin, ALL view | 40 → 40 | 219 | 5.7 s → 5.8 s | Same hash. The ALL view never loaded per-group attendance, so batching does not apply. |
| `getUserBvStatus` | FOLK member | 27 → 8 | 214 → 214 | 7.5 s → 3.3 s | Same hash |
| `getUserBvStatus` | PW member | 13 → 13 | 93 | 6.2 s → 3.9 s | Same hash. This member did not have the N+1 group loop. |
| `getBvSupervisorOverview` | PW supervisor | 14 → 10 | 234 | 7.3 s → 3.2 s | Same hash. Second visit 9 queries, same hash. |
| `getGuideUsers` | FOLK guide (≤ 300 members) | 18 → 12 | 866 → 199 | 3.8 s → 2.1 s | Same hash |
| `getGuideUsers` | PW and FOLK super-admin catalogues | 14–17, unchanged | +3 rows vs morning | 2.1–6.0 s, still in that band | Hash differs from the morning snapshot and matches a later same-day snapshot of the original single pass. Treated as new entries, not a logic change. Two visits in this run match each other. |
| `getMentorMembers` | Sadhana mentor | 15 → 15 | 2411 → 2412 | 9.9 s → 7.5 s | Hash differs. One extra row versus the morning run. Two visits in this run match. Not field-compared. |
| `getUserProgressStats` | one PW member, 45-day daily trend | after only: 7 | after only: 34 | 3.2 s, then 1.1 s | Before: **not measured**. After hash stable across two visits. Sadhana reads are `user` + `entryDate` on the deployed composite index. |

`getUserProfile` runs the membership sync, guide resolution, residency read, and request-state reads together. Guide and parent lookups that used to wait on each other also run together, which is why the query count rises by about two while the wait falls.

A two-pass Sadhana history (last 7 days, then 100 days for everyone else) was tried for large directories and reverted. On four alternating rounds over 300 users it was not reliably faster than one paged 100-day read (single pass 1375–2997 ms, two pass 1808–2182 ms). Small directories still use one `in` query per 30 members for the 100-day window, which is what cut the FOLK guide read from 866 rows to 199.

## D. Realtime sync

The duplicate profile call came from the client. Loading the profile sets the permission scope, the scope change cleared the cache, and the loader ran the same read again.

The profile entry that produced the new scope is now copied onto the new cache key, including its realtime token and the revision already received for that token. If a loader’s keys were all retained, it keeps those keys and does not start another request. A different user still clears everything.

The Firestore listener waits until the profile load has settled, so it does not connect twice during the scope change. Server revisions are still stored, so an update that arrives during that wait is not dropped on the server.

`tests/realtime-client.browser.cjs` passed after these changes: propagation 209 ms, 47 queries, 0 requests during 65 idle seconds, 0 unaffected rerenders. Covered scope reattachment, dedupe, a 100-event burst, hidden panels, drafts, and failure retry.

Live end-to-end listener latency was **not measured**.

## E. Code and architecture changes

| Area | Change |
|---|---|
| `src/lib/app-endpoints-sdk.ts`, `src/hooks/useReactiveLoader.ts`, `src/contexts/UserProfileContext.tsx`, `src/components/RealtimeSyncProvider.tsx` | Keep the identity-source profile query across a permission-scope change. |
| `src/api/getUserProfile.ts` | Independent reads run in one step. Same response on the roles whose hash matched. |
| `src/api/getGuideUsers.ts` | History for 300 or fewer members is one indexed `in` read per 30 ids. Large catalogues stay on the original paged 100-day scan. |
| `src/api/getUserBvStatus.ts` | Available-group member counts are chunked `in` reads instead of one read per group. |
| `src/api/getBvslGroups.ts` | Caller scope and the group catalogue start together. Attendance and pending requests for a facilitator’s groups are chunked, still capped at 2,000 session rows and 200 present rows per group, and 100 pending requests per group. |
| `src/api/getBvSupervisorOverview.ts` | Caller, hierarchy scope, groups, members, and pending registrations start together. Attendance is one batched read, still capped at 5,000 rows per group. |
| `src/api/getMentorMembers.ts` | Caller, residency scope, guide label, member rows, and hierarchy scope overlap. Residency names overlap the entry read. |
| `src/api/getUserProgressStats.ts` | Trend, attendance, and insight start together. Date-bounded Sadhana reads use the deployed `user` + `entryDate` index instead of scanning every member’s entries for those dates. |
| `src/api/getOneToOneContext.ts` | The 28-day Sadhana window is read per identity alias on that same index. Rows are deduped by id. Attendance stays a date-window scan: no `user` + `attendanceDate` index is deployed. |
| `src/hooks/useDashboardPrefetch.ts` | PW Members prefetch uses the same `getGuideUsers` input as the Members panel, including `segment: 'PW'`. |
| `src/spa-pages/PwUserDashboard.tsx`, `FolkUserDashboard.tsx` | Default Sadhana chart, insight, and guide card start with the summary request. |
| `public/logo-mark.webp`, `public/favicon.png`, landing, how-to, join, and `src/app/layout.tsx` | Display and favicon use the smaller files. |

Server caches such as guides and residencies still do not serve reactive reads. A reactive read has to record its dependencies, and the current cache returns a stored value without replaying those dependencies. Caching those responses safely needs a dependency-replaying cache. That was not built.

## F. Remaining issues

1. **Per-query REST latency.** A single indexed read in this benchmark is often 0.5–2 s. Fewer queries help, and they cannot make a dashboard faster than one round trip. Region placement and the per-request rate-limit transaction were not changed.
2. **Reactive server cache bypass.** Shared reads (guides, residencies, group catalogues) are executed again on every reactive request.
3. **`getGuideUsers` for a full directory** still pages the last 100 days of Sadhana entries. The two-pass alternative was slower in the alternating test above.
4. **`getUserProgressStats` before-state** was not timed. The after-state for one PW member is 7 queries and 34 rows. Empty alias queries are still issued for identity fields that have no entries.
5. **`getOneToOneContext` attendance** still reads every attendance row in the 28-day window and filters to the member. A `user` + `attendanceDate` index would make this match the Sadhana read. Not added.
6. **`getGuideDetailedReport` and `getCurrentGuide`** were left as they are. The report already overlaps several independent reads. `getCurrentGuide` still scans residencies and today’s entries.
7. **Main JS bundle** is still about 590–694 KB transferred. `framer-motion` is on the first load because the root app and the landing page import it. Recharts stays in the dashboard chunks that draw charts.
8. **Reporting-chain rebuild** can write every user document when the chain marker is stale. The benchmark stub rejects those writes. One FOLK guide `getGuideUsers` attempt hit that path and was not used as a measurement.
9. **Accessibility** was not fully audited. Badge counts in dashboard navigation are still a bare number.
10. **Production Web Vitals and load** were not measured. `minInstances: 0` cold starts were not timed.

## G. Regression verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Pass. |
| `npx next build` | Pass. The build also runs TypeScript. |
| Non-emulator `*.test.ts` | 469 passed, 1 file failed: `tests/auth-token-verification.test.ts`. Its assertions passed when rerun. The file then fails because a rate-limit path keeps looking up Google default credentials after the test has finished. Not caused by these edits. |
| `tests/*.test.cjs` and `tests/*.test.mjs` | 41 passed, 1 failed: `tests/notification-broadcast-queue.test.mjs` rejects the existing import of `./realtimeNotificationPublisher`. That import was already in `src/lib/notificationBroadcast.ts`. Not caused by these edits. |
| Focused suites after the last endpoint edits | `getBvslGroups`, supervisor overview, mentor scope, one-to-one context, progress stats, and `tests/dashboard-hierarchy-access.test.ts` passed (the hierarchy file was inside the 469). |
| `tests/realtime-client.browser.cjs` | Pass. |
| `tests/admin-dashboard-performance.browser.cjs` against the new build | Pass for PW admin, PW super admin, FOLK guide, and FOLK super guide. Second tab visits issued 0 requests. The search box kept “Member 000”. Cached date filters issued no extra report read. Runtime errors: none. |
| Browser lab, 8 roles | Page errors: 0. Duplicate API calls: 0. |
| Permission behavior | No role, capability, or security-rule edits. Supervisor and hierarchy tests cover the endpoints whose queries were batched. |
| Emulator suites (`*.emulator.test.ts`) | **Not run.** No emulator was started. |
| Playwright e2e under `tests/e2e` | **Not run.** |
| Production load test | **Not run.** |

The existing browser tests above are the regression checks for the client cache and the admin dashboard. No new test framework was added.
