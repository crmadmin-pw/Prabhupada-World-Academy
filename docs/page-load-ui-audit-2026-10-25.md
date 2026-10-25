# Page-by-Page Load Audit + First-Open & UI/UX Findings

**Date:** 2026-10-25
**Scope:** every routed page, the first-open critical path, build/static-load config, and UI/UX loading behavior.
**Rule:** investigation only — no source code changed. Backend evidence reuses [performance-audit-2026-10-10.md](performance-audit-2026-10-10.md); this report adds the **frontend/per-page layer** it did not cover.

---

## 1. Why the first open (and every first open) is slow — the serial gate chain

Opening any protected page runs **six serial gates before your data paints**:

| # | Gate | Cost | File |
|---|---|---|---|
| 1 | Document HTML is rendered **per request** | `await connection()` in the root layout opts the entire shell out of static generation; `proxy.ts` also mints a nonce per request for every non-static route. No pre-built/cached app shell exists. | [layout.tsx](src/app/layout.tsx#L28), [proxy.ts](src/proxy.ts) |
| 2 | Root App JS download only then starts | [page.tsx](src/app/[[...path]]/page.tsx) renders `App` with `ssr: false` — blank screen until the SPA bundle is downloaded and executed | same |
| 3 | Firebase auth token resolves | full-screen spinner, no timeout UI before 12s (only on join pages) | [ProtectedRoute.tsx](src/layouts/ProtectedRoute.tsx) |
| 4 | Profile fetch (`_nocache: true`) | bypasses the client cache **by design** (correct for auth), 20s timeout, retries at 2/4/8/16s on failure — worst-case stall is ~30s+ on a flaky network | [UserProfileContext.tsx](src/contexts/UserProfileContext.tsx#L155-L168) |
| 5 | DashboardRouter redirect → page chunk | chunk download normally saved by `preloadRoute` (runs at pathname detect + during auth) — this is done well | [routePreload.ts](src/lib/routePreload.ts) |
| 6 | Page's own data fetch | every request pays the backend tax (rate-limit txn + realtime registration + auth scope reads, measured 300–1,600 ms for a single small query) | audit §3 |

Cuts 1–2 are new findings not in the earlier audit. The largest lever: **make the HTML document cacheable/static** (e.g. move the CSP nonce strategy so the shell can be statically generated and CDN-cached), which eliminates per-request SSR cost globally, including logged-out/first visits.

Also on the first open: **`minInstances: 0`** + possible region split (audit §B) — a cold instance sits exactly at gate 1's server, so the whole chain above is delayed by the cold start.

---

## 2. Per-page findings

Legend: ✅ already well-optimized; ⚠ bug/slowness found; file references are clickable.

| Page (file) | Finding | Detail & fix |
|---|---|---|
| **Landing / Login** ([LandingPage.tsx](src/spa-pages/LandingPage.tsx), [LoginPage.tsx](src/spa-pages/LoginPage.tsx)) | ✅ preloaded by pathname; ⚠ | Only non-SPA-page cost is the dynamic HTML doc (§1). No fix needed beyond the shell. |
| **`/dashboard` router** ([App.tsx](src/App.tsx#L253-L317)) | ⚠ | Pure redirect logic runs **after** profile load; fine. But `UserProfileContext` also fires `updateLastLogin` write on every fresh session — one more backend tax call in parallel with the profile (harmless, parallel). |
| **Folk/PW user dashboard** ([FolkUserDashboard.tsx](src/spa-pages/FolkUserDashboard.tsx), [PwUserDashboard.tsx](src/spa-pages/PwUserDashboard.tsx)) | ✅ mostly | Progress-stats + 1:1 prefetch starts with the summary read (parallel). ⚠ The Sadhana tab and its charts render **only after `getUserDashboardData` returns** (`if (dashLoading) return <LoadingPage/>`) — first open has no partial content. Fix: render the shell + tab bar immediately and let the summary area use a skeleton; the three parallel reads already exist. |
| **Daily Sadhana form** ([DailySadhanaForm.tsx](src/spa-pages/DailySadhanaForm.tsx#L91-L96)) | ⚠ minor | A `setInterval(1s)` clock ticks the whole time a PW user has the form open. Cheap but unnecessary — schedule next tick from the lock-boundary time instead. |
| **RGF / RGSF / BVSL dashboard** ([RgfDashboard.tsx](src/spa-pages/RgfDashboard.tsx#L30-L70), [BvslDashboard.tsx](src/spa-pages/BvslDashboard.tsx)) | ⚠ **biggest page-level bug** | `getBvslGroups` (measured **21 queries / 3.0–6.9 s**) fails/loads → **the entire dashboard shell is blocked**: `loading ? <LoadingPage/> : <TabRouter …>`. The tab chrome, Weekly Plan and everything except group-dependent tabs could render immediately; group data should hydrate into the Groups/Session/Members tabs when it lands. Also `getBvslGroups` result is **not run through the endpoint cache** (manual `useState`) — re-entering the tab refetches the 21-query monster every time. |
| **Group switching** → `/bvsl/groups/:id` ([BvGroupDetailPage.tsx](src/spa-pages/BvGroupDetailPage.tsx#L378-L414)) | ⚠ | Group change = full `load()` reset with full-screen `loading`; the attendance matrix refetch is correctly keyed by date range, but the detail read itself is cached nowhere, so **switching between two groups A→B→A always refetches**. Fix: keep the page shell mounted, per-group cache entries (the SDK cache already supports scoped keys), instant render from cache + silent revalidate, and guard stale responses (audit §F already covers the defensive half). |
| **Guide/PW admin dashboards** ([FolkGuideDashboard.tsx](src/spa-pages/FolkGuideDashboard.tsx#L122-L163), [PwAdminDashboard.tsx](src/spa-pages/PwAdminDashboard.tsx#L112-L157)) | ⚠ | `fetchCounts` fires **5 uncached endpoints in parallel on every mount** for badge counts (Approvals, transfers, cleanliness, BV registrations). Parallel is good, but each pays the backend tax; these are perfect candidates for one lightweight `getNavBadges` aggregate + cache. ⚠ Both dashboards call `getGuideUsers`-family endpoints again per tab visit (report tabs memoized via `visitedTabs`, good). |
| **History / Bhakti Vriksha / Profile** ([HistoryPage.tsx](src/spa-pages/HistoryPage.tsx) etc.) | ✅ | Standard `useQuery`/cache reads; inherit the shared backend tax only. |
| **Attendance admin** ([AttendanceManagePage.tsx](src/spa-pages/attendance/AttendanceManagePage.tsx#L32)) | ✅ | `reload()` on mount, debounced search (400 ms). |
| **Join/invite pages** ([JoinGroupPage.tsx](src/spa-pages/JoinGroupPage.tsx#L78-L93), [BvJoinPage.tsx](src/spa-pages/BvJoinPage.tsx)) | ✅ | Have the unique 12 s "auth is slow" UX. |
| **Auth callback** ([AuthCallbackPage.tsx](src/spa-pages/AuthCallbackPage.tsx#L38-L43)) | ⚠ minor | Hard 20 s timeout exists, but the per-second `setInterval` for the elapsed counter re-renders every second; harmless, could pause after paint. |
| **Realtime stream** ([RealtimeSyncProvider.tsx](src/components/RealtimeSyncProvider.tsx)) | ✅ | Listener connect is correctly deferred until after the profile settles; reconnect backoff + toast hygiene are good. |

**Cross-page constant:** every uncached request pays the **per-request backend tax** (audit §3). That is why *every page* feels slow, not just heavy ones; the per-page fixes above remove frontend amplification, the P0 list removes the tax.

---

## 3. UI / UX improvements

1. **Full-screen spinner, not skeletons, on the first open.** `ProtectedRoute` shows a centered spinner + "Loading your profile…" ([ProtectedRoute.tsx](src/layouts/ProtectedRoute.tsx#L60-L70)) for what is routinely 1–3 s. A static app-shell skeleton (header + tab bar + card placeholders) reads faster and can be rendered from the cached HTML once §1 is fixed. The existing `RouteLoadingFallback` skeletons are the right pattern — use it here too.
2. **Dead-end spinner on expired sessions.** `!user` renders a spinner with "Session expired — redirecting…" whose redirect is a `useEffect` + `window.location.replace`. Redirect immediately in render instead of showing a spinner that can hang if `replace` is slow.
3. **Whole-shell blocking while small data loads** (RGF/BVSL dashboards, group detail): render the shell immediately; hydrate data into panels. Users perceive a loaded app vs. a blank/skeleton screen.
4. **Retry UX already good** (profile retries escalate timeouts, error card offers Retry) — keep.
5. **Stale-response safety on group switching** — never momentarily show the previous group's data; the server's realtime revision guard partially exists (audit §F proposes extending it to group keys).
6. **PW form clock**: remove the visible ticking dependency; compute lock state from timestamps, not a 1 Hz re-render.
7. **Loading descriptions**: "Loading your profile…" is good copy; consistent per-panel skeletons (P2/P3 in the audit) complete this.

---

## 4. Priority summary (frontend layer only; backend P0s unchanged)

| Rank | Change | Files | Type |
|---|---|---|---|
| 1 | Cacheable/static HTML shell (remove per-request `connection()` + per-request CSP nonce for the shell routes, keep nonce for API) | [layout.tsx](src/app/layout.tsx), [proxy.ts](src/proxy.ts) | **P0 first-load** |
| 2 | Stop blocking the RGF/BVSL shell on `getBvslGroups`; run it through the endpoint cache | [RgfDashboard.tsx](src/spa-pages/RgfDashboard.tsx), [BvslDashboard.tsx](src/spa-pages/BvslDashboard.tsx) | **P0 per-page** |
| 3 | Per-group cache + shell retention on group detail switching | [BvGroupDetailPage.tsx](src/spa-pages/BvGroupDetailPage.tsx) | **P1** |
| 4 | `getNavBadges` aggregate to replace the 5-call `fetchCounts` | [FolkGuideDashboard.tsx](src/spa-pages/FolkGuideDashboard.tsx), [PwAdminDashboard.tsx](src/spa-pages/PwAdminDashboard.tsx) | **P1** |
| 5 | User-dashboard shell renders before the summary lands | [FolkUserDashboard.tsx](src/spa-pages/FolkUserDashboard.tsx), [PwUserDashboard.tsx](src/spa-pages/PwUserDashboard.tsx) | **P1** |
| 6 | Static shell skeleton + instant session-expired redirect + remove 1 Hz clock | [ProtectedRoute.tsx](src/layouts/ProtectedRoute.tsx), [DailySadhanaForm.tsx](src/spa-pages/DailySadhanaForm.tsx) | **P3/UX** |

Items 1–2 deliver the "first visit feels fast" goal on the frontend side; the backend P0 list from the earlier audit remains the dominant lever for every request.
