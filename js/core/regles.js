/**
 * Règles de dérivation de colonnes calculées du fichier Excel GRDF PB 2032.
 * Les formules utilisent les valeurs de référence (refListes) lues à l'import
 * depuis l'onglet Listes, jamais codées en dur.
 *
 * @typedef {object} RefListes
 * @property {string[]} equipements - 5 valeurs ordonnées des accessoires (Listes!D2:D6)
 * @property {string[]} bagues - 5 valeurs ordonnées des bagues (Listes!K2:K6); index 0 = valeur non-protectrice
 * @property {string[]} pressions - 3 valeurs ordonnées de pression (Listes!L2:L4)
 * L'ordre est garanti par le lecteur de fichier (Task 8).
 */

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
 * @param {object} ref - Objet refListes contenant equipements, bagues, pressions
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
 * Calcule les statuts d'un branchement.
 *
 * @param {object} b - Branchement avec valeursClient, saisies, ajoute
 * @returns {object} Objet avec aFaire, identifie, reporte, pointArret, diTechnique, ajoute
 */
export function calculerStatuts(b) {
  const identificationPb = valeurEffective(b, 'identificationPb');
  const constatCoffret = valeurEffective(b, 'constatCoffret');
  const typeReport = valeurEffective(b, 'typeReport');
  const pointArret = valeurEffective(b, 'pointArret');
  const causeDi = valeurEffective(b, 'causeDi');

  const estNonVide = (val) => val != null && val !== '';

  const identifie = identificationPb === 1 || estNonVide(constatCoffret);
  const reporte = estNonVide(typeReport);
  const pointArretPresent = estNonVide(pointArret);
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
  const estNonVide = (val) => val != null && val !== '';

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
