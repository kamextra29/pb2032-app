import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLONNES, lettreVersIndex, indexVersLettre, ZONES } from '../js/core/colonnes.js';

test('carte des colonnes', () => {
  assert.equal(COLONNES.length, 41);
  assert.equal(COLONNES[0].lettre, 'A');
  assert.equal(COLONNES[21].lettre, 'V');
  assert.equal(COLONNES[40].lettre, 'AO');
  assert.equal(lettreVersIndex('AO'), 41);   // index 1-based Excel
  assert.equal(indexVersLettre(28), 'AB');
  assert.deepEqual(ZONES.ignorees, ['L','M','N','W','X','Y','Z','AA','AB','AC','AD','AO']);
  assert.ok(ZONES.infosClient.includes('A') && ZONES.infosClient.includes('K'));
  assert.ok(ZONES.identification.includes('O') && ZONES.identification.includes('AG'));
  assert.ok(ZONES.report.includes('AH') && ZONES.report.includes('AN'));
});
