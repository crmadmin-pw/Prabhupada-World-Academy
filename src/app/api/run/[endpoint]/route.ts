import { NextRequest, NextResponse } from 'next/server';
import { resolveAuthenticatedProfile } from '@/lib/accountLinkReview';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { verifyFirebaseIdToken } from '@/lib/verifyFirebaseIdToken';
import { timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  buildApiUserContext,
  hasApiCapabilities,
  type ApiCapability,
  type ApiDatabaseUser,
  type ApiUserContext,
} from '@/lib/apiAuthorization';
import { isReadOnlyEndpoint } from '@/lib/realtimeChannels';
import { withRequestQueries } from '@/lib/requestQueries';
import { whenServerCacheShared } from '@/lib/serverCache';
import { registerRealtimeQuery } from '@/lib/realtimeQueryRegistration';
import { registerRealtimeIdentity } from '@/lib/realtimeIdentityRegistration';
import { caughtApiError } from '@/lib/caughtApiError';
import { isRateLimited, RATE_LIMIT_MESSAGE } from '@/utils/rateLimit';

interface SchemaIssue {
  message?: string;
}

interface EndpointSchema {
  safeParse(input: unknown):
    | { success: true; data: unknown }
    | { success: false; error: { errors?: unknown; issues?: SchemaIssue[] } };
}

interface EndpointConfig {
  public?: boolean;
  publicSecretEnv?: string;
  requiredCapabilities?: ApiCapability | ApiCapability[];
  maxBodyBytes?: number;
  inputSchema?: EndpointSchema;
  execute(args: { input: unknown; context: { user: ApiUserContext | null } }): Promise<unknown> | unknown;
}

// Initialize Firebase Admin safely
const apps = getApps();
if (apps.length === 0) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'bvpw108';
  const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
  let initialized = false;

  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      if (serviceAccount.private_key && serviceAccount.private_key.includes('BEGIN') && !serviceAccount.private_key.includes('dummy')) {
        initializeApp({
          credential: cert(serviceAccount),
          projectId: serviceAccount.project_id || projectId
        });
        initialized = true;
      }
    } catch {
      console.warn('[Firebase Admin Route] Failed to initialize using local file, using project ID fallback.');
    }
  }
  
  if (!initialized && process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (serviceAccount.private_key && serviceAccount.private_key.includes('BEGIN') && !serviceAccount.private_key.includes('dummy')) {
        initializeApp({
          credential: cert(serviceAccount),
          projectId: serviceAccount.project_id || projectId
        });
        initialized = true;
      }
    } catch {
      console.warn('[Firebase Admin Route] Failed to initialize using env var, using project ID fallback.');
    }
  }

  if (!initialized && getApps().length === 0) {
    try {
      initializeApp({ projectId });
    } catch (e) {
      console.error('[Firebase Admin Route] Fallback initializeApp failed:', e);
    }
  }
}

async function verifyToken(token: string): Promise<{ email: string; uid: string; emailVerified: boolean; authTime: number | null }> {
  const decoded = await verifyFirebaseIdToken(token);
  if (!decoded.email) throw new Error('Unauthorized: An email address is required.');
  return {
    email: decoded.email,
    uid: decoded.uid,
    emailVerified: decoded.email_verified === true,
    authTime: typeof decoded.auth_time === 'number' ? decoded.auth_time : null,
  };
}

type VerifiedUser = Awaited<ReturnType<typeof verifyToken>>;

// A dashboard commonly starts several endpoint requests together. Without a
// burst cache, every request independently repeats the same UID lookup before
// its real endpoint can even start. Keep this deliberately short so role/status
// revocations remain effectively immediate while requests from one render share
// the lookup. Email matches are not linked here.
const resolvedUserBurstCache = new Map<string, { user: ApiDatabaseUser | null; expiresAt: number }>();
const resolvedUserInFlight = new Map<string, Promise<ApiDatabaseUser | null>>();
const RESOLVED_USER_BURST_TTL_MS = 2_000;
const MAX_RESOLVED_USER_CACHE_ENTRIES = 500;

