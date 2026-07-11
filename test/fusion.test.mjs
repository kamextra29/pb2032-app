import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionner } from '../js/core/fusion.js';

// 1. Rapprochement par PCE, types mélangés (nombre côté ancien, texte côté nouveau)
test('PCE match (types mixtes) : saisies réappliquées, id conservé, rapprochée comptée', () => {
  const ancien = {
    id: 1,
    ligne: 4,
    valeursClient: { insee: '21452', rue: 'RUE DES GENETS', numero: '4', complement: '', nomClient: 'MALLERON', pce: 12200144633562 },
    saisies: { constatCoffret: 'Bien positionné (< 10cm)' },
    ajoute: false,
    vEnDur: false,
  };
  const nouveau = {
    ligne: 4,
    valeursClient: { insee: '21452', rue: 'RUE DES GENETS', numero: '4', complement: '', nomClient: 'MALLERON', pce: '12200144633562' },
    vEnDur: false,
  };

  const { branchements, rapport } = fusionner([ancien], [nouveau]);

  assert.equal(branchements.length, 1);
  assert.equal(branchements[0].id, 1);
  assert.equal(branchements[0].ligne, 4);
  assert.deepEqual(branchements[0].saisies, { constatCoffret: 'Bien positionné (< 10cm)' });
  assert.equal(branchements[0].ajoute, false);
  assert.equal(branchements[0].valeursClient, nouveau.valeursClient);
  assert.equal(rapport.rapprochees, 1);
  assert.equal(rapport.nouvelles.length, 0);
  assert.equal(rapport.disparues.length, 0);
  assert.equal(rapport.conflits.length, 0);
});

// 2. Repli adresse quand le PCE est vide des deux côtés (accents/casse tolérés)
test('repli adresse quand PCE vide des deux côtés (accents/casse ignorés)', () => {
  const ancien = {
    id: 2,
    ligne: 5,
    valeursClient: { insee: '21452', rue: 'Rue de la Gentiane', numero: '', complement: '', nomClient: 'Dupond', pce: '' },
    saisies: { commentaireIdent: 'RAS' },
    ajoute: false,
    vEnDur: false,
  };
  const nouveau = {
    ligne: 5,
    valeursClient: { insee: '21452', rue: 'RUE DE LA GENTIANE', numero: '', complement: '', nomClient: 'DUPOND', pce: '' },
    vEnDur: false,
  };

  const { branchements, rapport } = fusionner([ancien], [nouveau]);

  assert.equal(branchements.length, 1);
  assert.equal(branchements[0].id, 2);
  assert.deepEqual(branchements[0].saisies, { commentaireIdent: 'RAS' });
  assert.equal(rapport.rapprochees, 1);
});

// 3. Repli ambigu : 2 nouvelles lignes partagent la même clé composite
test('repli ambigu (2 nouvelles lignes même adresse) : ancien → disparue orpheline, nouveaux → nouvelles', () => {
  const ancien = {
    id: 3,
    ligne: 10,
    valeursClient: { insee: '21453', rue: "RUE DE L'EGLISE", numero: '7', complement: '', nomClient: 'DURAND', pce: '' },
    saisies: { commentaireIdent: 'a verifier' },
    ajoute: false,
    vEnDur: false,
  };
  const nouveauA = { ligne: 20, valeursClient: { insee: '21453', rue: "RUE DE L'EGLISE", numero: '7', complement: '', nomClient: 'DURAND', pce: '' }, vEnDur: false };
  const nouveauB = { ligne: 21, valeursClient: { insee: '21453', rue: "RUE DE L'EGLISE", numero: '7', complement: '', nomClient: 'DURAND', pce: '' }, vEnDur: false };

  const { branchements, rapport } = fusionner([ancien], [nouveauA, nouveauB]);

  const orpheline = branchements.find(b => b.orpheline === true);
  assert.ok(orpheline, 'l\'ancien doit être conservé comme orpheline');
  assert.equal(orpheline.id, 3);
  assert.deepEqual(orpheline.saisies, { commentaireIdent: 'a verifier' });

  assert.equal(rapport.rapprochees, 0);
  assert.equal(rapport.disparues.length, 1);
  assert.equal(rapport.disparues[0].nbSaisies, 1);
  assert.equal(rapport.nouvelles.length, 2);
  assert.deepEqual(rapport.nouvelles.map(n => n.ligne).sort(), [20, 21]);
});

