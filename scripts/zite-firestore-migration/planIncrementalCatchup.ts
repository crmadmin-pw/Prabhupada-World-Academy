/* eslint-disable @typescript-eslint/no-explicit-any -- private migration snapshots */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson, normalizedFieldName, readJson, readJsonLines, safeFileName, sha256, writeJson, writeJsonLines } from './common';
import { equivalent, planCatchup } from './planCatchup';

export function importedEntryId(collection: string, sourceId: string): string {
  if (!['SadhanaEntries','BvslPreachingEntries'].includes(collection) || !/^[a-zA-Z0-9_-]+$/.test(sourceId)) throw new Error('Invalid imported entry identity');
  return `${collection==='SadhanaEntries'?'ZITE-ENTRY':'ZITE-BV-ENTRY'}-${sourceId}`;
}

// Compare against the last applied source and destination, not their timestamps:
// source backlinks can update a row without changing its business fields.
export function incrementalFieldAction(input: {
  priorSourceExists: boolean; oldSource: any; newSource: any; type?: string;
  priorDestinationExists: boolean; oldDestination: any; currentDestination: any;
}): 'source-unchanged' | 'apply' | 'conflict' {
  if (input.priorSourceExists && equivalent(input.oldSource, input.newSource, input.type)) return 'source-unchanged';
  if (input.priorDestinationExists && equivalent(input.oldDestination, input.currentDestination, input.type)) return 'apply';
  return 'conflict';
}

