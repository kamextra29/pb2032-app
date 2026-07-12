/**
 * Tests du writer chirurgical (Task 9) : le fichier exporté est le fichier
 * client original dans lequel SEULES les valeurs saisies sont injectées —
 * tout le reste (formules V/AB, styles, zones ignorées) est préservé.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from '../js/lib/zip.mjs';
import { buildFixture } from './fixture/build-fixture.mjs';
import { lireFichier } from '../js/core/xlsx-reader.js';
import { exporterFichier } from '../js/core/xlsx-writer.js';

const CHEMIN_PB = 'xl/worksheets/sheet2.xml';

// ---------------------------------------------------------------------------
// Aides.
// ---------------------------------------------------------------------------

/** Contenu texte d'une entrée d'un zip .xlsx. */
async function fichierZip(octets, chemin) {
  const zip = await JSZip.loadAsync(octets);
  const entree = zip.file(chemin);
  return entree ? entree.async('string') : null;
}

/** XML de la feuille PB de la fixture. */
function feuillePb(octets) {
  return fichierZip(octets, CHEMIN_PB);
}

/**
 * Bloc complet `<c r="ref" .../>` ou `<c r="ref" ...>...</c>` d'une cellule.
 * Extraction par positions (une regex avec alternative auto-fermante/appariée
 * déborderait sur la cellule suivante par backtracking).
 */
function extraireCellule(xml, ref) {
  const debut = xml.indexOf(`<c r="${ref}"`);
  if (debut === -1) return null;
  const finOuvrante = xml.indexOf('>', debut);
  if (xml[finOuvrante - 1] === '/') return xml.slice(debut, finOuvrante + 1);
  return xml.slice(debut, xml.indexOf('</c>', finOuvrante) + '</c>'.length);
}

/** Bloc complet `<row r="n" ...>...</row>` d'une ligne. */
function extraireLigne(xml, numero) {
  const debut = xml.indexOf(`<row r="${numero}"`);
  if (debut === -1) return null;
  const finOuvrante = xml.indexOf('>', debut);
  if (xml[finOuvrante - 1] === '/') return xml.slice(debut, finOuvrante + 1);
  return xml.slice(debut, xml.indexOf('</row>', finOuvrante) + '</row>'.length);
}

/** Lit la fixture et normalise les branchements (saisies vides par défaut). */
async function chargerFixture(octets) {
  const { dossier, branchements, erreurs } = await lireFichier(octets);
  assert.equal(erreurs.length, 0);
  return { dossier, branchements: branchements.map(b => ({ ...b, saisies: {} })) };
}

/** Recopie la fixture avec une entrée transformée (pour fabriquer des cas limites). */
async function modifierEntree(octets, chemin, transformer) {
  const zip = await JSZip.loadAsync(octets);
  const contenu = await zip.file(chemin).async('string');
  zip.file(chemin, transformer(contenu));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------------------
// 1. Aucune saisie : rien ne change.
// ---------------------------------------------------------------------------

test('export sans aucune saisie = feuille strictement identique', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await chargerFixture(original);

  const exporte = await exporterFichier(original, branchements, dossier);

  assert.equal(await feuillePb(exporte), await feuillePb(original));
  // La fixture a déjà fullCalcOnLoad="1" : workbook.xml ne gagne rien d'autre.
  assert.equal(await fichierZip(exporte, 'xl/workbook.xml'), await fichierZip(original, 'xl/workbook.xml'));
  assert.match(await fichierZip(exporte, 'xl/workbook.xml'), /fullCalcOnLoad="1"/);
});

test('branchements sans champ saisies du tout : tolérés, rien ne change', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await lireFichier(original); // sans saisies
  const exporte = await exporterFichier(original, branchements, dossier);
  assert.equal(await feuillePb(exporte), await feuillePb(original));
});

// ---------------------------------------------------------------------------
// 2-4. Réécriture d'une cellule : texte, nombre, échappement.
// ---------------------------------------------------------------------------

test('une saisie texte ne change que sa cellule', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await chargerFixture(original);
  const b = { ...branchements[0], saisies: { constatCoffret: 'Bien positionné (< 10cm)' } };

  const xml = await feuillePb(await exporterFichier(original, [b], dossier));
  const xmlOriginal = await feuillePb(original);

  assert.match(xml, /<c r="O4"[^>]*t="inlineStr"><is><t[^>]*>Bien positionné \(&lt; 10cm\)<\/t><\/is><\/c>/);
  // s= de la cellule d'origine conservé (O4 = style identification).
  assert.match(extraireCellule(xml, 'O4'), /s="10"/);
  // Le reste du bloc row 4 est inchangé (comparaison hors cellule O4).
  const ligne4Avant = extraireLigne(xmlOriginal, 4).replace(extraireCellule(xmlOriginal, 'O4'), '');
  const ligne4Apres = extraireLigne(xml, 4).replace(extraireCellule(xml, 'O4'), '');
  assert.equal(ligne4Apres, ligne4Avant);
  // Et les autres lignes sont strictement identiques.
  for (const n of [5, 6, 7, 8, 9, 10, 11, 12, 20]) {
    assert.equal(extraireLigne(xml, n), extraireLigne(xmlOriginal, n));
  }
});

