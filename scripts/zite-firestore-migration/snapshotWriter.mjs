import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const outputPath = process.argv[2];
const base64Mode = process.argv.includes('--base64-chunks');
if (!outputPath) {
  throw new Error('Usage: node snapshotWriter.mjs <output.jsonl>');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const stream = fs.createWriteStream(outputPath, { flags: 'wx', encoding: 'utf8' });
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let count = 0;
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
  JSON.parse(record);
  if (!stream.write(`${record}\n`)) {
    await new Promise((resolve) => stream.once('drain', resolve));
  }
  count += 1;
}

await new Promise((resolve, reject) => {
  stream.end(resolve);
  stream.on('error', reject);
});

process.stdout.write(JSON.stringify({ outputPath, count }));
