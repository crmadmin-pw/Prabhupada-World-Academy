import assert from 'node:assert/strict';
import test from 'node:test';
import { importedEntryId, incrementalFieldAction } from '../scripts/zite-firestore-migration/planIncrementalCatchup';

test('a Zite backlink edit cannot revert a current-app business field',()=>{
  assert.equal(incrementalFieldAction({priorSourceExists:true,oldSource:'old-guide',newSource:'old-guide',priorDestinationExists:true,oldDestination:'mapped-old-guide',currentDestination:'new-guide'}),'source-unchanged');
});
test('only Zite changed the field, so the new value can be imported',()=>{
  assert.equal(incrementalFieldAction({priorSourceExists:true,oldSource:10,newSource:20,type:'number',priorDestinationExists:true,oldDestination:10,currentDestination:'10'}),'apply');
});
test('independent edits and a new source record colliding with current data need review',()=>{
  assert.equal(incrementalFieldAction({priorSourceExists:true,oldSource:10,newSource:20,priorDestinationExists:true,oldDestination:10,currentDestination:30}),'conflict');
  assert.equal(incrementalFieldAction({priorSourceExists:false,oldSource:undefined,newSource:20,priorDestinationExists:false,oldDestination:undefined,currentDestination:30}),'conflict');
});
test('an explicit source clear is a change, while reordered links are unchanged',()=>{
  assert.equal(incrementalFieldAction({priorSourceExists:true,oldSource:10,newSource:null,priorDestinationExists:true,oldDestination:10,currentDestination:10}),'apply');
  assert.equal(incrementalFieldAction({priorSourceExists:true,oldSource:['a','b'],newSource:['b','a'],type:'linked_record',priorDestinationExists:true,oldDestination:['a','b'],currentDestination:['c']}),'source-unchanged');
});
test('imported entry IDs cannot collide with either live app sequential counter',()=>{
  const id=importedEntryId('SadhanaEntries','source-123');
  assert.equal(id,importedEntryId('SadhanaEntries','source-123'));
  assert.notEqual(id,importedEntryId('SadhanaEntries','source-124'));
  assert.ok(!/^ENTRY-\d+$/.test(id));
  assert.ok(!/^BV-ENTRY-\d+$/.test(importedEntryId('BvslPreachingEntries','source-123')));
  assert.throws(()=>importedEntryId('Users','source-123'));
});
