/**
 * Écriture chirurgicale du fichier client Excel « Annexe 7 PB 2032 » (§9 du plan).
 *
 * Exigence n°1 du projet : le fichier exporté EST le fichier client original —
 * seules les valeurs saisies sur le terrain y sont injectées, tout le reste est
 * préservé à l'identique. Aucun parsing DOM : la feuille (~60 Mo décompressée)
 * est reconstruite par segments de chaîne (jamais de concaténation répétée), en
 * réécrivant uniquement les blocs `<row>` touchés, et dans ces blocs uniquement
 * les `<c>` visés.
 *
 * Garde-fous :
 * - liste blanche absolue des colonnes inscriptibles (A–K, O–U, AE–AG, AH–AN) ;
 * - V n'est écrite que pour les lignes « V en dur » (vEnDur garantit l'absence
 *   de formule) quand S ou T vient d'être modifiée — jamais autrement ;
 * - toute cellule ciblée qui contiendrait un `<f>` fait échouer l'export
 *   (erreur explicite) plutôt que de détruire silencieusement une formule ;
 * - vérification interne post-injection (comptages <row>/<c> équilibrés,
 *   nombre de cellules écrites == attendu) avant de retourner le fichier.
 *
 * Doit tourner en Web Worker ET en Node : pas de DOM, pas de DOMParser.
 */

import JSZip from '../lib/zip.mjs';
import { COLONNES, lettreVersIndex } from './colonnes.js';
import { calculerPression, valeurEffective } from './regles.js';

// Liste blanche des colonnes que l'app a le droit d'écrire (§9 du plan) :
// A–K (corrections des infos client), O–U (identification), AE–AG,
// AH–AN (report). Tout le reste — L,M,N, V, W–AD, AO — est intouchable
// (V ne s'écrit que par l'exception « V en dur » ci-dessous).
const LETTRES_AUTORISEES = new Set([
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
  'O', 'P', 'Q', 'R', 'S', 'T', 'U',
  'AE', 'AF', 'AG',
  'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN',
]);

// Colonnes toujours écrites en nombre (longueur de sonde, cases « = 1 »).
const LETTRES_TOUJOURS_NUMERIQUES = new Set(['U', 'AG', 'AM']);

// A–K : nombre si la saisie est uniquement des chiffres sans zéro de tête
// (INSEE, PCE…), texte sinon (« 4B », matricules, noms).
const RE_ENTIER_SANS_ZERO = /^[1-9]\d*$/;

const INDEX_K = lettreVersIndex('K');
const LETTRE_PAR_CLE = new Map(COLONNES.map(c => [c.cle, c.lettre]));

/**
 * Injecte les saisies terrain dans le fichier client original et retourne le
 * nouveau .xlsx. Les entrées du zip non touchées sont recopiées telles quelles.
 * @param {Uint8Array} octetsOriginaux - Fichier client original (.xlsx).
 * @param {Array<object>} branchements - Enregistrements du store ({ligne, valeursClient, saisies, ajoute, vEnDur}).
 * @param {object} dossier - Dossier actif ({cheminFeuillePb, refListes, derniereLigneDonnees, …}).
 * @returns {Promise<Uint8Array>} Octets du fichier exporté.
 */