// 4. Ligne client supprimée : ancien avec saisies, aucune correspondance possible
test('ligne client supprimée (ancien avec saisies, aucune correspondance) → orpheline avec nbSaisies', () => {
  const ancien = {
    id: 4,
    ligne: 6,
    valeursClient: { insee: '21452', rue: 'RUE DES GENETS', numero: '4B', complement: '', nomClient: 'MARTIN', pce: '444444444' },
    saisies: { constatCoffret: 'Bien positionné (< 10cm)', constatBrt: 'Classe A' },
    ajoute: false,
    vEnDur: false,
  };

  const { branchements, rapport } = fusionner([ancien], []);

  assert.equal(branchements.length, 1);
  assert.equal(branchements[0].orpheline, true);
  assert.equal(branchements[0].id, 4);
  assert.equal(rapport.disparues.length, 1);
  assert.equal(rapport.disparues[0].nbSaisies, 2);
  assert.match(rapport.disparues[0].resume, /MARTIN/);
  assert.equal(rapport.rapprochees, 0);
});

// 5. Conflit : le client a modifié une valeur que le terrain avait corrigée
test('conflit : le client a modifié une valeur que le terrain avait corrigée', () => {
  const ancien = {
    id: 5,
    ligne: 4,
    valeursClient: { pce: '111', nomClient: 'DUPOND' },
    saisies: { nomClient: 'DURAND' },
    ajoute: false,
    vEnDur: false,
  };
  const nouveau = { ligne: 4, valeursClient: { pce: '111', nomClient: 'DUPONT' }, vEnDur: false };

  const { branchements, rapport } = fusionner([ancien], [nouveau]);

  // la saisie terrain prime dans le résultat
  assert.equal(branchements[0].saisies.nomClient, 'DURAND');

  assert.equal(rapport.conflits.length, 1);
  const conflit = rapport.conflits[0];
  assert.equal(conflit.reference, '111');
  assert.equal(conflit.cle, 'nomClient');
  assert.equal(conflit.valeurTerrain, 'DURAND');
  assert.equal(conflit.ancienneValeurClient, 'DUPOND');
  assert.equal(conflit.nouvelleValeurClient, 'DUPONT');
});

// 6. Pas de conflit si la valeur client n'a pas changé
test('pas de conflit quand la valeur client est inchangée', () => {
  const ancien = {
    id: 6,
    ligne: 4,
    valeursClient: { pce: '222', constatCoffret: '' },
    saisies: { constatCoffret: 'Bien positionné (< 10cm)' },
    ajoute: false,
    vEnDur: false,
  };
  const nouveau = { ligne: 4, valeursClient: { pce: '222', constatCoffret: '' }, vEnDur: false };

  const { branchements, rapport } = fusionner([ancien], [nouveau]);

  assert.equal(rapport.conflits.length, 0);
  assert.equal(branchements[0].saisies.constatCoffret, 'Bien positionné (< 10cm)');
});

// 7. Ajout app conservé : son PCE saisi n'apparaît pas dans le nouveau fichier
test('ajout app conservé tel quel (PCE saisi absent du nouveau fichier)', () => {
  const ajout = {
    id: 100,
    ajoute: true,
    ajoutId: 1,
    valeursClient: {},
    saisies: { commune: 'NEUILLY CRIMOLOIS', rue: 'RUE NEUVE', numero: '7', nomClient: 'NOUVEAU CLIENT', pce: '999999999' },
    vEnDur: false,
  };
  const nouveau = { ligne: 50, valeursClient: { pce: '111111111', nomClient: 'AUTRE' }, vEnDur: false };

  const { branchements, rapport } = fusionner([ajout], [nouveau]);

  const trouve = branchements.find(b => b.id === 100);
  assert.ok(trouve, 'l\'ajout doit être conservé');
  assert.equal(trouve.ajoute, true);
  assert.deepEqual(trouve.saisies, ajout.saisies);
  assert.equal(rapport.rapprochees, 0);
  assert.equal(rapport.nouvelles.length, 1);
});

