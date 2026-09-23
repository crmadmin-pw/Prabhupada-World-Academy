/* eslint-disable @typescript-eslint/no-explicit-any -- private source snapshots have heterogeneous schemas */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCE_SYSTEM, SOURCE_TABLES, PERMISSION_FIELDS } from './config';
import { canonicalJson, normalizeEmail, normalizedFieldName, readJson, readJsonLines, safeFileName, sha256, sourceFieldToCamelCase, writeJson, writeJsonLines } from './common';

export const BASELINE = '2026-09-11T00:54:54Z';
export const values = (v: any): string[] => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String);
export const dateKey = (v: any): string => String(v ?? '').slice(0, 10);
const configFor = new Map(SOURCE_TABLES.map(t => [t.source, t]));
const SYSTEM = new Set(['id','created_at','updated_at','created_by','updated_by','source_metadata','autonumber_id']);
const PROTECTED = new Set(['id','email','userId','legacyUserId','role','roles','status','segment','uid','authUid','firebaseUid','firebaseAuthUid','authLinkedAt','lastLoginAt','oneToOneEligibility','oneToOneDelegate','bvMentorGuideId','sadhanaMentor', ...PERMISSION_FIELDS]);
export const protectedUserField = (key: string): boolean => PROTECTED.has(key) || /^(is[A-Z]|bvReporting|bvRegistration|pendingRole|roleNotice)/.test(key);
export const protectedIdentity = (row: any) => Object.fromEntries(Object.entries(row).filter(([key]) => protectedUserField(key)));
const FORWARD: Record<string, string[]> = {
  Users:['Guide','Residency','Temporary Residency','One To One Delegate'],
  'Folk Residencies':['Guides'], 'Sadhana Entries':['User'], 'Sadhana Fields':['Guide','Residency'],
  'BV Groups':['BVSL Leader','Guide'], 'BV Group Members':['Group','User'], 'BV Group Requests':['Group','User'],
  'BV Sessions':['Group'], 'BV Attendance':['Session','User','Group'], 'BVSL Preaching Entries':['User','Sadhana Entry'],
  Services:['Residency'], 'Service Allocations':['Service','User','Backup User','Service Verified By'],
  'Service Availability':['User'], 'Service Swaps':['Allocation','From User','To User'], 'User Skills':['User','Skill'],
  'Ashray Checklist':['User'], 'Residency Transfer Requests':['User','From Residency','To Residency'],
  'Guide Transfer Requests':['User','From Guide','To Guide'], BvQuizzes:['Group','Created By'], BvQuizSubmissions:['User','Quiz'],
  ServiceRatings:['Service'], 'Unavailability Requests':['User','Service Allocation','Reviewed By'],
  'Sadhana Monthly Summaries':['User'], 'One To One Meetings':['Guide','Member'], 'Preaching Report Goals':['Center'],
  Trips:['User'], 'Rent Payments':['User'], 'BVSL Weekly Plans':['User'], 'TagMango Sync Log':['Matched User'],
  'Attendance Events':['Created By'], 'Attendance Sessions':['Event'], 'Attendance Participants':['Event'],
  'Attendance Records':['Session','User','Participant'], 'Attendance Volunteers':['User','Session','Granted By'],
  'Challenge Enrollments':['Participant','User','Session'], 'Cleanliness Rooms':['Residency','Occupants'],
  'Cleanliness Inspections':['Room','Inspector','Residency'], 'Jigyasa Session Attendance':['Registration'],
  'Cleanliness Review Requests':['User','Room','Inspection','Reviewed By'],
};
const REQUIRED: Record<string, string[]> = {
  'Sadhana Entries':['User'], 'BVSL Preaching Entries':['User'], 'Service Allocations':['User','Service'],
  'Ashray Checklist':['User'], 'Residency Transfer Requests':['User'],
};

export function equivalent(a: any, b: any, type?: string): boolean {
  if ((a === undefined || a === null) && (b === undefined || b === null)) return true;
  if (type === 'date') return dateKey(a) === dateKey(b);
  if (type === 'number' && a !== null && a !== undefined && a !== '' && b !== null && b !== undefined && b !== '') return Number(a) === Number(b);
  if (type === 'linked_record') return canonicalJson(values(a).sort()) === canonicalJson(values(b).sort());
  return canonicalJson(a) === canonicalJson(b);
}

