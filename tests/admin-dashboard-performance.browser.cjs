// Built dashboards with deterministic 350ms API responses. No live API writes.
// Run: DASHBOARD_TEST_ORIGIN=http://127.0.0.1:3107 node tests/admin-dashboard-performance.browser.cjs
// BASELINE=1 records the old behavior without asserting cache/state retention.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const origin = process.env.DASHBOARD_TEST_ORIGIN || 'http://127.0.0.1:3107';
const baseline = process.env.BASELINE === '1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
 const browser = await chromium.launch({ headless: true });
 try {
  for (const role of ['PW admin', 'PW super admin', 'FOLK guide', 'FOLK super guide']) {
   if (process.env.PERF_ROLE && role !== process.env.PERF_ROLE) continue;
   const segment = role.startsWith('PW') ? 'PW' : 'FOLK';
   const superAdmin = role.includes('super');
   const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1600, height: 1050 } });
   const page = await context.newPage();
   const errors = [], reads = [], assets = [], durations = [];
   page.on('pageerror', error => errors.push(error.message));
   const profile = { id: 'test-admin', userId: 'test-admin', fullName: 'Test Administrator', email: 'admin@example.invalid',
    role: segment === 'PW' ? (superAdmin ? 'SUPER_ADMIN' : 'User') : (superAdmin ? 'SUPER_GUIDE' : 'Guide'),
    status: 'Active', segment, isBvAdmin: segment === 'PW', isBvSuperAdmin: segment === 'PW' && superAdmin };
   const members = Array.from({length: 120}, (_, i) => ({ id: 'member-'+i, userId: 'member-'+i, fullName: 'Member '+String(i).padStart(3,'0'),
    email: 'member'+i+'@example.invalid', role: 'USER', roles: ['USER'], status: 'ACTIVE', segment,
    isPrabhupadaWorldUser: segment === 'PW', ashrayLevel: 'Sevak', selectedGuideId: 'test-admin', guideId: 'test-admin', guide: 'test-admin', selectedGuideName: 'Test Guide',
    residencyName: '', latestScore: 80, submittedToday: true, bvGroupName: 'Test Group' }));
   const group = { id: 'test-group', groupId: 'test-group', groupDbId: 'test-group', groupName: 'Test Group', segment,
    isActive: true, facilitatorIds: ['test-admin'], bvslName: 'Test RGF', memberCount: 120, totalSessions: 5, bvsls: [], meetingTime: '7 PM' };
   await context.addInitScript(({ apiKey }) => {
    const token = `${btoa('{}')}.${btoa(JSON.stringify({sub:'test-admin',exp:Math.floor(Date.now()/1000)+3600}))}.test`;
    localStorage.setItem('folk_login_ts', String(Date.now()));
    localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify({ uid:'test-admin',email:'admin@example.invalid',emailVerified:true,isAnonymous:false,providerData:[],apiKey,appName:'[DEFAULT]',stsTokenManager:{refreshToken:'test-only',accessToken:token,expirationTime:Date.now()+3600000} }));
   }, { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY });
   await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('accounts:lookup')) return route.fulfill({ json:{ users:[{localId:'test-admin',email:profile.email,emailVerified:true}] } });
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) { assets.push({name:url.pathname.split('/').pop(),at:Date.now()}); return route.continue(); }
    const name = url.pathname.split('/').pop();
    const input = route.request().postDataJSON() || {};
    reads.push({name,input,at:Date.now()});
    let response = {};
    if (name === 'getUserProfile') response = { user:profile };
    if (name === 'getCurrentGuide') response = { guide:{ id:'test-admin',guideId:'test-admin',fullName:'Test Guide',folkResidencies:[] } };
    if (name === 'getGuides') response = { guides:[{id:'test-admin',guideId:'test-admin',name:'Test Guide',fullName:'Test Guide',email:profile.email}] };
    if (name === 'getAllResidencies') response = { residencies:[] };
    if (name === 'getActiveSadhanaMentors') response = [];
    if (name === 'getGuideUsers') response = { users:members };
    if (name === 'getBvslGroups' || name === 'getAllBvGroupsAdmin') response = { groups:[group],bvsls:[],pendingRequestCount:0,error:null };
    if (name === 'getGuideDetailedReport') {
     response = { users: members.slice(0,12).map(u=>({...u,fullName:`Sadhana ${input.date} ${u.fullName}`,submitted:true,isResident:segment==='FOLK',fieldScores:{},fieldRawValues:{},totalScore:16,scorePercent:80,currentStreak:3})), fieldDefs:[],availableResidencies:[],availableGuides:[],summary:{} };
    }
    if (name === 'getBvSessionMatrix') response = { groups:[{id:'test-group',name:'Test Group'}],members:[],dates:[],sessionDates:[],attendance:{},quizScores:{} };
    if (name === 'getSuperGuideBvStats') response = {guides:[],summary:{totalUsers:120,markedCount:120,presentCount:100,absentCount:20,notMarkedCount:0,serviceFullCount:0,avgPoints:2},guideBreakdown:[],leaderboard:[]};
    if (name === 'getMeetings') response = { meetings:[{id:'test-meeting',title:'Test Meeting',type:'FACILITATOR',department:segment,status:'SCHEDULED',scheduledAt:'2026-12-01T14:00:00+05:30',durationMinutes:60,inviteeUserIds:[],invitees:[],createdByName:'Test Administrator'}] };
    if (name === 'getMoms') response = { moms:[] };
    if (name === 'getMissingSadhanaReport') response = { users:[],dates:['2026-09-01'],matrix:{},guides:[],stats:{totalUsers:0,totalDays:7,totalMissing:0,totalLate:0,completionRate:100} };
    if (name === 'getPwNotificationConfig') response = {enabled:false,times:[]};
    if (/getPending|getCleanlinessReviews|getResidencyTransferRequests/.test(name)) response = [];
    if (name === 'getGuideRequests') response = { guideTransfers:[],ashrayUpgrades:[] };
    await delay(name === 'getGuideUsers' && input.forMeetingInvitees ? 1400 : 350);
    return route.fulfill({json:response});
   });
   const root = segment === 'PW' ? '/pw-admin/dashboard' : '/folk-guide/dashboard';
   const navigationStart = performance.now();
   await page.goto(origin+root);
   const sadhana = () => page.getByText(/Sadhana \d{4}-\d\d-\d\d Member 000/, {exact:true}).filter({visible:true}).first();
   await expect(sadhana()).toBeVisible({timeout:20000});
   durations.push({flow:'initial dashboard + Sadhana',ms:Math.round(performance.now()-navigationStart)});
   const flows = [
    ['Bhakti Vriksha Report', segment==='FOLK' && superAdmin ? 'Full Service' : 'Total Members'],
    ['Members / Users','Member 000'],
    ['Bhakti Vriksha','Test Group'],
    ...(segment==='PW' ? [['Meetings & MoM','Test Meeting']] : []),
    ['Missing Sadhana','Completion Rate'],
   ];
   const visibleText = text => page.getByText(text,{exact:true}).filter({visible:true}).first();
   for (let visit=1;visit<=2;visit++) {
    for (const [label, marker] of flows) {
     const beforeReads=reads.length;
     const start=performance.now();
     const clickedAt=Date.now();
     await page.getByRole('button',{name:label,exact:true}).filter({visible:true}).first().click();
     await expect(visibleText(marker)).toBeVisible({timeout:15000});
     durations.push({flow:label,visit,ms:Math.round(performance.now()-start),requests:reads.length-beforeReads});
     if (process.env.PERF_TRACE === '1' && visit === 1) console.error(role, label, reads.slice(beforeReads).map(r => `${r.name}@+${r.at-clickedAt}ms`).join(' '), '| assets', assets.filter(a => a.at >= clickedAt).map(a => `${a.name}@+${a.at-clickedAt}ms`).join(' '));
     if (!baseline && visit === 2) assert.equal(reads.length-beforeReads, 0, `${role}: revisiting ${label} must not refetch`);
     if (label==='Members / Users' && !baseline) {
      const search=page.getByPlaceholder('Search by name...').filter({visible:true});
      if (visit===1) {
       await page.getByRole('button',{name:'Next',exact:true}).filter({visible:true}).click();
       await expect(visibleText('Member 050')).toBeVisible();
       await page.getByRole('button',{name:'Previous',exact:true}).filter({visible:true}).click();
       await search.fill('Member 000');
      }
      else await expect(search).toHaveValue('Member 000');
     }
    }
    const before=reads.filter(r=>r.name==='getGuideDetailedReport').length;
    const start=performance.now();
    await page.getByRole('button',{name:'Sadhana Report',exact:true}).filter({visible:true}).first().click();
    await expect(sadhana()).toBeVisible();
    durations.push({flow:'Sadhana return',visit,ms:Math.round(performance.now()-start),requests:reads.filter(r=>r.name==='getGuideDetailedReport').length-before});
   }
   const beforeFilter=reads.filter(r=>r.name==='getGuideDetailedReport').length;
   const today=page.getByRole('button',{name:'Today',exact:true}).filter({visible:true});
   if (await today.count()) {
    const start=performance.now();
    await today.click();
    const todayDate=new Date().toISOString().slice(0,10);
    await expect(visibleText(`Sadhana ${todayDate} Member 000`)).toBeVisible();
    durations.push({flow:'uncached date filter',ms:Math.round(performance.now()-start)});
    const yesterday=page.getByRole('button',{name:'Yesterday',exact:true}).filter({visible:true});
    const cachedStart=performance.now();
    await yesterday.click();
    const yesterdayDate=new Date(Date.now()-86400000).toISOString().slice(0,10);
    await expect(visibleText(`Sadhana ${yesterdayDate} Member 000`)).toBeVisible();
    durations.push({flow:'cached date filter',ms:Math.round(performance.now()-cachedStart),requests:reads.filter(r=>r.name==='getGuideDetailedReport').length-beforeFilter-1});
    if (!baseline) {
     // Refresh yesterday then change to cached today before the old response
     // arrives. The obsolete response must not replace the selected report.
     await page.getByRole('button',{name:'Refresh',exact:true}).filter({visible:true}).click();
     await today.click();
     await delay(600);
     await expect(visibleText(`Sadhana ${todayDate} Member 000`)).toBeVisible();
    }
   }
   assert.deepEqual(errors,[], `${role} runtime errors`);
   console.log(JSON.stringify({role,baseline,durations,totalRequests:reads.length}));
   await context.close();
  }
 } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1});
