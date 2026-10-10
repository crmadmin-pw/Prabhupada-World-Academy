/**
 * Cleans free-text before it is placed in email HTML.
 * Strips active markup, then escapes the rest. The mailer may keep only the
 * exact formatting tags the templates themselves write.
 */
export function sanitizeInputText(input: string | null | undefined): string {
  if (!input || typeof input !== 'string') return '';

  return input
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<iframe\b[^<]*>([\s\S]*?)<\/iframe>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/\u0000/g, '')
    .trim();
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TRUSTED_EMAIL_TAG = /<strong>|<\/strong>|<br\s*\/?>/g;

/** Escape one email text block. Template tags such as <strong> stay intact. */
export function escapeEmailHtml(input: string | null | undefined): string {
  const cleaned = sanitizeInputText(input);
  const placeholders: string[] = [];
  const marked = cleaned.replace(TRUSTED_EMAIL_TAG, (tag) => {
    const token = `\u0000${placeholders.length}\u0000`;
    placeholders.push(/^<br/i.test(tag) ? '<br/>' : tag);
    return token;
  });
  return escapeHtml(marked).replace(/\u0000(\d+)\u0000/g, (_match, index) => placeholders[Number(index)] ?? '');
}
