/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore REST and migration plans */
import path from 'node:path';
import fs from 'node:fs';
import { canonicalJson, readJson, readJsonLines, writeJson, writeJsonLines } from './common';
import { decodeFields, documentName, encodeFields, fieldPath, firebaseAccessToken } from './firestoreRest';
import { validateCatchupPlan } from './catchupGuards';
import { protectedIdentity } from './planCatchup';

async function main():Promise<void>{
const [passArg,database,mode,expectedHash]=process.argv.slice(2);
if(!passArg||!database||!['prepare-rehearsal','apply-rehearsal','apply-production','verify'].includes(mode))throw new Error('Usage: executeCatchup.ts <pass-dir> <database> <prepare-rehearsal|apply-rehearsal|apply-production|verify> <plan-hash>');
const pass=path.resolve(passArg),capture=path.dirname(pass);
const production=database==='(default)';
if(!production&&database!=='migration-catchup-0923')throw new Error('Unexpected rehearsal database');
if(production&&!['apply-production','verify'].includes(mode)||!production&&mode==='apply-production')throw new Error('Mode/database mismatch');
const plan=readJson<any>(path.join(pass,'catchup-plan.json'));
const writes=readJsonLines(path.join(pass,'catchup-writes.jsonl'));
validateCatchupPlan(plan,writes);if(expectedHash!==plan.planHash)throw new Error('Explicit plan hash is required');
const backup=readJson<any>(path.join(capture,'firestore/backup-verification.json'));
if(backup.restoredDatabaseId!=='migration-catchup-0923'||backup.totalRestoredDocuments!==backup.totalExpectedDocuments)throw new Error('Backup restore is not verified');
const prefix=`https://firestore.googleapis.com/v1/projects/bvpw108/databases/${encodeURIComponent(database)}/documents`;
const target=(w:any)=>documentName('bvpw108',database,w.collection,w.documentId);
async function api(url:string,body?:any):Promise<any>{
  const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+firebaseAccessToken(),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});
  if(!r.ok)throw new Error(`Firestore ${r.status}: ${await r.text()}`);return r.json();
}
async function getDocuments(items:any[]):Promise<Map<string,any>>{
  const found=new Map<string,any>();
  for(let i=0;i<items.length;i+=200){const response=await api(prefix+':batchGet',{documents:items.slice(i,i+200).map(target)});
    for(const x of response){if(x.found){const name=x.found.name;found.set(name,{id:name.split('/').at(-1),data:decodeFields(x.found.fields??{}),raw:x.found,updateTime:x.found.updateTime});}}
  }return found;
}
const matches=(actual:any,w:any)=>actual&&Object.entries(w.data).every(([k,v])=>canonicalJson(actual.data[k])===canonicalJson(v));
function restWrite(w:any,actual?:any):any{
  const update={name:target(w),fields:encodeFields(w.data)};
  return w.operation==='create'?{update,currentDocument:{exists:false}}:{update,updateMask:{fieldPaths:Object.keys(w.data).map(fieldPath)},currentDocument:{updateTime:actual?.updateTime??w.precondition.updateTime}};
}
async function commitBatches(items:any[],journal:string){
  const journalPath=path.join(pass,journal);
  const previous=fs.existsSync(journalPath)?readJson<any>(journalPath):null;
  if(previous&&(previous.planHash!==plan.planHash||previous.database!==database))throw new Error('Commit journal belongs to another plan');
  const completed:any[]=previous?.completed??[];let batch:any[]=[],bytes=0;
  async function flush(){if(!batch.length)return;const result=await api(prefix+':commit',{writes:batch});completed.push({commitTime:result.commitTime,count:batch.length});writeJson(path.join(pass,journal),{database,planHash:plan.planHash,completed});console.log(JSON.stringify({mode,database,committed:batch.length,total:completed.reduce((n,r)=>n+r.count,0)}));batch=[];bytes=0;}
  for(const item of items){const size=Buffer.byteLength(JSON.stringify(item));if(size>8000000)throw new Error('Oversized write');if(batch.length>=200||bytes+size>7500000)await flush();batch.push(item);bytes+=size;}await flush();
}
const snapshotUsers=readJsonLines(path.join(pass,'firestore/tables/Users.jsonl'));
async function queryUsers(transaction?:string):Promise<any[]>{const response=await api(prefix+':runQuery',{structuredQuery:{from:[{collectionId:'Users'}]},...(transaction?{transaction}:{})});return response.filter((r:any)=>r.document).map((r:any)=>({id:r.document.name.split('/').at(-1),data:decodeFields(r.document.fields),updateTime:r.document.updateTime,raw:r.document}));}
function fixedIdentity(data:any){const p=protectedIdentity(data);for(const key of ['lastLoginAt','authLinkedAt','firebaseUid'])delete p[key];return p;}
function assertExistingIdentities(users:any[]){for(const before of snapshotUsers){const row=users.find(u=>u.id===before.id);if(!row)throw new Error('Current profile disappeared: '+before.id);const expected=fixedIdentity(before.data);if(before.data.email==='adpd@hkmmumbai.org')expected.status='Active';if(canonicalJson(fixedIdentity(row.data))!==canonicalJson(expected))throw new Error('Current role/login identity changed since approval: '+before.id);}}

