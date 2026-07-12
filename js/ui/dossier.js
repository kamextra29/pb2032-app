/**
 * Écran « Dossier » (#dossier) : import du fichier client, et les deux
 * actions proposées quand un dossier existe déjà (Remplacer / Mettre à jour
 * — réimport-fusion, §10, Task 17).
 *
 * Convention de montage asynchrone (voir aussi js/app.js) : tous les `await`
 * nécessaires à la décision du contenu initial (ici `chargerTout()`) sont
 * faits AVANT la première écriture dans `conteneur`, pour ne jamais afficher
 * un état transitoire vide puis le remplacer (flash visuel). Les mises à jour
 * déclenchées ensuite par l'utilisateur (progression d'import, etc.) sont
 * sûres après ce premier rendu.
 *
 * Garde-fou navigation, en deux temps :
 * - pendant le montage initial : `estActif()` (rappel vivant fourni par le
 *   routeur, cf. convention dans js/app.js) est vérifié après chaque `await`
 *   qui précède une écriture DOM — si une navigation plus récente a pris la
 *   main pendant le `chargerTout()` initial, on abandonne silencieusement
 *   sans jamais écrire par-dessus l'écran suivant ;
 * - après le montage : un jeton local (`etat.actif`, invalidé par
 *   `demonter()`) protège les mises à jour déclenchées ensuite (progression
 *   d'import, etc.).
 */

import { chargerTout, remplacerDossier, remplacerApresFusion } from '../core/store.js';
import { calculerSynthese } from '../core/regles.js';
import { COLONNES } from '../core/colonnes.js';
import { demanderImport, demanderFusion, ErreurWorker } from './worker-client.js';
import { echapperHtml } from './dom.js';

/** Libellé d'une colonne (cle → libellé lisible), utilisé par le rapport de fusion. */
const LIBELLE_PAR_CLE = Object.fromEntries(COLONNES.map((c) => [c.cle, c.libelle]));

export async function monter(conteneur, _parametre, estActif = () => true) {
  const etat = { actif: true };

  const { dossier, branchements } = await chargerTout();
  if (!estActif() || !etat.actif) return; // navigation ailleurs pendant le chargement initial

  if (dossier) {
    afficherDossierExistant(conteneur, etat, dossier, branchements);
  } else {
    afficherEcranImport(conteneur, etat);
  }

  exposerPontDev(conteneur, etat);

  return function demonter() {
    etat.actif = false;
    if (window.__importerOctets) delete window.__importerOctets;
    if (window.__fusionnerOctets) delete window.__fusionnerOctets;
  };
}

// ---------------------------------------------------------------------------
// Dossier existant : synthèse + Remplacer / Mettre à jour.
// ---------------------------------------------------------------------------

function afficherDossierExistant(conteneur, etat, dossier, branchements) {
  const synthese = calculerSynthese(branchements);
  const dateImport = formaterDate(dossier.dateImport);

  conteneur.innerHTML = `
    <section class="ecran">
      <h1>Dossier</h1>
      <div class="carte">
        <h2>${echapperHtml(dossier.nom)}</h2>
        <p class="texte-2">Importé le ${echapperHtml(dateImport)}</p>
        ${blocSyntheseHtml(synthese)}
      </div>
      <button class="bouton btn-danger" id="btn-remplacer" type="button">Remplacer (repartir de zéro)</button>
      <button class="bouton" id="btn-fusion" type="button">Mettre à jour (fusion)</button>
      <div id="zone-etat"></div>
    </section>
  `;

  conteneur.querySelector('#btn-remplacer').addEventListener('click', () => {
    afficherConfirmationRemplacement(conteneur, etat);
  });
  conteneur.querySelector('#btn-fusion').addEventListener('click', () => {
    afficherEcranFusion(conteneur, etat, branchements);
  });
}

function afficherConfirmationRemplacement(conteneur, etat) {
  const zone = conteneur.querySelector('#zone-etat');
  zone.innerHTML = `
    <div class="carte bloc-avertissement">
      <p><strong>Les saisies locales seront perdues.</strong> Continuer ?</p>
      <div class="rangee-boutons">
        <button class="bouton" id="btn-annuler-remplacement" type="button">Annuler</button>
        <button class="bouton btn-danger" id="btn-confirmer-remplacement" type="button">Remplacer</button>
      </div>
    </div>
  `;
  zone.querySelector('#btn-annuler-remplacement').addEventListener('click', () => {
    zone.innerHTML = '';
  });
  zone.querySelector('#btn-confirmer-remplacement').addEventListener('click', () => {
    afficherEcranImport(conteneur, etat);
  });
}

