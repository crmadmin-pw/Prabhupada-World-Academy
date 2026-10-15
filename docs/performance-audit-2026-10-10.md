# Prabhupada World Academy — Performance Investigation & Optimization Plan

**Date:** 2026-10-10
**Scope:** end-to-end request path — browser (React SPA) → `/api/run/[endpoint]` router → Firebase Admin/Firestore → response → client cache/realtime → render.
**Rule followed:** investigatory pass only. **No source code was modified.** Every claim is tied to a file, config, or previously recorded measurement, and is labelled measured vs. hypothesis.

> **Prior work exists.** `docs/performance-audit.md` (2026-09-01) and `docs/dashboard-performance.md` (2026-09-09) already removed polling, added query dedupe, split bundles, and measured before/after browser flows. The app is therefore *faster than its baseline* but the user still reports broad slowness. This report targets **what still makes it slow today**, not what was already fixed.

---

## 0. Honesty / method statement

| Tool | Status here |
|---|---|
| Live browser profiling, LCP/INP/TTFB, network waterfall | **Not available.** No runnable dev server in this environment (WSL `node_modules` driven by Windows Node; Next Turbopack build panics on the UNC path). UI timing claims are therefore **not** re-measured by me. |
| Existing measured baselines | **Used.** `docs/dashboard-performance-measurements.json` (browser flows with 350 ms injected API latency; live DB-backed endpoint traces) and the tables in `docs/dashboard-performance.md`. |
| Behaviour tests | **Run.** Non-emulator suite: 341/351 pass. Used as evidence for one confirmed read-ordering defect (`tests/cold-report-concurrency.test.ts`). |
| Static tracing | **Primary method.** Read the full request path and counted round-trips, transactions, and invalidation triggers per request. |
| Database query plans / profiler | Not re-run here (read-only live DB requires credentials). Referenced from the existing `Query Explain` records in `docs/dashboard-performance.md`. |

**Measured facts reused from the repo (not re-generated):**
- Live endpoint traces, PW super admin (`dashboard-performance-measurements.json`): `getGuideDetailedReport` ≈ 1.5–5.0 s, `getBvSessionMatrix` ≈ 3.1–3.9 s, `getGuideUsers` ≈ 3.7–5.4 s (324 KB payload), `getBvslGroups` ≈ 3.0–6.9 s with **21 queries**, `getMissingSadhanaReport` ≈ 1.9–4.0 s.
- Browser flows with a controlled 350 ms API delay: cached tab return ≈ 77–203 ms with **0 requests**; first visits ≈ 0.5–2.4 s depending on role/report.
- Query-count evidence: `getBvslGroups` = 21 queries, `getGuideDetailedReport` = 4–14, `getGuideUsers` = 10–16, `getMissingSadhanaReport` = 3–11, and small "one-query" reads (e.g. `getMeetings`, `getMoms`) still commonly take **300–1,600 ms**.

**Interpretation.** Cached navigation is already good; **uncached/first-time requests and every mutation-adjacent refresh are slow**, and a single small query routinely costs hundreds of ms. That points at a **per-request fixed cost plus database round-trip latency**, not at React rendering or request count.

---

## 1. Executive diagnosis

There is **not one single bottleneck — there is one dominant shared cost plus several independent amplifiers.** Ranked:

