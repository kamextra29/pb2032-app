/**
 * Génère une fixture .xlsx synthétique reproduisant la structure exacte du fichier
 * client réel « Annexe 7 LOT 5 SLTP BFC CR - Marché PB2032.xlsx », en miniature :
 * 3 onglets, tableau structuré Tableau1 (A3:AO20), en-têtes fusionnés colorés par
 * zone, listes déroulantes standard + étendues (x14), plages nommées, sharedStrings,
 * styles distincts par zone. Aucune donnée personnelle réelle : toutes les valeurs
 * (adresses, noms, PCE) sont inventées, mais les 41 en-têtes et les valeurs de listes
 * sont celles du vrai fichier (source unique de vérité : js/core/colonnes.js pour les
 * en-têtes/zones).
 *
 * Le writer chirurgical (Task 9) ne lit jamais les formules : il doit seulement les
 * préserver octet pour octet. Les formules ci-dessous sont donc syntaxiquement
 * fidèles à l'original mais raccourcies.
 */

import JSZip from '../../js/lib/zip.mjs';
import { COLONNES, lettreVersIndex } from '../../js/core/colonnes.js';

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Échappe les caractères spéciaux XML dans un contenu texte. */
function esc(valeur) {
  return String(valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Registre des chaînes partagées (xl/sharedStrings.xml). */
class SharedStrings {
  constructor() {
    this._index = new Map();
    this._valeurs = [];
    this._total = 0;
  }

  id(chaine) {
    this._total++;
    if (this._index.has(chaine)) return this._index.get(chaine);
    const idx = this._valeurs.length;
    this._index.set(chaine, idx);
    this._valeurs.push(chaine);
    return idx;
  }

  xml() {
    const items = this._valeurs.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('');
    return `${XML_HEADER}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this._total}" uniqueCount="${this._valeurs.length}">${items}</sst>`;
  }
}

// ---------------------------------------------------------------------------
// Styles (xl/styles.xml) — indices s= distincts par zone, réutilisés partout.
// ---------------------------------------------------------------------------

const S = {
  normal: 0,
  entete1Emprise: 1, // A1:K1 « EMPRISE DU CHANTIER »
  entete1Identification: 2, // O1:AD1 « IDENTIFICATION PB 2032 »
  entete1Report: 3, // AH1:AO1 « Report branchement »
  entete2SousGroupe: 4, // O2/Y2/AH2
  entete3InfosClient: 5, // ligne 3, zone A-K
  entete3Identification: 6, // ligne 3, zone O-V/AE-AG
  entete3Report: 7, // ligne 3, zone AH-AN
  entete3Defaut: 8, // ligne 3, zones ignorées
  donneesInfosClient: 9,
  donneesIdentification: 10,
  donneesReport: 11,
  donneesDefaut: 12,
};

const HEADER3_STYLE_PAR_ZONE = {
  infosClient: S.entete3InfosClient,
  identification: S.entete3Identification,
  report: S.entete3Report,
  ignorees: S.entete3Defaut,
};

const DATA_STYLE_PAR_ZONE = {
  infosClient: S.donneesInfosClient,
  identification: S.donneesIdentification,
  report: S.donneesReport,
  ignorees: S.donneesDefaut,
};

// Garde-fou : si une nouvelle zone apparaît dans colonnes.js sans style associé
// ici, on échoue immédiatement au chargement du module plutôt que d'écrire
// silencieusement s="undefined" dans le XML.
for (const colonne of COLONNES) {
  if (!(colonne.zone in HEADER3_STYLE_PAR_ZONE) || !(colonne.zone in DATA_STYLE_PAR_ZONE)) {
    throw new Error(
      `build-fixture.mjs : la zone « ${colonne.zone} » (colonne ${colonne.lettre}) ` +
      `n'a pas de style dans HEADER3_STYLE_PAR_ZONE / DATA_STYLE_PAR_ZONE`
    );
  }
}

function buildStylesXml() {
  const fonts = [
    '<font><sz val="11"/><name val="Calibri"/></font>',
    '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>',
    '<font><b/><color rgb="FF000000"/><sz val="11"/><name val="Calibri"/></font>',
  ];

  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    fillSolid('FFFA007D'),
    fillSolid('FF00B050'),
    fillSolid('FF00823B'),
    fillSolid('FFD9D9D9'),
    fillSolid('FFFFFFCC'),
    fillSolid('FFFFCCFF'),
    fillSolid('FFE7FFE7'),
  ];

  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>',
  ];

  const centre = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
  const xf = (fontId, fillId, borderId, alignment = '') =>
    `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${alignment ? ' applyAlignment="1"' : ''}>${alignment}</xf>`;

  const cellXfs = [
    xf(0, 0, 0), // 0 normal
    xf(1, 2, 1, centre), // 1 entete1Emprise
    xf(1, 3, 1, centre), // 2 entete1Identification
    xf(1, 4, 1, centre), // 3 entete1Report
    xf(2, 5, 1, centre), // 4 entete2SousGroupe
    xf(2, 6, 1, centre), // 5 entete3InfosClient
    xf(2, 7, 1, centre), // 6 entete3Identification
    xf(2, 8, 1, centre), // 7 entete3Report
    xf(2, 0, 1, centre), // 8 entete3Defaut
    xf(0, 6, 1), // 9 donneesInfosClient
    xf(0, 7, 1), // 10 donneesIdentification
    xf(0, 8, 1), // 11 donneesReport
    xf(0, 0, 1), // 12 donneesDefaut
  ];

  return `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="${fills.length}">${fills.join('')}</fills>` +
    `<borders count="${borders.length}">${borders.join('')}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;
}

function fillSolid(rgb) {
  return `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
}