// ---------------------------------------------------------------------------
// Mise à jour par réimport-fusion (§10, Task 17) : import du nouveau fichier,
// rapprochement (fusion.js, via le worker), rapport, puis confirmation/annulation.
// Rien n'est écrit en base tant que « Confirmer la mise à jour » n'a pas été
// cliqué (§10.5) — « Annuler » revient à l'écran dossier existant inchangé.
// ---------------------------------------------------------------------------

function afficherEcranFusion(conteneur, etat, branchementsActuels) {
  const zone = conteneur.querySelector('#zone-etat');
  if (!zone) return;
  zone.innerHTML = `
    <div class="carte">
      <p>Sélectionnez la nouvelle version du fichier client. Vos saisies terrain (et les photos) seront conservées et réappliquées aux lignes correspondantes.</p>
      <button class="bouton btn-primaire" id="btn-choisir-fichier-fusion" type="button">Choisir le fichier</button>
      <input type="file" accept=".xlsx" id="input-fichier-fusion" hidden>
      <div id="zone-fusion-etat"></div>
    </div>
  `;

  const boutonChoisir = zone.querySelector('#btn-choisir-fichier-fusion');
  const inputFichier = zone.querySelector('#input-fichier-fusion');
  boutonChoisir.addEventListener('click', () => inputFichier.click());
  inputFichier.addEventListener('change', async () => {
    const fichier = inputFichier.files?.[0];
    if (!fichier) return;
    const octets = await fichier.arrayBuffer();
    if (!etat.actif) return;
    await lancerFusion(conteneur, etat, fichier.name, octets, branchementsActuels);
  });
}

async function lancerFusion(conteneur, etat, nomFichier, octetsArrayBuffer, branchementsActuels) {
  const zoneFusion = conteneur.querySelector('#zone-fusion-etat');
  if (!zoneFusion) return;
  afficherProgression(zoneFusion, 0, 'Lecture du nouveau fichier…');

  try {
    const { dossier: dossierLu, branchements: branchementsLus, octets } = await demanderImport(
      octetsArrayBuffer,
      (progression, etape) => {
        if (!etat.actif) return;
        const zoneActuelle = conteneur.querySelector('#zone-fusion-etat');
        if (zoneActuelle) afficherProgression(zoneActuelle, progression, etape);
      }
    );
    if (!etat.actif) return;

    const zoneAvantFusion = conteneur.querySelector('#zone-fusion-etat');
    if (zoneAvantFusion) afficherProgression(zoneAvantFusion, 0.95, 'Rapprochement des saisies…');

    const resultat = await demanderFusion(branchementsActuels, branchementsLus);
    if (!etat.actif) return;

    // Métadonnées entièrement issues du nouveau fichier lu — rien de l'ancien
    // dossier n'est reporté (nom, listes, refListes, chemin de la feuille…) :
    // le nouveau fichier devient la base d'export (§10.2).
    const dossierPropose = {
      ...dossierLu,
      nom: nomFichier,
      dateImport: new Date().toISOString(),
      blob: new Uint8Array(octets),
    };

    afficherRapportFusion(conteneur, etat, dossierPropose, resultat);
  } catch (erreur) {
    if (!etat.actif) return;
    const zoneActuelle = conteneur.querySelector('#zone-fusion-etat');
    if (zoneActuelle) afficherErreurImport(zoneActuelle, erreur);
  }
}