1. **Every API request pays a fixed backend tax that includes database work unrelated to the user's data.** The router performs, per request: token verification, a profile resolve, a **rate-limit Firestore transaction**, a realtime **identity write**, and (for reads) a realtime **query-registration transaction**; scoped endpoints additionally resolve authorization with extra reads. So even a "cheap" read is several Firestore operations before any business data is fetched. *(Confirmed by code.)*
2. **Database round-trip latency is high and multiplied by query count.** Firestore is pinned to `asia-south1` (`firebase.json`), the App Hosting region is not declared in `apphosting.yaml` (must be verified in console), and endpoints issue **3–21 sequential/parallel queries each**. If compute and Firestore are in different regions, every round trip carries intercontinental latency — which the 300–1,600 ms single-query measurements are consistent with. *(Confirmed config + measured latency; region co-location is a hypothesis to verify.)*
3. **The service scales to zero.** `apphosting.yaml` sets `minInstances: 0`, so after a quiet period the next user (or the next dashboard burst) pays a **cold start** (Node boot + Firebase Admin init + module load). This matches "everything buffers" for intermittent usage. *(Confirmed config.)*
4. **Authorization is recomputed, and can be recomputed from a full-graph scan.** `getScopedHierarchyUserIds` / `readScopedUsers` read a `Config` marker, the caller record, and chunked `reportingChain` queries on **every scoped call** (several endpoints do this twice per request). Worse, any write to Users/Guides/BvGroups/BvGroupMembers sets a **process-local stale flag**, forcing a **full-collection rebuild** of the reporting chains on the next scoped request. *(Confirmed by code.)*
5. **The client cache can be wiped wholesale by a routine profile change.** `dashboardScope()` stringifies role/status/segment/flag fields; `RealtimeSyncProvider` clears the entire endpoint cache whenever that string changes. A profile refresh that alters any of those fields → **all panels refetch + all realtime listeners rebuild**. *(Confirmed by code; frequency is data-dependent.)*
6. **Loading states are long by design.** Client query timeout is **45 s**, mutations 20 s, with retry backoff; there is no progressive/incremental reveal. A slow first visit therefore shows a spinner for the full backend time. *(Confirmed by code.)*

**Answer to "one shared bottleneck or many?"** — One shared **per-request backend tax** (auth + rate-limit transaction + realtime registration + authorization resolution) amplified by **cross-region DB latency** and **cold starts**, plus **multiple independent per-feature costs** (heavy aggregate endpoints, label-blocked directory, per-group refetch). Fixing the shared tax + infrastructure region + cold start will lift *every* feature; the per-feature fixes then matter individually.

---

## 2. Measured bottlenecks (evidence table)

| Area | Measurement | Source |
|---|---|---|
| Cached tab return | 77–203 ms, **0** API calls | `dashboard-performance-measurements.json` |
| First report/dashboard visit | ≈ 0.5–2.4 s (with only 350 ms injected latency) | same |
| Cached date selection | ≈ 75–89 ms | same |
| Uncached date selection | ≈ 440–505 ms | same |
| Large endpoints (live DB) | Detailed Sadhana 1.5–5.0 s; Members 3.7–5.4 s (324 KB); BV groups 3.0–6.9 s / **21 queries**; Missing Sadhana 1.9–4.0 s | same |
| Small endpoints (live DB) | `getMeetings`/`getMoms` 300–1,600 ms for 1–2 queries | same |
| Directory ordering defect | Reproduced: directory waits on label reads → test fails after 2 s | `tests/cold-report-concurrency.test.ts` (run here) |
| Scale-to-zero | `minInstances: 0`, `maxInstances: 10`, `concurrency: 80` | `apphosting.yaml` |
| DB location | Firestore `asia-south1`; no compute region in config | `firebase.json`, `apphosting.yaml` |
| Indexes | 21 composite indexes, 5 field overrides | `firestore.indexes.json` |

---

## 3. Root-cause analysis (request path, step by step)

Per authenticated **read** request to `/api/run/[endpoint]` (from `src/app/api/run/[endpoint]/route.ts` and the SDK):

1. **Rate limit** — `isRateLimited(...)` → `consumeRateLimit` → `consumeShared` runs a **Firestore transaction (read + write) on a `RateLimits` doc** keyed by the token (falling back to IP). `src/utils/rateLimit.ts`.
   - *Impact:* +1 transactional round trip on **every** request; all of one user's parallel dashboard requests target the **same document**, so Firestore **serializes/retries them** (contention on burst).
