/**
 * Lecture ciblée du fichier client Excel « Annexe 7 PB 2032 ».
 *
 * Contrainte majeure : la feuille de données décompressée pèse ~60 Mo (25 556 lignes,
 * formules V/AB répétées). Aucun parsing DOM complet ici : on scanne le XML en texte,
 * bloc `<row>` par bloc `<row>`, et on arrête dès que 50 lignes consécutives n'ont
 * aucune donnée A–K (les lignes vides pré-formatées ne sont jamais parcourues).
 *
 * Doit tourner en Web Worker ET en Node : pas de DOM, pas de DOMParser, pas d'IndexedDB.
 */

import JSZip from '../lib/zip.mjs';
import { COLONNES, lettreVersIndex, indexVersLettre } from './colonnes.js';
import { normaliser } from './regles.js';

const NOM_FEUILLE_PB = 'Protection Branchements 2032';
const NOM_TABLE = 'Tableau1';
const MAX_LIGNES_VIDES_CONSECUTIVES = 50;

// Colonnes A–K (infosClient) dont au moins une doit être non vide pour qu'une ligne
// compte comme « ligne de données » (§6.3 de la spec).
const COLONNES_A_K = COLONNES.filter(c => lettreVersIndex(c.lettre) <= lettreVersIndex('K'));

// Colonnes dont la ligne 3 (en-tête) est vérifiée à l'import (§6.2).
const COLONNES_ENTETE_VERIFIEES = ['A', 'B', 'C', 'D', 'G', 'H', 'O', 'Q', 'S', 'T', 'V', 'AF', 'AG', 'AH', 'AO'];

/**
 * Lit un fichier .xlsx client et en extrait les branchements, les listes et les
 * références nécessaires aux règles métier.
 * @param {Uint8Array} octets - Contenu binaire du fichier .xlsx.
 * @returns {Promise<{dossier: object|null, branchements: Array|null, erreurs: string[]}>}
 */