function afficherRapportFusion(conteneur, etat, dossierPropose, resultat) {
  const { branchements: branchementsFusionnes, rapport } = resultat;

  conteneur.innerHTML = `
    <section class="ecran">
      <h1>Rapport de mise à jour</h1>
      <div class="carte">
        <p><strong>${rapport.rapprochees}</strong> branchement(s) rapproché(s) — saisies terrain conservées.</p>
      </div>
      ${rapport.nouvelles.length ? blocNouvellesHtml(rapport.nouvelles) : ''}
      ${rapport.disparues.length ? blocDisparuesHtml(rapport.disparues) : ''}
      ${rapport.conflits.length ? blocConflitsHtml(rapport.conflits) : '<p class="texte-2">Aucun conflit.</p>'}
      <div id="zone-confirmation-fusion"></div>
      <div class="rangee-boutons">
        <button class="bouton" id="btn-annuler-fusion" type="button">Annuler</button>
        <button class="bouton btn-primaire" id="btn-confirmer-fusion" type="button">Confirmer la mise à jour</button>
      </div>
    </section>
  `;

  conteneur.querySelector('#btn-annuler-fusion').addEventListener('click', async () => {
    // Rien n'a été écrit en base (§10.5) : on relit simplement l'état actuel du store.
    const { dossier, branchements } = await chargerTout();
    if (!etat.actif) return;
    afficherDossierExistant(conteneur, etat, dossier, branchements);
  });

  conteneur.querySelector('#btn-confirmer-fusion').addEventListener('click', async (evenement) => {
    evenement.currentTarget.disabled = true;
    try {
      await remplacerApresFusion(dossierPropose, branchementsFusionnes);
      if (!etat.actif) return;
      location.hash = '#accueil';
    } catch (erreur) {
      if (!etat.actif) return;
      const zoneConfirmation = conteneur.querySelector('#zone-confirmation-fusion');
      if (zoneConfirmation) {
        zoneConfirmation.innerHTML = `<p class="texte-2 texte-erreur">Mise à jour impossible : ${echapperHtml(erreur?.message ?? String(erreur))}</p>`;
      }
      evenement.currentTarget.disabled = false;
    }
  });
}

function blocNouvellesHtml(nouvelles) {
  return `
    <div class="carte">
      <h2>${nouvelles.length} nouveau(x) branchement(s)</h2>
      <ul>${nouvelles.map((n) => `<li>${echapperHtml(n.resume)}</li>`).join('')}</ul>
    </div>
  `;
}

function blocDisparuesHtml(disparues) {
  return `
    <div class="carte bloc-avertissement">
      <h2>${disparues.length} branchement(s) disparu(s) du fichier client</h2>
      <ul>${disparues.map((d) => `<li>${echapperHtml(d.resume)} — <strong>${d.nbSaisies} saisie(s) conservée(s)</strong></li>`).join('')}</ul>
    </div>
  `;
}

function blocConflitsHtml(conflits) {
  return `
    <div class="carte bloc-avertissement">
      <h2>${conflits.length} conflit(s)</h2>
      <ul>${conflits.map((c) => `
        <li>
          <strong>${echapperHtml(LIBELLE_PAR_CLE[c.cle] ?? c.cle)}</strong>${c.reference ? ` (${echapperHtml(c.reference)})` : ''} :
          le client est passé de « ${echapperHtml(formaterValeurRapport(c.ancienneValeurClient))} » à « ${echapperHtml(formaterValeurRapport(c.nouvelleValeurClient))} »,
          votre saisie « ${echapperHtml(formaterValeurRapport(c.valeurTerrain))} » est conservée.
        </li>
      `).join('')}</ul>
    </div>
  `;
}

function formaterValeurRapport(v) {
  return v === undefined || v === null || v === '' ? '(vide)' : String(v);
}

// ---------------------------------------------------------------------------
// Pas de dossier (ou remplacement en cours) : bouton d'import.
// ---------------------------------------------------------------------------

function afficherEcranImport(conteneur, etat) {
  conteneur.innerHTML = `
    <section class="ecran">
      <h1>Dossier</h1>
      <p class="texte-2">Aucun dossier importé pour l'instant.</p>
      <button class="bouton btn-primaire" id="btn-importer" type="button">Importer un fichier client</button>
      <input type="file" accept=".xlsx" id="input-fichier" hidden>
      <div id="zone-etat"></div>
    </section>
  `;

  const boutonImporter = conteneur.querySelector('#btn-importer');
  const inputFichier = conteneur.querySelector('#input-fichier');

  boutonImporter.addEventListener('click', () => inputFichier.click());
  inputFichier.addEventListener('change', async () => {
    const fichier = inputFichier.files?.[0];
    if (!fichier) return;
    const octets = await fichier.arrayBuffer();
    if (!etat.actif) return;
    await lancerImport(conteneur, etat, fichier.name, octets);
  });
}

// ---------------------------------------------------------------------------
// Déroulé commun de l'import (bouton fichier ou pont de test dev).
// ---------------------------------------------------------------------------

