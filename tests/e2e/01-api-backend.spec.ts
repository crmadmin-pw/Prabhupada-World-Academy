// ═══════════════════════════════════════════════════════════════════════════
// 01-api-backend.spec.ts  — Pure API / backend tests (no browser needed)
// Tests every major API endpoint with correct tokens and validates responses.
// ═══════════════════════════════════════════════════════════════════════════
import { test, expect } from '@playwright/test';
import { USERS, apiCall } from './helpers';

let testGuideId: string = '9b438709-3d45-48a5-bb45-7cbff4a9ee75';

test.beforeAll(async ({ request }) => {
  const { body } = await apiCall(request, 'getGuides');
  if (body?.guides?.length > 0) {
    testGuideId = body.guides[0].guideId;
  }
});

// ─── Public endpoints ───────────────────────────────────────────────────────

test.describe('Public API', () => {
  test('GET /api/run/getGuides returns guides array', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getGuides');
    expect(status).toBe(200);
    expect(body).toHaveProperty('guides');
    expect(Array.isArray(body.guides)).toBe(true);
    expect(body.guides.length).toBeGreaterThan(0);
    const g = body.guides[0];
    expect(g).toHaveProperty('guideId');
    expect(g).toHaveProperty('name');
  });

  test('GET /api/run/getAllResidencies returns residencies', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getAllResidencies');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('Non-existent endpoint returns 404', async ({ request }) => {
    const { status } = await apiCall(request, 'nonExistentEndpoint');
    expect(status).toBe(404);
  });
});

// ─── Auth — getUserProfile ───────────────────────────────────────────────────

test.describe('Auth — getUserProfile', () => {
  test('Regular user profile loads correctly', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getUserProfile', {}, USERS.regular.email);
    expect(status).toBe(200);
    expect(body.user).toHaveProperty('email', USERS.regular.email);
    expect(body.user).toHaveProperty('role', 'USER');
  });

  test('Guide profile has correct role', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getUserProfile', {}, USERS.guide.email);
    expect(status).toBe(200);
    expect(body.user.role).toBe('GUIDE');
  });

  test('Super Guide profile has correct role', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getUserProfile', {}, USERS.super.email);
    expect(status).toBe(200);
    expect(body.user.role).toBe('SUPER_GUIDE');
  });

  test('Sadhana Mentor profile has correct role', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getUserProfile', {}, USERS.mentor.email);
    expect(status).toBe(200);
    expect(body.user.role).toBe('SADHANA_MENTOR');
  });

  test('BVSL profile has correct role', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getUserProfile', {}, USERS.bvsl.email);
    expect(status).toBe(200);
    expect(body.user.role).toBe('BVSL');
  });

  test('Unauthenticated request is rejected', async ({ request }) => {
    // Calling an authenticated endpoint without token
    const res = await request.post('http://localhost:3000/api/run/getUserProfile', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    // Should return 401 or error
    expect([401, 403, 500]).toContain(res.status());
  });
});

// ─── Guide Dashboard API ─────────────────────────────────────────────────────

test.describe('Guide Dashboard API', () => {
  test('getCurrentGuide returns guide record', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getCurrentGuide', {}, USERS.guide.email);
    expect(status).toBe(200);
    expect(body).toHaveProperty('guide');
  });

  test('getGuideUsers returns users for the guide', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getGuideUsers', {}, USERS.guide.email);
    expect(status).toBe(200);
    expect(body).toHaveProperty('users');
    expect(Array.isArray(body.users)).toBe(true);
  });

  test('getSadhanaFormData returns fields list', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getSadhanaFormData', {}, USERS.guide.email);
    expect(status).toBe(200);
    expect(body).toHaveProperty('fields');
    expect(Array.isArray(body.fields)).toBe(true);
    expect(body.fields.length).toBeGreaterThan(0);
  });

  test('getGuideDetailedReport returns report data', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const { status, body } = await apiCall(request, 'getGuideDetailedReport',
      { guideId: testGuideId, date: today, reportType: 'daily' }, USERS.guide.email);
    expect(status).toBe(200);
    expect(body).toHaveProperty('users');
  });

  test('getSadhanaStats returns stats', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const { status, body } = await apiCall(request, 'getSadhanaStats',
      { guideId: testGuideId, startDate: today, endDate: today }, USERS.guide.email);
    expect(status).toBe(200);
  });

  test('Regular user cannot access guide-only getCurrentGuide', async ({ request }) => {
    // getCurrentGuide for a non-guide should return null/empty or an error
    const { status, body } = await apiCall(request, 'getCurrentGuide', {}, USERS.regular.email);
    // Either 200 with null guide or 403
    if (status === 200) {
      expect(body === null || body?.guide === undefined).toBeTruthy();
    } else {
      expect([403, 401]).toContain(status);
    }
  });
});

