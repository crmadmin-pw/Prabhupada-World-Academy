/* eslint-disable @typescript-eslint/no-explicit-any -- private snapshot manifests */
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, readJson, readJsonLines, sha256, writeJson, writeJsonLines } from './common';
import { planCatchup } from './planCatchup';
const pass=path.resolve(process.argv[2]??'');if(!process.argv[2])throw new Error('Pass directory required');
const verified=readJson<any>(path.join(pass,'rehearsal-readback.json'));
const functional=readJson<any>(path.join(pass,'functional-verification.json'));
const plan=readJson<any>(path.join(pass,'catchup-plan.json'));
if(verified.planHash!==plan.planHash||verified.mismatches.length||functional.planHash!==plan.planHash||functional.errors.length)throw new Error('Successful database and functional checks required');
const out=path.join(pass,'idempotency');
writeJson(path.join(out,'approved-decisions.json'),readJson(path.join(pass,'approved-decisions.json')));
writeJson(path.join(out,'source-refresh-schema.json'),readJson(path.join(pass,'source-refresh-schema.json')));
for(const file of fs.readdirSync(path.join(pass,'source-refresh')))writeJsonLines(path.join(out,'source-refresh',file),readJsonLines(path.join(pass,'source-refresh',file)));
const prior=readJson<any>(path.join(pass,'firestore/manifest.json'));
const tables=prior.tables.map((t:any)=>{
  const live=path.join(pass,'rehearsal-functional-snapshot',t.collection+'.jsonl');
  const rows=readJsonLines(fs.existsSync(live)?live:path.join(pass,'firestore',t.file));
  writeJsonLines(path.join(out,'firestore',t.file),rows);
  return {...t,count:rows.length,checksum:sha256(rows.map(canonicalJson).join('\n'))};
});
const manifest={...prior,tables,capturedAt:functional.verifiedAt,source:'verified-rehearsal-readback-over-original-unchanged-collections'};
writeJson(path.join(out,'firestore/manifest.json'),{...manifest,checksum:sha256(canonicalJson(manifest))});
const repeated=planCatchup(path.dirname(pass),out);
const result={planHash:plan.planHash,verifiedAt:new Date().toISOString(),operationalWritesOnRepeat:repeated.operationalWrites,reviews:repeated.reviews,historyVersionWritesOnRepeat:repeated.historyWrites,passed:repeated.operationalWrites===0&&repeated.reviews.length===0};
writeJson(path.join(pass,'idempotency-verification.json'),result);console.log(JSON.stringify(result));if(!result.passed)throw new Error('Repeated catch-up would modify operational data');
