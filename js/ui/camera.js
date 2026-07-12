/**
 * Photos (capture + compression) et scan de code-barres (§8, Task 16).
 *
 * PHOTOS
 * ------
 * `monterZonePhotos(branchementId, conteneur)` remplit `conteneur` avec :
 *  - un bouton « + Photo » qui déclenche un `<input type="file" accept="image/*"
 *    capture="environment">` (choix caméra/galerie natif Android) ;
 *  - une compression canvas (côté long ≤ 2000px, jamais d'agrandissement,
 *    JPEG qualité 0,8 — `dimensionsCompressees` est la seule partie pure,
 *    testée sous Node dans test/camera.test.mjs) avant tout stockage ;
 *  - une grille de vignettes (`photosDe`), plein écran au tap (tap pour
 *    fermer), suppression avec confirmation inline.
 *
 * Fiche.js appelle `monterZonePhotos` à CHAQUE rendu complet de l'écran (une
 * fois par sauvegarde de champ, cf. convention du module) : chaque appel
 * revoque d'abord les URL d'objet de l'affichage précédent (`revoquerUrlsActives`)
 * avant d'en créer de nouvelles — aucune fuite mémoire même avec des
 * re-rendus fréquents. `demonterZonePhotos` (appelée depuis le `demonter()`
 * renvoyé par fiche.js) fait de même au démontage final de l'écran. Un jeton
 * de course (`jetonGalerie`) protège contre deux rendus concurrents (deux
 * sauvegardes de champ rapprochées) : seul le dernier appel construit le DOM
 * et crée des URL d'objet.
 *
 * Le nom de fichier (`nomPhoto`, js/core/photos-noms.js) n'est calculé qu'à
 * l'export (Task 17) : ici, `nom: ''` est stocké tel quel.
 *
 * SCAN CODE-BARRES
 * ----------------
 * `scannerCodeBarre(onTrouve, onAnnuleOuEchec)` : si `BarcodeDetector` est
 * absent, ou si `getUserMedia`/la construction du détecteur échoue, appelle
 * IMMÉDIATEMENT `onAnnuleOuEchec('indisponible'|'refus')` sans jamais ouvrir
 * de flux caméra — recherche.js retombe alors sur la saisie manuelle déjà en
 * place. Sinon, ouvre un overlay plein écran (flux vidéo + bouton Annuler) et
 * détecte en boucle (~200 ms) ; le flux est TOUJOURS arrêté à la fermeture
 * (succès, Annuler, ou navigation ailleurs pendant le scan via `hashchange`).
 */

import { ajouterPhoto, photosDe, supprimerPhoto, estimerStockage } from '../core/store.js';
import { echapperHtml } from './dom.js';

const COTE_MAX = 2000;
const QUALITE_JPEG = 0.8;

// ---------------------------------------------------------------------------
// Compression (canvas) — seule logique pure du module, testée sous Node.
// ---------------------------------------------------------------------------

/**
 * Calcule les dimensions d'une image ramenée à un côté long maximal, aspect
 * conservé, jamais d'agrandissement (image déjà sous la limite → inchangée).
 *
 * @param {number} largeur
 * @param {number} hauteur
 * @param {number} [max] - côté long maximal en pixels (2000 par défaut, §8)
 * @returns {{w: number, h: number}}
 */
export function dimensionsCompressees(largeur, hauteur, max = COTE_MAX) {
  const cote = Math.max(largeur, hauteur);
  if (cote <= max) return { w: largeur, h: hauteur };
  const echelle = max / cote;
  return { w: Math.round(largeur * echelle), h: Math.round(hauteur * echelle) };
}

/**
 * Décode un fichier/blob image en un objet dessinable (`ImageBitmap` ou
 * `HTMLImageElement`) avec sa fonction de libération associée. Repli sur
 * `Image` + `objectURL` si `createImageBitmap` est absent, ou s'il échoue sur
 * ce fichier précis (certains formats/téléphones).
 *
 * @param {Blob} fichier
 * @returns {Promise<{image: ImageBitmap|HTMLImageElement, liberer: () => void}>}
 */
async function obtenirImageDecodee(fichier) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(fichier);
      return { image: bitmap, liberer: () => bitmap.close?.() };
    } catch {
      // On retombe sur le chemin Image()+objectURL ci-dessous.
    }
  }
  const url = URL.createObjectURL(fichier);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = url;
  });
  return { image, liberer: () => URL.revokeObjectURL(url) };
}

/**
 * Compresse une image (fichier/blob) : décodage, redimensionnement canvas
 * (`dimensionsCompressees`), export JPEG qualité 0,8.
 *
 * @param {Blob} fichier
 * @returns {Promise<Blob>}
 */
async function compresserImage(fichier) {
  const { image, liberer } = await obtenirImageDecodee(fichier);
  try {
    const { w, h } = dimensionsCompressees(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(image, 0, 0, w, h);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Compression de la photo impossible'))),
        'image/jpeg',
        QUALITE_JPEG
      );
    });
  } finally {
    liberer();
  }
}

