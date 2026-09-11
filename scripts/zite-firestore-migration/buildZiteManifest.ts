import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_BASE_ID, SOURCE_SYSTEM, SOURCE_TABLES, assertStaticConfiguration } from './config';
import { canonicalJson, readJsonLines, safeFileName, sha256, writeJson } from './common';
import { validateZiteSchema } from './schemaValidation';

function main(): void {
  assertStaticConfiguration();
  const runDirArg = process.argv[2];
  const watermark = process.argv[3];
  const captureStartedAt = process.argv[4];
  if (!runDirArg || !watermark || !captureStartedAt) {
    throw new Error('Usage: npx tsx buildZiteManifest.ts <run-directory> <watermark> <capture-started-at>');
  }
  const runDir = path.resolve(runDirArg);
  const ziteDir = path.join(runDir, 'zite');
  const manifestPath = path.join(ziteDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) throw new Error(`Refusing to overwrite ${manifestPath}`);

  const excludedCounts = new Map(
    readJsonLines(path.join(ziteDir, 'excluded-counts.jsonl')).map((row) => [row.source, Number(row.observedCount ?? 0)]),
  );
  const tables = SOURCE_TABLES.map((config) => {
    if (config.disposition === 'exclude') {
      const forbiddenFile = path.join(ziteDir, 'tables', `${safeFileName(config.source)}.jsonl`);
      if (fs.existsSync(forbiddenFile)) throw new Error(`LLP data file must not exist: ${forbiddenFile}`);
      return {
        source: config.source,
        sourceId: config.sourceId ?? null,
        disposition: config.disposition,
        count: 0,
        exportedCount: 0,
        observedCount: excludedCounts.get(config.source) ?? 0,
        file: null,
        checksum: null,
        maxUpdatedAt: null,
      };
    }
    const relativeFile = `tables/${safeFileName(config.source)}.jsonl`;
    const filePath = path.join(ziteDir, relativeFile);
    if (!fs.existsSync(filePath)) throw new Error(`Missing source snapshot table: ${config.source}`);
    const body = fs.readFileSync(filePath, 'utf8');
    const rows = readJsonLines(filePath);
    const maxUpdatedAt = rows.map((row) => row.updated_at).filter(Boolean).sort().at(-1) ?? null;
    if (maxUpdatedAt && maxUpdatedAt > watermark) {
      throw new Error(`${config.source} contains ${maxUpdatedAt}, later than watermark ${watermark}`);
    }
    return {
      source: config.source,
      sourceId: config.sourceId ?? null,
      disposition: config.disposition,
      count: rows.length,
      exportedCount: rows.length,
      observedCount: rows.length,
      file: relativeFile,
      checksum: sha256(body),
      maxUpdatedAt,
    };
  });

  const schemaBody = fs.readFileSync(path.join(ziteDir, 'schema.jsonl'), 'utf8');
  const schemaValidation = validateZiteSchema(
    readJsonLines(path.join(ziteDir, 'schema.jsonl')),
    SOURCE_TABLES.map((table) => table.source),
  );
  const unsigned = {
    kind: 'zite-snapshot',
    sourceSystem: SOURCE_SYSTEM,
    baseId: SOURCE_BASE_ID,
    captureStartedAt,
    capturedAt: watermark,
    watermark,
    readOnly: true,
    visibleRowsOnly: true,
    tombstonesIncluded: false,
    attachmentBytesVerified: false,
    schemaFile: 'schema.jsonl',
    schemaChecksum: sha256(schemaBody),
    schemaValidation,
    tables,
  };
  writeJson(manifestPath, { ...unsigned, checksum: sha256(canonicalJson(unsigned)) });
  process.stdout.write(`${JSON.stringify({
    manifestPath,
    watermark,
    nonLlpRows: tables.filter((table) => table.disposition !== 'exclude').reduce((total, table) => total + table.count, 0),
    llpRowsExported: tables.filter((table) => table.disposition === 'exclude').reduce((total, table) => total + table.exportedCount, 0),
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
