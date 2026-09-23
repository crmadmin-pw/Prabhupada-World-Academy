/* eslint-disable @typescript-eslint/no-explicit-any -- migration plan validation */
import { SOURCE_TABLES, PERMISSION_FIELDS } from './config';
import { canonicalJson, normalizeEmail, sha256 } from './common';
import { protectedUserField } from './planCatchup';
export function validateCatchupPlan(summary:any,writes:any[]):void{
  if(summary.kind!=='guarded-zite-catchup-plan'||summary.reviews?.length)throw new Error('Plan is not review-free');
  if(sha256(writes.map(canonicalJson).join('\n'))!==summary.planHash)throw new Error('Plan hash mismatch');
  const operational=new Set(SOURCE_TABLES.filter(t=>t.disposition==='operational').map(t=>t.destination));
  const seen=new Set<string>();
  for(const w of writes){
    const key=`${w.collection}/${w.documentId}`;if(seen.has(key))throw new Error('Duplicate write target');seen.add(key);
    if(!['create','update'].includes(w.operation)||w.deleteFields?.length||w.collection.includes('/')||w.documentId.includes('/'))throw new Error('Unsafe operation');
    if(/^LLP/i.test(w.collection)||w.collection==='PushSubscriptions')throw new Error('Excluded operational collection');
    if(w.collection==='_MigrationCatchupHistory'){
      if(w.operation!=='create'||w.phase!==0||/^LLP/i.test(w.data.sourceTable))throw new Error('Unsafe source history write');
      if(sha256(w.data.sourceRecordJson)!==w.data.sourceChecksum)throw new Error('Source history checksum mismatch');
    }else{
      if(!operational.has(w.collection)||!w.sourceRecordId||!w.data.migrationCatchupProvenance)throw new Error('Missing approved table or provenance');
      if(w.collection==='Users'&&w.operation==='update')for(const key of Object.keys(w.data)){
        if(protectedUserField(key)&&!(key==='status'&&normalizeEmail(w.before.email)==='adpd@hkmmumbai.org'&&w.data.status==='Active'))throw new Error('Protected account field write');
      }
      if(w.collection==='Users'&&w.operation==='create'){
        if(w.data.role!=='User'||w.data.roles||w.data.firebaseUid||PERMISSION_FIELDS.some(f=>w.data[f]!==false))throw new Error('New profile has unsafe privileges or Auth linkage');
        if(normalizeEmail(w.data.email)!==w.data.email||!w.data.email)throw new Error('New profile lacks normalized email');
      }
    }
    if(w.operation==='create'&&w.precondition?.exists!==false)throw new Error('Create is not create-only');
    if(w.operation==='update'&&(!w.precondition?.updateTime||!w.before))throw new Error('Update lacks guarded before-values');
  }
}
