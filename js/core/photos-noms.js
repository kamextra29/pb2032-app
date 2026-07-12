import { valeurEffective, normaliser } from './regles.js';

/**
 * Génère le nom de fichier normalisé pour une photo de branchement.
 * Format: {numero}_{rue}_{pce}_{index}.jpg
 *
 * @param {Object} infos - Infos du branchement
 * @param {string} [infos.numero] - N° de rue ('' ou absent → 'SN')
 * @param {string} infos.rue - Nom de rue
 * @param {string|number} [infos.pce] - Identifiant PCE
 * @param {number} [infos.ligne] - N° de ligne Excel (repli si pas PCE)
 * @param {number} [infos.ajoutId] - ID d'ajout branchement (repli si pas PCE)
 * @param {number} index - Indice photo du branchement
 * @returns {string} Nom de fichier normalisé
 */
export function nomPhoto(infos, index) {
  // Normalisation du numéro (String() : les valeurs Excel peuvent être des nombres ;
  // ?? pour conserver un numéro 0, placeholder GRDF)
  let numeroPart = normalizeForPhoto(String(infos.numero ?? ''));
  if (!numeroPart) {
    numeroPart = 'SN';
  }

  // Normalisation de la rue
  const ruePart = normalizeForPhoto(String(infos.rue || ''));

  // Partie PCE (avec replis ajoutId puis ligne)
  let pcePart;
  const pceStr = String(infos.pce || '').trim();
  if (pceStr) {
    pcePart = pceStr;
  } else if (infos.ajoutId !== undefined) {
    pcePart = 'A' + String(infos.ajoutId).padStart(4, '0');
  } else if (infos.ligne !== undefined) {
    pcePart = 'L' + String(infos.ligne).padStart(4, '0');
  } else {
    throw new Error('nomPhoto : ni PCE, ni ajoutId, ni ligne fournis');
  }

  return `${numeroPart}_${ruePart}_${pcePart}_${index}.jpg`;
}

/**
 * Normalise un texte pour le nommage de photos:
 * - Supprime les accents (NFD + suppression diacritiques)
 * - Convertit en majuscules
 * - Remplace les caractères non alphanumériques par des tirets
 * - Réduit les tirets multiples
 * - Supprime les tirets en début/fin
 *
 * @param {string} text - Texte à normaliser
 * @returns {string} Texte normalisé ('' si vide)
 */
function normalizeForPhoto(text) {
  if (!text) return '';

  // Décomposition NFD des accents, puis suppression des marques diacritiques
  let normalized = text
    .normalize('NFD')
    .replace(/[\p{Diacritic}]/gu, '')
    .toUpperCase();

  // Remplace les caractères hors [A-Z0-9] par des tirets
  normalized = normalized.replace(/[^A-Z0-9]/g, '-');

  // Réduit les tirets multiples
  normalized = normalized.replace(/-+/g, '-');

  // Supprime les tirets en début/fin
  normalized = normalized.replace(/^-+|-+$/g, '');

  return normalized;
}

/**
 * Construit les entrées d'un export ZIP de photos (Task 17, §8) : fonction
 * pure, testée sous Node — aucun accès à IndexedDB ni à JSZip ici, l'appelant
 * (js/ui/accueil.js) fournit les photos déjà chargées et se charge de
 * construire l'archive.
 *
 * Le nom de chaque photo est calculé à partir des valeurs EFFECTIVES du
 * branchement (`valeurEffective` : saisie/correction si présente, sinon
 * valeur client) — une adresse corrigée sur le terrain produit donc un nom à
 * jour, y compris pour des photos ajoutées avant la correction.
 *
 * Filtre d'étendue (`filtre`) : `commune`, `rue` et/ou `phase` (clé
 * `phaseTerrain`), chacun comparé via `normaliser()` (accents/casse/espaces
 * tolérés). Un champ absent ou vide n'est pas appliqué ; `filtre` absent ou
 * `{}` = tout le dossier. Un branchement sans aucune photo est ignoré
 * silencieusement (il ne produit aucune entrée).
 *
 * Dédoublonnage défensif : si deux photos (de deux branchements distincts,
 * normalement impossible mais les données clients peuvent être
 * surprenantes — adresses dupliquées, PCE ré-utilisé…) produisent le même
 * nom de fichier, les occurrences suivantes reçoivent un suffixe `-2`, `-3`…
 * avant l'extension, jamais de fichier silencieusement écrasé dans le zip.
 *
 * @param {object[]} branchements - Branchements du store (`valeursClient`, `saisies`, `ligne`, `ajoutId`, `id`)
 * @param {Map<number, object[]>} photosParBranchement - Photos regroupées par `branchementId` (chaque photo : `{id, index, blob, ...}`)
 * @param {{commune?: string, rue?: string, phase?: string}} [filtre] - Étendue de l'export ; absent/vide = tout le dossier
 * @returns {{nom: string, photo: object}[]} Entrées du zip : nom de fichier unique + photo source (porte `blob`)
 */
export function construireEntreesZip(branchements, photosParBranchement, filtre = {}) {
  const nomsVus = new Map();
  const entrees = [];

  for (const branchement of branchements) {
    if (!correspondFiltre(branchement, filtre)) continue;

    const photos = photosParBranchement.get(branchement.id);
    if (!photos || photos.length === 0) continue;

    const infos = {
      numero: valeurEffective(branchement, 'numero'),
      rue: valeurEffective(branchement, 'rue'),
      pce: valeurEffective(branchement, 'pce'),
      ligne: branchement.ligne ?? undefined,
      ajoutId: branchement.ajoutId,
    };

    const photosTriees = [...photos].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const photo of photosTriees) {
      const nom = nomUnique(nomPhoto(infos, photo.index), nomsVus);
      entrees.push({ nom, photo });
    }
  }

  return entrees;
}

/** Teste si un branchement correspond au filtre d'étendue (valeurs effectives, comparaison normalisée). */
function correspondFiltre(branchement, filtre) {
  if (filtre?.commune && normaliser(valeurEffective(branchement, 'commune')) !== normaliser(filtre.commune)) {
    return false;
  }
  if (filtre?.rue && normaliser(valeurEffective(branchement, 'rue')) !== normaliser(filtre.rue)) {
    return false;
  }
  if (filtre?.phase && normaliser(valeurEffective(branchement, 'phaseTerrain')) !== normaliser(filtre.phase)) {
    return false;
  }
  return true;
}

/** Renvoie `nom` inchangé la première fois vu, sinon `base-2.ext`, `base-3.ext`… */
function nomUnique(nom, nomsVus) {
  const compte = (nomsVus.get(nom) ?? 0) + 1;
  nomsVus.set(nom, compte);
  if (compte === 1) return nom;

  const pointFinal = nom.lastIndexOf('.');
  const base = pointFinal === -1 ? nom : nom.slice(0, pointFinal);
  const extension = pointFinal === -1 ? '' : nom.slice(pointFinal);
  return `${base}-${compte}${extension}`;
}
