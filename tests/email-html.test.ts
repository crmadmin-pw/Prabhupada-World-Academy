import assert from 'node:assert/strict';
import test from 'node:test';

import { Email } from '../src/lib/app-backend-sdk';

test('email HTML escapes typed names and notes and keeps template formatting', async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
  };
  try {
    await Email.send({
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
  } finally {
    console.log = original;
  }

  const logged = lines.join('\n');
  assert.match(logged, /&lt;img src=x/);
  assert.match(logged, /<strong>A\. C\. Bhaktivedanta<\/strong>/);
  assert.match(logged, /&lt;b&gt;sharp&lt;\/b&gt;/);
  assert.match(logged, /&lt;b&gt;Review&lt;\/b&gt;/);
  assert.match(logged, /\/guide\/dashboard/);
  assert.equal(logged.includes('<script'), false);
  assert.equal(logged.includes('javascript:'), false);
  assert.equal(logged.includes('onerror'), false);
  assert.equal(/\r|\nBcc:/.test(logged), false);
});
