/* eslint-disable @typescript-eslint/no-explicit-any -- migration snapshots contain heterogeneous external JSON values */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type JsonObject = Record<string, any>;

export function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: any): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

export function comparable(value: unknown): string {
  if (isBlank(value)) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  return canonicalJson(value);
}

export function normalizedFieldName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

const wordOverrides: Record<string, string> = {
  id: 'Id',
  bv: 'Bv',
  bvsl: 'Bvsl',
  nr: 'Nr',
  sp: 'Sp',
  sb: 'Sb',
  os: 'Os',
  ma: 'Ma',
  na: 'Na',
  gv: 'Gv',
  json: 'Json',
  qr: 'Qr',
  url: 'Url',
};

export function sourceFieldToCamelCase(field: string): string {
  const words = field.replace(/\([^)]*\)/g, '').match(/[a-zA-Z0-9]+/g) ?? [];
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      const normalized = wordOverrides[lower] ?? `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
      return index === 0 ? `${normalized.slice(0, 1).toLowerCase()}${normalized.slice(1)}` : normalized;
    })
    .join('');
}

export function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export function readJsonLines(filePath: string): any[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return [];
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error: any) {
        throw new Error(`Invalid JSONL at ${filePath}:${index + 1}: ${error?.message || error}`);
      }
    });
}

export function writeJson(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeJsonLines(filePath: string, values: any[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = values.map((value) => canonicalJson(value)).join('\n');
  fs.writeFileSync(filePath, body ? `${body}\n` : '', 'utf8');
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : canonicalJson(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeCsv(filePath: string, headers: string[], rows: object[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    const values = row as Record<string, unknown>;
    lines.push(headers.map((header) => csvCell(values[header])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

export function readJson<T = any>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}
