/**
 * Carte des 41 colonnes (A → AO) du fichier Excel GRDF PB 2032.
 * Source unique de vérité pour le mappage des colonnes et leurs métadonnées.
 */

/**
 * Convertit une lettre de colonne Excel en index 1-based (base 26 bijective).
 * @param {string} lettre - Lettre de colonne (ex. 'A', 'AB'), casse indifférente.
 * @returns {number} Index 1-based ('A' → 1, 'AO' → 41).
 */
export function lettreVersIndex(lettre) {
  const majuscules = lettre.toUpperCase();
  let index = 0;
  for (let i = 0; i < majuscules.length; i++) {
    const code = majuscules.charCodeAt(i) - 64; // A=1, B=2, ..., Z=26
    index = index * 26 + code;
  }
  return index;
}

/**
 * Convertit un index 1-based en lettre de colonne Excel (base 26 bijective).
 * @param {number} index - Index 1-based (1 → 'A', 28 → 'AB').
 * @returns {string} Lettre de colonne Excel.
 */
export function indexVersLettre(index) {
  let lettre = '';
  while (index > 0) {
    index -= 1; // Adjust for bijective base-26
    lettre = String.fromCharCode(65 + (index % 26)) + lettre;
    index = Math.floor(index / 26);
  }
  return lettre;
}

// Array of 41 column definitions (A → AO)
export const COLONNES = [
  { lettre: 'A', cle: 'insee', libelle: 'INSEE', zone: 'infosClient', type: 'texte' },
  { lettre: 'B', cle: 'commune', libelle: 'Commune', zone: 'infosClient', type: 'texte' },
  { lettre: 'C', cle: 'rue', libelle: 'Rue', zone: 'infosClient', type: 'texte' },
  { lettre: 'D', cle: 'numero', libelle: 'N°', zone: 'infosClient', type: 'texte' },
  { lettre: 'E', cle: 'complement', libelle: 'Complément Adresse', zone: 'infosClient', type: 'texte' },
  { lettre: 'F', cle: 'nomClient', libelle: 'Nom du client', zone: 'infosClient', type: 'texte' },
  { lettre: 'G', cle: 'pce', libelle: 'N° PCE', zone: 'infosClient', type: 'texte' },
  { lettre: 'H', cle: 'matricule', libelle: 'Matricule compteur', zone: 'infosClient', type: 'texte' },
  { lettre: 'I', cle: 'situationCompteur', libelle: 'Situation compteur', zone: 'infosClient', type: 'texte' },
  { lettre: 'J', cle: 'etatTechnique', libelle: 'Etat technique', zone: 'infosClient', type: 'texte' },
  { lettre: 'K', cle: 'typeClient', libelle: 'Type client', zone: 'infosClient', type: 'texte' },
  { lettre: 'L', cle: 'idCoffret', libelle: 'ID coffret', zone: 'ignorees', type: 'texte' },
  { lettre: 'M', cle: 'plan', libelle: 'Plan', zone: 'ignorees', type: 'texte' },
  { lettre: 'N', cle: 'commentairePrecision', libelle: 'Commentaire / précision', zone: 'ignorees', type: 'texte' },
  { lettre: 'O', cle: 'constatCoffret', libelle: 'Constat Coffret', zone: 'identification', type: 'liste' },
  { lettre: 'P', cle: 'constatBrt', libelle: 'Constat BRT CARTO', zone: 'identification', type: 'liste' },
  { lettre: 'Q', cle: 'matiere', libelle: 'Matière du branchement en amont du robinet', zone: 'identification', type: 'liste' },
  { lettre: 'R', cle: 'diametre', libelle: 'Diamètre (facultatif)', zone: 'identification', type: 'listeCascade' },
  { lettre: 'S', cle: 'accessoires', libelle: 'Accessoires présents dans le coffret', zone: 'identification', type: 'liste' },
  { lettre: 'T', cle: 'bague', libelle: 'Bague de protection', zone: 'identification', type: 'liste' },
  { lettre: 'U', cle: 'longueurSonde', libelle: 'Si DPBE, longueur d\'introduction de la sonde (mètre)', zone: 'identification', type: 'nombre' },
  { lettre: 'V', cle: 'pression', libelle: 'Pression', zone: 'identification', type: 'calcule' },
  { lettre: 'W', cle: 'codeBarreCompteur', libelle: 'Code barre compteur', zone: 'ignorees', type: 'texte' },
  { lettre: 'X', cle: 'typeClient2', libelle: 'Type client2', zone: 'ignorees', type: 'texte' },
  { lettre: 'Y', cle: 'emplacementRegulateur', libelle: 'Emplacement regulateur', zone: 'ignorees', type: 'texte' },
  { lettre: 'Z', cle: 'codeBarreRegulateur', libelle: 'Code barre regulateur', zone: 'ignorees', type: 'texte' },
  { lettre: 'AA', cle: 'sigleCabRegulateur', libelle: 'Sigle code barre fictif régulateur', zone: 'ignorees', type: 'texte' },
  { lettre: 'AB', cle: 'cabFictif', libelle: 'Code barre fictif avec tous les chiffres', zone: 'ignorees', type: 'texte' },
  { lettre: 'AC', cle: 'anneeRegulateur', libelle: 'Année regulateur', zone: 'ignorees', type: 'texte' },
  { lettre: 'AD', cle: 'changementRegulateur', libelle: 'Changement de régulateur = noter 1', zone: 'ignorees', type: 'texte' },
  { lettre: 'AE', cle: 'commentaireIdent', libelle: 'Commentaire', zone: 'identification', type: 'texte' },
  { lettre: 'AF', cle: 'phaseTerrain', libelle: 'Phase terrain', zone: 'identification', type: 'liste' },
  { lettre: 'AG', cle: 'identificationPb', libelle: 'Identification PB 2032', zone: 'identification', type: 'nombre' },
  { lettre: 'AH', cle: 'typeReport', libelle: 'Type report', zone: 'report', type: 'liste' },
  { lettre: 'AI', cle: 'appareil', libelle: 'Appareil de détection utilisé', zone: 'report', type: 'liste' },
  { lettre: 'AJ', cle: 'classeBrt', libelle: 'Classe du branchement', zone: 'report', type: 'liste' },
  { lettre: 'AK', cle: 'pointArret', libelle: 'Point d\'arrêt', zone: 'report', type: 'liste' },
  { lettre: 'AL', cle: 'causeDi', libelle: 'Cause de la DI technique', zone: 'report', type: 'liste' },
  { lettre: 'AM', cle: 'ajoutNumero', libelle: 'Ajout N° adresse', zone: 'report', type: 'nombre' },
  { lettre: 'AN', cle: 'commentaireReport', libelle: 'Commentaire2', zone: 'report', type: 'texte' },
  { lettre: 'AO', cle: 'statutPb', libelle: 'Statut branchement PB 2032', zone: 'ignorees', type: 'texte' },
];

// Derive ZONES from COLONNES
export const ZONES = {
  infosClient: COLONNES.filter(c => c.zone === 'infosClient').map(c => c.lettre),
  identification: COLONNES.filter(c => c.zone === 'identification').map(c => c.lettre),
  report: COLONNES.filter(c => c.zone === 'report').map(c => c.lettre),
  ignorees: COLONNES.filter(c => c.zone === 'ignorees').map(c => c.lettre),
};
