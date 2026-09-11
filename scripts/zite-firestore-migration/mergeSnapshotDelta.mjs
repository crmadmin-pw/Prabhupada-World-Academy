import fs from 'node:fs';
import readline from 'node:readline';

const filePath = process.argv[2];
const base64Mode = process.argv.includes('--base64-chunks');
if (!filePath || !fs.existsSync(filePath)) {
  throw new Error('Usage: node mergeSnapshotDelta.mjs <existing-output.jsonl>');
}

const records = new Map();
for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)) {
  const row = JSON.parse(line);
  if (!row.id) throw new Error(`Existing source row has no id in ${filePath}`);
  records.set(row.id, row);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let deltaCount = 0;
let encodedRecord = '';
for await (const line of input) {
  if (!line) continue;
  if (line === '__END__') {
    if (encodedRecord) throw new Error('Incomplete base64 record at end of input');
    input.close();
    process.stdin.destroy();
    break;
  }
  if (base64Mode && line !== '__RECORD__') {
    encodedRecord += line;
    continue;
  }
  const record = base64Mode ? Buffer.from(encodedRecord, 'base64').toString('utf8') : line;
  encodedRecord = '';
  const row = JSON.parse(record);
  if (!row.id) throw new Error(`Delta source row has no id in ${filePath}`);
  records.set(row.id, row);
  deltaCount += 1;
}

const rows = [...records.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const tempPath = `${filePath}.tmp`;
fs.writeFileSync(tempPath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
fs.renameSync(tempPath, filePath);
process.stdout.write(JSON.stringify({ filePath, count: rows.length, deltaCount }));
