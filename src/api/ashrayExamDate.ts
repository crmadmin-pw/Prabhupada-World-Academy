import { Config } from '@/lib/backend-sdk';
import { CONFIG_KEYS } from '@/config/configKeys';

export type AshrayDepartment = 'FOLK' | 'PW';

export function examConfigKey(segment: AshrayDepartment): string {
  return segment === 'FOLK' ? CONFIG_KEYS.NEXT_ASHRAY_EXAM_FOLK : CONFIG_KEYS.NEXT_ASHRAY_EXAM_PW;
}

/** Accept the date input value and store the legacy-compatible M/D/YYYY form. */
export function normalizeAshrayExamDate(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))$/.exec(raw);
  if (!match) throw new Error('Enter a valid exam date');
  const year = Number(match[1] || match[6]);
  const month = Number(match[2] || match[4]);
  const day = Number(match[3] || match[5]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Enter a valid exam date');
  }
  return `${month}/${day}/${year}`;
}

export async function readAshrayExamDate(segment: AshrayDepartment): Promise<string> {
  const current = await Config.findOne({ filters: { configKey: examConfigKey(segment) }, fields: ['configValue'] });
  if (current?.configValue) return String(current.configValue);
  // Preserve the existing single-date configuration until each department is
  // explicitly assigned its own schedule.
  const legacy = await Config.findOne({ filters: { configKey: CONFIG_KEYS.NEXT_ASHRAY_EXAM }, fields: ['configValue'] });
  return String(legacy?.configValue || '');
}
