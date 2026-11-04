import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { createExcelBlob } from '../src/utils/exportExcel';

test('Excel workbook preserves numeric values, text identifiers and literal formulas', async () => {
  const blob = await createExcelBlob([
    { name: 'Report', headers: ['Name', 'Identifier', 'Score', 'Missing'], rows: [
      ['=HYPERLINK("https://example.invalid")', '00123', 67, null],
      ['नाम & <member>', '00001', 0, undefined],
    ] },
    { name: 'Report Details', headers: ['Setting', 'Value'], rows: [['Start date', '2026-11-02']] },
  ]);
  assert.match(blob.type, /spreadsheetml/);
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const sheet = strFromU8(entries['xl/worksheets/sheet1.xml']);
  const strings = strFromU8(entries['xl/sharedStrings.xml']);
  assert.match(sheet, /<c[^>]*r="C2"[^>]*>\s*<v>67<\/v>/);
  assert.match(sheet, /<c[^>]*r="C3"[^>]*>\s*<v>0<\/v>/);
  assert.doesNotMatch(sheet, /<f[ >]/);
  assert.match(strings, /00123/);
  assert.match(strings, /HYPERLINK/);
  assert.match(strings, /नाम &amp; &lt;member&gt;/);
  assert.match(strFromU8(entries['xl/workbook.xml']), /Report Details/);
  assert.match(strFromU8(entries['xl/worksheets/sheet2.xml']), /<sheetData>/);
});