// 8. Ajout app dont le PCE saisi apparaît dans le nouveau fichier → rapproché
test('ajout app dont le PCE saisi apparaît dans le nouveau fichier → rapproché, ajoute abandonné', () => {
  const ajout = {
    id: 101,
    ajoute: true,
    ajoutId: 2,
    valeursClient: {},
    saisies: { commune: 'NEUILLY CRIMOLOIS', rue: 'RUE OUBLIEE', numero: '3', nomClient: 'RETROUVE', pce: '333333333' },
    vEnDur: false,
  };
  const nouveau = { ligne: 60, valeursClient: { pce: '333333333', nomClient: 'RETROUVE', rue: 'RUE OUBLIEE', numero: '3' }, vEnDur: false };

  const { branchements, rapport } = fusionner([ajout], [nouveau]);

  assert.equal(branchements.length, 1);
  const b = branchements[0];
  assert.equal(b.ajoute, false);
  assert.equal(b.ligne, 60);
  assert.equal(b.id, 101);
  assert.deepEqual(b.saisies, ajout.saisies);
  assert.equal(rapport.rapprochees, 1);
  assert.equal(rapport.nouvelles.length, 0);
});

// 9. Ancien sans saisies et sans correspondance : abandonné silencieusement
test('ancien sans saisies et sans correspondance → abandonné silencieusement (pas de disparue)', () => {
  const ancien = {
    id: 9,
    ligne: 99,
    valeursClient: { pce: '444444444', nomClient: 'DISPARU' },
    saisies: {},
    ajoute: false,
    vEnDur: false,
  };

  const { branchements, rapport } = fusionner([ancien], []);

  assert.equal(branchements.length, 0);
  assert.equal(rapport.disparues.length, 0);
  assert.equal(rapport.nouvelles.length, 0);
  assert.equal(rapport.rapprochees, 0);
});

// 10. Repli adresse : numéro texte vs nombre → correspondance quand même
test('repli adresse : numéro texte ("7") vs nombre (7) → correspondance quand même', () => {
  const ancien = {
    id: 10,
    ligne: 7,
    valeursClient: { insee: '21453', rue: "RUE DE L'EGLISE", numero: '7', complement: '', nomClient: 'DURAND', pce: '' },
    saisies: { commentaireIdent: 'ras' },
    ajoute: false,
    vEnDur: false,
  };
  const nouveau = { ligne: 7, valeursClient: { insee: '21453', rue: "RUE DE L'EGLISE", numero: 7, complement: '', nomClient: 'DURAND', pce: '' }, vEnDur: false };

  const { branchements, rapport } = fusionner([ancien], [nouveau]);

  assert.equal(rapport.rapprochees, 1);
  assert.equal(branchements[0].id, 10);
  assert.deepEqual(branchements[0].saisies, { commentaireIdent: 'ras' });
});

// 11. PCE renseigné mais introuvable : pas de repli adresse (risque de faux rapprochement)
test('PCE renseigné mais absent des nouveaux : pas de repli adresse, ancien → orpheline', () => {
  const ancien = {
    id: 11,
    ligne: 4,
    valeursClient: { insee: '21452', rue: 'RUE DES GENETS', numero: '4', complement: '', nomClient: 'MALLERON', pce: '555555555' },
    saisies: { constatCoffret: 'Bien positionné (< 10cm)' },
    ajoute: false,
    vEnDur: false,
  };
  // Même adresse, unique côté nouveaux, mais PCE différent : ne doit PAS matcher
  const nouveau = {
    ligne: 4,
    valeursClient: { insee: '21452', rue: 'RUE DES GENETS', numero: '4', complement: '', nomClient: 'MALLERON', pce: '666666666' },
    vEnDur: false,
  };

  const { branchements, rapport } = fusionner([ancien], [nouveau]);

  assert.equal(rapport.rapprochees, 0);
  const orpheline = branchements.find(b => b.orpheline === true);
  assert.ok(orpheline, 'l\'ancien doit devenir orpheline, sans repli adresse');
  assert.equal(orpheline.id, 11);
  assert.deepEqual(orpheline.saisies, { constatCoffret: 'Bien positionné (< 10cm)' });
  assert.equal(rapport.disparues.length, 1);
  assert.equal(rapport.nouvelles.length, 1);
});

