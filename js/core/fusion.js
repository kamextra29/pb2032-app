/**
 * Fusion d'un réimport de fichier client (Annexe 7 mise à jour) avec les
 * branchements déjà en base. Règle absolue : une saisie terrain ne doit
 * jamais être perdue, même quand le client renomme, réorganise ou supprime
 * des lignes.
 *
 * Règles de rapprochement (spec §10.1) :
 * - Clé primaire : PCE normalisé (`String(pce).trim()`), quand il est non
 *   vide des deux côtés (le fichier réel mélange PCE numériques et texte).
 * - Repli (PCE vide d'au moins un côté) : clé composite
 *   INSEE + rue + n° + complément + nom du client, chaque composant passé
 *   par `normaliser()` (accents, casse, espaces).
 * - Ambiguïté : si la clé de repli correspond à 0 ou plusieurs nouvelles
 *   lignes, aucun rapprochement automatique — l'ancien devient une
 *   « disparue » orpheline (saisies conservées), les nouvelles lignes
 *   deviennent des « nouvelles ». Symétriquement, si la même clé de repli
 *   est partagée par plusieurs anciennes lignes, aucune d'elles n'est
 *   rapprochée automatiquement non plus.
 * - PCE renseigné mais introuvable → pas de repli adresse (risque de faux
 *   rapprochement) ; la ligne devient orpheline, réconciliable manuellement.
 * - Les branchements ajoutés dans l'app (`ajoute: true`) sont conservés tels
 *   quels, sauf si le PCE saisi (`saisies.pce`) apparaît désormais dans le
 *   nouveau fichier : ils sont alors rapprochés de la ligne client
 *   correspondante (le marqueur `ajoute` disparaît).
 *
 * @module fusion
 */

import { normaliser } from './regles.js';

/**
 * Normalise une valeur de PCE pour comparaison stricte. Le fichier réel
 * mélange des PCE numériques, texte et absents ; la comparaison doit donc
 * toujours passer par `String(...).trim()`.
 *
 * @param {object} valeurs - Objet portant un champ `pce` (valeursClient ou saisies)
 * @returns {?string} PCE normalisé, ou `null` si absent/vide
 */
function clePceDe(valeurs) {
  const pce = valeurs?.pce;
  if (pce === undefined || pce === null) return null;
  const s = String(pce).trim();
  return s === '' ? null : s;
}

/**
 * Construit la clé de repli composite (INSEE + rue + n° + complément + nom),
 * chaque composant normalisé pour tolérer les variations d'accents, de casse
 * et d'espacement entre deux versions du fichier client.
 *
 * @param {object} valeursClient - Valeurs client d'un branchement
 * @returns {string} Clé de repli
 */
function cleRepliDe(valeursClient) {
  return ['insee', 'rue', 'numero', 'complement', 'nomClient']
    .map(cle => normaliser(valeursClient?.[cle]))
    .join('|');
}

/**
 * Résumé lisible d'un branchement pour le rapport de fusion
 * (ex. « RUE DES GENETS 4 — MALLERON »).
 *
 * @param {object} valeursClient - Valeurs client d'un branchement
 * @returns {string} Résumé "adresse — nom"
 */
function resumeDe(valeursClient) {
  const adresse = [valeursClient?.rue, valeursClient?.numero]
    .map(v => String(v ?? '').trim())
    .filter(v => v !== '')
    .join(' ');
  const nomClient = valeursClient?.nomClient ?? '';
  return `${adresse} — ${nomClient}`;
}

/**
 * Indexe une liste de branchements (ancien ou nouveau) par une fonction de
 * clé appliquée à leur `valeursClient`, en regroupant les lignes qui
 * partagent la même clé (un groupe de taille > 1 signale une ambiguïté).
 *
 * @param {object[]} lignes - Lignes à indexer (chacune avec un champ `valeursClient`)
 * @param {(valeursClient: object) => ?string} fnCle - Extracteur de clé (`null` = ignorée)
 * @returns {Map<string, object[]>} Index clé → lignes correspondantes
 */
function indexerParCle(lignes, fnCle) {
  const index = new Map();
  for (const ligne of lignes) {
    const cle = fnCle(ligne.valeursClient);
    if (cle === null || cle === undefined) continue;
    if (!index.has(cle)) index.set(cle, []);
    index.get(cle).push(ligne);
  }
  return index;
}

/**
 * Détecte les conflits entre les saisies terrain conservées et les nouvelles
 * valeurs client, pour un ancien et un nouveau déjà rapprochés. Un conflit
 * survient quand le client a modifié une valeur que le terrain avait
 * corrigée ; la saisie continue de primer dans le résultat, le conflit est
 * seulement signalé.
 *
 * @param {object} ancien - Ancien branchement (avec `saisies` et `valeursClient`)
 * @param {object} nouveau - Nouvelle ligne correspondante (avec `valeursClient`)
 * @param {?string} reference - PCE normalisé, ou clé d'adresse composite pour les correspondances par repli
 * @returns {object[]} Conflits `{reference, cle, valeurTerrain, ancienneValeurClient, nouvelleValeurClient}`
 */
