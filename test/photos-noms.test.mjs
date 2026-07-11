import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomPhoto } from '../js/core/photos-noms.js';

test('nommage nominal', () => {
  assert.equal(nomPhoto({ numero: '4', rue: 'Rue des Genêts', pce: '12200144633562' }, 1),
    '4_RUE-DES-GENETS_12200144633562_1.jpg');
});

test('cas particuliers', () => {
  // sans n° de rue → SN
  assert.equal(nomPhoto({ numero: '', rue: 'Rue de la Gentiane', pce: '999' }, 2),
    'SN_RUE-DE-LA-GENTIANE_999_2.jpg');
  // sans PCE, ligne client 937 → L0937
  assert.equal(nomPhoto({ numero: '4B', rue: 'X', pce: '', ligne: 937 }, 1), '4B_X_L0937_1.jpg');
  // branchement ajouté sans PCE, id d'ajout 1 → A0001
  assert.equal(nomPhoto({ numero: '2', rue: 'X', pce: '', ajoutId: 1 }, 1), '2_X_A0001_1.jpg');
  // caractères interdits et apostrophes retirés, espaces multiples réduits
  assert.equal(nomPhoto({ numero: '3', rue: "Impasse de l'Église / Nord", pce: '1' }, 1),
    '3_IMPASSE-DE-L-EGLISE-NORD_1_1.jpg');
});

test('entrées numériques (valeurs brutes Excel)', () => {
  assert.equal(nomPhoto({ numero: 4, rue: 'X', pce: 12200144633562 }, 1), '4_X_12200144633562_1.jpg');
});

test('aucun identifiant → erreur explicite', () => {
  assert.throws(() => nomPhoto({ numero: '4', rue: 'X', pce: '' }, 1), /ni PCE/);
});