// ---------------------------------------------------------------------------
// Cellules — chaque builder renvoie {row, col, xml} pour tri/assemblage par ligne.
// ---------------------------------------------------------------------------

function celluleTexte(lettre, row, ss, valeur, style) {
  const col = lettreVersIndex(lettre);
  return { row, col, xml: `<c r="${lettre}${row}" s="${style}" t="s"><v>${ss.id(valeur)}</v></c>` };
}

function celluleNombre(lettre, row, valeur, style) {
  const col = lettreVersIndex(lettre);
  return { row, col, xml: `<c r="${lettre}${row}" s="${style}"><v>${valeur}</v></c>` };
}

function celluleFormule(lettre, row, formule, style) {
  const col = lettreVersIndex(lettre);
  return { row, col, xml: `<c r="${lettre}${row}" s="${style}"><f>${esc(formule)}</f></c>` };
}

function celluleVide(lettre, row, style) {
  const col = lettreVersIndex(lettre);
  return { row, col, xml: `<c r="${lettre}${row}" s="${style}"/>` };
}

/** Assemble une liste de cellules {row, col, xml} en lignes <row> triées. */
function assemblerLignes(cellules) {
  const parLigne = new Map();
  for (const c of cellules) {
    if (!parLigne.has(c.row)) parLigne.set(c.row, []);
    parLigne.get(c.row).push(c);
  }
  const numerosLignes = [...parLigne.keys()].sort((a, b) => a - b);
  return numerosLignes
    .map(r => {
      const contenu = parLigne
        .get(r)
        .sort((a, b) => a.col - b.col)
        .map(c => c.xml)
        .join('');
      return `<row r="${r}">${contenu}</row>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Données des 8 lignes du tableau (imposées — référencées par Tasks 8/9/10).
// ---------------------------------------------------------------------------

const DATA_ROWS = {
  4: {
    insee: 21452, commune: 'NEUILLY CRIMOLOIS', rue: 'RUE DES GENETS', numero: '4',
    nomClient: 'MALLERON', pce: 12200144633562, matricule: 'A21XX001',
    etatTechnique: 'Improductif', typeClient: 'Individuel', phaseTerrain: 1,
  },
  5: {
    insee: 21452, commune: 'NEUILLY CRIMOLOIS', rue: 'RUE DE LA GENTIANE',
    nomClient: 'DUPOND', pce: 12200144633563, matricule: 'A21XX002',
    etatTechnique: 'Improductif', typeClient: 'Individuel', phaseTerrain: 1,
  },
  6: {
    insee: 21452, commune: 'NEUILLY CRIMOLOIS', rue: 'RUE DES GENETS', numero: '4B',
    nomClient: 'MARTIN', matricule: 'A21XX003',
    typeClient: 'Individuel', phaseTerrain: 1,
  },
  7: {
    insee: 21452, commune: 'NEUILLY CRIMOLOIS', rue: 'RUE DES GENETS', numero: '2',
    nomClient: 'BERNARD', pce: 12200144633565, matricule: 'A21XX004',
    typeClient: 'Individuel', phaseTerrain: 1,
    constatCoffret: 'Bien positionné (< 10cm)', matiere: 'PE', diametre: '32',
    accessoires: 'Robinet de coupure gaz, détendeur(s), compteur(s)', bague: 'NON',
    identificationPb: 1,
  },
  8: {
    insee: 21452, commune: 'NEUILLY CRIMOLOIS', rue: 'RUE DES GENETS', numero: '11',
    nomClient: 'PETIT', pce: 12200144633566, matricule: 'A21XX005',
    typeClient: 'Individuel', phaseTerrain: 1,
    pressionEnDur: 'MPB', // V écrasée par une valeur en dur (pas de formule)
  },
  9: {
    insee: 21452, commune: 'NEUILLY CRIMOLOIS', rue: 'RUE DE LA GENTIANE', numero: '3',
    nomClient: 'ROBERT', pce: 12200144633567, matricule: 'A21XX006',
    typeClient: 'Individuel', phaseTerrain: 1,
    typeReport: 'Détection sans coupure, levé et report',
  },
  10: {
    insee: 21453, commune: 'NEUILLY LES DIJON', rue: "RUE DE L'ÉGLISE", numero: '7',
    nomClient: 'DURAND & FILS', pce: 12200144633568, matricule: 'A21XX007',
    typeClient: 'Individuel', phaseTerrain: 1,
  },
  11: {
    insee: 21453, commune: 'NEUILLY LES DIJON', rue: "RUE DE L'ÉGLISE", numero: '7',
    pce: 12200144633569, matricule: 'A21XX008',
    typeClient: 'Individuel', phaseTerrain: 1,
  },
};

// FIXTURE_ATTENDU expose la même référence : un test qui muterait DATA_ROWS
// corromprait silencieusement les assertions suivantes — le gel rend ça bruyant.
for (const ligne of Object.values(DATA_ROWS)) Object.freeze(ligne);
Object.freeze(DATA_ROWS);

// Clés dont la valeur doit être écrite en nombre plutôt qu'en chaîne partagée.
// colonnes.js décrit le type côté UI (insee et pce en "texte", phaseTerrain en
// "liste"), mais dans le fichier réel ces cellules sont physiquement des nombres
// (<v> brut sans t="s") — cf. spec Task 7 ; identificationPb est "nombre" partout.
const CLES_NUMERIQUES = new Set(['insee', 'pce', 'phaseTerrain', 'identificationPb']);

const V_FORMULE =
  'IF(Tableau1[[#This Row],[Accessoires présents dans le coffret]]=Listes!D$2,Listes!L$2,' +
  'IF(Tableau1[[#This Row],[Accessoires présents dans le coffret]]=Listes!D$3,Listes!L$2,' +
  'IF(Tableau1[[#This Row],[Accessoires présents dans le coffret]]=Listes!D$4,Listes!L$3,Listes!L$4)))';

const formuleAB = row => `IFERROR(VLOOKUP(AA${row},Listes!$W$2:$X$13,2,0),"")`;

const PREMIERE_LIGNE_DONNEES = 4;
const DERNIERE_LIGNE_DONNEES = 11;
const DERNIERE_LIGNE_TABLE = 20;

// ---------------------------------------------------------------------------
// Feuille 2 : Protection Branchements 2032 (le tableau terrain).
// ---------------------------------------------------------------------------

function buildSheet2Xml(ss, lignesVides = 0) {
  const cellules = [];

  // Ligne 1 : gros en-têtes de zone fusionnés.
  cellules.push(celluleTexte('A', 1, ss, 'EMPRISE DU CHANTIER', S.entete1Emprise));
  cellules.push(celluleTexte('O', 1, ss, 'IDENTIFICATION PB 2032', S.entete1Identification));
  cellules.push(celluleTexte('AH', 1, ss, 'Report branchement', S.entete1Report));

  // Ligne 2 : sous-groupes.
  cellules.push(celluleTexte('O', 2, ss, 'Identification branchement et compteur', S.entete2SousGroupe));
  cellules.push(celluleTexte('Y', 2, ss, 'Régulateur', S.entete2SousGroupe));
  cellules.push(celluleVide('AH', 2, S.entete2SousGroupe));

  // Ligne 3 : 41 en-têtes de colonnes (source unique : COLONNES).
  for (const colonne of COLONNES) {
    const style = HEADER3_STYLE_PAR_ZONE[colonne.zone];
    cellules.push(celluleTexte(colonne.lettre, 3, ss, colonne.libelle, style));
  }

  // Lignes 4-20 : 8 lignes de données + 9 lignes vides pré-formatées.
  for (let row = PREMIERE_LIGNE_DONNEES; row <= DERNIERE_LIGNE_TABLE; row++) {
    const donnees = DATA_ROWS[row] ?? {};
    for (const colonne of COLONNES) {
      const style = DATA_STYLE_PAR_ZONE[colonne.zone];

      if (colonne.lettre === 'V') {
        if (donnees.pressionEnDur) {
          cellules.push(celluleTexte('V', row, ss, donnees.pressionEnDur, style));
        } else {
          cellules.push(celluleFormule('V', row, V_FORMULE, style));
        }
        continue;
      }
      if (colonne.lettre === 'AB') {
        cellules.push(celluleFormule('AB', row, formuleAB(row), style));
        continue;
      }

      const valeur = donnees[colonne.cle];
      if (valeur === undefined || valeur === null || valeur === '') {
        cellules.push(celluleVide(colonne.lettre, row, style));
      } else if (CLES_NUMERIQUES.has(colonne.cle)) {
        cellules.push(celluleNombre(colonne.lettre, row, valeur, style));
      } else {
        cellules.push(celluleTexte(colonne.lettre, row, ss, valeur, style));
      }
    }
  }

  // Lignes vides supplémentaires APRÈS la fin du tableau (test d'échelle
  // Task 9) : volontairement hors de la ref du tableau et des sqref de
  // validation — leur seul rôle est de donner au writer un volume de <row>
  // réaliste (~25 000 dans le vrai fichier), avec la même forme que les
  // lignes vides pré-formatées (41 cellules, formules V/AB). Avec
  // lignesVides = 0 (défaut), pas un octet de la fixture ne change.
  const sheetData =
    `<sheetData>${assemblerLignes(cellules)}${lignesVidesXml(lignesVides)}</sheetData>`;

  const fusions = ['A1:K1', 'O1:AD1', 'AH1:AO1', 'O2:X2', 'Y2:AD2', 'AH2:AO2'];
  const mergeCells =
    `<mergeCells count="${fusions.length}">` +
    fusions.map(ref => `<mergeCell ref="${ref}"/>`).join('') +
    '</mergeCells>';

  // Colonnes masquées W..AD (zone « Régulateur », comme le vrai fichier).
  const cols = `<cols><col min="${lettreVersIndex('W')}" max="${lettreVersIndex('AD')}" width="9" hidden="1" customWidth="1"/></cols>`;

  const validations = [
    validationStandard('COFFRET', 'O4:O20'),
    validationStandard('BRT', 'P4:P20 AJ4:AJ20'),
    validationStandard('Matiere', 'Q4:Q20'),
    validationStandard('INDIRECT(Q4)', 'R4:R20'),
    validationStandard('Equipement_coffret', 'S4:S20'),
    validationStandard('PROTECTION', 'T4:T20'),
    validationStandard('VALEUR', 'AG4:AG20 AM4:AM20'),
    validationStandard('APPAREIL', 'AI4:AI20'),
    validationStandard('Point_d_arret_client', 'AK4:AK20'),
    validationStandard('DI_technique', 'AL4:AL20'),
  ];
  const dataValidations =
    `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>`;

  // Validations étendues : la plage source est dérivée des listes (jamais
  // re-saisie), seule la colonne cible reste explicite.
  const validationsX14 = [
    validationX14(plageListeColonne('R'), 'AH4:AH20'),
    validationX14(plageListeColonne('AA'), 'AO4:AO20'),
    validationX14(plageListeColonne('Y'), 'Y4:Y20'),
    validationX14(plageListeColonne('W'), 'AA4:AA20'),
  ];
  const extLst =
    '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">' +
    `<x14:dataValidations count="${validationsX14.length}" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">` +
    validationsX14.join('') +
    '</x14:dataValidations></ext></extLst>';

  return (
    `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:AO${DERNIERE_LIGNE_TABLE}"/>` +
    cols +
    sheetData +
    mergeCells +
    dataValidations +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' +
    extLst +
    '</worksheet>'
  );
}

/** Blocs <row> vides formatés au-delà du tableau (lignes 21..20+n), en une chaîne. */
function lignesVidesXml(nombre) {
  if (nombre <= 0) return '';
  const vFormuleEchappee = esc(V_FORMULE);
  const morceaux = [];
  for (let row = DERNIERE_LIGNE_TABLE + 1; row <= DERNIERE_LIGNE_TABLE + nombre; row++) {
    let cellulesXml = '';
    for (const colonne of COLONNES) {
      const style = DATA_STYLE_PAR_ZONE[colonne.zone];
      if (colonne.lettre === 'V') {
        cellulesXml += `<c r="V${row}" s="${style}"><f>${vFormuleEchappee}</f></c>`;
      } else if (colonne.lettre === 'AB') {
        cellulesXml += `<c r="AB${row}" s="${style}"><f>${esc(formuleAB(row))}</f></c>`;
      } else {
        cellulesXml += `<c r="${colonne.lettre}${row}" s="${style}"/>`;
      }
    }
    morceaux.push(`<row r="${row}">${cellulesXml}</row>`);
  }
  return morceaux.join('');
}

function validationStandard(formule, sqref) {
  return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${sqref}"><formula1>${esc(formule)}</formula1></dataValidation>`;
}

function validationX14(reference, sqref) {
  return (
    '<x14:dataValidation type="list" allowBlank="1">' +
    `<x14:formula1><xm:f>${esc(reference)}</xm:f></x14:formula1>` +
    `<xm:sqref>${sqref}</xm:sqref>` +
    '</x14:dataValidation>'
  );
}

// ---------------------------------------------------------------------------
// Feuille 1 : RCT marché Avenanté (stub avec une formule COUNTIFS sur Tableau1).
// ---------------------------------------------------------------------------

function buildSheet1Xml(ss) {
  const cellules = [
    celluleTexte('A', 1, ss, 'Nombre de branchements reportés', S.normal),
    celluleFormule('B', 1, 'COUNTIFS(Tableau1[Type report],"<>")', S.normal),
  ];
  return (
    `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    '<dimension ref="A1:B1"/>' +
    `<sheetData>${assemblerLignes(cellules)}</sheetData>` +
    '</worksheet>'
  );
}

// ---------------------------------------------------------------------------
// Feuille 3 : Listes (sources des listes déroulantes).
// ---------------------------------------------------------------------------

// Colonnes "classiques" : ligne 1 = titre, lignes 2+ = valeurs de la liste.
const LISTES_COLONNES = [
  { lettre: 'A', titre: 'COFFRET', valeurs: [
    'Bien positionné (< 10cm)', 'Erreur position (> 10cm)',
    'Introuvable ou non visible', 'Présent sur le terrain mais non représenté',
  ] },
  { lettre: 'B', titre: 'BRT', valeurs: [
    'Classe A', 'Classe B', 'Position incertaine', 'Sans classe', 'Non représenté',
  ] },
  { lettre: 'C', titre: 'TYPE CLIENT', valeurs: ['Individuel', 'Collectif', 'Gros consommateur'] },
  { lettre: 'D', titre: 'Equipement coffret', valeurs: [
    'Robinet de coupure gaz, détendeur(s), compteur(s)',
    'Robinet de coupure gaz, détendeur(s)',
    'Robinet de coupure gaz, compteur(s)',
    'Robinet de coupure gaz seul',
    'Robinet de coupure gaz, détendeur(s), compteur(s) dépos(és) (improductif)',
  ] },
  { lettre: 'K', titre: 'PROTECTION', valeurs: ['NON', 'PBDI', 'MBDI', 'DPBE', 'DPBA'] },
  { lettre: 'L', titre: 'PRESSION', valeurs: ['MPB', 'BP', 'à renseigner'] },
  { lettre: 'S', titre: 'DI technique', valeurs: [
    'Robinet type F/Poussoir', 'Coude, manchon ou autre bloquant le flexi', 'Coffret inadapté',
  ] },
  { lettre: 'T', titre: "Point d'arret client", valeurs: [
    'Refus client (ex : Chaudière impossible à éteindre)', 'Robinet non démontable',
  ] },
  { lettre: 'U', titre: 'VALEUR', valeurs: [1] },
  { lettre: 'V', titre: 'APPAREIL', valeurs: [
    'Géoradar', 'Flexitrace', 'Gaz-Tracker', 'Détection électromagnétique',
  ] },
  { lettre: 'R', titre: 'TYPE REPORT AVENANT', valeurs: [
    "Report d'un branchement de moins de 3 m",
    "Cotation et report d'un branchement  sans détection (affleurant mal positionné par exemple)",
    'Détection sans coupure, levé et report',
    "Détection nécessitant coupure + remise en gaz de l'installation, levé et report",
  ] },
  { lettre: 'W', titre: 'Sigle', valeurs: ['FB6', 'CGP'] },
  { lettre: 'X', titre: 'CAB Fictif', valeurs: ['929090Z0700047', '939090Z8300099'] },
  { lettre: 'Y', titre: 'Emplacement regulateur', valeurs: [
    '1 - Coffret exterieur en façade', '2 - Coffret enterré',
  ] },
  { lettre: 'AA', titre: 'Statut PB 2032', valeurs: [
    'Conforme PB 2032 Protegé DPB', 'Conforme PB 2032 Classe A', 'Hors périmètre PB 2032',
  ] },
];

// Bloc « Matiere » (E1:J1) : exception — la ligne 1 EST la valeur de liste
// (pas de titre séparé au-dessus), cf. plage nommée Matiere = Listes!$E$1:$J$1.
const MATIERE_LETTRES = ['E', 'F', 'G', 'H', 'I', 'J'];
const MATIERE_VALEURS = ['PE', 'Ac', 'Cu', 'Pb', 'Solacier', 'Métal'];
const PE_VALEURS = ['20', '32', 'Autre']; // Listes!E2:E4
const AUTRE_MATIERE_VALEUR = '-'; // Listes!F2/G2/H2/I2/J2

/**
 * Plage absolue d'une liste verticale de l'onglet Listes (valeurs à partir de
 * `debut`). Une liste d'une seule valeur donne la forme cellule unique
 * (`Listes!$U$2`), comme le vrai fichier pour VALEUR.
 * @param {string} lettre - Colonne de la liste dans Listes.
 * @param {Array} valeurs - Valeurs de la liste (leur nombre fixe la ligne de fin).
 * @param {number} [debut=2] - Première ligne des valeurs (2 = sous le titre).
 * @returns {string} Référence absolue, ex. 'Listes!$R$2:$R$5'.
 */
function plageListe(lettre, valeurs, debut = 2) {
  const fin = debut + valeurs.length - 1;
  return fin === debut
    ? `Listes!$${lettre}$${debut}`
    : `Listes!$${lettre}$${debut}:$${lettre}$${fin}`;
}

/**
 * Plage absolue de la liste LISTES_COLONNES portée par la colonne `lettre`.
 * Utilisée à la fois par les plages nommées (workbook.xml) et les validations
 * x14 (sheet2.xml) : la borne de fin est dérivée du nombre de valeurs, jamais
 * re-saisie à la main.
 * @param {string} lettre - Colonne de la liste dans Listes (ex. 'R').
 * @returns {string} Référence absolue, ex. 'Listes!$R$2:$R$5'.
 */
function plageListeColonne(lettre) {
  const colonne = LISTES_COLONNES.find(c => c.lettre === lettre);
  if (!colonne) {
    throw new Error(`build-fixture.mjs : aucune liste en colonne ${lettre} de l'onglet Listes`);
  }
  return plageListe(colonne.lettre, colonne.valeurs);
}

function buildSheet3Xml(ss) {
  const cellules = [];

  for (const colonne of LISTES_COLONNES) {
    cellules.push(celluleTexte(colonne.lettre, 1, ss, colonne.titre, S.normal));
    colonne.valeurs.forEach((valeur, i) => {
      const row = i + 2;
      if (typeof valeur === 'number') {
        cellules.push(celluleNombre(colonne.lettre, row, valeur, S.normal));
      } else {
        cellules.push(celluleTexte(colonne.lettre, row, ss, valeur, S.normal));
      }
    });
  }

  MATIERE_LETTRES.forEach((lettre, i) => {
    cellules.push(celluleTexte(lettre, 1, ss, MATIERE_VALEURS[i], S.normal));
  });
  PE_VALEURS.forEach((valeur, i) => {
    cellules.push(celluleTexte('E', i + 2, ss, valeur, S.normal));
  });
  ['F', 'G', 'H', 'I', 'J'].forEach(lettre => {
    cellules.push(celluleTexte(lettre, 2, ss, AUTRE_MATIERE_VALEUR, S.normal));
  });

  return (
    `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    '<dimension ref="A1:AA6"/>' +
    `<sheetData>${assemblerLignes(cellules)}</sheetData>` +
    '</worksheet>'
  );
}

// ---------------------------------------------------------------------------
// Table structurée (xl/tables/table1.xml).
// ---------------------------------------------------------------------------

function buildTable1Xml() {
  const colonnes = COLONNES.map(
    (c, i) => `<tableColumn id="${i + 1}" name="${esc(c.libelle)}"/>`
  ).join('');
  return (
    `${XML_HEADER}<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Tableau1" displayName="Tableau1" ref="A3:AO${DERNIERE_LIGNE_TABLE}" totalsRowShown="0">` +
    `<autoFilter ref="A3:AO${DERNIERE_LIGNE_TABLE}"/>` +
    `<tableColumns count="${COLONNES.length}">${colonnes}</tableColumns>` +
    '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>' +
    '</table>'
  );
}

// ---------------------------------------------------------------------------
// Classeur (xl/workbook.xml) — plages nommées adaptées aux lignes de la fixture.
// ---------------------------------------------------------------------------

function definedName(nom, reference) {
  return `<definedName name="${esc(nom)}">${esc(reference)}</definedName>`;
}

function buildWorkbookXml() {
  const sheets =
    '<sheets>' +
    '<sheet name="RCT marché Avenanté" sheetId="1" r:id="rId1"/>' +
    '<sheet name="Protection Branchements 2032" sheetId="2" r:id="rId2"/>' +
    '<sheet name="Listes" sheetId="3" r:id="rId3"/>' +
    '</sheets>';

  // Plages verticales dérivées des listes elles-mêmes (plageListeColonne) ;
  // le bloc Matiere (horizontal E1:J1 + cellules fixes) reste explicite car sa
  // géométrie ne se déduit pas d'un simple nombre de valeurs.
  const definedNames =
    '<definedNames>' +
    definedName('COFFRET', plageListeColonne('A')) +
    definedName('BRT', plageListeColonne('B')) +
    definedName('TYPE_CLIENT', plageListeColonne('C')) +
    definedName('Equipement_coffret', plageListeColonne('D')) +
    definedName('Matiere', 'Listes!$E$1:$J$1') +
    definedName('PE', plageListe('E', PE_VALEURS)) +
    definedName('Ac', 'Listes!$F$2:$F$2') +
    definedName('Cu', 'Listes!$G$2:$G$2') +
    definedName('Pb', 'Listes!$H$2:$H$2') +
    definedName('Solacier', 'Listes!$I$2:$I$2') +
    definedName('Métal', 'Listes!$J$2:$J$2') +
    definedName('PROTECTION', plageListeColonne('K')) +
    definedName('PRESSION', plageListeColonne('L')) +
    definedName('DI_technique', plageListeColonne('S')) +
    definedName('Point_d_arret_client', plageListeColonne('T')) +
    definedName('VALEUR', plageListeColonne('U')) +
    definedName('APPAREIL', plageListeColonne('V')) +
    definedName('TYPE_REPORT_AVENANT', plageListeColonne('R')) +
    '</definedNames>';

  return (
    `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    sheets +
    definedNames +
    '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
    '</workbook>'
  );
}

function buildWorkbookRels() {
  return (
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>' +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>'
  );
}

function buildSheet2Rels() {
  return (
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>' +
    '</Relationships>'
  );
}

// ---------------------------------------------------------------------------
// Plomberie du paquet OPC ([Content_Types].xml, _rels/.rels, docProps) —
// enveloppe commune à tout .xlsx, indépendante du contenu du classeur.
// ---------------------------------------------------------------------------

function buildContentTypes() {
  return (
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>'
  );
}

function buildRootRels() {
  return (
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>'
  );
}

function buildDocPropsCore() {
  return (
    `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    '<dc:title>Fixture PB 2032 (synthétique)</dc:title>' +
    '</cp:coreProperties>'
  );
}

function buildDocPropsApp() {
  return (
    `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    '<Application>pb2032-app (fixture)</Application>' +
    '<TitlesOfParts><vt:vector size="3" baseType="lpstr">' +
    '<vt:lpstr>RCT marché Avenanté</vt:lpstr>' +
    '<vt:lpstr>Protection Branchements 2032</vt:lpstr>' +
    '<vt:lpstr>Listes</vt:lpstr>' +
    '</vt:vector></TitlesOfParts>' +
    '</Properties>'
  );
}

// ---------------------------------------------------------------------------
// Assemblage final du .xlsx.
// ---------------------------------------------------------------------------

/**
 * Construit la fixture .xlsx synthétique en mémoire.
 * @param {object} [options]
 * @param {number} [options.lignesVides=0] - Lignes vides formatées ajoutées
 *   APRÈS le tableau (test d'échelle du writer, Task 9). 0 = fixture inchangée.
 * @returns {Promise<Uint8Array>} Octets du fichier .xlsx (zip DEFLATE).
 */
export async function buildFixture({ lignesVides = 0 } = {}) {
  const ss = new SharedStrings();

  // L'ordre d'appel des builders détermine l'ordre des chaînes dans
  // sharedStrings.xml ; sans conséquence fonctionnelle, on garde l'ordre des
  // feuilles (1, 2, 3) par lisibilité.
  const sheet1Xml = buildSheet1Xml(ss);
  const sheet2Xml = buildSheet2Xml(ss, lignesVides);
  const sheet3Xml = buildSheet3Xml(ss);
  const sharedStringsXml = ss.xml();

  const zip = new JSZip();
  zip.file('[Content_Types].xml', buildContentTypes());
  zip.file('_rels/.rels', buildRootRels());
  zip.file('docProps/core.xml', buildDocPropsCore());
  zip.file('docProps/app.xml', buildDocPropsApp());
  zip.file('xl/workbook.xml', buildWorkbookXml());
  zip.file('xl/_rels/workbook.xml.rels', buildWorkbookRels());
  zip.file('xl/styles.xml', buildStylesXml());
  zip.file('xl/sharedStrings.xml', sharedStringsXml);
  zip.file('xl/worksheets/sheet1.xml', sheet1Xml);
  zip.file('xl/worksheets/sheet2.xml', sheet2Xml);
  zip.file('xl/worksheets/sheet3.xml', sheet3Xml);
  zip.file('xl/worksheets/_rels/sheet2.xml.rels', buildSheet2Rels());
  zip.file('xl/tables/table1.xml', buildTable1Xml());

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * Résumé des lignes/valeurs de la fixture, pour les assertions des Tasks 8/9/10.
 * Dérivé de DATA_ROWS pour ne jamais diverger des octets réellement écrits.
 */
export const FIXTURE_ATTENDU = {
  nomFeuilleDonnees: 'Protection Branchements 2032',
  nomFeuilleListes: 'Listes',
  nomFeuilleAvenante: 'RCT marché Avenanté',
  nomTable: 'Tableau1',
  refTable: `A3:AO${DERNIERE_LIGNE_TABLE}`,
  premiereLigneDonnees: PREMIERE_LIGNE_DONNEES,
  derniereLigneDonnees: DERNIERE_LIGNE_DONNEES,
  nbLignesDonnees: DERNIERE_LIGNE_DONNEES - PREMIERE_LIGNE_DONNEES + 1,
  premiereLigneVideFormatee: DERNIERE_LIGNE_DONNEES + 1,
  derniereLigneTable: DERNIERE_LIGNE_TABLE,
  lignes: DATA_ROWS,
};
