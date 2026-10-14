import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';

import { Email } from '../src/lib/app-backend-sdk';
import { prepareOutboundEmail } from '../src/lib/mailer';

const SMTP_KEYS = [
  'APP_SMTP_HOST', 'ZITE_SMTP_HOST', 'SMTP_HOST',
  'APP_SMTP_PORT', 'ZITE_SMTP_PORT', 'SMTP_PORT',
  'APP_SMTP_USER', 'ZITE_SMTP_USER', 'SMTP_USER',
  'APP_SMTP_PASSWORD', 'ZITE_SMTP_PASSWORD', 'SMTP_PASSWORD', 'SMTP_PASS',
  'APP_SMTP_FROM', 'ZITE_SMTP_FROM', 'SMTP_FROM',
  'APP_APP_URL', 'ZITE_APP_URL',
] as const;

function isolateSmtpEnv() {
  const previous = new Map<string, string | undefined>();
  for (const key of SMTP_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('email HTML escapes typed names and notes and keeps template formatting', () => {
  const restore = isolateSmtpEnv();
  try {
  const message = prepareOutboundEmail({
    to: 'guide@example.test',
    subject: 'Approval\r\nBcc: attacker@example.test',
    body: [
      {
        type: 'text',
        content: `Hare Krishna, <img src=x onerror="alert(1)">!\n\nYour guide — <strong><script>alert(1)</script>A. C. Bhaktivedanta</strong> — wrote: ${'Meet at 5 <b>sharp</b>'}.`,
      },
      { type: 'button', label: '<b>Review</b>', href: 'javascript:alert(1)' },
      { type: 'button', label: 'Open', href: '/guide/dashboard' },
    ],
  });

  const rendered = `${message.subject}\n${message.html}\n${message.text}`;
  assert.match(rendered, /&lt;img src=x/);
  assert.match(rendered, /<strong>A\. C\. Bhaktivedanta<\/strong>/);
  assert.match(rendered, /&lt;b&gt;sharp&lt;\/b&gt;/);
  assert.match(rendered, /&lt;b&gt;Review&lt;\/b&gt;/);
  assert.match(rendered, /\/guide\/dashboard/);
  assert.equal(rendered.includes('<script'), false);
  assert.equal(rendered.includes('javascript:'), false);
  assert.equal(rendered.includes('onerror'), false);
  assert.equal(/\r|\nBcc:/.test(rendered), false);
  } finally {
    restore();
  }
});

test('email send delivers through SMTP and does not report success when delivery fails', async t => {
  const restore = isolateSmtpEnv();
  try {
    await assert.rejects(
      Email.send({ to: 'guide@example.test', subject: 'Hello', body: [{ type: 'text', content: 'Hare Krishna' }] }),
      /Email delivery is not configured/,
    );

    process.env.APP_SMTP_HOST = 'smtp.example.test';
    process.env.APP_SMTP_PORT = '587';
    process.env.APP_SMTP_USER = 'mailer@example.test';
    process.env.APP_SMTP_PASSWORD = 'secret';
    process.env.APP_SMTP_FROM = 'Prabhupada World Academy <mailer@example.test>';

    const sent: Array<{ from?: string; to?: string; subject?: string; html?: string }> = [];
    t.mock.method(nodemailer, 'createTransport', () => ({
      sendMail: async (message: { from?: string; to?: string; subject?: string; html?: string }) => {
        sent.push(message);
        return { messageId: 'queued' };
      },
    }));

    const result = await Email.send({
      to: 'guide@example.test',
      subject: 'Registration received',
      body: [{ type: 'text', content: 'Hare Krishna, <b>Prabhu</b>' }],
    });
    assert.equal(result.success, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].from, 'Prabhupada World Academy <mailer@example.test>');
    assert.equal(sent[0].to, 'guide@example.test');
    assert.equal(sent[0].subject, 'Registration received');
    assert.match(sent[0].html || '', /Hare Krishna/);
    assert.match(sent[0].html || '', /&lt;b&gt;Prabhu&lt;\/b&gt;/);

    t.mock.method(nodemailer, 'createTransport', () => ({
      sendMail: async () => {
        throw new Error('535 authentication failed');
      },
    }));
    await assert.rejects(
      Email.send({ to: 'guide@example.test', subject: 'Hello', body: [{ type: 'text', content: 'Hare Krishna' }] }),
      /Email delivery failed/,
    );
  } finally {
    restore();
  }
});
