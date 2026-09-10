import { apiUser } from './helpers/apiUser';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import test from 'node:test';

import sendDueMeetingReminders from '../src/api/sendDueMeetingReminders';
import sendMeetingReminder, { encryptPayload, executeMeetingReminder } from '../src/api/sendMeetingReminder';
import { Meetings, PushSubscriptions, Users } from '../src/lib/app-backend-sdk';
import { meetingStartMs } from '../src/lib/meetingReminderSchedule';
import { meetingSubscriptionTargets } from '../src/lib/meetingReminderRecipients';

test('meeting Web Push payload uses browser-compatible RFC 8291 encryption', async () => {
  const receiver = createECDH('prime256v1');
  const receiverPublic = receiver.generateKeys();
  const auth = randomBytes(16);
  const message = JSON.stringify({ title: 'Meeting soon', body: 'Click to join.' });
  const encrypted = await encryptPayload(receiverPublic.toString('base64url'), auth.toString('base64url'), message);
  const wire = Buffer.from(encrypted.body);
  const serverPublic = wire.subarray(21, 86);
  const shared = receiver.computeSecret(serverPublic);
  const ikm = hkdfSync('sha256', shared, auth, Buffer.concat([
    Buffer.from('WebPush: info\0'), receiverPublic, serverPublic,
  ]), 32);
  const salt = wire.subarray(0, 16);
  const key = hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(key), Buffer.from(nonce));
  decipher.setAuthTag(wire.subarray(-16));
  const clear = Buffer.concat([decipher.update(wire.subarray(86, -16)), decipher.final()]);
  assert.equal(clear.at(-1), 2);
  assert.equal(clear.subarray(0, -1).toString(), message);
});


function database(meeting: any) {
  const documents = new Map<string, any>([['Meetings/'+meeting.id, structuredClone(meeting)]]);
  let queue = Promise.resolve();
  return { documents, collection: (name: string) => ({doc:(id: string)=>name+'/'+id}),
    runTransaction(fn: any) {
      const result = queue.then(()=>fn({get:async(ref: string)=>({data:()=>documents.get(ref)}),
        set:(ref: string,data: any,options: any)=>documents.set(ref,options?.merge?{...documents.get(ref),...data}:data)}));
      queue=result.catch(()=>{}); return result;
    },
  };
}
const manager = {user:apiUser({isActive:true,capabilities:['meetings.manage'],segment:'PW'})};
function setup(t: any, overrides: any = {}) {
  const meeting={id:'reminder-test',title:'PW Meeting',segment:'PW',status:'SCHEDULED',
    scheduledAt:new Date(Date.now()+10*60_000).toISOString(),locationOrLink:'https://meet.google.com/test',
    inviteeUserIds:['old-1','auth-2','db-3'],invitees:[],...overrides};
  const db=database(meeting), published:any[]=[];
  const users=[{id:'db-1',userId:'old-1',authUid:'auth-1',email:'one@example.invalid'},
    {id:'db-2',authUid:'auth-2',email:'two@example.invalid'}, {id:'db-3',email:'three@example.invalid'}];
  const receiver=createECDH('prime256v1');receiver.generateKeys();
  const vapid=createECDH('prime256v1');vapid.generateKeys();
  const previous=[process.env.APP_VAPID_PRIVATE_KEY,process.env.APP_VAPID_PUBLIC_KEY];
  process.env.APP_VAPID_PRIVATE_KEY=vapid.getPrivateKey().toString('base64url');
  process.env.APP_VAPID_PUBLIC_KEY=vapid.getPublicKey().toString('base64url');
  t.after(()=>{for(const [key,value] of [['APP_VAPID_PRIVATE_KEY',previous[0]],['APP_VAPID_PUBLIC_KEY',previous[1]]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}});
  const sub=(id:string,user:any)=>({id,user,endpoint:'https://push.example.invalid/'+id,p256DhKey:receiver.getPublicKey().toString('base64url'),authKey:randomBytes(16).toString('base64url')});
  const subscriptions=[sub('phone-1',['db-1']),sub('laptop-1','auth-1'),sub('phone-2','db-2')];
  t.mock.method(Meetings,'findOne',async()=>db.documents.get('Meetings/'+meeting.id));
  t.mock.method(Users,'findAll',async({filters}:any)=>{const [key,value]=Object.entries(filters)[0] as [string,any];return {records:users.filter(u=>value.in.includes((u as any)[key])),hasMore:false};});
  t.mock.method(PushSubscriptions,'findAll',async()=>({records:subscriptions,hasMore:false}));
  const execute=()=>executeMeetingReminder({meetingId:meeting.id,reminderType:'TEN_MINUTES'},manager,db,async(...args:any[])=>{published.push(args);});
  return {meeting,db,published,users,subscriptions,execute,sub};
}

test('all identity aliases receive in-app reminders, all devices receive push, no unrelated user is included',async t=>{
 const s=setup(t); s.subscriptions.push(s.sub('unrelated','other'));
 const requests:string[]=[];t.mock.method(globalThis,'fetch',async(url:any)=>{requests.push(String(url));return new Response(null,{status:201});});
 const result=await s.execute();
 assert.equal(result.inAppRecipients,3);assert.equal(result.sent,3);assert.equal(result.skipped,1);
 assert.equal(s.published.length,1);assert.equal(s.published[0][6],'https://meet.google.com/test');
 assert.ok(s.published[0][5].includes('db-2'));assert.ok(s.published[0][5].includes('auth-1'));
 assert.deepEqual(requests.map(x=>x.split('/').pop()).sort(),['laptop-1','phone-1','phone-2']);
 assert.equal(s.db.documents.get('Meetings/'+s.meeting.id).notification10mSent,true);
});

test('failed devices remain retryable while accepted devices and in-app broadcasts are not repeated',async t=>{
 const s=setup(t);let retry=false;const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(url:any)=>{calls.push(String(url));return new Response(null,{status:!retry&&String(url).endsWith('phone-2')?503:201});});
 const first=await s.execute();assert.equal(first.success,false);assert.equal(first.failed,1);assert.equal(first.sent,2);
 assert.notEqual(s.db.documents.get('Meetings/'+s.meeting.id).notification10mSent,true);
 retry=true;calls.length=0;const second=await s.execute();
 assert.equal(second.success,true);assert.equal(second.sent,1);assert.equal(s.published.length,1);
 assert.equal(calls.length,1);assert.ok(calls[0].endsWith('phone-2'));
});