function detecterConflits(ancien, nouveau, reference) {
  const conflits = [];
  const saisies = ancien.saisies || {};
  const valeursClientAnciennes = ancien.valeursClient || {};
  for (const cle of Object.keys(saisies)) {
    const ancienneValeurClient = valeursClientAnciennes[cle];
    const nouvelleValeurClient = nouveau.valeursClient[cle];
    if (nouvelleValeurClient !== ancienneValeurClient) {
      conflits.push({
        reference,
        cle,
        valeurTerrain: saisies[cle],
        ancienneValeurClient,
        nouvelleValeurClient,
      });
    }
  }
  return conflits;
}

/**
 * Fusionne un réimport de fichier client avec les branchements existants.
 * Fonction pure, sans accès au store : elle ne fait que calculer le
 * résultat fusionné et le rapport ; c'est l'appelant qui décide de
 * confirmer ou d'annuler la mise à jour (spec §10.5).
 *
 * @param {object[]} anciens - Branchements du store
 *   (`{id?, ligne, valeursClient, saisies, ajoute, vEnDur, ajoutId?}`)
 * @param {object[]} nouveaux - Lignes du nouveau fichier lu (Task 8)
 *   (`{ligne, valeursClient, vEnDur}`)
 * @returns {{branchements: object[], rapport: object}} Résultat fusionné et rapport de fusion
 */
export function fusionner(anciens, nouveaux) {
  const ancienNormaux = anciens.filter(a => a.ajoute !== true);
  const ancienAjoutes = anciens.filter(a => a.ajoute === true);

  const nouveauxParPce = indexerParCle(nouveaux, clePceDe);
  const nouveauxParRepli = indexerParCle(nouveaux, cleRepliDe);
  const ancienSansPceParRepli = indexerParCle(
    ancienNormaux.filter(a => clePceDe(a.valeursClient) === null),
    cleRepliDe
  );

  const branchements = [];
  const rapport = { rapprochees: 0, nouvelles: [], disparues: [], conflits: [] };
  const lignesApparies = new Set(); // n° de ligne des nouveaux déjà consommés par un rapprochement

  const trouverCandidatUnique = (candidats) => {
    const disponibles = (candidats || []).filter(n => !lignesApparies.has(n.ligne));
    return disponibles.length === 1 ? disponibles[0] : null;
  };

  for (const ancien of ancienNormaux) {
    const clePce = clePceDe(ancien.valeursClient);
    let nouveau = null;

    if (clePce !== null) {
      nouveau = trouverCandidatUnique(nouveauxParPce.get(clePce));
    } else {
      const cleRepli = cleRepliDe(ancien.valeursClient);
      const ambiguSurAnciens = (ancienSansPceParRepli.get(cleRepli) || []).length > 1;
      if (!ambiguSurAnciens) {
        nouveau = trouverCandidatUnique(nouveauxParRepli.get(cleRepli));
      }
    }

    if (nouveau) {
      lignesApparies.add(nouveau.ligne);
      const reference = clePce ?? clePceDe(nouveau.valeursClient) ?? cleRepliDe(nouveau.valeursClient);
      rapport.conflits.push(...detecterConflits(ancien, nouveau, reference));
      branchements.push({
        ligne: nouveau.ligne,
        valeursClient: nouveau.valeursClient,
        saisies: { ...(ancien.saisies || {}) },
        ajoute: false,
        vEnDur: nouveau.vEnDur,
        id: ancien.id,
      });
      rapport.rapprochees++;
    } else if (Object.keys(ancien.saisies || {}).length > 0) {
      branchements.push({ ...ancien, orpheline: true });
      rapport.disparues.push({
        resume: resumeDe(ancien.valeursClient),
        nbSaisies: Object.keys(ancien.saisies || {}).length,
      });
    }
    // Sinon : aucune saisie à préserver, la ligne est abandonnée silencieusement
    // (le nouveau fichier fait foi, spec §10.3).
  }

  for (const ajout of ancienAjoutes) {
    const clePce = clePceDe(ajout.saisies || {});
    const nouveau = clePce !== null ? trouverCandidatUnique(nouveauxParPce.get(clePce)) : null;

    if (nouveau) {
      lignesApparies.add(nouveau.ligne);
      branchements.push({
        ligne: nouveau.ligne,
        valeursClient: nouveau.valeursClient,
        saisies: { ...(ajout.saisies || {}) },
        ajoute: false,
        vEnDur: nouveau.vEnDur,
        id: ajout.id,
      });
      rapport.rapprochees++;
    } else {
      branchements.push({ ...ajout });
    }
  }

  for (const nouveau of nouveaux) {
    if (lignesApparies.has(nouveau.ligne)) continue;
    branchements.push({
      ligne: nouveau.ligne,
      valeursClient: nouveau.valeursClient,
      saisies: {},
      ajoute: false,
      vEnDur: nouveau.vEnDur,
    });
    rapport.nouvelles.push({ ligne: nouveau.ligne, resume: resumeDe(nouveau.valeursClient) });
  }

  return { branchements, rapport };
}
