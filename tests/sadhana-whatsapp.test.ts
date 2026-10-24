import assert from 'node:assert/strict';
import test from 'node:test';
import { sadhanaWhatsAppLink } from '../src/lib/sadhanaWhatsApp';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SadhanaDetailTable from '../src/components/guide/SadhanaDetailTable';

const member = { segment: 'FOLK', fullName: 'A & B', phone: '98765 43210', missingDates: ['2026-10-20'] };
const today = '2026-10-21';

test('WhatsApp composer normalizes an Indian number and encodes the member and missing dates', () => {
  const url = new URL(sadhanaWhatsAppLink(member, today)!);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/919876543210');
  assert.match(url.searchParams.get('text')!, /Hare Krishna, A & B Prabhu! 🙏/);
  assert.match(url.searchParams.get('text')!, /20 Oct 2026/);
});

test('FOLK individual reminder uses the approved devotional message', () => {
  const url = new URL(sadhanaWhatsAppLink(member, today)!);
  assert.equal(url.searchParams.get('text'), [
    'Hare Krishna, A & B Prabhu! 🙏',
    'Jay Srila Prabhupada',
    '',
    'Just a gentle reminder that your Sadhana entries for 20 Oct 2026 are still pending.',
    '',
    'Whenever you get a chance, kindly update them in the application while the submission window is open.',
    '',
    'Please feel free to let me know if you need any help. 😊',
    'Thank you, Prabhu!',
  ].join('\n'));
});

test('PW, unspecified departments, invalid phones and complete reports have no composer link', () => {
  for (const segment of ['PW', undefined, '']) assert.equal(sadhanaWhatsAppLink({ ...member, segment }, today), null);
  for (const phone of ['', null, '123', '0000000000']) assert.equal(sadhanaWhatsAppLink({ ...member, phone }, today), null);
  assert.equal(sadhanaWhatsAppLink({ ...member, missingDates: [] }, today), null);
});

test('missing dates exclude the future and invalid dates, are deduplicated, and preserve international numbers', () => {
  const url = new URL(sadhanaWhatsAppLink({ ...member, phone: '+44 7700 900123', missingDates: ['2026-10-22', '2026-10-20', '2026-10-20', '2026-02-30', 'invalid'] }, today)!);
  assert.equal(url.pathname, '/447700900123');
  const message = url.searchParams.get('text')!;
  assert.equal(message.match(/20 Oct 2026/g)?.length, 1);
  assert.doesNotMatch(message, /22 Oct|30 Feb|invalid/);
  assert.equal(sadhanaWhatsAppLink({ ...member, missingDates: ['2026-10-22'] }, today), null);
});

test('report table offers WhatsApp only for a missing FOLK entry, including non-residents', () => {
  const user = { ...member, userId: 'member-1', ashrayLevel: 'Sevak', isResident: false, submitted: false, fieldScores: {}, totalScore: null, scorePercent: null, flagSick: false, flagOs: false };
  const render = (reminderSegment: string | undefined, submitted = false) => renderToStaticMarkup(createElement(SadhanaDetailTable, {
    users: [{ ...user, submitted }], fieldDefs: [], reportDate: '2020-01-01', reminderSegment, showFolkColumn: false,
  }));
  assert.match(render('FOLK'), /https:\/\/wa.me\/919876543210/);
  assert.doesNotMatch(render('PW'), /wa.me/);
  assert.doesNotMatch(render(undefined), /wa.me/);
  assert.doesNotMatch(render('FOLK', true), /wa.me/);
});