if(mode==='prepare-rehearsal'){
  const seedMap=new Map<string,any>();
  for(const row of snapshotUsers)seedMap.set('Users/'+row.id,{collection:'Users',documentId:row.id,data:row.data});
  for(const w of writes)if(w.operation==='update')seedMap.set(w.collection+'/'+w.documentId,{collection:w.collection,documentId:w.documentId,data:w.before});
  const seeds=[...seedMap.values()];const actual=await getDocuments(seeds);
  const updates=seeds.filter(w=>canonicalJson(actual.get(target(w))?.data)!==canonicalJson(w.data)).map(w=>({update:{name:target(w),fields:encodeFields(w.data)},currentDocument:actual.has(target(w))?{updateTime:actual.get(target(w)).updateTime}:{exists:false}}));
  await commitBatches(updates,'rehearsal-seed-commits.json');
  writeJson(path.join(pass,'rehearsal-prepared.json'),{database,planHash:plan.planHash,preparedAt:new Date().toISOString(),seededDocuments:updates.length,source:'fresh-production-snapshot-over-verified-isolated-backup'});
  console.log(JSON.stringify({prepared:true,seeded:updates.length}));
}else if(mode==='verify'){
  const actual=await getDocuments(writes);const mismatches=writes.filter(w=>!matches(actual.get(target(w)),w)).map(w=>({collection:w.collection,id:w.documentId}));
  const users=await queryUsers();assertExistingIdentities(users);
  for(const w of writes.filter(w=>w.phase===1)){
    if(users.filter(u=>u.data.email===w.data.email).length!==1)throw new Error('New profile email is not unique');
    if(w.data.userId&&users.filter(u=>u.data.userId===w.data.userId).length!==1)throw new Error('New profile public number is not unique');
  }
  const result={database,planHash:plan.planHash,verifiedAt:new Date().toISOString(),plannedWrites:writes.length,matchingWrites:writes.length-mismatches.length,mismatches,existingIdentityProtectionPassed:true,userCount:users.length,newProfileCount:writes.filter(w=>w.phase===1).length};
  writeJson(path.join(pass,production?'production-readback.json':'rehearsal-readback.json'),result);
  writeJsonLines(path.join(pass,production?'production-users-after.jsonl':'rehearsal-users-after.jsonl'),users.map(u=>({id:u.id,data:u.data,updateTime:u.updateTime})));
  console.log(JSON.stringify(result));if(mismatches.length)throw new Error('Read-back does not match plan');
}else{
  if(production){const rehearsal=readJson<any>(path.join(pass,'rehearsal-readback.json'));const functional=readJson<any>(path.join(pass,'functional-verification.json'));const idempotency=readJson<any>(path.join(pass,'idempotency-verification.json'));if(rehearsal.planHash!==plan.planHash||rehearsal.mismatches.length||functional.planHash!==plan.planHash||functional.errors.length||idempotency.planHash!==plan.planHash||idempotency.passed!==true)throw new Error('Rehearsal, functional and idempotency verification must pass before production');}
  else{const prepared=readJson<any>(path.join(pass,'rehearsal-prepared.json'));if(prepared.planHash!==plan.planHash)throw new Error('Rehearsal baseline is not prepared');}
  const users=await queryUsers();assertExistingIdentities(users);
  const actual=await getDocuments(writes);const pending:any[]=[];
  for(const w of writes){const row=actual.get(target(w));if(matches(row,w))continue;if(w.operation==='create'){if(row)throw new Error('Create target is occupied: '+target(w));}
    else{if(!row)throw new Error('Update target disappeared: '+target(w));for(const k of Object.keys(w.data)){if(k==='migrationCatchupProvenance')continue;if(canonicalJson(row.data[k])!==canonicalJson(w.before[k]))throw new Error('Data changed since planning: '+target(w)+'.'+k);}}
    pending.push(w);
  }
  // Save fresh typed preimages before any operation, including native timestamps.
  const evidenceFile=path.join(pass,`${production?'production':'rehearsal'}-preimages-${Date.now()}.jsonl`);
  writeJsonLines(evidenceFile,pending.filter(w=>actual.has(target(w))).map(w=>({collection:w.collection,id:w.documentId,document:actual.get(target(w)).raw})));
  // The source and before-value history is durable before operational writes.
  await commitBatches(pending.filter(w=>w.phase===0).map(w=>restWrite(w)),`${production?'production':'rehearsal'}-archive-commits.json`);
  const newUsers=pending.filter(w=>w.phase===1);
  if(newUsers.length){
    const begun=await api(prefix+':beginTransaction',{options:{readWrite:{}}});const transaction=begun.transaction;
    try{
      const live=await queryUsers(transaction);assertExistingIdentities(live);
      for(const w of newUsers){if(live.some(u=>u.id===w.documentId||u.data.email===w.data.email||w.data.userId&&u.data.userId===w.data.userId))throw new Error('Concurrent profile/email/number collision; re-plan required');}
      const result=await api(prefix+':commit',{transaction,writes:newUsers.map(w=>restWrite(w))});
      writeJson(path.join(pass,`${production?'production':'rehearsal'}-identity-commit.json`),{database,planHash:plan.planHash,commitTime:result.commitTime,created:newUsers.map(w=>({id:w.documentId,email:w.data.email,userId:w.data.userId??null}))});
    }catch(error){await api(prefix+':rollback',{transaction}).catch(()=>undefined);throw error;}
  }
  await commitBatches(pending.filter(w=>w.phase===2).map(w=>restWrite(w,actual.get(target(w)))),`${production?'production':'rehearsal'}-data-commits.json`);
  writeJson(path.join(pass,`${production?'production':'rehearsal'}-apply.json`),{database,planHash:plan.planHash,completedAt:new Date().toISOString(),newWrites:pending.length,alreadyMatching:writes.length-pending.length,verifyRequired:true});
  console.log(JSON.stringify({applied:pending.length,alreadyMatching:writes.length-pending.length,verifyRequired:true}));
}
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
