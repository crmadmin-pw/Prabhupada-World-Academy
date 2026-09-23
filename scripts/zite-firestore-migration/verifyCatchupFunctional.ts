/* eslint-disable @typescript-eslint/no-explicit-any -- read-only endpoint replay over captured database documents */
import path from 'node:path';
import assert from 'node:assert/strict';
import { canonicalJson, readJson, readJsonLines, writeJson, writeJsonLines } from './common';
import { firebaseAccessToken, listCollection } from './firestoreRest';
import { validateCatchupPlan } from './catchupGuards';
import { values } from './planCatchup';
import * as sdk from '../../src/lib/app-backend-sdk';
import getUserProfile from '../../src/api/getUserProfile';
import resolveUserLogin from '../../src/api/resolveUserLogin';
import getUserHistory from '../../src/api/getUserHistory';
import getGuideUsers from '../../src/api/getGuideUsers';
import { buildApiUserContext } from '../../src/lib/apiAuthorization';

async function main(){
  const [passArg,database]=process.argv.slice(2);if(!passArg||!['migration-catchup-0923','(default)'].includes(database))throw new Error('Explicit pass and approved database required');
  const pass=path.resolve(passArg);const plan=readJson<any>(path.join(pass,'catchup-plan.json'));const writes=readJsonLines(path.join(pass,'catchup-writes.jsonl'));validateCatchupPlan(plan,writes);
  const production=database==='(default)';
  const reuseRehearsalSnapshot=process.argv.includes('--reuse-rehearsal-snapshot');
  if(production&&reuseRehearsalSnapshot)throw new Error('Production verification must refresh database reads');
  const manifests=readJson<any>(path.join(pass,'firestore/manifest.json'));
  const tables=new Map<string,any[]>();
  for(const t of manifests.tables)tables.set(t.collection,readJsonLines(path.join(pass,'firestore',t.file)).map(r=>({id:r.id,...r.data})));
  const refreshed=[...new Set(['Users','Guides','FolkResidencies','BvGroupMembers','BvGroups',...writes.filter(w=>w.phase>0).map(w=>w.collection)])];
  for(let i=0;i<refreshed.length;i+=3){await Promise.all(refreshed.slice(i,i+3).map(async collection=>{const file=path.join(pass,production?'production-functional-snapshot':'rehearsal-functional-snapshot',collection+'.jsonl');const rows=reuseRehearsalSnapshot?readJsonLines(file):await listCollection('bvpw108',database,collection,firebaseAccessToken());if(!rows.length&&reuseRehearsalSnapshot)throw new Error('Missing rehearsal snapshot '+collection);tables.set(collection,rows.map(r=>({...r.data,id:r.id})));if(!reuseRehearsalSnapshot)writeJsonLines(file,rows);console.log(`${collection}: ${rows.length}`);}));}
  // Redirect every model read/write before calling handlers. No handler can
  // mutate a database or send an email during this verification.
  const attemptedHandlerWrites:any[]=[];
  function match(row:any,filters:any){return Object.entries(filters??{}).every(([key,expected]:[string,any])=>{
    const actual=row[key];if(expected===undefined)return true;
    if(expected&&typeof expected==='object'&&!Array.isArray(expected))return Object.entries(expected).every(([op,v]:[string,any])=>{if(op==='in')return v.includes(actual);if(op==='notIn')return !v.includes(actual);if(op==='gte'||op==='>=')return actual>=v;if(op==='lte'||op==='<=')return actual<=v;if(op==='gt'||op==='>')return actual>v;if(op==='lt'||op==='<')return actual<v;if(op==='arrayContains')return Array.isArray(actual)&&actual.includes(v);throw new Error('Unsupported test filter '+op);});
    return canonicalJson(actual)===canonicalJson(expected);
  });}
  for(const model of new Set(Object.values(sdk).filter((v:any)=>v instanceof sdk.Table) as any[])){
    model.findAll=async(query:any={})=>{const all=(tables.get(model.tableName)??[]).filter(row=>match(row,query.filters));const offset=query.offset??0,limit=query.limit??100;return{records:structuredClone(all.slice(offset,offset+limit)),hasMore:offset+limit<all.length};};
    model.findOne=async(query:any)=>{const row=(tables.get(model.tableName)??[]).find(r=>query.id?r.id===query.id:match(r,query.filters));return row?structuredClone(row):undefined;};
    model.update=async(change:any)=>{attemptedHandlerWrites.push({table:model.tableName,id:change.id,fields:Object.keys(change.record)});return{id:change.id,...change.record};};
    model.create=async()=>{throw new Error('Unexpected create during read-only endpoint verification');};
    model.delete=async()=>{throw new Error('Unexpected delete during read-only endpoint verification');};
  }
  (sdk.Email as any).send=async()=>{throw new Error('Unexpected email during verification');};
  const users=tables.get('Users')!;const guides=tables.get('Guides')!;const entries=tables.get('SadhanaEntries')!;
  const context=(u:any)=>({user:buildApiUserContext({uid:u.firebaseUid??`read-only-verification-${u.id}`,email:u.email,emailVerified:true},u)});
  const errors:any[]=[];const sourceWarnings:any[]=[];const logins:any[]=[];const authChecks:any[]=[];const guideChecks:any[]=[];let historyEntriesVerified=0;
  for(const u of users.filter(u=>u.email&&u.userId&&u.status)){
    try{const login:any=await resolveUserLogin.execute({input:{},context:context(u)} as any);assert.equal(login.action,'route');assert.equal(login.user.email,u.email);assert.equal(login.user.role,String(u.role??'User').toUpperCase().replace(/\s+/g,'_'));
      if(u.status==='Active')assert.ok(!['/inactive','/rejected','/pending'].includes(login.route));
      if(u.status==='Inactive')assert.equal(login.route,'/inactive');if(u.status==='Rejected')assert.equal(login.route,'/rejected');if(u.status==='Pending Approval')assert.equal(login.route,'/pending');
      const profile:any=await getUserProfile.execute({input:{bypassCache:true},context:context(u)} as any);assert.equal(profile.user.email,u.email);assert.equal(profile.user.userId,u.userId);
      if(values(u.guide).length)assert.equal(profile.user.selectedGuideId,values(u.guide)[0]);
      logins.push({id:u.id,email:u.email,userId:u.userId,status:u.status,route:login.route,profileEmailVerified:true});
    }catch(e){errors.push({check:'login/profile-handler',id:u.id,error:String(e)});}
  }
  for(const auth of readJson<any>(path.join(pass,'firebase-auth.json')).users){
    const exact=users.filter(u=>String(u.email??'').toLowerCase()===String(auth.email??'').toLowerCase());
    const direct=users.find(u=>u.id===(auth.localId??auth.uid)&&u.userId&&u.status);
    const linked=users.find(u=>u.firebaseUid===(auth.localId??auth.uid));
    const resolved=direct??linked??exact.find(u=>u.userId&&u.status)??exact[0];
    if(resolved&&String(resolved.email).toLowerCase()!==String(auth.email??'').toLowerCase())errors.push({check:'auth-email-link',email:auth.email,profile:resolved.id});
    authChecks.push({email:auth.email,profileId:resolved?.id??null,registered:!!(resolved?.userId&&resolved.status),disabled:auth.disabled??false});
  }
  const changedEntries=writes.filter(w=>w.collection==='SadhanaEntries');
  for(const ownerId of new Set(changedEntries.map(w=>w.data.user??w.before?.user))){
    const user=users.find(u=>u.id===ownerId);if(!user){errors.push({check:'history-owner',ownerId});continue;}
    try{const got:any[]=[];let offset=0;for(;;){const page:any=await getUserHistory.execute({input:{limit:200,offset,includeFieldValues:true},context:context(user)} as any);got.push(...page.entries);if(!page.hasMore)break;offset+=200;if(offset>20000)throw new Error('History pagination did not terminate');}
      for(const w of changedEntries.filter(w=>(w.data.user??w.before?.user)===ownerId)){const output=got.find(e=>e.rowId===w.documentId);assert.ok(output,`Missing history row ${w.documentId}`);const stored=entries.find(e=>e.id===w.documentId)!;assert.equal(output.entryDate,stored.entryDate);assert.equal(output.flagOs,stored.flagOs||false);assert.equal(output.flagSick,stored.flagSick||false);assert.ok(output.scorePercent==null||Number.isFinite(Number(output.scorePercent)));
        let expectedFields={};if(stored.fieldValuesJson){try{expectedFields=JSON.parse(stored.fieldValuesJson);}catch{
          const archive=writes.find(h=>h.collection==='_MigrationCatchupHistory'&&h.data.sourceTable==='Sadhana Entries'&&h.data.sourceRecordId===w.sourceRecordId);
          assert.ok(archive);assert.equal(JSON.parse(archive.data.sourceRecordJson)['Field Values JSON'],stored.fieldValuesJson,'Malformed detail text must be proven verbatim source data, not import corruption');
          sourceWarnings.push({kind:'malformed-source-detail-json-preserved',sourceId:w.sourceRecordId,documentId:w.documentId,applicationBehavior:'history handler retains entry/score columns and returns empty detail object'});
        }}assert.deepEqual(output.fieldValues,expectedFields);historyEntriesVerified++;}
    }catch(e){errors.push({check:'history-handler',ownerId,error:String(e)});}
  }
  for(const r of plan.renumberings){const u=users.find(u=>u.id===r.sourceId);try{assert.ok(u);assert.equal(u.userId,r.newUserId);assert.equal(u.email,r.email);assert.equal(users.filter(x=>x.userId===r.newUserId).length,1);}catch(e){errors.push({check:'renumbering',sourceId:r.sourceId,error:String(e)});}}
  const changedOwners=new Set(writes.filter(w=>w.collection==='Users'||w.collection==='SadhanaEntries').map(w=>w.collection==='Users'?w.documentId:w.data.user??w.before?.user));
  for(const guideId of new Set(users.filter(u=>changedOwners.has(u.id)).flatMap(u=>values(u.guide)))){
    const guide=guides.find(g=>g.id===guideId);const account=users.find(u=>u.email===guide?.email&&u.status==='Active'&&/Guide/i.test(u.role));if(!account)continue;
    try{const result:any=await getGuideUsers.execute({input:{guideId,status:'all',minimal:true},context:context(account)} as any);const visible=result.users??result.records??(Array.isArray(result)?result:[]);const direct=users.filter(u=>values(u.guide).includes(guideId)&&changedOwners.has(u.id)&&u.userId&&u.status&&!['GUIDE','SUPER_GUIDE','ADMIN','SUPER_ADMIN','PW_ADMIN'].includes(String(u.role??'').toUpperCase().replace(/\s+/g,'_')));
      for(const u of direct)assert.ok(visible.some((x:any)=>x.userId===u.id||x.email===u.email),`Missing member ${u.id}`);
      guideChecks.push({guideId,email:guide.email,visibleUsers:visible.length,changedDirectMembersVerified:direct.length});
    }catch(e){errors.push({check:'guide-handler',guideId,error:String(e)});}
  }
  const result={kind:'read-only-catchup-functional-verification',database,planHash:plan.planHash,verifiedAt:new Date().toISOString(),method:'actual-database-readback-replayed-through-local-endpoint-handlers-with-all-model-writes-intercepted',authenticatedBrowserLoginVerified:false,registeredProfilesChecked:logins.length,historyEntriesVerified,authChecks,guideChecks,logins,sourceWarnings,interceptedHandlerWriteCount:attemptedHandlerWrites.length,errors};
  writeJson(path.join(pass,production?'production-functional-verification.json':'functional-verification.json'),result);console.log(JSON.stringify({...result,authChecks:authChecks.length,logins:logins.filter(r=>plan.renumberings.some((n:any)=>n.email===r.email)||r.email==='adpd@hkmmumbai.org')},null,2));if(errors.length)throw new Error('Functional verification has failures');
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
