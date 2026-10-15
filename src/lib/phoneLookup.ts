import { normalizePhone } from './phoneNormalize';

interface PhoneTable {
  findAll(query: any): Promise<{ records: any[] }>;
}

/** Stored spellings of one number. Firestore matches phones exactly, so each
 * common form is queried and the result is confirmed by normalized value. */
export function storedPhoneForms(raw: string): string[] {
  const norm = normalizePhone(raw);
  const digits = norm.replace('+', '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return [...new Set([
    raw.trim(),
    norm,
    digits,
    local,
    `+${digits}`,
    `91${local}`,
    `+91${local}`,
  ].filter(form => form.replace(/\D/g, '').length >= 7))];
}

/** Last 10 digits, so `9876543210` and `+91 98765 43210` are the same number. */
export function phoneMatchKey(raw: string): string {
  const digits = normalizePhone(raw).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Records whose phone is the same number as `raw`. */
export async function findByPhone(table: PhoneTable, raw: string, fields?: string[]): Promise<any[]> {
  const key = phoneMatchKey(raw);
  if (key.length < 7) return [];
  const { records } = await table.findAll({
    filters: { phone: { in: storedPhoneForms(raw) } },
    ...(fields ? { fields: [...new Set([...fields, 'phone'])] } : {}),
    limit: 20,
  });
  return records.filter(record => phoneMatchKey(String(record.phone || '')) === key);
}
