/* eslint-disable @typescript-eslint/no-explicit-any -- migration snapshots contain heterogeneous external JSON values */
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_TABLES } from './config';
import { canonicalJson, readJson, readJsonLines, safeFileName, sha256, writeJson } from './common';

interface AttachmentItem {
  sourceTable: string;
  sourceRecordId: string;
  field: string;
  url: string;
  filename: string | null;
}

function attachmentItems(value: any): Array<{ url: string; filename: string | null }> {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((entry) => {
    if (typeof entry === 'string') return [{ url: entry, filename: null }];
    if (entry && typeof entry.url === 'string') return [{ url: entry.url, filename: entry.filename ?? null }];
    return [];
  });
}

function hasRecognizedMagic(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const hex = bytes.subarray(0, 12).toString('hex');
  return hex.startsWith('ffd8ff') ||
    hex.startsWith('89504e470d0a1a0a') ||
    hex.startsWith('47494638') ||
    (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') ||
    bytes.subarray(0, 4).toString('ascii') === '%PDF' ||
    hex.startsWith('504b0304');
}

async function main(): Promise<void> {
  const runDirArg = process.argv[2];
  if (!runDirArg) throw new Error('Usage: node --import tsx snapshotAttachments.ts <run-directory>');
  const runDir = path.resolve(runDirArg);
  const ziteDir = path.join(runDir, 'zite');
  const schema = readJsonLines(path.join(ziteDir, 'schema.jsonl'));
  const schemaByName = new Map(schema.map((table) => [table.name, table]));
  const items: AttachmentItem[] = [];

  for (const config of SOURCE_TABLES.filter((table) => table.disposition !== 'exclude')) {
    if (/^LLP/i.test(config.source)) throw new Error(`LLP attachment firewall violation: ${config.source}`);
    const fields = (schemaByName.get(config.source)?.fields ?? []).filter((field: any) => field.type === 'attachments');
    if (fields.length === 0) continue;
    const file = path.join(ziteDir, 'tables', `${safeFileName(config.source)}.jsonl`);
    for (const row of readJsonLines(file)) {
      for (const field of fields) {
        for (const attachment of attachmentItems(row[field.name])) {
          const url = new URL(attachment.url);
          if (url.protocol !== 'https:') throw new Error(`Attachment is not HTTPS: ${config.source}/${row.id}/${field.name}`);
          items.push({
            sourceTable: config.source,
            sourceRecordId: row.id,
            field: field.name,
            url: attachment.url,
            filename: attachment.filename,
          });
        }
      }
    }
  }

  const attachmentDir = path.join(ziteDir, 'attachments');
  fs.mkdirSync(attachmentDir, { recursive: true });
  const byUrl = new Map<string, Promise<any>>();
  const download = (item: AttachmentItem): Promise<any> => {
    const existing = byUrl.get(item.url);
    if (existing) return existing;
    const promise = (async () => {
      const response = await fetch(item.url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`Attachment download failed (${response.status}): ${item.sourceTable}/${item.sourceRecordId}/${item.field}`);
      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > 25_000_000) throw new Error(`Attachment exceeds 25MB limit: ${item.sourceTable}/${item.sourceRecordId}/${item.field}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 25_000_000) throw new Error(`Invalid attachment size ${bytes.length}: ${item.sourceTable}/${item.sourceRecordId}/${item.field}`);
      const contentType = response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
      if (!hasRecognizedMagic(bytes)) throw new Error(`Unrecognized or unreadable attachment bytes: ${item.sourceTable}/${item.sourceRecordId}/${item.field}`);
      const checksum = sha256(bytes);
      const relativeFile = `attachments/${checksum}.bin`;
      const output = path.join(ziteDir, relativeFile);
      if (!fs.existsSync(output)) fs.writeFileSync(output, bytes, { flag: 'wx' });
      else if (sha256(fs.readFileSync(output)) !== checksum) throw new Error(`Attachment checksum collision: ${output}`);
      return { checksum, bytes: bytes.length, contentType, file: relativeFile };
    })();
    byUrl.set(item.url, promise);
    return promise;
  };

  const results: any[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, Math.max(items.length, 1)) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      const downloaded = await download(item);
      results.push({ ...item, ...downloaded, urlChecksum: sha256(item.url) });
      if (results.length % 25 === 0) process.stdout.write(`Verified ${results.length}/${items.length} attachments\n`);
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => `${a.sourceTable}|${a.sourceRecordId}|${a.field}|${a.url}`.localeCompare(`${b.sourceTable}|${b.sourceRecordId}|${b.field}|${b.url}`));

  const attachmentManifest = {
    kind: 'zite-attachment-snapshot',
    capturedSourceWatermark: readJson<any>(path.join(ziteDir, 'manifest.json')).watermark,
    verifiedAt: new Date().toISOString(),
    count: results.length,
    uniqueFiles: new Set(results.map((row) => row.checksum)).size,
    totalBytes: [...new Map(results.map((row) => [row.checksum, row.bytes])).values()].reduce((sum, bytes) => sum + Number(bytes), 0),
    attachments: results,
  };
  const attachmentManifestPath = path.join(ziteDir, 'attachment-manifest.json');
  writeJson(attachmentManifestPath, attachmentManifest);

  const existingManifest = readJson<any>(path.join(ziteDir, 'manifest.json'));
  const unsigned = { ...existingManifest };
  delete unsigned.checksum;
  const updated = {
    ...unsigned,
    attachmentBytesVerified: true,
    attachmentManifestFile: 'attachment-manifest.json',
    attachmentManifestChecksum: sha256(canonicalJson(attachmentManifest)),
  };
  writeJson(path.join(ziteDir, 'manifest.json'), { ...updated, checksum: sha256(canonicalJson(updated)) });
  process.stdout.write(`${JSON.stringify({ count: attachmentManifest.count, uniqueFiles: attachmentManifest.uniqueFiles, totalBytes: attachmentManifest.totalBytes }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