export function planCatchup(captureDir: string, passDir: string): any {
  const decisions = readJson<any>(path.join(passDir,'approved-decisions.json'));
  if (decisions.statusOverrides?.['adpd@hkmmumbai.org'] !== 'Active' || decisions.noAuthMutations !== true || decisions.noExistingUserRenumbering !== true) throw new Error('Missing explicit identity decisions');
  const sourceManifest = readJson<any>(path.join(captureDir,'zite/manifest.json'));
  const destManifest = readJson<any>(path.join(passDir,'firestore/manifest.json'));
  const schema = new Map(readJson<any>(path.join(passDir,'source-refresh-schema.json')).tables.map((t:any)=>[t.name,t]));
  const current = new Map<string, any[]>(destManifest.tables.map((t:any)=>[t.collection,readJsonLines(path.join(passDir,'firestore',t.file))]));
  const source = new Map<string, any[]>();
  for (const t of sourceManifest.tables) {
    if (/^LLP/i.test(t.source)) throw new Error('LLP export is forbidden');
    const rows = new Map(readJsonLines(path.join(captureDir,'zite',t.file)).map(row=>[row.id,row]));
    for (const row of readJsonLines(path.join(passDir,'source-refresh',`${safeFileName(t.source)}.jsonl`))) rows.set(row.id,row);
    source.set(t.source,[...rows.values()]);
  }
  const users = current.get('Users') ?? [];
  const currentById = new Map<string,any>();
  for (const [collection,rows] of current) for (const row of rows) currentById.set(`${collection}|${row.id}`,row);
  const mapping = new Map<string,string>();
  const rules = new Map<string,string>();
  const reviews:any[]=[]; const limitations:any[]=[]; const renumberings:any[]=[];
  const sourceUsers=source.get('Users') ?? [];
  let maxUserNumber=Math.max(0,...users.map(r=>Number(/^USER-(\d+)$/.exec(String(r.data.userId))?.[1]??0)),...sourceUsers.map(r=>Number(/^USER-(\d+)$/.exec(String(r['User ID']))?.[1]??0)));
  const sourceEmails = new Map<string,number>();
  for (const u of sourceUsers) { const email=normalizeEmail(u.Email); if(email) sourceEmails.set(email,(sourceEmails.get(email)??0)+1); }
  for (const table of ['Users','Guides']) for (const row of source.get(table) ?? []) {
    const key=`${table}|${row.id}`,email=normalizeEmail(row.Email);
    if(!email) { limitations.push({table,sourceId:row.id,reason:'no-source-email-identity'}); continue; }
    if(table==='Users'&&sourceEmails.get(email)!==1){reviews.push({table,sourceId:row.id,reason:'duplicate-source-email',email});continue;}
    const matches=(current.get(table)??[]).filter(r=>normalizeEmail(r.data.email)===email);
    if(matches.length>1){reviews.push({table,sourceId:row.id,reason:'duplicate-destination-email',email});continue;}
    if(matches.length===1){mapping.set(key,matches[0].id);rules.set(key,'unique-normalized-email');continue;}
    if(currentById.has(key)){reviews.push({table,sourceId:row.id,reason:'source-id-occupied-by-different-email',email});continue;}
    if(table==='Guides'){reviews.push({table,sourceId:row.id,reason:'new-guide-needs-role-policy',email});continue;}
    const oldUserId=String(row['User ID']??'');
    const collisions=users.filter(r=>oldUserId&&r.data.userId===oldUserId);
    if(collisions.length){
      if(!decisions.renumberIncomingEmails.includes(email)){reviews.push({table,sourceId:row.id,reason:'unapproved-user-number-collision',email});continue;}
      const newUserId=`USER-${String(++maxUserNumber).padStart(3,'0')}`;
      renumberings.push({sourceId:row.id,email,name:row['Full Name'],oldUserId,newUserId});
    }
    mapping.set(key,row.id);rules.set(key,'create-separate-source-identity');
  }
  // Some still-visible child records refer to a source profile removed from
  // Zite after an earlier repair. Keep the proven current profile; never create
  // a deleted source identity or infer ownership from a shared phone/name.
  const activeSourceUserIds=new Set(sourceUsers.map(row=>row.id));
  for(const currentUser of users)for(const provenance of [currentUser.data.migrationProvenance,currentUser.data.migrationRepairProvenance,currentUser.data.migrationCatchupProvenance]){
    if(provenance?.sourceSystem!==SOURCE_SYSTEM||provenance?.sourceTable!=='Users'||!provenance.sourceRecordId||activeSourceUserIds.has(provenance.sourceRecordId))continue;
    const key=`Users|${provenance.sourceRecordId}`;
    if(mapping.has(key)&&mapping.get(key)!==currentUser.id){reviews.push({reason:'ambiguous-historical-owner',sourceId:provenance.sourceRecordId});continue;}
    mapping.set(key,currentUser.id);rules.set(key,'preserved-current-profile-with-exact-source-provenance');
  }
  const ledger = new Map((current.get('_MigrationLedger')??[]).map(r=>[`${r.data.sourceTable}|${r.data.sourceRecordId}`,r.data]));
  const userAliases=new Map<string,string>();
  for(const u of users)for(const field of ['id','userId','uid','authUid','firebaseUid','firebaseAuthUid'])for(const value of values(field==='id'?u.id:u.data[field]))if(!userAliases.has(value))userAliases.set(value,u.id);
  const ownerOf=(r:any)=>values(r.data.user).map(v=>userAliases.get(v)??v);
  for(const [table,rows] of source){
    const config=configFor.get(table)!;if(config.disposition!=='operational'||['Users','Guides'].includes(table))continue;
    const destination=current.get(config.destination!)??[];
    for(const row of rows){
      const key=`${table}|${row.id}`;
      const own=destination.find(r=>r.id===row.id);
      if(own){mapping.set(key,own.id);rules.set(key,'exact-source-document-id');continue;}
      const provenance=destination.filter(r=>[r.data.migrationProvenance,r.data.migrationRepairProvenance,r.data.migrationCatchupProvenance].some(p=>p?.sourceRecordId===row.id&&p?.sourceTable===table));
      if(provenance.length===1){mapping.set(key,provenance[0].id);rules.set(key,'proven-source-provenance');continue;}
      if(provenance.length>1){reviews.push({table,sourceId:row.id,reason:'multiple-provenance-targets'});continue;}
      if(table==='Sadhana Entries'||table==='BVSL Preaching Entries'){
        const owner=mapping.get(`Users|${values(row.User)[0]}`);
        const candidates=owner?destination.filter(r=>ownerOf(r).includes(owner)&&dateKey(r.data.entryDate)===dateKey(row['Entry Date'])):[];
        if(candidates.length===1){mapping.set(key,candidates[0].id);rules.set(key,'unique-canonical-owner-and-date');continue;}
        if(candidates.length>1){reviews.push({table,sourceId:row.id,reason:'ambiguous-owner-date',candidateIds:candidates.map(r=>r.id)});continue;}
        mapping.set(key,row.id);rules.set(key,'create-source-document-id');continue;
      }
      const prior=ledger.get(key);
      if(prior&&!['archive','limitation','review'].includes(prior.action)&&currentById.has(`${config.destination}|${prior.destinationDocumentId}`)){
        mapping.set(key,prior.destinationDocumentId);rules.set(key,'existing-migration-ledger');continue;
      }
      mapping.set(key,row.id);rules.set(key,'create-source-document-id');
    }
  }
  const fieldLookups=new Map<string,Map<string,string>>();
  for(const [collection,rows] of current){const lookup=new Map<string,string>();for(const r of rows)for(const key of Object.keys(r.data))if(!lookup.has(normalizedFieldName(key)))lookup.set(normalizedFieldName(key),key);fieldLookups.set(collection,lookup);}
  const runId=`catchup_${sha256(canonicalJson({decisions,sourceChecksum:sourceManifest.checksum,currentChecksum:destManifest.checksum})).slice(0,24)}`;
  const writes:any[]=[]; const records:any[]=[]; const seenTargets=new Map<string,string>();
  const sourceUserByPublicId=new Map(sourceUsers.filter(r=>r['User ID']).map(r=>[r['User ID'],r]));
  const renumberById=new Map(renumberings.map(r=>[r.sourceId,r]));
  for(const [table,rows] of source){
    const config=configFor.get(table)!;
    for(const row of rows){
      if(!(row.updated_at>BASELINE||row.created_at>BASELINE))continue;
      const key=`${table}|${row.id}`,collection=config.destination,documentId=mapping.get(key);
      const before=documentId&&collection?currentById.get(`${collection}|${documentId}`):undefined;
      const sourceChecksum=sha256(canonicalJson(row));
      let disposition=config.disposition==='archive_only'?'archive-only':!documentId?'archive-only':'operational';
      const reasons:string[]=[];const data:Record<string,any>={};
      const fields:any[]=(schema.get(table) as any)?.fields??[];
      if(disposition==='operational'){
        for(const required of REQUIRED[table]??[]){if(!values(row[required]).length||values(row[required]).some(id=>!mapping.get(`${fields.find(f=>f.name===required)?.linksTo}|${id}`))){disposition='archive-only';reasons.push(`unresolved-required:${required}`);}}
      }
      if(disposition==='operational'){
        for(const [sourceField,raw] of Object.entries(row)){
          if(SYSTEM.has(sourceField))continue;const field=fields.find(f=>f.name===sourceField);if(!field)throw new Error(`Unknown source field ${table}.${sourceField}`);
          const targetField=fieldLookups.get(collection!)?.get(normalizedFieldName(sourceField))??sourceFieldToCamelCase(sourceField);
          if(table==='Users'&&protectedUserField(targetField))continue;
          if(table==='Guides'&&['id','email','guideId','legacyGuideId','isActive','segment'].includes(targetField))continue;
          if(field.type==='linked_record'&&!(FORWARD[table]??[]).includes(sourceField))continue;
          let value:any=raw;
          if(field.type==='linked_record'){
            const targets=values(raw).map(id=>mapping.get(`${field.linksTo}|${id}`));
            if(targets.some(v=>!v)){reasons.push(`unresolved-optional:${sourceField}`);continue;}
            value=targets.length===0?null:targets.length===1?targets[0]:targets;
          }else if(field.type==='date'&&raw){value=`${dateKey(raw)}T00:00:00.000Z`;}
          // These legacy tables store public User IDs as text rather than links.
          if(sourceField==='User ID'&&table!=='Users'&&sourceUserByPublicId.has(String(raw))){
            const sourceUser=sourceUserByPublicId.get(String(raw))!;
            const mapped=mapping.get(`Users|${sourceUser.id}`);const currentUser=mapped?currentById.get(`Users|${mapped}`):undefined;
            value=renumberById.get(sourceUser.id)?.newUserId??currentUser?.data.userId??raw;
          }
          if(!before&&(value===null||value===undefined))continue;
          if(before&&equivalent(before.data[targetField],value,field.type))continue;
          data[targetField]=value;
        }
        if(table==='Users'&&!before){
          data.id=documentId;data.email=normalizeEmail(row.Email);data.role='User';data.segment='FOLK';
          if(row.Status)data.status=row.Status;
          if(row['User ID'])data.userId=renumberById.get(row.id)?.newUserId??row['User ID'];
          if(renumberById.has(row.id))data.legacyUserId=row['User ID'];
          for(const flag of PERMISSION_FIELDS)data[flag]=false;
        }
        if(table==='Users'&&decisions.statusOverrides[normalizeEmail(row.Email)]&&before?.data.status!==decisions.statusOverrides[normalizeEmail(row.Email)])data.status=decisions.statusOverrides[normalizeEmail(row.Email)];
        if(Object.keys(data).length){
          const target=`${collection}|${documentId}`;if(seenTargets.has(target))reviews.push({table,sourceId:row.id,reason:'multiple-source-rows-target-one-document',otherSource:seenTargets.get(target)});seenTargets.set(target,key);
          data.migrationCatchupProvenance={runId,sourceSystem:SOURCE_SYSTEM,sourceTable:table,sourceRecordId:row.id,sourceChecksum,sourceUpdatedAt:row.updated_at};
          if(!before)data.id=documentId;
          writes.push({phase:table==='Users'&&!before?1:2,operation:before?'update':'create',collection,documentId,data,precondition:before?{updateTime:before.updateTime}:{exists:false},before:before?.data??null,sourceTable:table,sourceRecordId:row.id});
        }
      }
      if(reasons.length)limitations.push({table,sourceId:row.id,disposition,reasons});
      const historyId=sha256(`${runId}|${table}|${row.id}`);
      writes.push({phase:0,operation:'create',collection:'_MigrationCatchupHistory',documentId:historyId,data:{runId,sourceSystem:SOURCE_SYSTEM,sourceTable:table,sourceRecordId:row.id,sourceChecksum,sourceRecordJson:canonicalJson(row),destinationCollection:collection??null,destinationDocumentId:disposition==='operational'?documentId:null,matchRule:rules.get(key)??null,disposition,reasons,beforeJson:before?canonicalJson(before.data):null,beforeUpdateTime:before?.updateTime??null},precondition:{exists:false},before:null});
      records.push({table,sourceId:row.id,collection:collection??null,documentId:disposition==='operational'?documentId:null,disposition,matchRule:rules.get(key)??null,sourceChecksum});
    }
  }
  // Explicit approved activation must be honored even if the source row was not modified.
  const advaita=users.find(r=>normalizeEmail(r.data.email)==='adpd@hkmmumbai.org');
  if(!advaita)reviews.push({reason:'approved-activation-profile-missing'});
  else if(advaita.data.status!=='Active'&&!writes.some(w=>w.collection==='Users'&&w.documentId===advaita.id&&w.data.status==='Active'))reviews.push({reason:'activation-not-in-plan'});
  const operational=writes.filter(w=>w.phase>0);
  const finalUsers=users.map(r=>({id:r.id,data:{...r.data,...operational.find(w=>w.collection==='Users'&&w.documentId===r.id)?.data}}));
  finalUsers.push(...operational.filter(w=>w.collection==='Users'&&w.operation==='create').map(w=>({id:w.documentId,data:w.data})));
  const existingNumberCollisions:any[]=[];
  for(const userId of new Set(finalUsers.map(r=>r.data.userId).filter(Boolean))){
    const same=finalUsers.filter(r=>r.data.userId===userId);if(same.length<2)continue;
    const original=users.filter(r=>r.data.userId===userId);
    if(canonicalJson(same.map(r=>r.id).sort())!==canonicalJson(original.map(r=>r.id).sort()))reviews.push({reason:'new-user-number-duplicate',userId});
    else existingNumberCollisions.push({userId,documentIds:same.map(r=>r.id),disposition:'pre-existing-preserved-no-new-collision'});
  }
  for(const u of users){const after=finalUsers.find(r=>r.id===u.id)!;const expected={...protectedIdentity(u.data)};if(normalizeEmail(u.data.email)==='adpd@hkmmumbai.org')expected.status='Active';if(canonicalJson(protectedIdentity(after.data))!==canonicalJson(expected))reviews.push({reason:'protected-identity-change',id:u.id});}
  const sorted=writes.sort((a,b)=>a.phase-b.phase||`${a.collection}/${a.documentId}`.localeCompare(`${b.collection}/${b.documentId}`));
  const planHash=sha256(sorted.map(canonicalJson).join('\n'));
  const counts:any={};for(const w of operational){const c=counts[w.collection]??{create:0,update:0};c[w.operation]++;counts[w.collection]=c;}
  const summary={kind:'guarded-zite-catchup-plan',runId,planHash,generatedAt:new Date().toISOString(),baseline:BASELINE,sourceRefreshThrough:decisions.sourceRefreshThrough,replayFrom:decisions.sourceReplayFrom,sourceContinuesAcceptingWrites:true,scope:'new-or-updated-source-records-since-original-migration',sourceRecords:records.length,historyWrites:sorted.length-operational.length,operationalWrites:operational.length,counts,renumberings,reviews,limitations,existingNumberCollisions,protectedIdentitiesHash:sha256(canonicalJson(users.map(u=>({id:u.id,data:protectedIdentity(u.data)})))),sourceSnapshotChecksum:sourceManifest.checksum,currentSnapshotChecksum:destManifest.checksum,productionApplied:false};
  writeJsonLines(path.join(passDir,'catchup-writes.jsonl'),sorted);writeJsonLines(path.join(passDir,'catchup-records.jsonl'),records);writeJson(path.join(passDir,'catchup-plan.json'),summary);
  writeJsonLines(path.join(passDir,'source-mapping.jsonl'),[...mapping].map(([key,documentId])=>({sourceTable:key.slice(0,key.indexOf('|')),sourceId:key.slice(key.indexOf('|')+1),documentId,rule:rules.get(key)})));
  return summary;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const [capture,pass]=process.argv.slice(2);if(!capture||!pass)throw new Error('Usage: planCatchup.ts <capture-dir> <pass-dir>');const report=planCatchup(path.resolve(capture),path.resolve(pass));console.log(JSON.stringify({...report,limitations:report.limitations.length},null,2));}