test('AG numérique, style conservé', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await chargerFixture(original);
  const b = { ...branchements[0], saisies: { identificationPb: 1 } };

  const xml = await feuillePb(await exporterFichier(original, [b], dossier));
  assert.match(xml, /<c r="AG4" s="\d+"><v>1<\/v><\/c>/);
});

test('échappement XML', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await chargerFixture(original);
  const b = { ...branchements[0], saisies: { commentaireIdent: 'coffret < mur & portail' } };

  const xml = await feuillePb(await exporterFichier(original, [b], dossier));
  assert.match(xml, /coffret &lt; mur &amp; portail/);
  assert.doesNotMatch(xml, /coffret < mur & portail/);
});

// ---------------------------------------------------------------------------
// 5-6. Colonne V : exception « V en dur », formules intouchables partout ailleurs.
// ---------------------------------------------------------------------------

test('exception V : ligne V-en-dur avec S modifiée → V réécrite', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await chargerFixture(original);
  // branchements[4] = ligne 8, la seule ligne V-en-dur de la fixture.
  assert.equal(branchements[4].vEnDur, true);
  const b = { ...branchements[4], saisies: { accessoires: dossier.refListes.equipements[2] } }; // → BP

  const xml = await feuillePb(await exporterFichier(original, [b], dossier));
  assert.match(xml, /<c r="V8"[^>]*t="inlineStr"><is><t[^>]*>BP<\/t><\/is><\/c>/);
});

test('contre-exemple V : ligne à formule V avec S modifiée → formule intacte', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await chargerFixture(original);
  assert.equal(branchements[0].vEnDur, false);
  const b = { ...branchements[0], saisies: { accessoires: dossier.refListes.equipements[2] } };

  const xml = await feuillePb(await exporterFichier(original, [b], dossier));
  const xmlOriginal = await feuillePb(original);
  // S4 réécrite, V4 (formule) strictement identique à l'original.
  assert.match(extraireCellule(xml, 'S4'), /t="inlineStr"/);
  assert.equal(extraireCellule(xml, 'V4'), extraireCellule(xmlOriginal, 'V4'));
  assert.match(extraireCellule(xml, 'V4'), /<f>/);
});

test('les formules V et AB des autres lignes sont préservées à l’identique', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await chargerFixture(original);
  const b = { ...branchements[0], saisies: { constatCoffret: dossier.listes.constatCoffret[0] } };

  const xml = await feuillePb(await exporterFichier(original, [b], dossier));
  const orig = await feuillePb(original);
  assert.equal(extraireCellule(xml, 'V5'), extraireCellule(orig, 'V5'));
  assert.equal(extraireCellule(xml, 'AB4'), extraireCellule(orig, 'AB4'));
  assert.equal(extraireCellule(xml, 'V12'), extraireCellule(orig, 'V12'));
  assert.match(extraireCellule(xml, 'V5'), /<f>/);
});

// ---------------------------------------------------------------------------
// 7. Branchements ajoutés : premières lignes vides après les données.
// ---------------------------------------------------------------------------

test('branchement ajouté écrit dans la première ligne vide', async () => {
  const original = await buildFixture();
  const { dossier } = await chargerFixture(original);
  const ajout = {
    ajoute: true,
    saisies: { commune: 'NEUILLY CRIMOLOIS', rue: 'RUE NEUVE', numero: '7', typeClient: 'Individuel' },
  };

  const xml = await feuillePb(await exporterFichier(original, [ajout], dossier));
  assert.match(extraireCellule(xml, 'B12'), />NEUILLY CRIMOLOIS</);
  assert.match(extraireCellule(xml, 'C12'), />RUE NEUVE</);
  // numero '7' : chiffres sans zéro de tête → nombre (règle A–K).
  assert.equal(extraireCellule(xml, 'D12'), '<c r="D12" s="9"><v>7</v></c>');
  // La formule V de la ligne vide reste intacte.
  assert.match(extraireCellule(xml, 'V12'), /<f>/);
});

test('un deuxième branchement ajouté prend la ligne suivante', async () => {
  const original = await buildFixture();
  const { dossier } = await chargerFixture(original);
  const ajouts = [
    { ajoute: true, saisies: { commune: 'NEUILLY CRIMOLOIS', rue: 'RUE NEUVE', numero: '7' } },
    { ajoute: true, saisies: { commune: 'NEUILLY LES DIJON', rue: 'RUE HAUTE', numero: '9' } },
  ];

  const xml = await feuillePb(await exporterFichier(original, ajouts, dossier));
  assert.match(extraireCellule(xml, 'B12'), />NEUILLY CRIMOLOIS</);
  assert.match(extraireCellule(xml, 'B13'), />NEUILLY LES DIJON</);
  assert.match(extraireCellule(xml, 'C13'), />RUE HAUTE</);
});

