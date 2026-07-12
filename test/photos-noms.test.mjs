import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomPhoto, construireEntreesZip } from '../js/core/photos-noms.js';

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
  // numéro 0 (placeholder GRDF) → '0', pas 'SN'
  assert.equal(nomPhoto({ numero: 0, rue: 'X', pce: '1' }, 1), '0_X_1_1.jpg');
});

test('aucun identifiant → erreur explicite', () => {
  assert.throws(() => nomPhoto({ numero: '4', rue: 'X', pce: '' }, 1), /ni PCE/);
});

// ---------------------------------------------------------------------------
// construireEntreesZip (Task 17, §8) : entrées de l'export ZIP photos.
// ---------------------------------------------------------------------------

function branchement(id, valeursClient, extra = {}) {
  return { id, ligne: id + 100, valeursClient, saisies: {}, ajoute: false, vEnDur: false, ...extra };
}

test('construireEntreesZip : nommage sur les valeurs effectives (corrections comprises)', () => {
  const b = branchement(1, { numero: '4', rue: 'Rue des Genêts', pce: '999' }, {
    saisies: { numero: '4B' }, // correction terrain : le nom doit refléter '4B', pas '4'
  });
  const photos = new Map([[1, [{ id: 10, index: 1, blob: 'x' }]]]);

  const entrees = construireEntreesZip([b], photos);

  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].nom, '4B_RUE-DES-GENETS_999_1.jpg');
  assert.equal(entrees[0].photo.id, 10);
});

test('construireEntreesZip : un branchement sans photo ne produit aucune entrée', () => {
  const b1 = branchement(1, { numero: '4', rue: 'X', pce: '1' });
  const b2 = branchement(2, { numero: '5', rue: 'X', pce: '2' });
  const photos = new Map([[1, [{ id: 10, index: 1, blob: 'x' }]]]); // rien pour b2

  const entrees = construireEntreesZip([b1, b2], photos);

  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].photo.id, 10);
});

test('construireEntreesZip : plusieurs photos d’un même branchement, triées par index', () => {
  const b = branchement(1, { numero: '4', rue: 'X', pce: '1' });
  const photos = new Map([[1, [
    { id: 20, index: 2, blob: 'x' },
    { id: 10, index: 1, blob: 'x' },
  ]]]);

  const entrees = construireEntreesZip([b], photos);

  assert.deepEqual(entrees.map((e) => e.nom), ['4_X_1_1.jpg', '4_X_1_2.jpg']);
  assert.deepEqual(entrees.map((e) => e.photo.id), [10, 20]);
});

test('construireEntreesZip : dédoublonnage défensif des noms identiques', () => {
  // Deux branchements distincts qui produisent, par coïncidence (données
  // client surprenantes), exactement le même nom de fichier.
  const b1 = branchement(1, { numero: '4', rue: 'X', pce: '1' });
  const b2 = branchement(2, { numero: '4', rue: 'X', pce: '1' });
  const photos = new Map([
    [1, [{ id: 10, index: 1, blob: 'x' }]],
    [2, [{ id: 11, index: 1, blob: 'x' }]],
  ]);

  const entrees = construireEntreesZip([b1, b2], photos);

  assert.deepEqual(entrees.map((e) => e.nom), ['4_X_1_1.jpg', '4_X_1_1-2.jpg']);
});

test('construireEntreesZip : filtre par commune (normalisé, accents/casse tolérés)', () => {
  const b1 = branchement(1, { commune: 'Neuilly Crimolois', numero: '4', rue: 'X', pce: '1' });
  const b2 = branchement(2, { commune: "Neuilly-lès-Dijon", numero: '5', rue: 'X', pce: '2' });
  const photos = new Map([
    [1, [{ id: 10, index: 1, blob: 'x' }]],
    [2, [{ id: 11, index: 1, blob: 'x' }]],
  ]);

  const entrees = construireEntreesZip([b1, b2], photos, { commune: 'NEUILLY CRIMOLOIS' });

  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].photo.id, 10);
});

test('construireEntreesZip : filtre par rue et par phase terrain', () => {
  const b1 = branchement(1, { rue: 'Rue des Genêts', numero: '4', pce: '1', phaseTerrain: '1' });
  const b2 = branchement(2, { rue: 'Rue de la Gentiane', numero: '5', pce: '2', phaseTerrain: '2' });
  const photos = new Map([
    [1, [{ id: 10, index: 1, blob: 'x' }]],
    [2, [{ id: 11, index: 1, blob: 'x' }]],
  ]);

  const parRue = construireEntreesZip([b1, b2], photos, { rue: 'rue des genets' });
  assert.deepEqual(parRue.map((e) => e.photo.id), [10]);

  const parPhase = construireEntreesZip([b1, b2], photos, { phase: '2' });
  assert.deepEqual(parPhase.map((e) => e.photo.id), [11]);
});

test('construireEntreesZip : filtre absent ou vide = tout le dossier', () => {
  const b1 = branchement(1, { numero: '4', rue: 'X', pce: '1' });
  const b2 = branchement(2, { numero: '5', rue: 'Y', pce: '2' });
  const photos = new Map([
    [1, [{ id: 10, index: 1, blob: 'x' }]],
    [2, [{ id: 11, index: 1, blob: 'x' }]],
  ]);

  assert.equal(construireEntreesZip([b1, b2], photos).length, 2);
  assert.equal(construireEntreesZip([b1, b2], photos, {}).length, 2);
});