export async function lireFichier(octets) {
  let zip;
  try {
    zip = await JSZip.loadAsync(octets);
  } catch {
    return { dossier: null, branchements: null, erreurs: ["Le fichier n'a pas pu être lu : ce n'est pas un fichier .xlsx valide."] };
  }

  const workbookXml = await lireEntreeTexte(zip, 'xl/workbook.xml');
  const workbookRelsXml = await lireEntreeTexte(zip, 'xl/_rels/workbook.xml.rels');
  if (workbookXml === null || workbookRelsXml === null) {
    return { dossier: null, branchements: null, erreurs: ["Le fichier n'a pas pu être lu : structure de classeur Excel absente ou invalide."] };
  }

  const feuilles = litFeuilles(workbookXml, workbookRelsXml);
  const cheminFeuillePb = feuilles.get(NOM_FEUILLE_PB);
  if (!cheminFeuillePb) {
    return {
      dossier: null,
      branchements: null,
      erreurs: [`Ce fichier ne ressemble pas à une Annexe 7 PB 2032 : l'onglet « ${NOM_FEUILLE_PB} » est introuvable.`],
    };
  }

  const sheetXml = await lireEntreeTexte(zip, cheminFeuillePb);
  if (sheetXml === null) {
    return { dossier: null, branchements: null, erreurs: [`Ce fichier ne ressemble pas à une Annexe 7 PB 2032 : la feuille « ${NOM_FEUILLE_PB} » est illisible.`] };
  }

  // Table structurée Tableau1, référencée par les relations de la feuille PB.
  const tableOk = await verifieTablePresente(zip, cheminFeuillePb);
  if (!tableOk) {
    return {
      dossier: null,
      branchements: null,
      erreurs: [`Ce fichier ne ressemble pas à une Annexe 7 PB 2032 : le tableau structuré « ${NOM_TABLE} » est introuvable.`],
    };
  }

  // Les en-têtes sont des chaînes partagées : sharedStrings.xml doit être chargé
  // avant toute lecture de valeur de cellule (en-têtes comme données).
  const sharedStringsXml = await lireEntreeTexte(zip, 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml ? litSharedStrings(sharedStringsXml) : [];

  const erreursEntete = verifieEntetes(sheetXml, sharedStrings);
  if (erreursEntete.length > 0) {
    return { dossier: null, branchements: null, erreurs: erreursEntete };
  }

  // Feuille Listes : nécessaire pour résoudre les plages nommées et la validation x14.
  const cheminFeuilleListes = feuilles.get('Listes');
  let grilleListes = new Map();
  if (cheminFeuilleListes) {
    const listesXml = await lireEntreeTexte(zip, cheminFeuilleListes);
    if (listesXml) grilleListes = construireGrille(listesXml, sharedStrings);
  }

  const definedNames = litDefinedNames(workbookXml);

  const { branchements, derniereLigneDonnees } = litLignesDonnees(sheetXml, sharedStrings);

  const listes = construireListes(definedNames, grilleListes, sheetXml, branchements);
  const refListes = {
    equipements: listes.accessoires,
    bagues: listes.bague,
    pressions: listes.pression,
  };

  const dossier = {
    nomFeuillePb: NOM_FEUILLE_PB,
    cheminFeuillePb,
    listes,
    refListes,
    derniereLigneDonnees,
  };

  return { dossier, branchements, erreurs: [] };
}

// ---------------------------------------------------------------------------
// Lecture des entrées du zip.
// ---------------------------------------------------------------------------

async function lireEntreeTexte(zip, chemin) {
  const entree = zip.file(chemin);
  if (!entree) return null;
  return entree.async('string');
}

// ---------------------------------------------------------------------------
// sharedStrings.xml
// ---------------------------------------------------------------------------

/**
 * Parse xl/sharedStrings.xml en tableau indexé de chaînes.
 * Un `<si>` peut contenir plusieurs `<t>` (texte enrichi `<r>`) : on concatène.
 * @param {string} xml - Contenu de xl/sharedStrings.xml.
 * @returns {string[]} Chaînes indexées par leur position dans le fichier.
 */
export function litSharedStrings(xml) {
  const valeurs = [];
  const reSi = /<si>([\s\S]*?)<\/si>/g;
  let matchSi;
  while ((matchSi = reSi.exec(xml)) !== null) {
    const contenu = matchSi[1];
    let texte = '';
    const reT = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let matchT;
    while ((matchT = reT.exec(contenu)) !== null) {
      texte += deseChapperXml(matchT[1]);
    }
    valeurs.push(texte);
  }
  return valeurs;
}

// ---------------------------------------------------------------------------
// workbook.xml + xl/_rels/workbook.xml.rels : nom de feuille -> chemin.
// ---------------------------------------------------------------------------

/**
 * Associe chaque nom de feuille du classeur à son chemin dans le zip, en passant
 * par les relations (jamais de chemin de feuille codé en dur).
 * @param {string} workbookXml - Contenu de xl/workbook.xml.
 * @param {string} relsXml - Contenu de xl/_rels/workbook.xml.rels.
 * @returns {Map<string, string>} Nom de feuille -> chemin complet dans le zip.
 */
export function litFeuilles(workbookXml, relsXml) {
  const idParRelation = new Map();
  const reRel = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g;
  let matchRel;
  while ((matchRel = reRel.exec(relsXml)) !== null) {
    const [, id, target] = matchRel;
    // Les cibles des relations du classeur sont relatives à xl/.
    const chemin = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    idParRelation.set(id, chemin);
  }

  const feuilles = new Map();
  const reSheet = /<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"[^>]*\/>/g;
  let matchSheet;
  while ((matchSheet = reSheet.exec(workbookXml)) !== null) {
    const [, nomEchappe, rid] = matchSheet;
    const chemin = idParRelation.get(rid);
    if (chemin) feuilles.set(deseChapperXml(nomEchappe), chemin);
  }
  return feuilles;
}

/**
 * Parse les plages nommées (`<definedName>`) de xl/workbook.xml.
 * @param {string} workbookXml - Contenu de xl/workbook.xml.
 * @returns {Map<string, string>} Nom -> référence brute (ex. 'Listes!$A$2:$A$5').
 */
export function litDefinedNames(workbookXml) {
  const noms = new Map();
  const re = /<definedName\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/definedName>/g;
  let match;
  while ((match = re.exec(workbookXml)) !== null) {
    const [, nomEchappe, refEchappee] = match;
    noms.set(deseChapperXml(nomEchappe), deseChapperXml(refEchappee).trim());
  }
  return noms;
}

// ---------------------------------------------------------------------------
// Table structurée Tableau1 : présence + rattachement à la feuille PB.
// ---------------------------------------------------------------------------

async function verifieTablePresente(zip, cheminFeuillePb) {
  // 1) La feuille PB doit référencer une table via ses relations.
  const dossierFeuille = cheminFeuillePb.slice(0, cheminFeuillePb.lastIndexOf('/'));
  const nomFichierFeuille = cheminFeuillePb.slice(cheminFeuillePb.lastIndexOf('/') + 1);
  const cheminRelsFeuille = `${dossierFeuille}/_rels/${nomFichierFeuille}.rels`;
  const relsFeuilleXml = await lireEntreeTexte(zip, cheminRelsFeuille);
  if (!relsFeuilleXml) return false;

  const chemins = [];
  const reRel = /<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\/>/g;
  let match;
  while ((match = reRel.exec(relsFeuilleXml)) !== null) {
    const target = match[1];
    const chemin = target.startsWith('/')
      ? target.slice(1)
      : resoudreCheminRelatif(dossierFeuille, target);
    chemins.push(chemin);
  }

  // 2) Parmi les chemins référencés, vérifier qu'au moins une table s'appelle Tableau1.
  for (const chemin of chemins) {
    if (!chemin.includes('/tables/')) continue;
    const tableXml = await lireEntreeTexte(zip, chemin);
    if (tableXml && new RegExp(`\\bname="${NOM_TABLE}"`).test(tableXml)) return true;
  }
  return false;
}

/** Résout un chemin relatif (`../tables/table1.xml`) depuis un dossier de base. */
function resoudreCheminRelatif(dossierBase, relatif) {
  const segments = dossierBase.split('/');
  for (const partie of relatif.split('/')) {
    if (partie === '..') segments.pop();
    else if (partie !== '.') segments.push(partie);
  }
  return segments.join('/');
}

// ---------------------------------------------------------------------------
// Vérification des en-têtes (ligne 3).
// ---------------------------------------------------------------------------

function verifieEntetes(sheetXml, sharedStrings) {
  const ligne3Xml = extraireBlocLigne(sheetXml, 3);
  if (ligne3Xml === null) {
    return ["Ce fichier ne ressemble pas à une Annexe 7 PB 2032 : la ligne d'en-têtes (ligne 3) est introuvable."];
  }
  const cellules = litCellules(ligne3Xml);
  const cellulesParCol = new Map(cellules.map(c => [c.col, c]));

  const erreurs = [];
  for (const lettre of COLONNES_ENTETE_VERIFIEES) {
    const colonne = COLONNES.find(c => c.lettre === lettre);
    const cellule = cellulesParCol.get(lettre);
    const valeur = cellule ? valeurCellule(cellule, sharedStrings) : undefined;
    // Le vrai fichier a parfois des en-têtes multi-lignes (retour à la ligne dans
    // la cellule, ex. « ...\n(Champ libre) ») : on ne valide que la première ligne.
    const texteBrut = valeur === undefined ? '' : String(valeur).split('\n')[0];
    const libelleAttendu = colonne.libelle.split('\n')[0];
    if (normaliser(texteBrut) !== normaliser(libelleAttendu)) {
      erreurs.push(
        `Ce fichier ne ressemble pas à une Annexe 7 PB 2032 : en-tête inattendu en colonne ${lettre} ` +
        `(attendu « ${libelleAttendu} », obtenu « ${texteBrut} »).`
      );
    }
  }
  return erreurs;
}

// ---------------------------------------------------------------------------
// Scan séquentiel des lignes de données (A-K + O-AO, hors zones ignorées).
// ---------------------------------------------------------------------------

// Colonnes à lire dans valeursClient : zones infosClient, identification, report.
// La zone "ignorees" (L,M,N,W-AD,AO) n'est jamais reportée (le writer travaille depuis
// le fichier original, il n'en a pas besoin).
const COLONNES_LUES = COLONNES.filter(c => c.zone !== 'ignorees');

function litLignesDonnees(sheetXml, sharedStrings) {
  const branchements = [];
  let ligneVideConsecutives = 0;
  let derniereLigneDonnees = 0;

  itereLignes(sheetXml, (numeroLigne, ligneXml) => {
    if (numeroLigne < 4) return true; // continuer : avant les données (en-têtes lignes 1-3)

    const cellules = litCellules(ligneXml);
    const cellulesParCol = new Map(cellules.map(c => [c.col, c]));

    const estLigneDeDonnees = COLONNES_A_K.some(c => {
      const cellule = cellulesParCol.get(c.lettre);
      if (cellule === undefined) return false;
      const valeur = valeurCellule(cellule, sharedStrings);
      return valeur !== undefined && valeur !== '';
    });

    if (!estLigneDeDonnees) {
      ligneVideConsecutives++;
      // Arrêt anticipé : au-delà de 50 lignes vides consécutives, le reste du tableau
      // (24 600 lignes vides pré-formatées dans le vrai fichier) ne peut plus contenir
      // de données utiles.
      return ligneVideConsecutives < MAX_LIGNES_VIDES_CONSECUTIVES;
    }
    ligneVideConsecutives = 0;

    const valeursClient = {};
    for (const colonne of COLONNES_LUES) {
      const cellule = cellulesParCol.get(colonne.lettre);
      if (!cellule) continue;
      const valeur = valeurCellule(cellule, sharedStrings);
      if (valeur !== undefined && valeur !== '') valeursClient[colonne.cle] = valeur;
    }

    const celluleV = cellulesParCol.get('V');
    const valeurV = celluleV ? valeurCellule(celluleV, sharedStrings) : undefined;
    const vEnDur = !!celluleV && celluleV.f === undefined && valeurV !== undefined && valeurV !== '';

    branchements.push({ ligne: numeroLigne, valeursClient, vEnDur });
    derniereLigneDonnees = numeroLigne;
    return true;
  });

  return { branchements, derniereLigneDonnees };
}

/**
 * Itère séquentiellement sur les blocs `<row>` d'une feuille, sans jamais charger
 * l'intégralité du XML en DOM. `cb(numeroLigne, blocLigneXml)` doit renvoyer `false`
 * pour arrêter le scan plus tôt (utilisé pour la coupe des 50 lignes vides).
 * @param {string} sheetXml - Contenu XML de la feuille.
 * @param {(numeroLigne: number, ligneXml: string) => boolean} cb - Callback par ligne.
 */
export function itereLignes(sheetXml, cb) {
  const debutSheetData = sheetXml.indexOf('<sheetData');
  const finSheetData = sheetXml.indexOf('</sheetData>');
  if (debutSheetData === -1 || finSheetData === -1) return;

  const debutContenu = sheetXml.indexOf('>', debutSheetData) + 1;
  let position = debutContenu;

  while (position < finSheetData) {
    const debutRow = sheetXml.indexOf('<row', position);
    if (debutRow === -1 || debutRow >= finSheetData) break;

    const finBaliseOuvrante = sheetXml.indexOf('>', debutRow);
    // Ligne auto-fermante <row .../> (rare, ligne totalement vide sans cellules).
    if (sheetXml[finBaliseOuvrante - 1] === '/') {
      const balise = sheetXml.slice(debutRow, finBaliseOuvrante + 1);
      const numeroLigne = extraireAttributR(balise);
      position = finBaliseOuvrante + 1;
      if (numeroLigne !== null && cb(numeroLigne, balise) === false) return;
      continue;
    }

    const finRow = sheetXml.indexOf('</row>', finBaliseOuvrante);
    if (finRow === -1) break;

    const blocComplet = sheetXml.slice(debutRow, finRow + '</row>'.length);
    const numeroLigne = extraireAttributR(blocComplet);
    position = finRow + '</row>'.length;
    if (numeroLigne !== null && cb(numeroLigne, blocComplet) === false) return;
  }
}

function extraireAttributR(balise) {
  const match = /\br="(\d+)"/.exec(balise);
  return match ? Number(match[1]) : null;
}

/** Extrait le bloc `<row r="n">...</row>` d'un numéro de ligne donné (utilisé pour les en-têtes). */
function extraireBlocLigne(sheetXml, numeroLigne) {
  let trouve = null;
  itereLignes(sheetXml, (n, blocXml) => {
    if (n === numeroLigne) {
      trouve = blocXml;
      return false;
    }
    return n < numeroLigne;
  });
  return trouve;
}

// ---------------------------------------------------------------------------
// Cellules d'une ligne.
// ---------------------------------------------------------------------------

/**
 * Parse les cellules `<c>` d'un bloc `<row>...</row>`.
 * @param {string} ligneXml - Bloc XML d'une ligne (avec ou sans balises `<row>`).
 * @returns {Array<{ref: string, col: string, t: string|undefined, v: string|undefined, f: string|undefined, is: string|undefined}>}
 */
export function litCellules(ligneXml) {
  const cellules = [];
  const reCell = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  let match;
  while ((match = reCell.exec(ligneXml)) !== null) {
    const [, attributs, , contenu] = match;
    const ref = /\br="([^"]+)"/.exec(attributs)?.[1];
    if (!ref) continue;
    const col = ref.match(/^[A-Z]+/)[0];
    const t = /\bt="([^"]+)"/.exec(attributs)?.[1];

    let v;
    let f;
    let is;
    if (contenu) {
      const matchV = /<v>([\s\S]*?)<\/v>/.exec(contenu);
      if (matchV) v = matchV[1];
      const matchF = /<f[^>]*>([\s\S]*?)<\/f>/.exec(contenu);
      if (matchF) f = matchF[1];
      if (t === 'inlineStr') {
        const matchIs = /<is>([\s\S]*?)<\/is>/.exec(contenu);
        if (matchIs) {
          is = '';
          const reT = /<t[^>]*>([\s\S]*?)<\/t>/g;
          let matchT;
          while ((matchT = reT.exec(matchIs[1])) !== null) is += matchT[1];
        }
      }
    }
    cellules.push({ ref, col, t, v, f, is });
  }
  return cellules;
}