test('trop de branchements ajoutés pour le tableau → erreur française explicite', async () => {
  const original = await buildFixture();
  const { dossier } = await chargerFixture(original);
  // La fixture n'a que 9 lignes vides (12-20) : le 10e ajout doit échouer.
  const ajouts = Array.from({ length: 10 }, (_, i) => ({
    ajoute: true,
    saisies: { commune: `COMMUNE ${i}` },
  }));

  await assert.rejects(
    exporterFichier(original, ajouts, dossier),
    /fin du tableau.*ligne 20/
  );
});

// ---------------------------------------------------------------------------
// 8. Zones interdites : jamais touchées, même si les saisies les contiennent.
// ---------------------------------------------------------------------------

test('zones interdites jamais touchées + fullCalcOnLoad', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await chargerFixture(original);
  // saisies illégales (bug UI simulé) : idCoffret (L) et statutPb (AO) doivent
  // être ignorées silencieusement, les cellules du fichier restent intactes.
  const b = {
    ...branchements[0],
    saisies: {
      nomClient: 'DURAND',
      constatCoffret: dossier.listes.constatCoffret[0],
      commentaireReport: 'RAS',
      idCoffret: 'X99',
      statutPb: 'Conforme PB 2032 Classe A',
      pression: 'BP', // V hors exception : jamais écrite non plus
      cleInconnue: 'sans effet',
    },
  };

  const exporte = await exporterFichier(original, [b], dossier);
  const xml = await feuillePb(exporte);
  const xmlOriginal = await feuillePb(original);
  for (const ref of ['L4', 'N4', 'W4', 'AB4', 'AO4', 'V4']) {
    assert.equal(extraireCellule(xml, ref), extraireCellule(xmlOriginal, ref));
  }
  assert.equal(xml.includes('X99'), false);
  assert.match(await fichierZip(exporte, 'xl/workbook.xml'), /fullCalcOnLoad="1"/);
});

// ---------------------------------------------------------------------------
// 9. Règle numérique A–K : chiffres sans zéro de tête → nombre, sinon texte.
// ---------------------------------------------------------------------------

test('corrections A–K : nombre si chiffres seuls, texte sinon', async () => {
  const original = await buildFixture();
  const { dossier, branchements } = await chargerFixture(original);
  const b = { ...branchements[0], saisies: { nomClient: 'DURAND', insee: '21453', numero: '4B' } };

  const xml = await feuillePb(await exporterFichier(original, [b], dossier));
  assert.match(extraireCellule(xml, 'F4'), /t="inlineStr"><is><t[^>]*>DURAND<\/t>/);
  assert.equal(extraireCellule(xml, 'A4'), '<c r="A4" s="9"><v>21453</v></c>');
  assert.match(extraireCellule(xml, 'D4'), /t="inlineStr"><is><t[^>]*>4B<\/t>/);
});

// ---------------------------------------------------------------------------
// 10. Cellule absente du bloc : insérée à la bonne position, sans s=.
// ---------------------------------------------------------------------------