// 12. Ancien normal et ajout en concurrence sur le même PCE nouveau : le normal gagne
test('ancien normal et ajout en concurrence sur le même PCE : le normal gagne, l\'ajout est conservé', () => {
  const ancienNormal = {
    id: 12,
    ligne: 4,
    valeursClient: { pce: '777777777', nomClient: 'MALLERON' },
    saisies: { constatCoffret: 'Bien positionné (< 10cm)' },
    ajoute: false,
    vEnDur: false,
  };
  const ajout = {
    id: 112,
    ajoute: true,
    ajoutId: 3,
    valeursClient: {},
    saisies: { rue: 'RUE NEUVE', numero: '9', pce: '777777777' },
    vEnDur: false,
  };
  const nouveau = { ligne: 4, valeursClient: { pce: '777777777', nomClient: 'MALLERON' }, vEnDur: false };

  const { branchements, rapport } = fusionner([ancienNormal, ajout], [nouveau]);

  assert.equal(rapport.rapprochees, 1);
  const rapproche = branchements.find(b => b.id === 12);
  assert.ok(rapproche, 'le normal doit gagner le rapprochement');
  assert.equal(rapproche.ajoute, false);
  assert.deepEqual(rapproche.saisies, { constatCoffret: 'Bien positionné (< 10cm)' });
  const ajoutConserve = branchements.find(b => b.id === 112);
  assert.ok(ajoutConserve, 'l\'ajout doit être conservé');
  assert.equal(ajoutConserve.ajoute, true);
  assert.deepEqual(ajoutConserve.saisies, ajout.saisies);
});

// 13. PCE dupliqué parmi les anciens : le premier gagne, le second devient orpheline
test('PCE dupliqué parmi les anciens : le premier gagne, le second → orpheline, saisies conservées', () => {
  const premier = {
    id: 13,
    ligne: 4,
    valeursClient: { pce: '888888888', nomClient: 'PREMIER' },
    saisies: { constatCoffret: 'Bien positionné (< 10cm)' },
    ajoute: false,
    vEnDur: false,
  };
  const second = {
    id: 14,
    ligne: 5,
    valeursClient: { pce: '888888888', nomClient: 'SECOND' },
    saisies: { commentaireIdent: 'doublon PCE' },
    ajoute: false,
    vEnDur: false,
  };
  const nouveau = { ligne: 4, valeursClient: { pce: '888888888', nomClient: 'PREMIER' }, vEnDur: false };

  const { branchements, rapport } = fusionner([premier, second], [nouveau]);

  assert.equal(rapport.rapprochees, 1);
  const gagnant = branchements.find(b => b.id === 13);
  assert.ok(gagnant, 'le premier ancien doit être rapproché');
  assert.deepEqual(gagnant.saisies, { constatCoffret: 'Bien positionné (< 10cm)' });
  const orpheline = branchements.find(b => b.id === 14);
  assert.ok(orpheline, 'le second ancien doit être conservé');
  assert.equal(orpheline.orpheline, true);
  assert.deepEqual(orpheline.saisies, { commentaireIdent: 'doublon PCE' });
  assert.equal(rapport.disparues.length, 1);
  assert.equal(rapport.disparues[0].nbSaisies, 1);
});

// Format du résumé utilisé dans les rapports (nouvelles/disparues)
test('résumé lisible au format "rue n° — nom" pour les rapports', () => {
  const nouveau = { ligne: 4, valeursClient: { rue: 'RUE DES GENETS', numero: 4, nomClient: 'MALLERON' }, vEnDur: false };

  const { rapport } = fusionner([], [nouveau]);

  assert.equal(rapport.nouvelles[0].resume, 'RUE DES GENETS 4 — MALLERON');
});
