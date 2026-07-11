/**
 * Règles de dérivation de colonnes calculées du fichier Excel GRDF PB 2032.
 * Les formules utilisent les valeurs de référence (refListes) lues à l'import
 * depuis l'onglet Listes, jamais codées en dur.
 * L'ordre est garanti par le lecteur de fichier (Task 8).
 *
 * @typedef {object} RefListes
 * @property {string[]} equipements - 5 valeurs ordonnées des accessoires (Listes!D2:D6)
 * @property {string[]} bagues - 5 valeurs ordonnées des bagues (Listes!K2:K6); index 0 = valeur non-protectrice
 * @property {string[]} pressions - 3 valeurs ordonnées de pression (Listes!L2:L4)
 */

/**
 * Comparateur pour tri intelligent des numéros de rue.
 * Extrait la partie numérique et le suffixe alphanumérique, puis compare en ordre:
 * 1. Numérique < Non-numérique
 * 2. Numérique: compare les entiers, puis les suffixes alphabétiquement
 * 3. Non-numérique: ordre alphabétique
 * 4. Chaîne vide toujours en dernier
 *
 * @param {*} a - Première valeur (sera convertie en string)
 * @param {*} b - Deuxième valeur (sera convertie en string)
 * @returns {number} -1 si a < b, 0 si a === b, 1 si a > b
 */
export function comparerNumeros(a, b) {
  // Convertir en string et trimmer
  const aStr = String(a ?? '').trim();
  const bStr = String(b ?? '').trim();

  // Les chaînes vides vont toujours en dernier
  if (aStr === '' && bStr === '') return 0;
  if (aStr === '') return 1;
  if (bStr === '') return -1;

  // Extraire la partie numérique et le suffixe
  const regexNum = /^(\d+)(.*)$/;
  const matchA = aStr.match(regexNum);
  const matchB = bStr.match(regexNum);

  const hasNumA = matchA !== null;
  const hasNumB = matchB !== null;

  // Si l'un a un numéro et l'autre pas, le numérique vient en premier
  if (hasNumA && !hasNumB) return -1;
  if (!hasNumA && hasNumB) return 1;

  // Si tous les deux ont un numérique
  if (hasNumA && hasNumB) {
    const numA = parseInt(matchA[1], 10);
    const numB = parseInt(matchB[1], 10);
    if (numA !== numB) return numA - numB;
    // Même numérique: comparer les suffixes alphabétiquement
    const suffixA = matchA[2];
    const suffixB = matchB[2];
    return suffixA.localeCompare(suffixB);
  }

  // Aucun n'a de numérique: ordre alphabétique
  return aStr.localeCompare(bStr);
}

/**
 * Normalise une valeur pour la recherche instantanée.
 * Supprime accents, convertit en minuscules, réduit les espaces multiples.
 *
 * @param {*} v - Valeur à normaliser (string, number, ou autre)
 * @returns {string} Valeur normalisée
 */
export function normaliser(v) {
  if (v == null) return '';
  return String(v)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Calcule la pression (colonne V) à partir des accessoires et de la bague de protection.
 * Règle métier :
 * - Détendeur présent → MPB
 * - Robinet + compteur sans détendeur → BP
 * - Robinet seul ou improductif → MPB si bague protectrice, sinon "à renseigner"
 * - Accessoires vides ou inconnus → "à renseigner"
 *
 * @param {string} accessoires - Valeur de la colonne S (Accessoires présents dans le coffret)
 * @param {string} bague - Valeur de la colonne T (Bague de protection)
 * @param {RefListes} ref - Objet refListes contenant equipements, bagues, pressions
 * @returns {string} Pression calculée (MPB, BP ou à renseigner)
 */
export function calculerPression(accessoires, bague, ref) {
  const [robinetDetendeurCompteur, robinetDetendeur, robinetCompteur, robinetSeul, improductif] = ref.equipements;
  const [MPB, BP, A_RENSEIGNER] = ref.pressions;
  const baguesProtectrices = ref.bagues.slice(1); // PBDI, MBDI, DPBE, DPBA

  if (accessoires === robinetDetendeurCompteur || accessoires === robinetDetendeur) return MPB;
  if (accessoires === robinetCompteur) return BP;
  if (accessoires === robinetSeul || accessoires === improductif)
    return baguesProtectrices.includes(bague) ? MPB : A_RENSEIGNER;
  return A_RENSEIGNER;
}

/**
 * Retourne la valeur effective d'un champ : saisie si présente, sinon client.
 *
 * @param {object} b - Branchement avec valeursClient et saisies
 * @param {string} cle - Clé du champ
 * @returns {*} Valeur effective (saisie prime sur client)
 */
export function valeurEffective(b, cle) {
  return b.saisies[cle] ?? b.valeursClient[cle];
}

/**
 * Teste si une valeur est non-vide (non null, non undefined, non chaîne vide).
 *
 * @param {*} val - Valeur à tester
 * @returns {boolean} true si la valeur est non-vide
 */
const estNonVide = (val) => val != null && val !== '';

/**
 * Calcule les statuts d'un branchement.
 *
 * @param {object} b - Branchement avec valeursClient, saisies, ajoute
 * @returns {object} Objet avec aFaire, identifie, reporte, pointArret, diTechnique, ajoute
 */
export function calculerStatuts(b) {
  const identificationPb = valeurEffective(b, 'identificationPb');
  const constatCoffret = valeurEffective(b, 'constatCoffret');
  const typeReport = valeurEffective(b, 'typeReport');
  const pointArretValeur = valeurEffective(b, 'pointArret');
  const causeDi = valeurEffective(b, 'causeDi');

  const identifie = identificationPb === 1 || estNonVide(constatCoffret);
  const reporte = estNonVide(typeReport);
  const pointArretPresent = estNonVide(pointArretValeur);
  const diTechniquePresent = estNonVide(causeDi);
  const aFaire = !identifie;

  return {
    aFaire,
    identifie,
    reporte,
    pointArret: pointArretPresent,
    diTechnique: diTechniquePresent,
    ajoute: b.ajoute === true,
  };
}

/**
 * Calcule la complétude d'un branchement.
 *
 * @param {object} valeursEffectives - Objet plat des valeurs effectives
 * @returns {object} Objet avec complets (count) et requis (count)
 */
export function calculerCompletude(valeursEffectives) {
  // Champs toujours requis
  const champsRequis = ['constatCoffret', 'constatBrt', 'matiere', 'accessoires', 'bague'];
  let requis = champsRequis.length;
  let complets = champsRequis.filter(cle => estNonVide(valeursEffectives[cle])).length;

  // Longueur de sonde requise si bague === 'DPBE'
  if (valeursEffectives.bague === 'DPBE') {
    requis++;
    if (estNonVide(valeursEffectives.longueurSonde)) {
      complets++;
    }
  }

  // Diamètre requis si matière === 'PE'
  if (valeursEffectives.matiere === 'PE') {
    requis++;
    if (estNonVide(valeursEffectives.diametre)) {
      complets++;
    }
  }

  return { complets, requis };
}
