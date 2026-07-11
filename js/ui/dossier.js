/**
 * Écran « Dossier » (#dossier) : import du fichier client, et pour l'instant
 * les deux actions proposées quand un dossier existe déjà (Remplacer / Mettre
 * à jour — cette dernière est câblée en Task 17, désactivée ici).
 *
 * Convention de montage asynchrone (voir aussi js/app.js) : tous les `await`
 * nécessaires à la décision du contenu initial (ici `chargerTout()`) sont
 * faits AVANT la première écriture dans `conteneur`, pour ne jamais afficher
 * un état transitoire vide puis le remplacer (flash visuel). Les mises à jour
 * déclenchées ensuite par l'utilisateur (progression d'import, etc.) sont
 * sûres après ce premier rendu.
 *
 * Garde-fou navigation : `monter()` peut être abandonné en cours de route si
 * l'utilisateur navigue ailleurs pendant un `await` (chargement initial ou
 * import en cours). Un jeton local (`etat.actif`) est vérifié après chaque
 * `await` avant toute écriture DOM ; `demonter()` le invalide.
 */

import { chargerTout, remplacerDossier } from '../core/store.js';
import { calculerSynthese } from '../core/regles.js';
import { demanderImport, ErreurWorker } from './worker-client.js';
import { echapperHtml } from './dom.js';

export async function monter(conteneur) {
  const etat = { actif: true };

  const { dossier, branchements } = await chargerTout();
  if (!etat.actif) return; // navigation ailleurs pendant le chargement initial

  if (dossier) {
    afficherDossierExistant(conteneur, etat, dossier, branchements);
  } else {
    afficherEcranImport(conteneur, etat);
  }

  exposerPontDev(conteneur, etat);

  return function demonter() {
    etat.actif = false;
    if (window.__importerOctets) delete window.__importerOctets;
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
      <button class="bouton" id="btn-fusion" type="button" disabled title="Disponible prochainement">Mettre à jour (fusion)</button>
      <div id="zone-etat"></div>
    </section>
  `;

  conteneur.querySelector('#btn-remplacer').addEventListener('click', () => {
    afficherConfirmationRemplacement(conteneur, etat);
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
}