test('cellule absente insérée dans l’ordre des colonnes, sans s=', async () => {
  // La fixture écrit toutes les cellules ; on retire AK4 pour simuler le vrai
  // fichier où les cellules vides peuvent être absentes du bloc <row>.
  const fixture = await buildFixture();
  const celluleAbsente = '<c r="AK4" s="11"/>';
  assert.match(await feuillePb(fixture), new RegExp(celluleAbsente));
  const original = await modifierEntree(fixture, CHEMIN_PB, xml => xml.replace(celluleAbsente, ''));

  const { dossier, branchements } = await chargerFixture(original);
  const b = { ...branchements[0], saisies: { pointArret: dossier.listes.pointArret[1] } };

  const xml = await feuillePb(await exporterFichier(original, [b], dossier));
  const celluleAK4 = extraireCellule(xml, 'AK4');
  assert.match(celluleAK4, />Robinet non démontable</);
  assert.doesNotMatch(celluleAK4, /s="/); // cellule insérée : pas de style hérité
  // Ordre des colonnes respecté dans le bloc row 4 : ... AJ4, AK4, AL4 ...
  const refs = [...extraireLigne(xml, 4).matchAll(/<c r="([A-Z]+4)"/g)].map(m => m[1]);
  const iAJ = refs.indexOf('AJ4');
  const iAK = refs.indexOf('AK4');
  const iAL = refs.indexOf('AL4');
  assert.ok(iAJ !== -1 && iAK !== -1 && iAL !== -1);
  assert.ok(iAJ < iAK && iAK < iAL, `ordre incorrect : ${refs.join(',')}`);
  // Le reste de la ligne est inchangé.
  const xmlOriginal = await feuillePb(original);
  assert.equal(extraireLigne(xml, 4).replace(celluleAK4, ''), extraireLigne(xmlOriginal, 4));
});

// ---------------------------------------------------------------------------
// 11. fullCalcOnLoad ajouté quand il manque.
// ---------------------------------------------------------------------------

test('fullCalcOnLoad ajouté à un calcPr qui ne l’a pas', async () => {
  const original = await modifierEntree(await buildFixture(), 'xl/workbook.xml',
    xml => xml.replace(' fullCalcOnLoad="1"', ''));
  const { dossier, branchements } = await chargerFixture(original);

  const exporte = await exporterFichier(original, branchements, dossier);
  assert.match(await fichierZip(exporte, 'xl/workbook.xml'), /<calcPr[^>]*fullCalcOnLoad="1"/);
});

test('calcPr créé s’il manque entièrement', async () => {
  const original = await modifierEntree(await buildFixture(), 'xl/workbook.xml',
    xml => xml.replace('<calcPr calcId="191029" fullCalcOnLoad="1"/>', ''));
  const { dossier, branchements } = await chargerFixture(original);

  const exporte = await exporterFichier(original, branchements, dossier);
  assert.match(await fichierZip(exporte, 'xl/workbook.xml'), /<calcPr[^>]*fullCalcOnLoad="1"\/>/);
});

// ---------------------------------------------------------------------------
// 12. Cellule ciblée porteuse d'une formule inattendue : erreur, pas d'écrasement.
// ---------------------------------------------------------------------------

test('cellule ciblée contenant une formule → erreur française, rien d’écrasé', async () => {
  // Cas artificiel mais atteignable par l'API publique (octetsOriginaux est
  // arbitraire) : on greffe une formule dans O4 puis on tente d'y écrire.
  const original = await modifierEntree(await buildFixture(), CHEMIN_PB,
    xml => xml.replace('<c r="O4" s="10"/>', '<c r="O4" s="10"><f>LEN(A4)</f></c>'));
  const { dossier, branchements } = await chargerFixture(original);
  const b = { ...branchements[0], saisies: { constatCoffret: dossier.listes.constatCoffret[0] } };

  await assert.rejects(exporterFichier(original, [b], dossier), /formule/);
});

// ---------------------------------------------------------------------------
// 13. Fixture paramétrable + test d'échelle (25 000 lignes vides).
// ---------------------------------------------------------------------------

test('buildFixture() et buildFixture({lignesVides: 0}) produisent le même contenu', async () => {
  // Comparaison entrée par entrée (contenu décompressé) : les octets bruts du
  // zip peuvent différer d'un horodatage interne, sans signification.
  const contenuEntrees = async octets => {
    const zip = await JSZip.loadAsync(octets);
    const noms = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
    const contenus = {};
    for (const nom of noms) contenus[nom] = await zip.file(nom).async('string');
    return contenus;
  };
  assert.deepEqual(
    await contenuEntrees(await buildFixture()),
    await contenuEntrees(await buildFixture({ lignesVides: 0 }))
  );
});

test('buildFixture({lignesVides}) ajoute des lignes après le tableau sans le toucher', async () => {
  const octets = await buildFixture({ lignesVides: 3 });
  const xml = await feuillePb(octets);
  assert.match(xml, /<row r="23">/);
  assert.doesNotMatch(xml, /<row r="24">/);
  // La ref du tableau structuré n'a pas bougé.
  assert.match(await fichierZip(octets, 'xl/tables/table1.xml'), /ref="A3:AO20"/);
  // Et le lecteur voit toujours les mêmes données.
  const { dossier, branchements } = await lireFichier(octets);
  assert.equal(branchements.length, 8);
  assert.equal(dossier.derniereLigneDonnees, 11);
});

test('échelle : export d’une feuille de 25 000 lignes vides en moins de 15 s', async () => {
  const octets = await buildFixture({ lignesVides: 25000 });
  const { dossier, branchements } = await chargerFixture(octets);
  const b = { ...branchements[0], saisies: { constatCoffret: dossier.listes.constatCoffret[0] } };

  const debut = Date.now();
  const exporte = await exporterFichier(octets, [b], dossier);
  const duree = Date.now() - debut;
  assert.ok(duree < 15000, `export trop lent : ${duree} ms`);

  // La sortie se recharge et contient bien la modification + la dernière ligne.
  const xml = await feuillePb(exporte);
  assert.match(extraireCellule(xml, 'O4'), /t="inlineStr"/);
  assert.match(xml, /<row r="25020">/);
});