/**
 * Compresse puis stocke une photo pour un branchement : index = 1 + le plus
 * grand index déjà présent, contrôle de quota AVANT stockage (avertissement
 * non bloquant si > 80 %, §11 — le travail terrain ne doit jamais être
 * bloqué). Chemin partagé par l'input file réel et par le hook de test
 * localhost ci-dessous.
 *
 * @param {number} branchementId
 * @param {Blob} fichierOuBlob
 * @returns {Promise<{avertissement: string, taille: number}>}
 */
async function compresserEtStocker(branchementId, fichierOuBlob) {
  const blobCompresse = await compresserImage(fichierOuBlob);
  const photosExistantes = await photosDe(branchementId);
  const index = 1 + photosExistantes.reduce((max, p) => Math.max(max, p.index ?? 0), 0);

  let avertissement = '';
  const stockage = await estimerStockage();
  if (stockage && stockage.pourcent != null && stockage.pourcent > 80) {
    avertissement = `Stockage à ${Math.round(stockage.pourcent)}% — pensez à exporter et libérer de la place.`;
  }

  await ajouterPhoto({
    branchementId,
    blob: blobCompresse,
    index,
    date: new Date().toISOString(),
    nom: '', // recalculé à l'export (Task 17), jamais ici
  });

  return { avertissement, taille: blobCompresse.size };
}

// Hook de test réservé à localhost (jamais actif en production) : exécute
// exactement le même chemin compression + stockage que l'ajout normal, pour
// permettre aux vérifications navigateur (sans caméra réelle disponible en
// preview) de piloter compression/stockage/galerie depuis un blob synthétique.
// Voir Task 16 du plan — documenté, jamais utilisé par le code applicatif.
if (typeof window !== 'undefined' && typeof window.location !== 'undefined'
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
  window.__ajouterPhotoTest = (branchementId, blob) => compresserEtStocker(branchementId, blob);
}

// ---------------------------------------------------------------------------
// Galerie (vignettes, plein écran, suppression) — zone photos de la fiche.
// ---------------------------------------------------------------------------

let jetonGalerie = 0;
let urlsActives = [];

function revoquerUrlsActives() {
  for (const url of urlsActives) URL.revokeObjectURL(url);
  urlsActives = [];
}

/** À appeler depuis le `demonter()` de l'écran fiche : arrête toute galerie en cours de chargement et revoque les URL restantes. */
export function demonterZonePhotos() {
  jetonGalerie++;
  revoquerUrlsActives();
}

/**
 * Monte la zone photos d'une fiche (remplace le placeholder « disponible
 * prochainement »). Peut être appelée plusieurs fois sur le même conteneur
 * (à chaque rendu complet de fiche.js) : voir le jeton de course ci-dessous.
 *
 * @param {number} branchementId
 * @param {HTMLElement} conteneur
 */
export function monterZonePhotos(branchementId, conteneur) {
  return rendreGalerie(conteneur, branchementId);
}

function formatTaille(octets) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

async function rendreGalerie(conteneur, branchementId) {
  const monJeton = ++jetonGalerie;
  revoquerUrlsActives();
  const photos = await photosDe(branchementId);
  if (monJeton !== jetonGalerie) return; // une galerie plus récente a pris la main entre-temps

  photos.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const tailleTotale = photos.reduce((somme, p) => somme + (p.blob?.size ?? 0), 0);
  const compte = photos.length
    ? `${photos.length} photo${photos.length > 1 ? 's' : ''} · ${formatTaille(tailleTotale)}`
    : 'Aucune photo';

  conteneur.innerHTML = `
    <div class="fiche-barre-haut">
      <h2>Photos</h2>
      <span class="texte-2">${compte}</span>
    </div>
    <input type="file" accept="image/*" capture="environment" multiple class="visually-hidden" id="input-photo">
    <button type="button" class="bouton bouton-grand" id="btn-ajouter-photo">+ Photo</button>
    <p class="texte-2" id="photos-message"></p>
    <div class="grille-photos" id="grille-photos"></div>
  `;

  const grille = conteneur.querySelector('#grille-photos');
  grille.innerHTML = photos.map((photo) => {
    const url = URL.createObjectURL(photo.blob);
    urlsActives.push(url);
    return `
      <div class="vignette-photo" data-id="${photo.id}">
        <img src="${url}" alt="Photo ${echapperHtml(String(photo.index ?? ''))}">
        <button type="button" class="btn-suppr-photo" data-id="${photo.id}" title="Supprimer" aria-label="Supprimer">✕</button>
      </div>
    `;
  }).join('');

  grille.querySelectorAll('.vignette-photo img').forEach((img) => {
    img.addEventListener('click', () => ouvrirPleinEcran(img.src, img.alt));
  });

  grille.querySelectorAll('.btn-suppr-photo').forEach((bouton) => {
    bouton.addEventListener('click', () => demanderSuppression(bouton, conteneur, branchementId));
  });

  const input = conteneur.querySelector('#input-photo');
  const boutonAjouter = conteneur.querySelector('#btn-ajouter-photo');
  boutonAjouter.addEventListener('click', () => input.click());
  input.addEventListener('change', () => gererAjoutPhotos(input, conteneur, branchementId, boutonAjouter));
}

