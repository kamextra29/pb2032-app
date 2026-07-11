import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/core/store.js';

// Chaque test repart d'une base IndexedDB vierge : on ferme la connexion
// partagée du module (sinon deleteDatabase reste bloqué en attente) puis on
// supprime la base physique.
beforeEach(async () => {
  await store.fermer();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('pb2032');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

function dossierMinimal(extra = {}) {
  return {
    nom: 'test.xlsx',
    dateImport: '2026-07-11T00:00:00.000Z',
    blob: new Uint8Array([1, 2, 3]),
    listes: {},
    refListes: {},
    nomFeuillePb: 'Protection Branchements 2032',
    cheminFeuillePb: 'xl/worksheets/sheet2.xml',
    derniereLigneDonnees: 11,
    ...extra,
  };
}

test('ouvrir() est idempotent', async () => {
  await store.ouvrir();
  await store.ouvrir();
  await store.remplacerDossier(dossierMinimal(), []);
  const { dossier } = await store.chargerTout();
  assert.ok(dossier);
});

test('chargerTout() sur une base vide renvoie dossier null et branchements vides', async () => {
  const { dossier, branchements } = await store.chargerTout();
  assert.equal(dossier, null);
  assert.deepEqual(branchements, []);
});

test('remplacerDossier puis chargerTout restitue le dossier et les branchements (incl. blob binaire)', async () => {
  const dossier = dossierMinimal({
    blob: new Uint8Array([80, 75, 3, 4, 255, 0, 128]),
    listes: { bague: ['NON', 'PBDI'] },
    refListes: { pressions: ['MPB', 'BP', 'à renseigner'] },
  });
  const branchements = [
    { ligne: 4, valeursClient: { commune: 'NEUILLY CRIMOLOIS', pce: '12200144633562' }, saisies: {}, ajoute: false, vEnDur: false },
    { ligne: 5, valeursClient: { commune: 'NEUILLY CRIMOLOIS', pce: '12200144633563' }, saisies: {}, ajoute: false, vEnDur: false },
  ];

  await store.remplacerDossier(dossier, branchements);
  const charge = await store.chargerTout();

  assert.deepEqual(charge.dossier, dossier);
  assert.ok(charge.dossier.blob instanceof Uint8Array);
  assert.equal(charge.branchements.length, 2);
  assert.equal(charge.branchements[0].valeursClient.pce, '12200144633562');
  assert.ok(Number.isInteger(charge.branchements[0].id));
});

test('remplacerDossier remplace entierement le dossier et les branchements precedents', async () => {
  await store.remplacerDossier(dossierMinimal(), [
    { ligne: 4, valeursClient: { pce: 'ancien-1' }, saisies: {}, ajoute: false, vEnDur: false },
    { ligne: 5, valeursClient: { pce: 'ancien-2' }, saisies: {}, ajoute: false, vEnDur: false },
  ]);
  const premiers = await store.chargerTout();
  assert.equal(premiers.branchements.length, 2);

  await store.remplacerDossier(dossierMinimal({ nom: 'nouveau.xlsx' }), [
    { ligne: 4, valeursClient: { pce: 'nouveau-1' }, saisies: {}, ajoute: false, vEnDur: false },
  ]);
  const { dossier, branchements } = await store.chargerTout();

  assert.equal(dossier.nom, 'nouveau.xlsx');
  assert.equal(branchements.length, 1);
  assert.equal(branchements[0].valeursClient.pce, 'nouveau-1');
});

test('remplacerDossier efface aussi les photos existantes', async () => {
  await store.remplacerDossier(dossierMinimal(), []);
  const id1 = await store.ajouterBranchement({ valeursClient: {}, saisies: {}, ajoute: true });
  await store.ajouterPhoto({ branchementId: id1, blob: new Uint8Array([1]), index: 1, date: 'd', nom: '1.jpg' });

  await store.remplacerDossier(dossierMinimal(), []);

  assert.deepEqual(await store.photosDe(id1), []);
});

test('remplacerApresFusion se comporte comme remplacerDossier (alias partage)', async () => {
  await store.remplacerDossier(dossierMinimal(), [
    { ligne: 4, valeursClient: { pce: 'a' }, saisies: {}, ajoute: false, vEnDur: false },
  ]);
  await store.remplacerApresFusion(dossierMinimal({ nom: 'fusion.xlsx' }), [
    { ligne: 4, valeursClient: { pce: 'b' }, saisies: {}, ajoute: false, vEnDur: false },
  ]);
  const { dossier, branchements } = await store.chargerTout();

  assert.equal(dossier.nom, 'fusion.xlsx');
  assert.equal(branchements.length, 1);
  assert.equal(branchements[0].valeursClient.pce, 'b');
});

test('majSaisies remplace entierement les saisies et met a jour dateModification', async () => {
  await store.remplacerDossier(dossierMinimal(), [
    { ligne: 4, valeursClient: { pce: 'x' }, saisies: { constatCoffret: 'ancien' }, ajoute: false, vEnDur: false },
  ]);
  const { branchements } = await store.chargerTout();
  const id = branchements[0].id;
  const avant = Date.now();

  await store.majSaisies(id, { constatCoffret: 'Bien positionné (< 10cm)' });

  const { branchements: apres } = await store.chargerTout();
  const maj = apres.find((b) => b.id === id);
  assert.deepEqual(maj.saisies, { constatCoffret: 'Bien positionné (< 10cm)' });
  assert.ok(maj.dateModification);
  assert.ok(!Number.isNaN(Date.parse(maj.dateModification)));
  assert.ok(Date.parse(maj.dateModification) >= avant);
});

test('ajouterBranchement puis supprimerAjout retire le branchement et ses photos', async () => {
  await store.remplacerDossier(dossierMinimal(), []);
  const idAjout = await store.ajouterBranchement({
    valeursClient: {}, saisies: { commune: 'X', rue: 'Y', numero: '1' }, ajoute: true, ajoutId: 1,
  });
  await store.ajouterPhoto({ branchementId: idAjout, blob: new Uint8Array([1]), index: 1, date: 'd', nom: 'a.jpg' });

  await store.supprimerAjout(idAjout);

  const { branchements } = await store.chargerTout();
  assert.equal(branchements.find((b) => b.id === idAjout), undefined);
  assert.deepEqual(await store.photosDe(idAjout), []);
});

test('supprimerAjout refuse de supprimer un branchement du fichier client', async () => {
  await store.remplacerDossier(dossierMinimal(), [
    { ligne: 4, valeursClient: { pce: 'x' }, saisies: {}, ajoute: false, vEnDur: false },
  ]);
  const { branchements } = await store.chargerTout();
  const id = branchements[0].id;

  await assert.rejects(() => store.supprimerAjout(id), /branchement ajouté/i);
});

test('supprimerAjout ne supprime que les photos du branchement ajoute concerne', async () => {
  await store.remplacerDossier(dossierMinimal(), []);
  const id1 = await store.ajouterBranchement({ valeursClient: {}, saisies: {}, ajoute: true, ajoutId: 1 });
  const id2 = await store.ajouterBranchement({ valeursClient: {}, saisies: {}, ajoute: true, ajoutId: 2 });
  await store.ajouterPhoto({ branchementId: id1, blob: new Uint8Array([1]), index: 1, date: 'd', nom: 'a.jpg' });
  await store.ajouterPhoto({ branchementId: id2, blob: new Uint8Array([2]), index: 1, date: 'd', nom: 'b.jpg' });

  await store.supprimerAjout(id1);

  assert.deepEqual(await store.photosDe(id1), []);
  const photosId2 = await store.photosDe(id2);
  assert.equal(photosId2.length, 1);
  assert.equal(photosId2[0].nom, 'b.jpg');
});

test('photosDe renvoie uniquement les photos du branchement demande', async () => {
  await store.remplacerDossier(dossierMinimal(), []);
  const id1 = await store.ajouterBranchement({ valeursClient: {}, saisies: {}, ajoute: true });
  const id2 = await store.ajouterBranchement({ valeursClient: {}, saisies: {}, ajoute: true });
  await store.ajouterPhoto({ branchementId: id1, blob: new Uint8Array([1]), index: 1, date: 'd', nom: '1.jpg' });
  await store.ajouterPhoto({ branchementId: id1, blob: new Uint8Array([2]), index: 2, date: 'd', nom: '2.jpg' });
  await store.ajouterPhoto({ branchementId: id2, blob: new Uint8Array([3]), index: 1, date: 'd', nom: '3.jpg' });

  const photos1 = await store.photosDe(id1);
  assert.equal(photos1.length, 2);
  assert.ok(photos1.every((p) => p.branchementId === id1));
});

test('supprimerPhoto retire une photo precise', async () => {
  await store.remplacerDossier(dossierMinimal(), []);
  const id1 = await store.ajouterBranchement({ valeursClient: {}, saisies: {}, ajoute: true });
  const photoId = await store.ajouterPhoto({ branchementId: id1, blob: new Uint8Array([1]), index: 1, date: 'd', nom: '1.jpg' });

  await store.supprimerPhoto(photoId);

  assert.deepEqual(await store.photosDe(id1), []);
});

test('parametres : ecriture puis lecture', async () => {
  assert.equal(await store.lireParametre('phaseCourante'), undefined);
  await store.ecrireParametre('phaseCourante', 2);
  assert.equal(await store.lireParametre('phaseCourante'), 2);
  await store.ecrireParametre('phaseCourante', 3);
  assert.equal(await store.lireParametre('phaseCourante'), 3);
});

test('une erreur de transaction rejette avec la vraie erreur, jamais null', async () => {
  // Deux ajouts avec la même clé explicite dans la même transaction →
  // ConstraintError sur le second. Le rejet doit porter cette erreur
  // (et non null : tx.error n'est renseigné qu'au moment de l'abort).
  await store.remplacerDossier(dossierMinimal(), []);
  await assert.rejects(
    () => store.remplacerDossier(dossierMinimal(), [
      { id: 1, ligne: 4, valeursClient: {}, saisies: {}, ajoute: false, vEnDur: false },
      { id: 1, ligne: 5, valeursClient: {}, saisies: {}, ajoute: false, vEnDur: false },
    ]),
    (e) => e != null && e.name === 'ConstraintError',
  );
});

test('remplacerDossier avec un branchement non clonable : rejet français ET données précédentes intactes', async () => {
  await store.remplacerDossier(dossierMinimal({ nom: 'avant.xlsx' }), [
    { ligne: 4, valeursClient: { pce: 'garde' }, saisies: {}, ajoute: false, vEnDur: false },
  ]);

  // Une fonction n'est pas clonable par IndexedDB : add() jette en synchrone
  // au milieu de la boucle, après les clear() déjà mis en file. Sans abort
  // explicite, la base resterait à moitié écrasée.
  await assert.rejects(
    () => store.remplacerDossier(dossierMinimal({ nom: 'apres.xlsx' }), [
      { ligne: 4, valeursClient: {}, saisies: {}, ajoute: false, vEnDur: false, casse: () => {} },
    ]),
    /rien n'a été modifié/,
  );

  const { dossier, branchements } = await store.chargerTout();
  assert.equal(dossier.nom, 'avant.xlsx');
  assert.equal(branchements.length, 1);
  assert.equal(branchements[0].valeursClient.pce, 'garde');
});

test('estimerStockage() renvoie null quand navigator.storage est absent (Node)', async () => {
  assert.equal(await store.estimerStockage(), null);
});

test('fermer() peut etre appele meme sans connexion ouverte', async () => {
  await store.fermer();
  await store.fermer();
});