async function lancerImport(conteneur, etat, nomFichier, octetsArrayBuffer) {
  const zone = conteneur.querySelector('#zone-etat');
  if (!zone) return;
  afficherProgression(zone, 0, 'Préparation…');

  try {
    const { dossier: dossierLu, branchements: branchementsLus, octets } = await demanderImport(
      octetsArrayBuffer,
      (progression, etape) => {
        if (!etat.actif) return;
        const zoneActuelle = conteneur.querySelector('#zone-etat');
        if (zoneActuelle) afficherProgression(zoneActuelle, progression, etape);
      }
    );
    if (!etat.actif) return;

    const dossierStore = {
      ...dossierLu,
      nom: nomFichier,
      dateImport: new Date().toISOString(),
      blob: new Uint8Array(octets),
    };
    const branchementsStore = branchementsLus.map((b) => ({
      ligne: b.ligne,
      valeursClient: b.valeursClient,
      vEnDur: b.vEnDur,
      saisies: {},
      ajoute: false,
    }));

    await remplacerDossier(dossierStore, branchementsStore);
    if (!etat.actif) return;

    afficherSynthesePostImport(conteneur, dossierStore, branchementsStore);
  } catch (erreur) {
    if (!etat.actif) return;
    const zoneActuelle = conteneur.querySelector('#zone-etat');
    if (zoneActuelle) afficherErreurImport(zoneActuelle, erreur);
  }
}

function afficherProgression(zone, progression, etape) {
  const pourcent = Math.round(Math.max(0, Math.min(1, progression)) * 100);
  zone.innerHTML = `
    <div class="carte">
      <p>${echapperHtml(etape)}</p>
      <div class="barre-progression"><div class="barre-progression-remplie" style="width:${pourcent}%"></div></div>
    </div>
  `;
}

function afficherErreurImport(zone, erreur) {
  const erreurs = erreur instanceof ErreurWorker ? erreur.erreurs : [erreur?.message || String(erreur)];
  zone.innerHTML = `
    <div class="carte bloc-erreur">
      <h2>Ce fichier ne ressemble pas à une Annexe 7 PB 2032 :</h2>
      <ul>${erreurs.map((e) => `<li>${echapperHtml(e)}</li>`).join('')}</ul>
    </div>
  `;
}

function afficherSynthesePostImport(conteneur, dossierStore, branchementsStore) {
  const synthese = calculerSynthese(branchementsStore);
  conteneur.innerHTML = `
    <section class="ecran">
      <h1>Dossier importé</h1>
      <div class="carte">
        <h2>${echapperHtml(dossierStore.nom)}</h2>
        ${blocSyntheseHtml(synthese)}
      </div>
      <button class="bouton btn-primaire" id="btn-accueil" type="button">Aller à l'accueil</button>
    </section>
  `;
  conteneur.querySelector('#btn-accueil').addEventListener('click', () => {
    location.hash = '#accueil';
  });
}

// ---------------------------------------------------------------------------
// Divers.
// ---------------------------------------------------------------------------

function blocSyntheseHtml(synthese) {
  return `
    <p>${synthese.nb} branchements · ${synthese.nbCommunes} communes · ${synthese.nbRues} rues</p>
    <p>${synthese.identifies} déjà identifiés · ${synthese.reportes} reportés</p>
  `;
}

function formaterDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
}

/**
 * Pont de test dev, inactif hors localhost : un sélecteur de fichier natif ne
 * peut pas être piloté par les outils de vérification automatisée. Ce pont
 * permet de déclencher le même déroulé d'import depuis la console du
 * navigateur, uniquement quand l'app tourne sur localhost. Il reste dans le
 * code (jamais actif en production, hostname différent).
 */
function exposerPontDev(conteneur, etat) {
  if (typeof location === 'undefined' || location.hostname !== 'localhost') return;
  window.__importerOctets = async (octets) => {
    if (!conteneur.querySelector('#zone-etat')) {
      // Dossier déjà affiché (vue "dossier existant") : basculer sur l'écran
      // d'import comme le ferait un clic sur Remplacer, puis importer.
      afficherEcranImport(conteneur, etat);
    }
    await lancerImport(conteneur, etat, '(test dev)', octets);
  };
  // Même principe pour la fusion (Task 17) : un <input type=file> ne peut pas
  // être piloté par les outils de vérification automatisée. `octets` = le
  // nouveau fichier client (ArrayBuffer), rapproché avec les branchements
  // actuels du store.
  window.__fusionnerOctets = async (octets) => {
    const { dossier, branchements } = await chargerTout();
    if (!etat.actif) return;
    if (!dossier) throw new Error('Aucun dossier existant : la fusion nécessite un dossier déjà importé.');
    afficherDossierExistant(conteneur, etat, dossier, branchements);
    afficherEcranFusion(conteneur, etat, branchements);
    await lancerFusion(conteneur, etat, '(test dev fusion)', octets, branchements);
  };
}
