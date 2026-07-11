import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLONNES, lettreVersIndex, indexVersLettre, ZONES } from '../js/core/colonnes.js';
import { calculerPression } from '../js/core/regles.js';

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

// refListes = valeurs lues à l'import dans l'onglet Listes (jamais codées en dur dans regles.js)
const refListes = {
  equipements: [  // Listes!D2:D6, dans l'ordre
    'Robinet de coupure gaz, détendeur(s), compteur(s)',
    'Robinet de coupure gaz, détendeur(s)',
    'Robinet de coupure gaz, compteur(s)',
    'Robinet de coupure gaz seul',
    'Robinet de coupure gaz, détendeur(s), compteur(s) dépos(és) (improductif)',
  ],
  bagues: ['NON', 'PBDI', 'MBDI', 'DPBE', 'DPBA'],      // Listes!K2:K6
  pressions: ['MPB', 'BP', 'à renseigner'],              // Listes!L2:L4 (plage PRESSION)
};

test('formule V : détendeur présent → MPB', () => {
  assert.equal(calculerPression(refListes.equipements[0], '', refListes), 'MPB');
  assert.equal(calculerPression(refListes.equipements[1], 'NON', refListes), 'MPB');
});

test('formule V : robinet + compteur sans détendeur → BP', () => {
  assert.equal(calculerPression(refListes.equipements[2], 'DPBE', refListes), 'BP');
});

test('formule V : robinet seul ou improductif → selon bague', () => {
  for (const equip of [refListes.equipements[3], refListes.equipements[4]]) {
    for (const bague of ['PBDI', 'MBDI', 'DPBE', 'DPBA'])
      assert.equal(calculerPression(equip, bague, refListes), 'MPB');
    assert.equal(calculerPression(equip, 'NON', refListes), 'à renseigner');
    assert.equal(calculerPression(equip, '', refListes), 'à renseigner');
  }
});

test('formule V : accessoires vides ou inconnus → à renseigner', () => {
  assert.equal(calculerPression('', '', refListes), 'à renseigner');
  assert.equal(calculerPression('autre valeur', 'PBDI', refListes), 'à renseigner');
});