2. **Token verification** — `verifyFirebaseIdToken` (Admin SDK). Fails closed (good), but adds work; Admin certs are cached after first use.
3. **Profile resolve** — `resolveDatabaseUser` → a `Users` lookup, deduped by a **2 s burst cache** (`resolvedUserBurstCache`). Short TTL means a long dashboard session re-resolves repeatedly.
4. **Endpoint execution** — the endpoint's own queries **plus**, for scoped endpoints, authorization:
   - `getScopedHierarchyUserIds` → `reportingChainsReady()` (a `Config` read) → `queryScope()` (`findCallerRecord` = 1 read, then `queryVisibleUsers` = chunked `reportingChain arrayContainsAny` reads).
   - `readScopedUsers` does the **same marker + caller + chunked reads again** for its own query. Several endpoints call both → double work.
   - If `reportingChainsLocallyStaleNow()` (set by any Users/Guides/BvGroups/BvGroupMembers write via `noteHierarchyWrite`) → `refreshReportingChains()` does a **full read of Users+BvGroups+BvGroupMembers+Guides+FolkResidencies** and **batch-writes `reportingChain`/`reportingScopeKeys` onto every Users doc**. `src/lib/hierarchyUtils.ts`.
5. **Realtime identity write** — `registerRealtimeIdentity` set (first request per uid per instance only; in-process cached). `src/lib/realtimeIdentityRegistration.ts`.
6. **Realtime query registration** — because the client sends `X-Realtime-Query: 1` on reads, the router calls `registerRealtimeQuery`, which opens a **Firestore transaction** (`transaction.getAll(signal, ...clocks)` + `set(subscription)`). `src/lib/realtimeQueryRegistration.ts`.
   - *Impact:* **every read is also a write transaction**, with an extra read of per-table clock docs.
7. **Response** — `Cache-Control: private, no-store`; `Server-Timing` recorded.

So a single dashboard read can cost **≈ 3–5 extra Firestore operations + 2 transactions** before business reads, and a scoped report adds several authorization reads on top. Multiply by 5–10 requests in a dashboard burst.

**Client side:**
- Cache TTL is 60 s (`CACHE_TTL_MS`); only `getGuides`/`getAllResidencies`/`getActiveSadhanaMentors` get 5 min. `src/lib/app-endpoints-sdk.ts`.
- `setEndpointPermissionScope` **clears the entire cache** when the scope string changes; scope includes `status`, `role`, `segment`, and ~15 flags (`dashboardScope`). `RealtimeSyncProvider`.
- Realtime: two `onSnapshot` listeners; the query listener is **re-subscribed** whenever the token set changes (every new query adds a token → `syncStreams` re-batches → new `onSnapshot` calls). `RealtimeSyncProvider`.
- `useQuery` is a stale-while-revalidate wrapper over the **same** endpoint cache (not a second cache) — correct, but it means `useQuery` pages share the 60 s TTL and are subject to the same wholesale-clear behavior.
- Timeouts: 45 s query / 20 s mutation, with 3 retries and exponential backoff; no progressive reveal. `src/lib/app-endpoints-sdk.ts`, `src/hooks/useQuery.ts`.

---

## 4. Recommendation tables

### A. Shared backend tax (P0)

