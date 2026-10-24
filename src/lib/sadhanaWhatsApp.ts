import { normalizePhoneForLinks } from './userUtils';

/** Build a composer link only for FOLK members with outstanding entries. */
export function sadhanaWhatsAppLink(input: {
  segment?: string | null;
  fullName: string;
  phone?: string | null;
  missingDates: string[];
}, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())): string | null {
  if (input.segment !== 'FOLK') return null;
  const phone = normalizePhoneForLinks(input.phone);
  if (!/^[1-9]\d{7,14}$/.test(phone)) return null;
  const dates = [...new Set(input.missingDates)].filter(date =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date,
  ).sort();
  if (!dates.length) return null;
  const labels = dates.map(date => new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`)));
  const message = `Hare Krishna ${input.fullName.trim()}! Your Sadhana entries are pending for ${labels.join(', ')}. Please fill in the pending entries in the FOLK app where the submission window is still open. If you need help, please let me know. Thank you!`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