async function resolveDatabaseUser(decodedUser: VerifiedUser, freshAuthority = false): Promise<ApiDatabaseUser | null> {
  const cacheKey = `${decodedUser.uid}:${decodedUser.email.toLowerCase()}`;
  const now = Date.now();
  const cached = resolvedUserBurstCache.get(cacheKey);
  if (!freshAuthority && cached && cached.expiresAt > now) return cached.user;
  if (cached) resolvedUserBurstCache.delete(cacheKey);

  const existing = resolvedUserInFlight.get(cacheKey);
  if (!freshAuthority && existing) return existing;

  const resolution = (async (): Promise<ApiDatabaseUser | null> => {
    const dbUser = await resolveAuthenticatedProfile(decodedUser.uid, decodedUser.email);

    if (resolvedUserBurstCache.size >= MAX_RESOLVED_USER_CACHE_ENTRIES) {
      const oldestKey = resolvedUserBurstCache.keys().next().value;
      if (oldestKey) resolvedUserBurstCache.delete(oldestKey);
    }
    resolvedUserBurstCache.set(cacheKey, {
      user: dbUser,
      expiresAt: Date.now() + RESOLVED_USER_BURST_TTL_MS,
    });
    return dbUser;
  })();

  resolvedUserInFlight.set(cacheKey, resolution);
  try {
    return await resolution;
  } finally {
    if (resolvedUserInFlight.get(cacheKey) === resolution) {
      resolvedUserInFlight.delete(cacheKey);
    }
  }
}

function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function verifyPublicEndpointSecret(req: NextRequest, endpointConfig: EndpointConfig): boolean {
  const secretEnv = endpointConfig.publicSecretEnv;
  if (!secretEnv) return true;

  const expected = process.env[secretEnv] || '';
  if (!expected) return false;

  const provided =
    req.headers.get('x-webhook-secret') ||
    req.headers.get('x-api-secret') ||
    '';

  return !!provided && secretsMatch(provided, expected);
}

