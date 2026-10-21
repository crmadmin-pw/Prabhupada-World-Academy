import assert from 'node:assert/strict';
import test from 'node:test';
import { splitStoredPhone } from '../src/lib/phoneNormalize';

const COUNTRY_CODES = ['+91', '+1', '+44', '+971', '+65', '+61', '+60', '+94', '+977', '+880'];

test('stored Australian numbers keep country code 61 on the BV form', () => {
  assert.deepEqual(splitStoredPhone('61412345678', COUNTRY_CODES), { cc: '+61', num: '412345678' });
  assert.deepEqual(splitStoredPhone('+61412345678', COUNTRY_CODES), { cc: '+61', num: '412345678' });
  assert.deepEqual(splitStoredPhone('+61 412 345 678', COUNTRY_CODES), { cc: '+61', num: '412345678' });
});

test('Indian numbers still split on 91, including a bare 10-digit mobile', () => {
  assert.deepEqual(splitStoredPhone('919876543210', COUNTRY_CODES), { cc: '+91', num: '9876543210' });
  assert.deepEqual(splitStoredPhone('+919876543210', COUNTRY_CODES), { cc: '+91', num: '9876543210' });
  assert.deepEqual(splitStoredPhone('9876543210', COUNTRY_CODES), { cc: '+91', num: '9876543210' });
  assert.deepEqual(splitStoredPhone('6123456789', COUNTRY_CODES), { cc: '+91', num: '6123456789' });
});

test('the calling code saved at account creation is kept on the BV form', () => {
  assert.deepEqual(splitStoredPhone('0412345678', COUNTRY_CODES, '+91', '+61'), { cc: '+61', num: '0412345678' });
  assert.deepEqual(splitStoredPhone('610412345678', COUNTRY_CODES, '+91', '+61'), { cc: '+61', num: '0412345678' });
  assert.deepEqual(splitStoredPhone('412345678', COUNTRY_CODES, '+91', '+61'), { cc: '+61', num: '412345678' });
  assert.deepEqual(splitStoredPhone('6123456789', COUNTRY_CODES, '+91', '+61'), { cc: '+61', num: '23456789' });
});

test('an Australian national mobile is not relabeled as India when the calling code was not stored', () => {
  assert.deepEqual(splitStoredPhone('0412345678', COUNTRY_CODES), { cc: '+61', num: '0412345678' });
  assert.deepEqual(splitStoredPhone('412345678', COUNTRY_CODES), { cc: '+61', num: '412345678' });
});
