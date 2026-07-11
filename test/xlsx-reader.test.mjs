import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from '../js/lib/zip.mjs';
import { buildFixture } from './fixture/build-fixture.mjs';
import { lireFichier } from '../js/core/xlsx-reader.js';

test('la fixture est un zip xlsx valide avec 3 feuilles', async () => {
  const octets = await buildFixture();
  const zip = await JSZip.loadAsync(octets);
  assert.ok(zip.file('xl/workbook.xml'));
  const wb = await zip.file('xl/workbook.xml').async('string');
  assert.match(wb, /Protection Branchements 2032/);
  assert.match(wb, /Listes/);
  assert.match(wb, /definedName name="PRESSION"/);
});

test('lecture des branchements de la fixture', async () => {
  const { dossier, branchements, erreurs } = await lireFichier(await buildFixture());
  assert.equal(erreurs.length, 0);
  assert.equal(branchements.length, 8);
  assert.equal(branchements[0].ligne, 4);
  assert.equal(branchements[0].valeursClient.commune, 'NEUILLY CRIMOLOIS');
  assert.equal(String(branchements[0].valeursClient.pce), '12200144633562');
  // ligne pré-identifiée : valeurs O..T présentes côté client
  assert.equal(branchements[3].valeursClient.identificationPb, 1);
  // V en dur détecté
  assert.equal(branchements[4].vEnDur, true);
  assert.equal(branchements[0].vEnDur, false);
});

test('extraction des listes et des références V', async () => {
  const { dossier } = await lireFichier(await buildFixture());
  assert.deepEqual(dossier.listes.bague, ['NON', 'PBDI', 'MBDI', 'DPBE', 'DPBA']);
  assert.deepEqual(dossier.listes.matiere, ['PE', 'Ac', 'Cu', 'Pb', 'Solacier', 'Métal']);
  assert.deepEqual(dossier.listes.diametreParMatiere.PE, ['20', '32', 'Autre']);
  assert.deepEqual(dossier.listes.typeReport.length, 4); // x14
  assert.deepEqual(dossier.refListes.pressions, ['MPB', 'BP', 'à renseigner']);
});

test('fichier invalide refusé proprement', async () => {
  const zip = new JSZip();
  zip.file('bonjour.txt', 'pas un xlsx');
  const octets = await zip.generateAsync({ type: 'uint8array' });
  const { erreurs } = await lireFichier(octets);
  assert.ok(erreurs.length > 0);
});

test('dernière ligne de données et zones ignorées absentes de valeursClient', async () => {
  const { dossier, branchements } = await lireFichier(await buildFixture());
  assert.equal(dossier.derniereLigneDonnees, 11);
  // ligne 4 : D4 = '4' (chaîne partagée, numero n'est pas dans CLES_NUMERIQUES)
  assert.equal(branchements[0].valeursClient.numero, '4');
  // ligne 5 (index 1) : D5 vide → pas de clé 'numero'
  assert.equal('numero' in branchements[1].valeursClient, false);
  // colonnes des zones ignorées jamais présentes, même quand la cellule a une valeur
  // (ex. AB porte une formule VLOOKUP sur toutes les lignes 4-20)
  for (const b of branchements) {
    assert.equal('idCoffret' in b.valeursClient, false); // L
    assert.equal('cabFictif' in b.valeursClient, false); // AB
    assert.equal('statutPb' in b.valeursClient, false); // AO
  }
});

test('phase terrain : valeurs distinctes triées des lignes de données', async () => {
  const { dossier } = await lireFichier(await buildFixture());
  assert.deepEqual(dossier.listes.phaseTerrain, [1]);
});

test('colonne V : valeur en dur lue, formule sans <v> absente de valeursClient', async () => {
  const { branchements } = await lireFichier(await buildFixture());
  // ligne 4 (index 0) : V porte une formule sans <v> mis en cache -> pas de clé 'pression'.
  assert.equal('pression' in branchements[0].valeursClient, false);
  // ligne 8 (index 4) : V en dur = 'MPB', lisible comme n'importe quelle valeur cliente.
  assert.equal(branchements[4].valeursClient.pression, 'MPB');
});

test('arrêt après 50 lignes vides consécutives : une donnée plus loin est ignorée', async () => {
  // La fixture ne contient que 9 lignes vides formatées (12-20). On en greffe assez
  // (via manipulation directe du zip, sans reconstruire tout build-fixture.mjs) pour
  // dépasser le seuil de 50 lignes vides consécutives, puis on place une ligne de
  // données bien au-delà : le lecteur ne doit jamais l'atteindre (comme les 24 600
  // lignes vides du vrai fichier, cf. §3.1 de la spec).
  const zip = await JSZip.loadAsync(await buildFixture());
  const cheminFeuille = 'xl/worksheets/sheet2.xml';
  const sheetXmlOriginal = await zip.file(cheminFeuille).async('string');

  let lignesVidesSupplementaires = '';
  for (let r = 21; r <= 80; r++) lignesVidesSupplementaires += `<row r="${r}"/>`;
  // Ligne de données largement après le seuil : ne doit jamais être scannée.
  const ligneResurgente = '<row r="200"><c r="A200"><v>99999</v></c></row>';

  const sheetXmlModifie = sheetXmlOriginal.replace(
    '</sheetData>',
    `${lignesVidesSupplementaires}${ligneResurgente}</sheetData>`
  );
  zip.file(cheminFeuille, sheetXmlModifie);
  const octetsModifies = await zip.generateAsync({ type: 'uint8array' });

  const { dossier, branchements, erreurs } = await lireFichier(octetsModifies);
  assert.equal(erreurs.length, 0);
  assert.equal(branchements.length, 8); // pas de 9e branchement pour la ligne 200
  assert.equal(dossier.derniereLigneDonnees, 11);
});
