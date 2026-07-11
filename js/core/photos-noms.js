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
  // Normalisation du numéro (String() : les valeurs Excel peuvent être des nombres)
  let numeroPart = normalizeForPhoto(String(infos.numero || ''));
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
 */
function normalizeForPhoto(text) {
  if (!text) return '';

  // NFD decompose accents, then remove diacritical marks
  let normalized = text
    .normalize('NFD')
    .replace(/[\p{Diacritic}]/gu, '')
    .toUpperCase();

  // Replace chars outside [A-Z0-9] with dash
  normalized = normalized.replace(/[^A-Z0-9]/g, '-');

  // Collapse multiple dashes
  normalized = normalized.replace(/-+/g, '-');

  // Trim leading/trailing dashes
  normalized = normalized.replace(/^-+|-+$/g, '');

  return normalized;
}