export async function exporterFichier(octetsOriginaux, branchements, dossier) {
  let zip;
  try {
    zip = await JSZip.loadAsync(octetsOriginaux);
  } catch {
    throw new Error("Export impossible : le fichier original n'est pas un .xlsx lisible.");
  }

  const entreeFeuille = zip.file(dossier.cheminFeuillePb);
  if (!entreeFeuille) {
    throw new Error(
      `Export impossible : la feuille « ${dossier.nomFeuillePb} » est introuvable dans le fichier original.`
    );
  }
  const sheetXml = await entreeFeuille.async('string');

  // Fin du tableau dérivée de la dernière <row> réellement présente dans la
  // feuille (20 dans la fixture, ~25 556 dans le vrai fichier) — jamais codée en dur.
  const finTableau = derniereLigneFeuille(sheetXml);
  const { modifications, nbAttendu } = construireModifications(branchements, dossier, finTableau);

  if (nbAttendu > 0) {
    zip.file(dossier.cheminFeuillePb, reconstruireFeuille(sheetXml, modifications, nbAttendu));
  }

  const entreeWorkbook = zip.file('xl/workbook.xml');
  if (!entreeWorkbook) {
    throw new Error('Export impossible : xl/workbook.xml est introuvable dans le fichier original.');
  }
  const workbookXml = await entreeWorkbook.async('string');
  const workbookMaj = assureFullCalcOnLoad(workbookXml);
  if (workbookMaj !== workbookXml) zip.file('xl/workbook.xml', workbookMaj);

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------------------
// 1. Construction de la liste des modifications.
// ---------------------------------------------------------------------------

/**
 * Transforme les saisies des branchements en modifications de cellules,
 * groupées par numéro de ligne. Les branchements ajoutés reçoivent les
 * premières lignes vides après les données, dans l'ordre de création.
 * @returns {{modifications: Map<number, Map<number, object>>, nbAttendu: number}}
 */
function construireModifications(branchements, dossier, finTableau) {
  const modifications = new Map(); // n° de ligne -> Map(index de colonne -> cible)
  let nbAttendu = 0;
  let prochaineLigneAjout = dossier.derniereLigneDonnees + 1;

  const poser = (ligne, lettre, valeur, estNombre) => {
    if (!modifications.has(ligne)) modifications.set(ligne, new Map());
    const cellules = modifications.get(ligne);
    const index = lettreVersIndex(lettre);
    if (!cellules.has(index)) nbAttendu++;
    cellules.set(index, { lettre, index, ref: `${lettre}${ligne}`, valeur, estNombre });
  };

  for (const b of branchements) {
    const saisies = b.saisies ?? {};

    // Les ajouts consomment leur ligne dans l'ordre de création, saisies ou pas,
    // pour que l'attribution des lignes soit stable d'un export à l'autre.
    let ligne;
    if (b.ajoute === true) {
      ligne = prochaineLigneAjout;
      prochaineLigneAjout++;
      if (ligne > finTableau) {
        throw new Error(
          'Export impossible : plus de ligne vide disponible pour les branchements ajoutés ' +
          `(fin du tableau : ligne ${finTableau}).`
        );
      }
    } else {
      ligne = b.ligne;
    }

    const cles = Object.keys(saisies).filter(cle => saisies[cle] !== undefined && saisies[cle] !== null);
    if (cles.length === 0) continue;

    if (!Number.isInteger(ligne) || ligne < 1) {
      throw new Error("Export impossible : un branchement avec saisies n'a pas de numéro de ligne valide.");
    }

    for (const cle of cles) {
      const lettre = LETTRE_PAR_CLE.get(cle);
      // Clé inconnue ou colonne hors liste blanche (zones ignorées, V, AO…) :
      // ignorée silencieusement — la cellule du fichier original reste intacte.
      if (lettre === undefined || !LETTRES_AUTORISEES.has(lettre)) continue;
      const valeur = saisies[cle];

      if (LETTRES_TOUJOURS_NUMERIQUES.has(lettre)) {
        const nombre = Number(valeur);
        if (!Number.isFinite(nombre)) {
          throw new Error(
            `Export impossible : la valeur « ${valeur} » de la colonne ${lettre} ` +
            `(ligne ${ligne}) n'est pas un nombre.`
          );
        }
        poser(ligne, lettre, String(nombre), true);
      } else if (lettreVersIndex(lettre) <= INDEX_K && RE_ENTIER_SANS_ZERO.test(String(valeur))) {
        poser(ligne, lettre, String(valeur), true);
      } else {
        poser(ligne, lettre, String(valeur), false);
      }
    }

    // Exception V (§3.4) : seule situation où l'app écrit la colonne V.
    // Ligne dont V est une valeur en dur (vEnDur garantit qu'il n'y a pas de
    // formule à écraser) et dont S (accessoires) ou T (bague) vient d'être
    // modifiée : la pression recalculée y est écrite, en texte.
    if (b.vEnDur === true && b.ajoute !== true && ('accessoires' in saisies || 'bague' in saisies)) {
      const pression = calculerPression(
        valeurEffective({ ...b, saisies }, 'accessoires'),
        valeurEffective({ ...b, saisies }, 'bague'),
        dossier.refListes
      );
      poser(ligne, 'V', String(pression), false);
    }
  }

  return { modifications, nbAttendu };
}

// ---------------------------------------------------------------------------
// 2. Reconstruction de la feuille par segments.
// ---------------------------------------------------------------------------

/** Numéro de la dernière `<row>` présente dans la feuille (fin du tableau). */
function derniereLigneFeuille(sheetXml) {
  const finSheetData = sheetXml.indexOf('</sheetData>');
  if (finSheetData === -1) {
    throw new Error('Export impossible : la feuille du fichier original ne contient pas de <sheetData>.');
  }
  const debutDerniereRow = sheetXml.lastIndexOf('<row', finSheetData);
  if (debutDerniereRow === -1) return 0;
  const balise = sheetXml.slice(debutDerniereRow, sheetXml.indexOf('>', debutDerniereRow) + 1);
  const m = /\br="(\d+)"/.exec(balise);
  return m ? Number(m[1]) : 0;
}

/**
 * Reconstruit le XML de la feuille : les lignes non modifiées sont recopiées
 * telles quelles (même tranche de chaîne), les lignes modifiées sont réécrites
 * cellule par cellule. Vérifie l'intégrité du résultat avant de le retourner.
 */
function reconstruireFeuille(sheetXml, modifications, nbAttendu) {
  const segments = [];
  const compteurs = { reecrites: 0, inserees: 0, cellulesDepliees: 0, lignesDepliees: 0 };
  const lignesRestantes = new Set(modifications.keys());

  const debutSheetData = sheetXml.indexOf('<sheetData');
  const finSheetData = sheetXml.indexOf('</sheetData>');
  if (debutSheetData === -1 || finSheetData === -1) {
    throw new Error('Export impossible : la feuille du fichier original ne contient pas de <sheetData>.');
  }

  let position = sheetXml.indexOf('>', debutSheetData) + 1;
  let copieDepuis = 0;

  // Scan séquentiel des blocs <row> (même approche que itereLignes, avec les
  // positions en plus pour trancher la chaîne). Arrêt anticipé dès que toutes
  // les lignes modifiées ont été traitées.
  while (position < finSheetData && lignesRestantes.size > 0) {
    const debutRow = sheetXml.indexOf('<row', position);
    if (debutRow === -1 || debutRow >= finSheetData) break;
    const finBaliseOuvrante = sheetXml.indexOf('>', debutRow);
    let finBloc;
    if (sheetXml[finBaliseOuvrante - 1] === '/') {
      finBloc = finBaliseOuvrante + 1; // <row .../> auto-fermante
    } else {
      const finRow = sheetXml.indexOf('</row>', finBaliseOuvrante);
      if (finRow === -1) break;
      finBloc = finRow + '</row>'.length;
    }

    const balise = sheetXml.slice(debutRow, finBaliseOuvrante + 1);
    const numeroLigne = Number(/\br="(\d+)"/.exec(balise)?.[1]);
    if (modifications.has(numeroLigne)) {
      const bloc = sheetXml.slice(debutRow, finBloc);
      segments.push(sheetXml.slice(copieDepuis, debutRow), reecrireLigne(bloc, modifications.get(numeroLigne), compteurs));
      copieDepuis = finBloc;
      lignesRestantes.delete(numeroLigne);
    }
    position = finBloc;
  }

  if (lignesRestantes.size > 0) {
    const manquantes = [...lignesRestantes].sort((a, b) => a - b).join(', ');
    throw new Error(`Export impossible : ligne(s) ${manquantes} introuvable(s) dans la feuille du fichier original.`);
  }

  segments.push(sheetXml.slice(copieDepuis));
  const resultat = segments.join('');

  verifierExport(sheetXml, resultat, nbAttendu, compteurs);
  return resultat;
}

/**
 * Réécrit un bloc `<row>` : les cellules ciblées sont remplacées (attributs
 * conservés, sauf t=), les cellules absentes sont insérées à leur position
 * (ordre des colonnes), tout le reste est recopié tel quel.
 */
function reecrireLigne(bloc, cibles, compteurs) {
  const finBaliseOuvrante = bloc.indexOf('>');
  let baliseOuvrante;
  let contenu;
  if (bloc[finBaliseOuvrante - 1] === '/') {
    // <row r="n"/> auto-fermante : dépliée pour recevoir ses cellules.
    baliseOuvrante = bloc.slice(0, finBaliseOuvrante - 1).replace(/\s+$/, '') + '>';
    contenu = '';
    compteurs.lignesDepliees++;
  } else {
    baliseOuvrante = bloc.slice(0, finBaliseOuvrante + 1);
    contenu = bloc.slice(finBaliseOuvrante + 1, bloc.length - '</row>'.length);
  }

  const restantes = [...cibles.values()].sort((a, b) => a.index - b.index);
  const sortie = [baliseOuvrante];
  let copieDepuis = 0;
  let iCible = 0;

  const reCell = /<c\b([^>]*?)(\/>|>[\s\S]*?<\/c>)/g;
  let match;
  while (iCible < restantes.length && (match = reCell.exec(contenu)) !== null) {
    const celluleXml = match[0];
    const attributs = match[1];
    const col = /\br="([A-Z]+)\d+"/.exec(attributs)?.[1];
    if (col === undefined) continue;
    const indexCol = lettreVersIndex(col);

    // Cibles dont la colonne précède la cellule courante : insérées avant elle.
    while (iCible < restantes.length && restantes[iCible].index < indexCol) {
      sortie.push(contenu.slice(copieDepuis, match.index), celluleNeuve(restantes[iCible], null));
      copieDepuis = match.index;
      compteurs.inserees++;
      iCible++;
    }

    if (iCible < restantes.length && restantes[iCible].index === indexCol) {
      // Une cellule ciblée ne doit JAMAIS contenir de formule (V est réservée
      // à l'exception vEnDur, AB n'est pas dans la liste blanche) : si ça
      // arrive, on refuse l'export plutôt que de détruire la formule.
      if (/<f\b/.test(celluleXml)) {
        throw new Error(
          `Export impossible : la cellule ${restantes[iCible].ref} contient une formule ` +
          "qui ne doit jamais être écrasée. Aucun fichier n'a été produit."
        );
      }
      sortie.push(contenu.slice(copieDepuis, match.index), celluleNeuve(restantes[iCible], attributs));
      copieDepuis = match.index + celluleXml.length;
      compteurs.reecrites++;
      if (match[2] === '/>') compteurs.cellulesDepliees++;
      iCible++;
    }
  }

  sortie.push(contenu.slice(copieDepuis));
  while (iCible < restantes.length) {
    sortie.push(celluleNeuve(restantes[iCible], null));
    compteurs.inserees++;
    iCible++;
  }

  sortie.push('</row>');
  return sortie.join('');
}

/**
 * Construit le XML d'une cellule écrite. Cellule existante : tous ses attributs
 * (r=, s=, …) sont conservés à l'identique, seul t= est remplacé. Cellule
 * insérée : uniquement r=, sans s= (§9). Texte → inlineStr (sharedStrings.xml
 * n'est jamais touché) ; nombre → <v> sans attribut t.
 */
function celluleNeuve(cible, attributsExistants) {
  const attributs = attributsExistants === null
    ? ` r="${cible.ref}"`
    : attributsExistants.replace(/\s+t="[^"]*"/, '').replace(/\s+$/, '');
  if (cible.estNombre) {
    return `<c${attributs}><v>${cible.valeur}</v></c>`;
  }
  return `<c${attributs} t="inlineStr"><is><t xml:space="preserve">${echapperXml(cible.valeur)}</t></is></c>`;
}

// ---------------------------------------------------------------------------
// 3. Vérification interne post-injection (§11).
// ---------------------------------------------------------------------------

function verifierExport(avant, apres, nbAttendu, compteurs) {
  const { reecrites, inserees, cellulesDepliees, lignesDepliees } = compteurs;
  const problemes = [];

  if (reecrites + inserees !== nbAttendu) {
    problemes.push(`${reecrites + inserees} cellule(s) écrite(s) au lieu de ${nbAttendu}`);
  }

  const rowsAvant = compter(avant, '<row ');
  const rowsApres = compter(apres, '<row ');
  if (rowsApres !== rowsAvant) {
    problemes.push(`nombre de <row> passé de ${rowsAvant} à ${rowsApres}`);
  }

  // Les seules fermetures </row> nouvelles sont les lignes auto-fermantes dépliées.
  const finsRowAttendues = compter(avant, '</row>') + lignesDepliees;
  const finsRowApres = compter(apres, '</row>');
  if (finsRowApres !== finsRowAttendues) {
    problemes.push(`comptage </row> déséquilibré (${finsRowApres} au lieu de ${finsRowAttendues})`);
  }

  const cellulesAttendues = compter(avant, '<c ') + inserees;
  const cellulesApres = compter(apres, '<c ');
  if (cellulesApres !== cellulesAttendues) {
    problemes.push(`nombre de <c> passé à ${cellulesApres} (attendu ${cellulesAttendues})`);
  }

  // Les seules fermetures </c> nouvelles : cellules insérées + auto-fermantes dépliées.
  const finsCelluleAttendues = compter(avant, '</c>') + inserees + cellulesDepliees;
  const finsCelluleApres = compter(apres, '</c>');
  if (finsCelluleApres !== finsCelluleAttendues) {
    problemes.push(`comptage </c> déséquilibré (${finsCelluleApres} au lieu de ${finsCelluleAttendues})`);
  }

  if (problemes.length > 0) {
    throw new Error(`Vérification interne de l'export échouée : ${problemes.join(' ; ')}.`);
  }
}

/** Compte les occurrences d'une sous-chaîne (indexOf : pas d'allocation sur 60 Mo). */
function compter(texte, sousChaine) {
  let n = 0;
  let i = texte.indexOf(sousChaine);
  while (i !== -1) {
    n++;
    i = texte.indexOf(sousChaine, i + sousChaine.length);
  }
  return n;
}

// ---------------------------------------------------------------------------
// 4. xl/workbook.xml : fullCalcOnLoad="1" pour forcer le recalcul à l'ouverture.
// ---------------------------------------------------------------------------

/**
 * Garantit `<calcPr … fullCalcOnLoad="1"/>` dans workbook.xml : attribut ajouté
 * (ou corrigé) sur le calcPr existant, élément créé s'il manque entièrement.
 * Retourne le XML inchangé (même référence) si rien n'est à faire.
 */
function assureFullCalcOnLoad(workbookXml) {
  const matchCalcPr = /<calcPr\b[^>]*\/?>/.exec(workbookXml);
  if (matchCalcPr) {
    const balise = matchCalcPr[0];
    if (/\bfullCalcOnLoad="1"/.test(balise)) return workbookXml;
    let nouvelle = balise.replace(/\s+fullCalcOnLoad="[^"]*"/, '');
    nouvelle = nouvelle.endsWith('/>')
      ? `${nouvelle.slice(0, -2)} fullCalcOnLoad="1"/>`
      : `${nouvelle.slice(0, -1)} fullCalcOnLoad="1">`;
    return workbookXml.slice(0, matchCalcPr.index) + nouvelle
      + workbookXml.slice(matchCalcPr.index + balise.length);
  }
  const fin = workbookXml.lastIndexOf('</workbook>');
  if (fin === -1) {
    throw new Error('Export impossible : xl/workbook.xml est invalide (balise </workbook> introuvable).');
  }
  return `${workbookXml.slice(0, fin)}<calcPr fullCalcOnLoad="1"/>${workbookXml.slice(fin)}`;
}

// ---------------------------------------------------------------------------
// Divers.
// ---------------------------------------------------------------------------

/** Échappe les 5 caractères spéciaux XML d'un contenu texte écrit dans la feuille. */
function echapperXml(valeur) {
  return String(valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
