import nodemailer, { type Transporter } from 'nodemailer';
import { escapeEmailHtml, escapeHtml } from './sanitize';

type MailPart = {
  type?: string;
  content?: string;
  label?: string;
  href?: string;
  alignment?: string;
};

export type PreparedEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function envValue(names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function safeMailHeader(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function safeMailHref(value: unknown): string {
  const href = String(value ?? '').trim();
  if (/[\r\n\0]/.test(href)) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/[A-Za-z0-9]/.test(href)) return href;
  return '';
}

function sanitizeMailLabel(label: string): string {
  return label.replace(/[\r\n\0]/g, ' ');
}

function safeMailBody(body: unknown): MailPart[] {
  if (!Array.isArray(body)) return [];
  return body.map(part => {
    if (!part || typeof part !== 'object') return {};
    const next = { ...(part as MailPart) };
    if (typeof next.content === 'string') next.content = escapeEmailHtml(next.content);
    if (typeof next.label === 'string') next.label = escapeHtml(sanitizeMailLabel(next.label));
    if (typeof next.href === 'string') next.href = safeMailHref(next.href);
    return next;
  });
}

function buttonAlignment(value: unknown): 'left' | 'center' | 'right' {
  return value === 'center' || value === 'right' ? value : 'left';
}

function absoluteHref(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  const base = envValue(['APP_APP_URL', 'ZITE_APP_URL']).replace(/\/$/, '');
  return base && href.startsWith('/') ? `${base}${href}` : href;
}

function visibleText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?strong>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Sanitized message that can be handed to an SMTP server. */
export function prepareOutboundEmail(params: { to: string; subject: string; body: unknown }): PreparedEmail {
  const to = safeMailHeader(params.to);
  const subject = safeMailHeader(params.subject);
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (const part of safeMailBody(params.body)) {
    if (part.type === 'divider') {
      htmlParts.push('<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>');
      textParts.push('---');
      continue;
    }
    if (part.type === 'button') {
      const href = absoluteHref(part.href || '');
      const label = part.label || '';
      if (!label) continue;
      if (!href) {
        htmlParts.push(`<p>${label}</p>`);
        textParts.push(visibleText(label));
        continue;
      }
      const align = buttonAlignment(part.alignment);
      htmlParts.push(`<p style="text-align:${align}"><a href="${escapeHtml(href)}">${label}</a></p>`);
      textParts.push(`${visibleText(label)}: ${href}`);
      continue;
    }
    if (!part.content) continue;
    htmlParts.push(`<p>${part.content.replace(/\n/g, '<br/>')}</p>`);
    textParts.push(visibleText(part.content));
  }

  return {
    to,
    subject,
    html: `<!DOCTYPE html><html><body>${htmlParts.join('')}</body></html>`,
    text: textParts.join('\n\n'),
  };
}

function smtpConfig() {
  const host = envValue(['APP_SMTP_HOST', 'ZITE_SMTP_HOST', 'SMTP_HOST']);
  const port = Number(envValue(['APP_SMTP_PORT', 'ZITE_SMTP_PORT', 'SMTP_PORT']) || '587');
  const user = envValue(['APP_SMTP_USER', 'ZITE_SMTP_USER', 'SMTP_USER']);
  const pass = envValue(['APP_SMTP_PASSWORD', 'ZITE_SMTP_PASSWORD', 'SMTP_PASSWORD', 'SMTP_PASS']);
  const from = safeMailHeader(envValue(['APP_SMTP_FROM', 'ZITE_SMTP_FROM', 'SMTP_FROM']) || user);
  if (!host || !from || !Number.isInteger(port) || port <= 0) return null;
  if (!user || !pass) return null;
  return { host, port, user, pass, from, secure: port === 465 };
}

type SmtpConfig = NonNullable<ReturnType<typeof smtpConfig>>;

function smtpTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/**
 * Hand the message to SMTP. Throws when mail is not configured or the server
 * rejects it, so callers cannot count an undelivered message as sent.
 */
export async function deliverEmail(params: { to: string; subject: string; body: unknown }): Promise<{ success: true }> {
  const message = prepareOutboundEmail(params);
  if (!message.to.includes('@')) throw new Error('Email recipient is missing');
  if (!message.subject) throw new Error('Email subject is missing');

  const config = smtpConfig();
  if (!config) throw new Error('Email delivery is not configured');

  const transport = smtpTransport(config);

  try {
    await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the mail server rejected the message';
    throw new Error(`Email delivery failed: ${reason}`);
  }

  return { success: true };
}