export function planIncrementalCatchup(capture: string, pass: string): any {
  const policy = readJson<any>(path.join(pass, 'incremental-policy.json'));
  if (!policy.priorPass || !policy.replayFrom || !['review', 'preserve-current', 'source-wins'].includes(policy.conflictPolicy)) throw new Error('Explicit incremental policy required');
  const priorPass = path.resolve(policy.priorPass), priorCapture = path.dirname(priorPass);
  const priorManifest = readJson<any>(path.join(priorCapture, 'zite/manifest.json'));
  const currentManifest = readJson<any>(path.join(capture, 'zite/manifest.json'));
  const priorSource = new Map<string, any>(), currentSource = new Map<string, any>();
  for (const [manifest, root, refresh, output] of [[priorManifest, priorCapture, priorPass, priorSource], [currentManifest, capture, pass, currentSource]] as any[]) {
    for (const table of manifest.tables) {
      if (/^LLP/i.test(table.source)) throw new Error('LLP source forbidden');
      for (const row of [...readJsonLines(path.join(root, 'zite', table.file)), ...readJsonLines(path.join(refresh, 'source-refresh', safeFileName(table.source)+'.jsonl'))]) output.set(table.source+'|'+row.id, row);
    }
  }
  const previous = new Map<string, any>();
  for (const table of readJson<any>(path.join(priorPass, 'firestore/manifest.json')).tables) {
    for (const row of readJsonLines(path.join(priorPass, 'firestore', table.file))) previous.set(table.collection+'|'+row.id, row.data);
  }
  for (const w of readJsonLines(path.join(priorPass, 'catchup-writes.jsonl')).filter(w=>w.phase>0)) previous.set(w.collection+'|'+w.documentId, {...previous.get(w.collection+'|'+w.documentId), ...w.data});
  const priorReceipt = readJson<any>(path.join(priorPass, 'completion-receipt.json'));
  if (priorReceipt.planHash !== readJson<any>(path.join(priorPass, 'catchup-plan.json')).planHash) throw new Error('Prior pass is not verified');
  const schema = new Map<string, any>(readJson<any>(path.join(pass, 'source-refresh-schema.json')).tables.map((t:any)=>[t.name,t]));
  const raw = planCatchup(capture, pass);
  const candidates = readJsonLines(path.join(pass, 'catchup-writes.jsonl'));
  const reviews = [...raw.reviews], preserved:any[] = [], conflicts:any[] = [], operational:any[] = [];
  for (const w of candidates.filter(w=>w.phase>0)) {
    const key=w.sourceTable+'|'+w.sourceRecordId, source=currentSource.get(key), oldSource=priorSource.get(key);
    const oldDestination=previous.get(w.collection+'|'+w.documentId);
    if(w.operation==='create') {
      if(oldDestination) { reviews.push({reason:'previously-present-destination-now-absent',collection:w.collection,documentId:w.documentId,sourceId:w.sourceRecordId}); continue; }
      if(policy.namespaceIncomingEntryIds&&['SadhanaEntries','BvslPreachingEntries'].includes(w.collection)) operational.push({...w,data:{...w.data,entryDate:String(w.data.entryDate).slice(0,10),legacyEntryId:w.data.entryId??null,entryId:importedEntryId(w.collection,w.sourceRecordId)}});
      else operational.push(w);
      continue;
    }
    if(policy.preserveExistingProfiles&&['Users','Guides'].includes(w.collection)) { preserved.push({collection:w.collection,documentId:w.documentId,reason:'preserve-current-profile'});continue; }
    if(policy.preserveCounters&&w.collection==='Config'&&String(w.before.configKey).startsWith('counter:')) {preserved.push({collection:w.collection,documentId:w.documentId,reason:'preserve-current-app-counter'});continue;}
    const data:any={};
    for(const [targetField, proposed] of Object.entries(w.data)) {
      if(targetField==='migrationCatchupProvenance') continue;
      if(targetField==='entryId'&&['SadhanaEntries','BvslPreachingEntries'].includes(w.collection)){preserved.push({collection:w.collection,documentId:w.documentId,field:targetField,reason:'preserve-existing-entry-identity'});continue;}
      const field=schema.get(w.sourceTable)?.fields.find((f:any)=>normalizedFieldName(f.name)===normalizedFieldName(targetField));
      if(!field) { reviews.push({reason:'unmapped-incremental-field',collection:w.collection,documentId:w.documentId,targetField});continue; }
      const action=incrementalFieldAction({priorSourceExists:!!oldSource,oldSource:oldSource?.[field.name],newSource:source[field.name],type:field.type,priorDestinationExists:!!oldDestination,oldDestination:oldDestination?.[targetField],currentDestination:w.before[targetField]});
      if(action==='source-unchanged') {preserved.push({collection:w.collection,documentId:w.documentId,field:targetField,reason:action});continue;}
      if(action==='conflict') {
        const conflict={reason:'both-applications-differ',collection:w.collection,documentId:w.documentId,sourceId:w.sourceRecordId,field:targetField,priorSource:oldSource?.[field.name]??null,sourceValue:source[field.name],priorDestination:oldDestination?.[targetField]??null,currentValue:w.before[targetField]??null,proposedValue:proposed};
        conflicts.push(conflict);
        if(policy.conflictPolicy==='review'){reviews.push(conflict);continue;}
        if(policy.conflictPolicy==='preserve-current'){preserved.push(conflict);continue;}
        if(!policy.sourceWinsTargets?.includes(w.collection+'/'+w.documentId)){reviews.push({...conflict,reason:'source-wins-target-not-authorized'});continue;}
      }
      data[targetField]=proposed;
    }
    if(Object.keys(data).length) operational.push({...w,data:{...data,migrationCatchupProvenance:w.data.migrationCatchupProvenance}});
  }
  const operationalKeys=new Set(operational.map(w=>w.sourceTable+'|'+w.sourceRecordId));
  const history=candidates.filter(w=>w.phase===0&&(operationalKeys.has(w.data.sourceTable+'|'+w.data.sourceRecordId)||JSON.parse(w.data.sourceRecordJson).updated_at>=policy.replayFrom||JSON.parse(w.data.sourceRecordJson).created_at>=policy.replayFrom));
  const writes=[...history,...operational].sort((a,b)=>a.phase-b.phase||`${a.collection}/${a.documentId}`.localeCompare(`${b.collection}/${b.documentId}`));
  const counts:any={};for(const w of operational){const c=counts[w.collection]??{create:0,update:0};c[w.operation]++;counts[w.collection]=c;}
  const plan={...raw,planner:'incremental-three-way',rehearsalDatabase:policy.rehearsalDatabase,incrementalPolicy:policy,planHash:sha256(writes.map(canonicalJson).join('\n')),scope:'missing-source-records-and-field-changes-since-last-applied-pass',historyWrites:history.length,operationalWrites:operational.length,counts,reviews,preservedDestinationFields:preserved.length,conflictingFields:conflicts.length};
  writeJsonLines(path.join(pass,'catchup-writes.jsonl'),writes);writeJson(path.join(pass,'catchup-plan.json'),plan);
  writeJson(path.join(pass,'incremental-comparison.json'),{preserved,conflicts,sourceRecordsCompared:currentSource.size,priorPass,priorPlanHash:priorReceipt.planHash});
  return plan;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [capture,pass]=process.argv.slice(2);if(!capture||!pass)throw new Error('Usage: planIncrementalCatchup.ts <capture-dir> <pass-dir>');
  const report=planIncrementalCatchup(path.resolve(capture),path.resolve(pass));console.log(JSON.stringify({...report,limitations:report.limitations.length},null,2));
}