test('missing push keys cannot prevent publication to participants',async t=>{
 const s=setup(t);process.env.APP_VAPID_PRIVATE_KEY='invalid';
 const result=await s.execute();assert.equal(result.inAppRecipients,3);assert.equal(s.published.length,1);
 assert.equal(result.failed,3);assert.notEqual(s.db.documents.get('Meetings/'+s.meeting.id).notification10mSent,true);
});

test('a subscription lookup failure cannot prevent in-app publication or mark the reminder complete', async t => {
  const s = setup(t);
  t.mock.method(PushSubscriptions, 'findAll', async () => { throw new Error('Temporary subscription lookup failure'); });
  await assert.rejects(s.execute, /Temporary subscription lookup failure/);
  assert.equal(s.published.length, 1);
  assert.notEqual(s.db.documents.get('Meetings/' + s.meeting.id).notification10mSent, true);
});

test('overlapping cron and browser sends share one durable lease',async t=>{
 const s=setup(t);const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(url:any)=>{calls.push(String(url));return new Response(null,{status:201});});
 await Promise.all([s.execute(),s.execute()]);assert.equal(calls.length,3);assert.equal(s.published.length,1);
});

test('an expired device does not prevent delivery to the other devices',async t=>{
 const s=setup(t);t.mock.method(globalThis,'fetch',async(url:any)=>new Response(null,{status:String(url).endsWith('phone-2')?410:201}));
 const result=await s.execute();assert.equal(result.sent,2);assert.equal(result.success,true);assert.equal(result.skipped,2);
});

test('cancelled meetings never dispatch either reminder and unauthenticated calls are rejected',async t=>{
 const s=setup(t,{status:'CANCELLED'});t.mock.method(globalThis,'fetch',async()=>{throw new Error('Must not send');});
 assert.equal((await s.execute()).sent,0);assert.equal(s.published.length,0);
 const result=await executeMeetingReminder({meetingId:s.meeting.id,reminderType:'ONE_MINUTE'},manager,s.db);
 assert.equal(result.sent,0);
 await assert.rejects(()=>executeMeetingReminder({meetingId:s.meeting.id,reminderType:'ONE_MINUTE'},{},s.db),/Unauthorized/);
});