| Issue | Root Cause | Evidence | Recommended Change | Expected Impact | Priority |
|---|---|---|---|---|---|
| Every request runs a rate-limit Firestore transaction | `consumeRateLimit` uses a shared-doc transaction per call, keyed per token | `src/utils/rateLimit.ts`; transaction on `RateLimits/{id}` | Make the limiter non-blocking: in-memory bucket per instance + async shared sync; or apply rate limits only to abuse-prone endpoints (auth/register/attendance/lookup), not every read. Keep the same limits/semantics | Removes 1 transactional round trip from **every** request; removes per-user doc contention on parallel bursts. Largest single shared win | **P0** |
| Every read is also a write (realtime query registration) | `X-Realtime-Query:1` → `registerRealtimeQuery` opens a transaction | `route.ts`, `realtimeQueryRegistration.ts` | Register in the background (fire-and-forget, like identity) and/or debounce/coalesce per (uid, endpoint) within a short window; skip registration for clearly non-realtime screens | Removes a second transaction + clock reads from every read; cuts write cost and latency | **P0** |
| Authorization recomputed per scoped call, sometimes twice | `reportingChainsReady()` marker read + caller read + chunked `arrayContainsAny` reads in both `getScopedHierarchyUserIds` and `readScopedUsers` | `src/lib/hierarchyUtils.ts` | Resolve the caller's scope **once per request** and memoize it (request-scoped, like `withRequestQueries`); pass it to both helpers. Cache `reportingChainsReady()` result in-process for a short, write-invalidated window | Removes several reads per scoped report and the duplicate marker/caller lookups | **P0** |
| Full-graph chain rebuild can trigger after any hierarchy write | `noteHierarchyWrite` sets a process-local stale flag on Users/Guides/BvGroups/BvGroupMembers writes → next scoped request reloads all five collections | `app-backend-sdk.ts`, `hierarchyUtils.ts` | Debounce rebuilds (e.g. ≤ once per N minutes or after a quiet period); scope the rebuild to the affected subtree; don't mark locally-stale for fields unrelated to reporting | Eliminates sporadic multi-second spikes on the request after a role/group edit | **P0** |

### B. Infrastructure (P0/P1)

| Issue | Root Cause | Evidence | Recommended Change | Expected Impact | Priority |
|---|---|---|---|---|---|
| Cold starts on nearly every quiet-period visit | `minInstances: 0` | `apphosting.yaml` | Set `minInstances ≥ 1` (or 2 for peaks); keep `maxInstances`/`concurrency` | Removes cold-start seconds from the first request after idle; the single most visible "everything buffers" fix for bursty usage | **P0** |
| Compute/Firestore region may be split | Firestore pinned `asia-south1`; compute region not declared | `firebase.json`, `apphosting.yaml` | Verify the App Hosting backend region; co-locate compute with `asia-south1` if it isn't | Each round trip drops by the inter-region RTT (order 100–250 ms); multiplied by 3–21 queries → large | **P0** (verify first) |
| Deep request amplification | 3–21 DB queries per endpoint | measured traces | Push filtering/aggregation server-side and reduce round trips (see §E) | Multiplies the latency win above | P1 |

### C. Dashboards (P1)

| Issue | Root Cause | Evidence | Recommended Change | Expected Impact | Priority |
|---|---|---|---|---|---|
| First dashboard visit is slow | Multiple uncached endpoints run on open; each pays the tax above | `dashboard-performance.md` (main calls per area) | Keep current parallel fetching; add: server-side pre-aggregated summaries for the metrics widgets; request-scoped auth memoization; prefetch after auth (already present) — ensure it never competes with visible requests | First visit approaches the cached path; fewer sequential waits | P1 |
| Global refetch on profile change | `dashboardScope` includes mutable fields; cache cleared wholesale on change | `app-endpoints-sdk.ts` + `dashboardScope.ts` | Split identity/authorization (rare, clears cache) from other profile fields (do **not** clear; just refresh `getUserProfile`); ignore incidental `undefined` vs `null` drift | Prevents all-panel refetch storms and listener rebuilds | P1 |
| Realtime listener churn | Query listener re-subscribed as tokens change | `RealtimeSyncProvider.tsx` | Keep the listener batch stable; update subscribed document IDs in place where possible | Fewer reconnects, fewer surprise refetches | P2 |

### D. Reports (P1)

