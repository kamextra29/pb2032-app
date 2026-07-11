/**
 * Règles de dérivation de colonnes calculées du fichier Excel GRDF PB 2032.
 * Les formules utilisent les valeurs de référence (refListes) lues à l'import
 * depuis l'onglet Listes, jamais codées en dur.
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
  const [dtc, dt, rc, seul, impro] = ref.equipements;
  const [MPB, BP, A_RENSEIGNER] = ref.pressions;
  const baguesProtectrices = ref.bagues.slice(1); // PBDI, MBDI, DPBE, DPBA

  if (accessoires === dtc || accessoires === dt) return MPB;
  if (accessoires === rc) return BP;
  if (accessoires === seul || accessoires === impro)
    return baguesProtectrices.includes(bague) ? MPB : A_RENSEIGNER;
  return A_RENSEIGNER;
}