test('scheduler uses only the 10-minute and 1-minute windows, paginates, and excludes FOLK, started, and stale reminders',async t=>{
 const previous=process.env.APP_CRON_SECRET;process.env.APP_CRON_SECRET='meeting-reminder-test-secret';
 t.after(()=>{if(previous===undefined)delete process.env.APP_CRON_SECRET;else process.env.APP_CRON_SECRET=previous;});
 const make=(id:string,minutes:number,extra:any={})=>({id,scheduledAt:new Date(Date.now()+minutes*60_000).toISOString(),status:'SCHEDULED',...extra});
 const pages=[[make('minute',1),make('late-minute',0.5),make('ten',10),make('late-ten',6)],
  [make('folk',10,{segment:'FOLK'}),make('past',-1),make('early',11),make('hour',60),make('done',9,{notification10mSent:true}),make('minute-done',0.5,{notification1mSent:true})]];
 t.mock.method(Meetings,'findAll',async({offset}:any)=>({records:pages[offset?1:0],hasMore:!offset}));
 const calls:string[]=[];t.mock.method(sendMeetingReminder,'execute',async({input}:any)=>{calls.push(input.meetingId+':'+input.reminderType);return {success:true} as any;});
 const result=await sendDueMeetingReminders.execute({input:{cronSecret:process.env.APP_CRON_SECRET},context:{}} as never);
 assert.deepEqual(calls.sort(),['late-minute:ONE_MINUTE','minute:ONE_MINUTE','ten:TEN_MINUTES']);
 assert.equal(result.tenMinuteReminders,1);assert.equal(result.oneMinuteReminders,2);
});

test('the ten-minute reminder and the one-minute reminder have independent checkpoints', async t => {
  const s = setup(t);
  const now = Date.now();
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 201 }));
  const publish = async (...args: any[]) => { s.published.push(args); };
  const ten = await s.execute();
  assert.equal(ten.sent, 3);
  assert.equal(s.db.documents.get('Meetings/' + s.meeting.id).notification10mSent, true);
  assert.notEqual(s.db.documents.get('Meetings/' + s.meeting.id).notification1mSent, true);
  t.mock.method(Date, 'now', () => now + 9.5 * 60_000);
  const minute = await executeMeetingReminder({ meetingId: s.meeting.id, reminderType: 'ONE_MINUTE' }, manager, s.db, publish);
  assert.equal(minute.sent, 3);
  assert.equal(s.db.documents.get('Meetings/' + s.meeting.id).notification1mSent, true);
  assert.equal(s.published.length, 2);
  assert.notEqual(s.published[0][4], s.published[1][4]);
});

test('subscription pagination includes later devices and deduplicates repeated endpoints', async t => {
  const records = Array.from({ length: 503 }, (_, index) => ({ id: `sub-${index}`, user: 'participant', endpoint: `https://push.example.invalid/${index}` }));
  records.push({ ...records[502], id: 'duplicate-endpoint' });
  const offsets: number[] = [];
  t.mock.method(PushSubscriptions, 'findAll', async ({ offset, limit }: any) => {
    offsets.push(offset);
    return { records: records.slice(offset, offset + limit), hasMore: offset + limit < records.length };
  });
  const targets = await meetingSubscriptionTargets([{ ids: ['participant'], email: '' }]);
  assert.deepEqual(offsets, [0, 500]);
  assert.equal(targets.length, 503);
  assert.ok(targets.some(sub => sub.id === 'sub-502'));
});

test('a reschedule during delivery cannot mark the new occurrence as notified', async t => {
  const s = setup(t);
  t.mock.method(globalThis, 'fetch', async () => {
    const current = s.db.documents.get('Meetings/' + s.meeting.id);
    s.db.documents.set('Meetings/' + s.meeting.id, { ...current, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
    return new Response(null, { status: 201 });
  });
  await s.execute();
  assert.notEqual(s.db.documents.get('Meetings/' + s.meeting.id).notification10mSent, true);
});

test('meeting times default to IST and preserve explicit positive and negative offsets', () => {
  assert.equal(meetingStartMs('2026-09-09T15:00'), Date.parse('2026-09-09T09:30:00Z'));
  assert.equal(meetingStartMs('2026-09-09T15:00+05:30'), Date.parse('2026-09-09T09:30:00Z'));
  assert.equal(meetingStartMs('2026-09-09T15:00-04:00'), Date.parse('2026-09-09T19:00:00Z'));
});