| Issue | Root Cause | Evidence | Recommended Change | Expected Impact | Priority |
|---|---|---|---|---|---|
| Reports read 500–5,000 docs and aggregate in memory on first view | No materialized summaries for these reports | measured rows/queries; endpoints (`getGuideDetailedReport`, `getBvSessionMatrix`, `getMissingSadhanaReport`, `getBvslGroups`) | Adopt the pattern already used for leaderboards (`SadhanaMonthlySummaries`/`startAppVersion`-style summaries): maintain period summaries; serve reports from them; recompute incrementally on write | Turns multi-second cold reports into bounded reads; matches the leaderboard redesign that already works | P1 |
| `getBvslGroups` issues 21 queries | Per-group/member enrichment waves | measurement `queries: 21` | Batch enrichment with `in` (≤30) as `getPushSubscriptionStats`/`createMeeting` already do; cache group-scoped results (server cache keyed by scope, short TTL) | Largest single query-count reduction | P1 |
| Reports can block on display labels | PW directory branch awaits `Guides.findAll` before the history read | **Confirmed failing test** `cold-report-concurrency.test.ts` | Start the scoped data read before reference-label reads; never await labels on the critical path | Removes a full extra round trip from the directory path | P1 |

### E. Query/cost reductions (P1/P2)

| Issue | Root Cause | Evidence | Recommended Change | Expected Impact | Priority |
|---|---|---|---|---|---|
| Over-fetch / payload size | Member directory returns ~324 KB | measurement | Return only rendered fields + aggregates; page at the **server** (cursor) rather than downloading all then paginating in the DOM | Smaller payloads, faster parse/render | P2 |
| Small queries still 300–1,600 ms | Region latency ± SDK overhead | measurement | After B (region) + A (tax), re-measure; if still high, batch related reads and use `getAll`/`in` | Establishes the achievable floor | P1 |
| Two-layer read ergonomics | `useQuery` wraps the endpoint cache (single cache, but shared 60 s TTL and global clear) | `useQuery.ts` | Keep one cache; document that TTL and clearing are shared; avoid wrapping same endpoint with different keys | Removes confusion and redundant requests | P3 |

### F. Perceived responsiveness (P2/P3)

| Issue | Root Cause | Evidence | Recommended Change | Expected Impact | Priority |
|---|---|---|---|---|---|
| Long spinners | 45 s query timeout, no progressive reveal; retries up to 3× with backoff | `app-endpoints-sdk.ts`, `useQuery.ts` | Render shell + partial data immediately; show last-known data while refreshing (already done for cache hits); reduce query timeout; add per-panel skeletons rather than full-screen blocks | Interactions feel responsive even when data is in flight | P2 |
| Mutations block the UI | Awaited server writes with no optimistic path (except quiz activation) | code | Apply the existing optimistic+rollback pattern to safe, reversible actions; never for financial/sensitive ops | Buttons feel instant without false success | P3 |
| Group switching | Switching group changes input key → cache miss → full endpoint re-run incl. authorization; previous in-flight response can still resolve | `invokeEndpoint` keying + `App.tsx` route/panel behavior | Prefetch on pointer intent (partially present); keep the shell; scope cache entries by group and show cached group data instantly while revalidating; ignore stale responses for a superseded group (the SDK already tracks epoch/version — extend it to group keys) | Group switch felt as immediate where data is cached; correct group data guaranteed | P1 |

---

## 5. Dashboard / Report / Group-switching plans (summarized)

- **Dashboard:** (1) make auth/scope request-scoped and memoized; (2) stop the rate-limit and realtime-registration transactions from sitting on the critical path; (3) set `minInstances ≥ 1`; (4) co-locate compute with Firestore; (5) split "identity change clears cache" from "profile field change refreshes profile".
- **Reports:** materialize period summaries; batch enrichment; never await labels before data; keep the 60 s stale-while-revalidate display.
- **Group switching:** keep the shell (already partly done); key cache + in-flight tracking by `(group, filters)`; prefetch on intent; render cached group data instantly and revalidate silently; ensure a stale group's response can never overwrite the newly selected group (extend the existing epoch/version guard).

---

## 6. Caching & state-management strategy

