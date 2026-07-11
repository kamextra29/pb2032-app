import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLONNES, lettreVersIndex, indexVersLettre, ZONES } from '../js/core/colonnes.js';
import { calculerPression, calculerStatuts, calculerCompletude, comparerNumeros, normaliser } from '../js/core/regles.js';

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

// valeurs(b) = fusion valeursClient + saisies (la saisie prime) — helper interne au module
test('statuts : à faire / identifié / reporté cumulables', () => {
  assert.deepEqual(calculerStatuts({ valeursClient: {}, saisies: {}, ajoute: false }),
    { aFaire: true, identifie: false, reporte: false, pointArret: false, diTechnique: false, ajoute: false });
  // pré-identifié par le client (O renseigné côté client)
  const preIdent = { valeursClient: { constatCoffret: 'Bien positionné (< 10cm)' }, saisies: {}, ajoute: false };
  assert.equal(calculerStatuts(preIdent).identifie, true);
  assert.equal(calculerStatuts(preIdent).aFaire, false);
  // AG=1 suffit ; reporté et identifié cumulables
  const s = calculerStatuts({ valeursClient: {}, saisies: { identificationPb: 1, typeReport: 'Détection sans coupure, levé et report' }, ajoute: false });
  assert.ok(s.identifie && s.reporte);
  assert.equal(calculerStatuts({ valeursClient: {}, saisies: { pointArret: 'Robinet non démontable' }, ajoute: false }).pointArret, true);
});

test('complétude : O,P,Q,S,T requis ; U si DPBE ; R si PE', () => {
  const base = { constatCoffret: 'x', constatBrt: 'x', matiere: 'Ac', accessoires: 'x', bague: 'NON' };
  assert.deepEqual(calculerCompletude(base), { complets: 5, requis: 5 });
  assert.deepEqual(calculerCompletude({ ...base, bague: 'DPBE' }), { complets: 5, requis: 6 });          // U manque
  assert.deepEqual(calculerCompletude({ ...base, bague: 'DPBE', longueurSonde: 2.5 }), { complets: 6, requis: 6 });
  assert.deepEqual(calculerCompletude({ ...base, matiere: 'PE' }), { complets: 5, requis: 6 });          // R manque
  assert.deepEqual(calculerCompletude({}), { complets: 0, requis: 5 });
});

test('tri intelligent des numéros', () => {
  const nums = ['11', '4B', '2', '4', '', '4A', 'SN?'];
  assert.deepEqual([...nums].sort(comparerNumeros), ['2', '4', '4A', '4B', '11', 'SN?', '']);
  // partie numérique d'abord (2 < 4 < 11), suffixe alphabétique ensuite,
  // non-numériques après en ordre alphabétique, vides en dernier
  assert.deepEqual([null, '2', undefined, ''].sort(comparerNumeros), ['2', null, '', undefined]);
  // null/undefined/'' = absents → tous en fin de tri (tri stable ⇒ ordre déterministe ;
  // undefined en toute fin : Array.prototype.sort ne le passe jamais au comparateur)
});

test('normalisation pour recherche : accents, casse, espaces multiples', () => {
  assert.equal(normaliser('  Rue des GENÊTS '), 'rue des genets');
  assert.equal(normaliser('N°'), 'n°');
  assert.equal(normaliser(12200144633562), '12200144633562'); // les valeurs numériques passent
});
