import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, sha256 } from '../scripts/zite-firestore-migration/common';
import { validateCatchupPlan } from '../scripts/zite-firestore-migration/catchupGuards';
import { equivalent, protectedUserField } from '../scripts/zite-firestore-migration/planCatchup';
const write=()=>({phase:2,operation:'update',collection:'Users',documentId:'person',sourceRecordId:'source-person',before:{email:'person@example.com',fullName:'Before'},data:{fullName:'After',migrationCatchupProvenance:{sourceRecordId:'source-person'}},precondition:{updateTime:'2026-09-23T00:00:00Z'}});
function verify(writes:unknown[]){return validateCatchupPlan({kind:'guarded-zite-catchup-plan',reviews:[],planHash:sha256(writes.map(canonicalJson).join('\n'))},writes);}
test('catch-up guard permits guarded profile fields, not identity/permission writes',()=>{
  assert.doesNotThrow(()=>verify([write()]));
  for(const field of ['role','roles','email','userId','status','firebaseUid','isPwAdmin','isBvFacilitator','segment']){
    const w=write();(w.data as Record<string,unknown>)[field]='changed';assert.throws(()=>verify([w]),/Protected account field/);
  }
});
test('only the expressly authorized Advaita activation bypasses status protection',()=>{
  const w=write();w.before.email='adpd@hkmmumbai.org';(w.data as Record<string,unknown>).status='Active';assert.doesNotThrow(()=>verify([w]));
  (w.data as Record<string,unknown>).status='Inactive';assert.throws(()=>verify([w]),/Protected account field/);
});
test('catch-up guard rejects unguarded, duplicate, deletion, and operational subscription writes',()=>{
  assert.throws(()=>verify([write(),write()]),/Duplicate write/);
  const w=write();(w as unknown as Record<string,unknown>).operation='delete';assert.throws(()=>verify([w]),/Unsafe operation/);
  w.operation='update';w.collection='PushSubscriptions';assert.throws(()=>verify([w]),/Excluded operational/);
  w.collection='Users';w.precondition.updateTime='';assert.throws(()=>verify([w]),/guarded before/);
});
test('source comparisons preserve equivalent numeric/date representations without treating cleared data as equal',()=>{
  assert.ok(equivalent('15',15,'number'));assert.ok(equivalent('2026-09-23T00:00:00.000Z','2026-09-23','date'));
  assert.ok(equivalent(['user-a'],'user-a','linked_record'));assert.ok(!equivalent('15',null,'number'));
  assert.ok(protectedUserField('bvReportingAdminId'));assert.ok(!protectedUserField('fullName'));
});