- **Keep** the single endpoint SDK cache (identity + permission scope + endpoint + filters), 250-entry LRU, stale-while-revalidate, request dedupe, and the data-free realtime metadata stream.
- **Change** the invalidation granularity: clear-all only on **identity/authorization** change; refresh-in-place for other profile fields.
- **Add** request-scoped auth/scope memoization (server) and a short in-process cache for the `Config` readiness marker.
- **Do not** add a second client cache or pre-fetch private data speculatively; keep authorization scoping ahead of any cache.

---

## 7. Prioritized roadmap

**P0 (do first — lifts every feature):**
1. Take the rate-limit Firestore transaction off the request path.
2. Move realtime query registration off the critical path.
3. Memoize authorization scope per request; stop duplicate scope resolution.
4. `minInstances ≥ 1`.
5. Verify/pin the App Hosting region to match Firestore (`asia-south1`).

**P1 (feature-level, high impact):**
6. Debounce/limit reporting-chain rebuilds.
7. Materialize heavy report summaries; batch `getBvslGroups`.
8. Fix the directory label-blocking read (confirmed test).
9. Stop the wholesale client-cache clear on profile-field churn.
10. Group-switch caching + stale-response guard.

**P2 (medium):** server-side pagination/cursor and payload trimming for the directory; reduce query and mutation timeouts with progressive reveal; stabilize realtime listener batching.

**P3 (polish):** per-panel skeletons/optimistic UI for safe reversible actions; unify `useQuery` usage; document cache semantics.

---

## 8. Expected improvements (measured vs. hypothesis)

| Change | Basis | Estimate |
|---|---|---|
| Remove rate-limit transaction | code path | Saves one transactional round trip per request — **hypothesis**: tens to low-hundreds of ms per request, plus removal of burst contention |
| Move realtime registration off critical path | code path | Saves one transaction + clock reads per read — **hypothesis**: similar magnitude; also cuts write cost |
| Co-locate compute with Firestore | region split | **Hypothesis:** ~100–250 ms × 3–21 queries; potentially the largest effect if regions are indeed split |
| `minInstances ≥ 1` | config | **Hypothesis:** removes cold-start seconds on first-after-idle request |
| Memoize scope per request | duplicate reads | **Hypothesis:** several reads → one per request |
| Materialized report summaries | leaderboards already do this | Targets the measured 1.5–6.9 s cold reports down toward the cached path |
| Cached group switch | cached flows already 77–203 ms | **Hypothesis:** uncached group switch approaches the cached band |

**I cannot state production P50/P95 after these changes without a browser/emulator run.** The instrumentation already exists (`Server-Timing`, `window.__pwDashboardPerformance()`, `dashboard-tab:*` measures); the next step is to re-run the existing four-role browser test and the live DB profiler and compare against `dashboard-performance-measurements.json`.

---

## 9. Regression & benchmarking plan

1. **Baseline now:** run `tests/admin-dashboard-performance.browser.cjs` (and `scripts/profileDashboard.ts`) on the deployed build; record first-visit and cached-return times per role and per report, plus `Server-Timing` breakdown.
2. After each P0 change, re-run the same flows on the same data/date/filters; compare hashes to prove output equivalence (as the prior pass did — 64/64).
3. Add a regression assertion that no endpoint performs an unbounded collection scan for authorization, and that read latency p95 stays under the target.
4. Keep two-server tests for the client cache (identity change clears, field change does not) and for stale-group-response rejection.
5. Targets (aspirational, from the task): button feedback < 100 ms; cached navigation ≈ immediate; cached group switch 100–300 ms; dashboard 1–2 s; report 1–3 s; API p95 < 500 ms; LCP < 2.5 s; INP ≤ 200 ms.

---

## 10. What is required before claiming success

- A runnable environment (Linux Node or a normal filesystem) to measure TTFB/LCP/INP and re-profile.
- Confirmation of the **App Hosting backend region** from the Firebase console (config alone cannot show it).
- A read-only DB profiling run to re-derive query counts and durations after changes.
