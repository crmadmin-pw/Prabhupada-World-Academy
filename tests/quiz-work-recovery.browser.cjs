// Local browser checks. Every API response is mocked; external requests are blocked.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3135';

async function setup(browser, admin, width) {
  const profile = { id: admin ? 'quiz-author' : 'quiz-member', userId: admin ? 'AUTHOR' : 'MEMBER',
    email: 'quiz@example.invalid', fullName: 'Quiz Test', status: 'Active', role: admin ? 'ADMIN' : 'User',
    isBvAdmin: admin, isBvMember: !admin, segment: 'PW', ashrayLevel: 'Sevak' };
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  const writes = [];
  let stored = null;
  let submitted = false;
  const questions = [
    { id: 'one', text: 'First question', type: 'single', options: ['First answer', 'Other answer'] },
    { id: 'two', text: 'Second question', type: 'multiple', options: ['Choice A', 'Choice B', 'Choice C'] },
  ];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await context.addInitScript(({ apiKey, profile }) => {
    const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: profile.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
    localStorage.setItem('folk_login_ts', String(Date.now()));
    localStorage.setItem('folk_install_dismissed', '1');
    localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({ uid: profile.id, email: profile.email,
      emailVerified: true, isAnonymous: false, providerData: [], apiKey, appName: '[DEFAULT]',
      stsTokenManager: { refreshToken: 'test-only', accessToken: token, expirationTime: Date.now() + 3600000 } }));
  }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, profile });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('accounts:lookup')) {
      return route.fulfill({ json: { users: [{ localId: profile.id, email: profile.email, emailVerified: true }] } });
    }
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const name = url.pathname.split('/').pop();
    let response = {};
    if (name === 'getUserProfile') response = { user: profile };
    if (name === 'getCurrentGuide') response = { guide: { id: profile.id, guideId: profile.userId, fullName: profile.fullName, folkResidencies: [] } };
    if (/getPending|getAllResidencies|getResidenciesForGuide|getCleanlinessReviews|getActiveSadhanaMentors/.test(name)) response = [];
    if (name === 'getGuideRequests') response = { guideTransfers: [], ashrayUpgrades: [] };
    if (name === 'getGuides') response = { guides: [] };
    if (name === 'getMeetings') response = { meetings: [] };
    if (name === 'getPwNotificationConfig') response = { enabled: false, times: [] };
    if (name === 'getUserDashboardData') response = { metrics: {}, recentEntries: [] };
    if (name === 'getUserProgressStats') response = { entries: [], fieldTrends: [], insightFields: [] };
    if (name === 'getUserBvStatus') response = { myGroup: { groupId: 'group', groupName: 'Reading group', bvslName: 'RGF', memberCount: 2 }, streak: 1, attendanceRate: 100 };
    if (name === 'getBvAttendance') response = { userHistory: [], leaderboard: [] };
    if (name === 'getBvQuizzes') response = { groups: [], quizzes: stored ? [stored] : [], permissions: { canManageContent: true, canToggleGroups: false } };
    if (name === 'createBvQuiz') {
      const input = route.request().postDataJSON();
      writes.push(input);
      stored = { ...input, id: 'saved-quiz', isActive: input.publicationStatus === 'published', questionCount: input.questions.length, submissionCount: 0, createdAt: '2026-11-03' };
      response = { success: true, quizId: stored.id };
    }
    if (name === 'getMyBvQuizSubmissions') response = { submissions: submitted ? [{ id: 'submission', quizTitle: 'Practice quiz', score: 2, totalQuestions: 2, percentage: 100 }] : [],
      pendingQuizzes: submitted ? [] : [{ id: 'attempt-quiz', title: 'Practice quiz', questionCount: 2 }], stats: { totalTaken: submitted ? 1 : 0, avgPercent: 100 } };
    if (name === 'getBvQuizDetail') response = admin ? stored : { id: 'attempt-quiz', title: 'Practice quiz', questions };
    if (name === 'submitBvQuiz') {
      writes.push(route.request().postDataJSON());
      submitted = true;
      response = { score: 2, total: 2, percentage: 100, results: questions.map(q => ({ questionId: q.id, selected: q.id === 'one' ? [0] : [0, 1], correct: q.id === 'one' ? [0] : [0, 1], isCorrect: true, explanation: '' })) };
    }
    return route.fulfill({ json: response });
  });
  return { context, page, errors, writes };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const admin = await setup(browser, true, 1400);
    const { page } = admin;
    await page.goto(`${origin}/pw-admin/dashboard#quizzes`);
    await page.getByRole('button', { name: 'New Quiz', exact: true }).click({ timeout: 60000 });
    await page.getByPlaceholder('Quiz title...').fill('Recovered quiz');
    await page.getByPlaceholder('Question text...').fill('An unfinished question');
    await expect(page.getByRole('status').filter({ hasText: 'Changes saved on this device' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'New Quiz', exact: true }).click();
    await expect(page.getByPlaceholder('Quiz title...')).toHaveValue('Recovered quiz');
    await expect(page.getByPlaceholder('Question text...')).toHaveValue('An unfinished question');
    assert.equal(admin.writes.length, 0, 'browser autosave must not publish');
    await page.getByRole('button', { name: 'Save as Draft', exact: true }).click();
    await expect(page.getByText('Draft · Only you', { exact: true })).toBeVisible();
    assert.equal(admin.writes[0].publicationStatus, 'draft');
    await page.getByRole('button', { name: 'Edit Recovered quiz', exact: true }).click();
    await page.getByPlaceholder('Option 1...').fill('Yes');
    await page.getByPlaceholder('Option 2...').fill('No');
    await page.getByText('Options — click ✓ to mark the correct answer', { exact: true }).locator('..').locator('button').first().click();
    await page.getByRole('button', { name: 'Publish Quiz', exact: true }).click();
    await expect(page.getByText('Draft · Only you', { exact: true })).toHaveCount(0);
    assert.equal(admin.writes.at(-1).publicationStatus, 'published');
    assert.deepEqual(admin.errors, []);
    await admin.context.close();
    console.log('Editor: browser recovery, private draft and explicit publish passed');

    for (const width of [1400, 390]) {
      const member = await setup(browser, false, width);
      const { page } = member;
      await page.goto(`${origin}/user/pw-dashboard#bv`);
      await page.getByRole('button', { name: 'Start', exact: true }).click({ timeout: 60000 });
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'First answer', exact: true }).click();
      await page.mouse.click(2, 2);
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: width < 640 ? 'Close' : 'Close and resume later', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'First answer', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
      await dialog.getByRole('button', { name: 'Choice A', exact: true }).click();
      await dialog.getByRole('button', { name: 'Choice B', exact: true }).click();
      await page.reload();
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Choice A', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.getByRole('button', { name: 'Choice B', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await dialog.getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
      assert.equal(member.writes.length, 1);
      assert.deepEqual(member.writes[0].answers, [{ questionId: 'one', selected: [0] }, { questionId: 'two', selected: [0, 1] }]);
      assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes(':attempt:'))), false);
      assert.deepEqual(member.errors, []);
      await member.context.close();
      console.log(`Attempt at ${width}px: outside click, reopen, reload, multiple answers and submit cleanup passed`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