const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ endpoint: string }> }
) {
  const requestStartedAt = Date.now();
  let authDurationMs = 0;
  let realtimeDurationMs = 0;
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const rateLimitKey = token ? `token:${token.slice(-30)}` : `ip:${req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1'}`;
  const limit = token ? 180 : 60;

  if (process.env.NODE_ENV !== 'development' && await isRateLimited(rateLimitKey, limit, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json(
      { message: RATE_LIMIT_MESSAGE, code: 'TOO_MANY_REQUESTS' },
      { status: 429, headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_MS / 1000) } }
    );
  }

  const { endpoint } = await params;

  // Prevent path traversal and importing anything outside the endpoint module namespace.
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(endpoint)) {
    return NextResponse.json({ message: 'Invalid endpoint' }, { status: 404 });
  }

  try {
    // 1. Dynamic import of the requested endpoint file
    let endpointConfig: EndpointConfig;
    try {
      endpointConfig = (await import(`@/api/${endpoint}`)).default as EndpointConfig;
    } catch (error: unknown) {
      console.error(`[API Router] Endpoint not found: ${endpoint}`, error);
      return NextResponse.json(
        { message: `Endpoint ${endpoint} not found or failed to load.` },
        { status: 404 }
      );
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    const maxBodyBytes = endpointConfig.maxBodyBytes || 1_000_000;
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return NextResponse.json({ message: 'Request body is too large' }, { status: 413 });
    }

    // Public access must be explicitly declared. Missing configuration is private.
    const isPublicEndpoint = endpointConfig.public === true;

    if (isPublicEndpoint && !verifyPublicEndpointSecret(req, endpointConfig)) {
      return NextResponse.json(
        { message: 'Public endpoint authentication failed' },
        { status: 401 }
      );
    }

    // 2. Parse request body
    let body = {};
    if (req.headers.get('content-type')?.includes('application/json')) {
      body = await req.json().catch(() => ({}));
    }

    // 3. Setup context
    const context: { user: ApiUserContext | null } = { user: null };
    let resolvedProfile: unknown;

    if (token) {
      const authStartedAt = Date.now();
      try {
        const decodedUser = await verifyToken(token);
        if (!decodedUser.emailVerified) {
          return NextResponse.json({ message: 'A verified email is required' }, { status: 403 });
        }

        // A role-revocation event can arrive inside the old burst-cache TTL.
        // Reactive reads must reauthorize against the current stored profile.
        const dbUser = await resolveDatabaseUser(decodedUser, req.headers.get('X-Realtime-Query') === '1');
        resolvedProfile = dbUser;
        context.user = buildApiUserContext(decodedUser, dbUser);
        authDurationMs = Date.now() - authStartedAt;
      } catch (authError: unknown) {
        const authFailure = caughtApiError(authError);
        console.error('[API Router] Authentication error:', authError);
        // Never fail open when a caller presents an invalid token, even for a public endpoint.
        return NextResponse.json(
          { message: authFailure.message || 'Unauthorized' },
          { status: 401 }
        );
      }
    } else if (!isPublicEndpoint) {
      return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }

    const requiredCapabilities = endpointConfig.requiredCapabilities as ApiCapability | ApiCapability[] | undefined;
    if (!hasApiCapabilities(context.user, requiredCapabilities)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    // 4. Input validation using Zod schema defined in endpoint
    let validatedInput: unknown = body;
    if (endpointConfig.inputSchema) {
      const parseResult = endpointConfig.inputSchema.safeParse(body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues ?? [];
        const issue = issues[0]?.message;
        return NextResponse.json(
          { message: issue ? `Validation failed: ${issue}` : 'Validation failed', errors: issues },
          { status: 400 }
        );
      }
      validatedInput = parseResult.data;
    }

    // 5. Execute endpoint handler
    const endpointStartedAt = Date.now();
    const reactive = req.headers.get('X-Realtime-Query') === '1' && isReadOnlyEndpoint(endpoint) && !!context.user;
    const { result: output, metrics: queryMetrics, dependencies, readVersion } = await withRequestQueries(
      async () => endpointConfig.execute({ input: validatedInput, context }),
      reactive,
    );
    const endpointDurationMs = Date.now() - endpointStartedAt;

    if (context.user) {
      try { await registerRealtimeIdentity(context.user, resolvedProfile); }
      catch (error) { console.warn('[Realtime] Notification routing registration unavailable', error); }
    }

    let realtimeQuery: { token: string; version: string } | undefined;
    if (reactive && context.user) {
      const realtimeStartedAt = Date.now();
      try {
        realtimeQuery = await registerRealtimeQuery(context.user, endpoint, validatedInput, dependencies, readVersion);
      } catch (error) {
        // Reading business data must still work during a transport outage.
        console.warn('[Realtime] Query registration unavailable', error);
      }
      realtimeDurationMs = Date.now() - realtimeStartedAt;
    }

    // Native Firestore write events cover committed mutations, including
    // imports and background jobs, with durable managed retries. No broad
    // department broadcast or unreliable post-response publish is needed.
    // 6. Return response
    const serializeStartedAt = performance.now();
    const response = NextResponse.json(output);
    const serializeDurationMs = performance.now() - serializeStartedAt;
    const totalDurationMs = Date.now() - requestStartedAt;
    response.headers.set('Cache-Control', 'private, no-store');
    if (realtimeQuery) {
      response.headers.set('X-Realtime-Token', realtimeQuery.token);
      response.headers.set('X-Realtime-Version', realtimeQuery.version);
    }
    response.headers.set(
      'Server-Timing',
      `auth;dur=${authDurationMs}, endpoint;dur=${endpointDurationMs}, db;dur=${queryMetrics.durationMs.toFixed(1)};desc="sum of concurrent reads", queries;desc="${queryMetrics.count}", deduplicated;desc="${queryMetrics.deduplicated}", serialize;dur=${serializeDurationMs.toFixed(1)}, realtime;dur=${realtimeDurationMs}, total;dur=${totalDurationMs}`,
    );
    if (totalDurationMs >= 1_000) {
      console.warn(
        `[API Performance] ${endpoint} took ${totalDurationMs}ms ` +
        `(auth ${authDurationMs}ms, endpoint ${endpointDurationMs}ms)`,
      );
    }
    await whenServerCacheShared();
    return response;

  } catch (error: unknown) {
    const failure = caughtApiError(error);
    if (failure.code !== 'TOO_MANY_REQUESTS') {
      console.error(`[API Router] Error running ${endpoint}:`, error);
    }
    await whenServerCacheShared();
    return NextResponse.json(
      { message: failure.message, code: failure.code },
      {
        status: failure.status,
        headers: failure.code === 'TOO_MANY_REQUESTS'
          ? { 'Retry-After': String(failure.retryAfterSeconds || RATE_LIMIT_WINDOW_MS / 1000) }
          : undefined,
      }
    );
  }
}
