/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore REST payloads contain heterogeneous values */
import fs from 'node:fs';

export type FirestoreValue = Record<string, any>;

export function firebaseAccessToken(): string {
  const candidates = [
    process.env.FIREBASE_ACCESS_TOKEN,
    (() => {
      const file = '/home/vedanarayana_das/.config/configstore/firebase-tools.json';
      if (!fs.existsSync(file)) return '';
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed?.tokens?.access_token ?? '';
    })(),
  ];
  const token = candidates.find((value) => typeof value === 'string' && value.length > 0);
  if (!token) throw new Error('Firebase CLI access token unavailable. Run firebase login first.');
  return token;
}

export function encodeValue(value: any): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot encode non-finite Firestore number: ${value}`);
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (value && typeof value === 'object') {
    if (value.__type === 'bytes' && typeof value.base64 === 'string') return { bytesValue: value.base64 };
    if (value.__type === 'reference' && typeof value.value === 'string') return { referenceValue: value.value };
    if (value.__type === 'geoPoint') return { geoPointValue: { latitude: value.latitude, longitude: value.longitude } };
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
}

export function encodeFields(data: Record<string, any>): Record<string, FirestoreValue> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeValue(value)]));
}

export function decodeValue(value: FirestoreValue): any {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return { __type: 'bytes', base64: value.bytesValue };
  if ('referenceValue' in value) return { __type: 'reference', value: value.referenceValue };
  if ('geoPointValue' in value) return { __type: 'geoPoint', ...value.geoPointValue };
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  throw new Error(`Unsupported Firestore REST value: ${JSON.stringify(value).slice(0, 200)}`);
}

export function decodeFields(fields: Record<string, FirestoreValue>): Record<string, any> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

export function documentName(projectId: string, databaseId: string, collection: string, documentId: string): string {
  if (!collection || !documentId || collection.includes('/') || documentId.includes('/')) {
    throw new Error(`Unsafe top-level Firestore target: ${collection}/${documentId}`);
  }
  return `projects/${projectId}/databases/${databaseId}/documents/${collection}/${documentId}`;
}

export function fieldPath(field: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) return field;
  return `\`${field.replace(/([\\`])/g, '\\$1')}\``;
}

export async function listCollection(
  projectId: string,
  databaseId: string,
  collection: string,
  token: string,
): Promise<any[]> {
  const rows: any[] = [];
  let pageToken = '';
  do {
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(collection)}`;
    const url = new URL(base);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) break;
    if (!response.ok) throw new Error(`Firestore read failed for ${collection}: ${response.status} ${await response.text()}`);
    const payload: any = await response.json();
    for (const document of payload.documents ?? []) {
      rows.push({
        id: decodeURIComponent(String(document.name).split('/').at(-1) ?? ''),
        createTime: document.createTime,
        updateTime: document.updateTime,
        data: decodeFields(document.fields ?? {}),
      });
    }
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}