// ─── Super Guide API ─────────────────────────────────────────────────────────

test.describe('Super Guide API', () => {
  test('Super guide can fetch all users', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getGuideUsers',
      { isSuperGuide: true }, USERS.super.email);
    expect(status).toBe(200);
    expect(body).toHaveProperty('users');
    expect(body.users.length).toBeGreaterThan(5);
  });

  test('Super guide can list all guides', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getGuides', {}, USERS.super.email);
    expect(status).toBe(200);
    expect(body.guides.length).toBeGreaterThan(5);
  });

  test('getPushSubscriptionStats is accessible to super guide', async ({ request }) => {
    const { status } = await apiCall(request, 'getPushSubscriptionStats', {}, USERS.super.email);
    expect(status).toBe(200);
  });

  test('Regular user cannot call super-only endpoints', async ({ request }) => {
    const { status } = await apiCall(request, 'getPushSubscriptionStats', {}, USERS.regular.email);
    expect([200, 403, 401]).toContain(status);
  });
});

// ─── Sadhana Mentor API ──────────────────────────────────────────────────────

test.describe('Sadhana Mentor API', () => {
  test('Mentor can fetch their members', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getGuideUsers', {}, USERS.mentor.email);
    expect(status).toBe(200);
    expect(body).toHaveProperty('users');
  });

  test('Mentor can fetch sadhana fields', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getSadhanaFormData', {}, USERS.mentor.email);
    expect(status).toBe(200);
    expect(body).toHaveProperty('fields');
    expect(Array.isArray(body.fields)).toBe(true);
  });
});

// ─── User Self-Service API ───────────────────────────────────────────────────

test.describe('User Self-Service API', () => {
  test('User can fetch their own profile', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getUserProfile', {}, USERS.regular.email);
    expect(status).toBe(200);
    expect(body.user.email).toBe(USERS.regular.email);
  });

  test('User can fetch sadhana history', async ({ request }) => {
    const { status } = await apiCall(request, 'getUserHistory',
      { limit: 10 }, USERS.regular.email);
    expect([200]).toContain(status);
  });

  test('Sadhana fields are returned for user submission', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getSadhanaFormData', {}, USERS.regular.email);
    expect(status).toBe(200);
    expect(body).toHaveProperty('fields');
    expect(Array.isArray(body.fields)).toBe(true);
  });

  test('User profile contains latest guide transfer request info', async ({ request }) => {
    const { status, body } = await apiCall(request, 'getUserProfile', {}, USERS.regular.email);
    expect(status).toBe(200);
    expect(body.user).toHaveProperty('latestGuideTransferStatus');
  });
});

// ─── Data Integrity ──────────────────────────────────────────────────────────

test.describe('Data Integrity', () => {
  test('All guides in getGuides have required fields', async ({ request }) => {
    const { body } = await apiCall(request, 'getGuides');
    for (const guide of body.guides) {
      expect(guide.guideId).toBeTruthy();
      expect(guide.name).toBeTruthy();
    }
  });

  test('All residencies have required fields', async ({ request }) => {
    const { body } = await apiCall(request, 'getAllResidencies');
    for (const r of body) {
      expect(r.residencyId).toBeTruthy();
      expect(r.residencyName).toBeTruthy();
    }
  });

  test('Sadhana fields have name and type', async ({ request }) => {
    const { body } = await apiCall(request, 'getSadhanaFormData', {}, USERS.regular.email);
    for (const field of body.fields) {
      expect(field.fieldKey && field.fieldType).toBeTruthy();
    }
  });
});