/**
 * Résout la valeur typée d'une cellule (nombre, chaîne partagée, inline, résultat
 * de formule texte). Retourne `undefined` si la cellule n'a pas de valeur lisible
 * (ex. formule sans `<v>` mis en cache).
 * @param {{t: string|undefined, v: string|undefined, is: string|undefined}} cellule
 * @param {string[]} sharedStrings - Tableau indexé (voir litSharedStrings).
 * @returns {number|string|undefined}
 */
export function valeurCellule(cellule, sharedStrings) {
  if (cellule.t === 'inlineStr') {
    return cellule.is !== undefined ? deseChapperXml(cellule.is) : undefined;
  }
  if (cellule.v === undefined) return undefined;
  if (cellule.t === 's') {
    const index = Number(cellule.v);
    return sharedStrings[index] !== undefined ? sharedStrings[index] : undefined;
  }
  if (cellule.t === 'str') {
    return deseChapperXml(cellule.v);
  }
  if (cellule.t === undefined || cellule.t === 'n') {
    return Number(cellule.v);
  }
  // Types booléens/erreur non rencontrés dans ce fichier : on renvoie le texte brut.
  return deseChapperXml(cellule.v);
}

/** Déséchappe les entités XML de base (&amp; &lt; &gt; &quot; &apos;). */
function deseChapperXml(texte) {
  return texte
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// Grille de l'onglet Listes (pour résoudre plages nommées et validations x14).
// ---------------------------------------------------------------------------

/**
 * Construit une grille `"COLONNE_LIGNE" -> valeur` de la feuille Listes, pour
 * résoudre ensuite n'importe quelle plage (verticale, horizontale, cellule unique).
 * La feuille Listes est petite (quelques dizaines de lignes) : elle est lue en entier.
 * @param {string} sheetXml - Contenu XML de la feuille Listes.
 * @param {string[]} sharedStrings - Tableau indexé.
 * @returns {Map<string, number|string>}
 */
function construireGrille(sheetXml, sharedStrings) {
  const grille = new Map();
  itereLignes(sheetXml, (numeroLigne, ligneXml) => {
    for (const cellule of litCellules(ligneXml)) {
      const valeur = valeurCellule(cellule, sharedStrings);
      if (valeur !== undefined) grille.set(`${cellule.col}${numeroLigne}`, valeur);
    }
    return true;
  });
  return grille;
}

/**
 * Résout une référence de plage (ex. `Listes!$A$2:$A$5`, `Listes!$U$2`,
 * `Listes!$E$1:$J$1`) en tableau de valeurs, dans l'ordre de la plage.
 * @param {string} reference - Référence absolue, avec ou sans nom de feuille.
 * @param {Map<string, number|string>} grille - Grille produite par construireGrille.
 * @returns {Array<number|string>}
 */
export function resoudrePlage(reference, grille) {
  const sansFeuille = reference.includes('!') ? reference.split('!')[1] : reference;
  const parties = sansFeuille.split(':').map(p => p.replace(/\$/g, ''));
  const [colDebut, ligneDebut] = decouperRef(parties[0]);
  const [colFin, ligneFin] = parties[1] ? decouperRef(parties[1]) : [colDebut, ligneDebut];

  const valeurs = [];
  if (ligneDebut === ligneFin) {
    // Plage horizontale (ou cellule unique).
    const iDebut = lettreVersIndex(colDebut);
    const iFin = lettreVersIndex(colFin);
    for (let i = iDebut; i <= iFin; i++) {
      const v = grille.get(`${indexVersLettre(i)}${ligneDebut}`);
      if (v !== undefined) valeurs.push(v);
    }
  } else {
    // Plage verticale (colDebut === colFin dans tous les cas rencontrés ici).
    for (let ligne = ligneDebut; ligne <= ligneFin; ligne++) {
      const v = grille.get(`${colDebut}${ligne}`);
      if (v !== undefined) valeurs.push(v);
    }
  }
  return valeurs;
}

function decouperRef(cellRef) {
  const match = /^([A-Z]+)(\d+)$/.exec(cellRef);
  return [match[1], Number(match[2])];
}

// ---------------------------------------------------------------------------
// Validation x14 (listes étendues, ex. AH « Type report ») : lue depuis extLst.
// ---------------------------------------------------------------------------

/**
 * Lit la référence de plage source d'une validation x14 ciblant la colonne donnée
 * (ex. AH), depuis le bloc `<extLst>` de la feuille PB.
 * @param {string} sheetXml - Contenu XML de la feuille PB.
 * @param {string} colonneCible - Lettre de colonne visée par le `sqref` (ex. 'AH').
 * @returns {string|null} Référence de plage (ex. 'Listes!$R$2:$R$5') ou null si absente.
 */
export function litX14PlageSource(sheetXml, colonneCible) {
  const debutExtLst = sheetXml.indexOf('<extLst');
  if (debutExtLst === -1) return null;
  const finExtLst = sheetXml.indexOf('</extLst>', debutExtLst);
  const extLstXml = sheetXml.slice(debutExtLst, finExtLst === -1 ? undefined : finExtLst + '</extLst>'.length);

  const reValidation = /<x14:dataValidation\b[^>]*>([\s\S]*?)<\/x14:dataValidation>/g;
  let match;
  while ((match = reValidation.exec(extLstXml)) !== null) {
    const bloc = match[1];
    const matchSqref = /<xm:sqref>([^<]*)<\/xm:sqref>/.exec(bloc);
    if (!matchSqref) continue;
    const sqref = matchSqref[1];
    const cible = sqref.split(/\s+/)[0]; // ex. "AH4:AH20"
    const colonneSqref = cible.match(/^[A-Z]+/)?.[0];
    if (colonneSqref !== colonneCible) continue;
    const matchFormule = /<xm:f>([\s\S]*?)<\/xm:f>/.exec(bloc);
    if (matchFormule) return deseChapperXml(matchFormule[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Construction de dossier.listes.
// ---------------------------------------------------------------------------

function construireListes(definedNames, grilleListes, sheetXml, branchements) {
  const plage = nom => {
    const ref = definedNames.get(nom);
    return ref ? resoudrePlage(ref, grilleListes) : [];
  };

  const matiere = plage('Matiere');
  const diametreParMatiere = {};
  for (const m of matiere) {
    if (definedNames.has(m)) diametreParMatiere[m] = plage(m);
  }

  const refAH = litX14PlageSource(sheetXml, 'AH');
  const typeReport = refAH ? resoudrePlage(refAH, grilleListes) : [];

  const phaseTerrain = [...new Set(
    branchements
      .map(b => b.valeursClient.phaseTerrain)
      .filter(v => v !== undefined && v !== '')
  )].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));

  return {
    constatCoffret: plage('COFFRET'),
    constatBrt: plage('BRT'),
    classeBrt: plage('BRT'),
    matiere,
    diametreParMatiere,
    accessoires: plage('Equipement_coffret'),
    bague: plage('PROTECTION'),
    pression: plage('PRESSION'),
    appareil: plage('APPAREIL'),
    pointArret: plage('Point_d_arret_client'),
    causeDi: plage('DI_technique'),
    typeReport,
    typeClient: plage('TYPE_CLIENT'),
    phaseTerrain,
    identificationPb: plage('VALEUR'),
    ajoutNumero: plage('VALEUR'),
  };
}
