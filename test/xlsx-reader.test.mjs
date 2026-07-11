import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from '../js/lib/zip.mjs';
import { buildFixture } from './fixture/build-fixture.mjs';

test('la fixture est un zip xlsx valide avec 3 feuilles', async () => {
  const octets = await buildFixture();
  const zip = await JSZip.loadAsync(octets);
  assert.ok(zip.file('xl/workbook.xml'));
  const wb = await zip.file('xl/workbook.xml').async('string');
  assert.match(wb, /Protection Branchements 2032/);
  assert.match(wb, /Listes/);
  assert.match(wb, /definedName name="PRESSION"/);
});