async function gererAjoutPhotos(input, conteneur, branchementId, boutonAjouter) {
  const fichiers = Array.from(input.files ?? []);
  input.value = '';
  if (fichiers.length === 0) return;
  boutonAjouter.disabled = true;

  let avertissement = '';
  let erreur = '';
  for (const fichier of fichiers) {
    try {
      const resultat = await compresserEtStocker(branchementId, fichier);
      if (resultat.avertissement) avertissement = resultat.avertissement;
    } catch (e) {
      erreur = `Photo non enregistrée : ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  await rendreGalerie(conteneur, branchementId);

  const zoneMessage = conteneur.querySelector('#photos-message');
  if (!zoneMessage) return;
  if (erreur) {
    zoneMessage.textContent = erreur;
    zoneMessage.classList.add('texte-erreur');
  } else if (avertissement) {
    zoneMessage.textContent = avertissement;
    zoneMessage.classList.add('texte-avertissement');
  }
}

function demanderSuppression(bouton, conteneur, branchementId) {
  const vignette = bouton.closest('.vignette-photo');
  const id = Number(vignette.dataset.id);
  vignette.innerHTML = `
    <div class="confirmation-suppr-photo">
      <p>Supprimer ?</p>
      <div class="rangee-boutons">
        <button type="button" class="bouton btn-annuler-suppr-photo">Non</button>
        <button type="button" class="bouton btn-danger btn-confirmer-suppr-photo">Oui</button>
      </div>
    </div>
  `;
  vignette.querySelector('.btn-annuler-suppr-photo').addEventListener('click', () => {
    rendreGalerie(conteneur, branchementId);
  });
  vignette.querySelector('.btn-confirmer-suppr-photo').addEventListener('click', async () => {
    await supprimerPhoto(id);
    await rendreGalerie(conteneur, branchementId);
  });
}

function ouvrirPleinEcran(url, alt) {
  const overlay = document.createElement('div');
  overlay.className = 'photo-plein-ecran';
  overlay.innerHTML = `<img src="${echapperHtml(url)}" alt="${echapperHtml(alt ?? '')}">`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Scan de code-barres (matricule compteur, §7.2/§8).
// ---------------------------------------------------------------------------

/**
 * Lance un scan de code-barres via la caméra arrière (`BarcodeDetector`).
 * Overlay plein écran (vidéo + bouton Annuler) ; le flux est TOUJOURS arrêté
 * à la fermeture (détection réussie, Annuler, ou navigation pendant le scan).
 *
 * Repli immédiat (aucun flux caméra ouvert) si `BarcodeDetector` est absent,
 * si `getUserMedia` échoue (refus/permission/absence de caméra), ou si la
 * construction du détecteur échoue.
 *
 * @param {(valeur: string) => void} onTrouve
 * @param {(raison: 'indisponible'|'refus'|'annule'|'navigation') => void} onAnnuleOuEchec
 */
export async function scannerCodeBarre(onTrouve, onAnnuleOuEchec) {
  if (!('BarcodeDetector' in window)) {
    onAnnuleOuEchec('indisponible');
    return;
  }

  let flux;
  try {
    flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    onAnnuleOuEchec('refus');
    return;
  }

  let detecteur;
  try {
    detecteur = new BarcodeDetector();
  } catch {
    flux.getTracks().forEach((piste) => piste.stop());
    onAnnuleOuEchec('indisponible');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <video class="scan-video" autoplay playsinline muted></video>
    <div class="scan-controles">
      <button type="button" class="bouton bouton-grand" id="btn-annuler-scan">Annuler</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const video = overlay.querySelector('video');
  video.srcObject = flux;

  let arrete = false;
  let occupe = false;
  let minuteur = null;

  function arreter() {
    if (arrete) return;
    arrete = true;
    if (minuteur) clearInterval(minuteur);
    flux.getTracks().forEach((piste) => piste.stop());
    overlay.remove();
    window.removeEventListener('hashchange', surNavigation);
  }

  function surNavigation() {
    arreter();
    onAnnuleOuEchec('navigation');
  }

  overlay.querySelector('#btn-annuler-scan').addEventListener('click', () => {
    arreter();
    onAnnuleOuEchec('annule');
  });
  window.addEventListener('hashchange', surNavigation);

  minuteur = setInterval(async () => {
    if (arrete || occupe) return;
    occupe = true;
    try {
      const codes = await detecteur.detect(video);
      if (!arrete && codes.length > 0) {
        const valeur = codes[0].rawValue;
        arreter();
        onTrouve(valeur);
      }
    } catch {
      // Frame pas encore prête ou erreur ponctuelle de décodage : on continue.
    } finally {
      occupe = false;
    }
  }, 200);
}
