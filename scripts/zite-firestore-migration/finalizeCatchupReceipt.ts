/* eslint-disable @typescript-eslint/no-explicit-any -- private migration evidence */
import path from 'node:path';
import { canonicalJson, readJson, readJsonLines, sha256, writeJson } from './common';
import { encodeFields, firebaseAccessToken, listCollection } from './firestoreRest';
async function main(){
  const pass=path.resolve(process.argv[2]??'');if(!process.argv[2])throw new Error('Pass directory required');
  const plan=readJson<any>(path.join(pass,'catchup-plan.json'));
  const readback=readJson<any>(path.join(pass,'production-readback.json'));
  const functional=readJson<any>(path.join(pass,'production-functional-verification.json'));
  if(readback.planHash!==plan.planHash||readback.mismatches.length||functional.planHash!==plan.planHash||functional.errors.length)throw new Error('Production verification must pass');
  const writes=readJsonLines(path.join(pass,'catchup-writes.jsonl')).filter(w=>w.phase>0);
  const retention=[];
  for(const collection of new Set(writes.map(w=>w.collection))){
    const before=readJsonLines(path.join(pass,'firestore/tables',collection+'.jsonl'));
    const after=readJsonLines(path.join(pass,'production-functional-snapshot',collection+'.jsonl'));
    const ids=new Set(after.map(r=>r.id));const missing=before.filter(r=>!ids.has(r.id));
    const expected=before.length+writes.filter(w=>w.collection===collection&&w.operation==='create').length;
    if(missing.length||after.length!==expected)throw new Error('Collection retention/count check failed: '+collection);
    retention.push({collection,before:before.length,after:after.length,expected,missingBeforeIds:0});
  }
  const beforeAuth=readJson<any>(path.join(pass,'firebase-auth.json')).users;
  const afterAuth=readJson<any>(path.join(pass,'post-apply/firebase-auth.json')).users;
  const authProjection=(users:any[])=>users.map(u=>({localId:u.localId,email:u.email,disabled:u.disabled,emailVerified:u.emailVerified})).sort((a,b)=>a.localId.localeCompare(b.localId));
  if(canonicalJson(authProjection(beforeAuth))!==canonicalJson(authProjection(afterAuth)))throw new Error('Firebase Auth identity state changed');
  const pushBefore=readJsonLines(path.join(pass,'firestore/tables/PushSubscriptions.jsonl')).map(r=>({id:r.id,data:r.data}));
  const pushAfter=(await listCollection('bvpw108','(default)','PushSubscriptions',firebaseAccessToken())).map(r=>({id:r.id,data:r.data}));
  if(canonicalJson(pushBefore)!==canonicalJson(pushAfter))throw new Error('Current notification subscriptions changed');
  const users=readJsonLines(path.join(pass,'production-users-after.jsonl'));
  const mathuranath=users.find(u=>u.data.email==='mtnd@hkmmumbai.org');
  const advaita=users.find(u=>u.data.email==='adpd@hkmmumbai.org');
  if(mathuranath?.data.role!=='Super Guide'||advaita?.data.status!=='Active')throw new Error('Approved account state differs');
  const receipt={
    kind:'zite-catchup-production-receipt',runId:plan.runId,planHash:plan.planHash,
    completedAt:readJson<any>(path.join(pass,'production-apply.json')).completedAt,verifiedAt:functional.verifiedAt,
    status:'catchup-pass-applied-with-documented-source-limitations',finalCutover:false,sourceContinuesAcceptingWrites:true,
    sourceBaseline:plan.baseline,sourceRefreshThrough:plan.sourceRefreshThrough,nextReplayFrom:plan.replayFrom,
    simultaneousPointInTimeSnapshot:false,sourceRecordsVersionArchived:plan.historyWrites,
    operationalCreates:writes.filter(w=>w.operation==='create').length,operationalUpdates:writes.filter(w=>w.operation==='update').length,
    verifiedPlannedWrites:readback.matchingWrites,counts:plan.counts,retention,
    firebaseAuthIdentitiesPreserved:beforeAuth.length,currentPushSubscriptionsPreserved:pushAfter.length,
    registeredProfilesChecked:functional.registeredProfilesChecked,affectedHistoryEntriesChecked:functional.historyEntriesVerified,
    authenticatedBrowserLoginVerified:false,guideChecks:functional.guideChecks,
    approvedAccounts:{advaitaStatus:advaita.data.status,mathuranathRole:mathuranath.data.role,renumberings:plan.renumberings.map((r:any)=>({...r,status:users.find(u=>u.id===r.sourceId)?.data.status}))},
    sourceLimitations:plan.limitations,sourceWarnings:functional.sourceWarnings,preExistingNumberCollisions:plan.existingNumberCollisions,
    noSourceMutations:true,noAccountMerges:true,noDestinationDeletes:true,excludedPrefix:'LLP',legacyPushSubscriptions:'archive-only',
    resumableConcurrencyGuardUsed:true,
  };
  const checksum=sha256(canonicalJson(receipt));writeJson(path.join(pass,'completion-receipt.json'),{...receipt,checksum});
  // Server-only checkpoint, create-only. Business data and Auth are not touched.
  const document={name:`projects/bvpw108/databases/(default)/documents/_MigrationCatchupRuns/${plan.runId}`,fields:encodeFields({...receipt,checksum})};
  const r=await fetch('https://firestore.googleapis.com/v1/projects/bvpw108/databases/(default)/documents:commit',{method:'POST',headers:{Authorization:'Bearer '+firebaseAccessToken(),'Content-Type':'application/json'},body:JSON.stringify({writes:[{update:document,currentDocument:{exists:false}}]}),signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error('Receipt checkpoint write failed: '+await r.text());
  const result:any=await r.json();writeJson(path.join(pass,'receipt-commit.json'),{commitTime:result.commitTime,document:document.name,checksum});
  console.log(JSON.stringify({runId:plan.runId,verifiedWrites:readback.matchingWrites,retentionPassed:true,authIdentitiesPreserved:beforeAuth.length,pushSubscriptionsPreserved:pushAfter.length,checkpointSaved:true}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
