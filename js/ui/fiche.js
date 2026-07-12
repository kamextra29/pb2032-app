/**
 * Écran « Fiche branchement » (#fiche/<id>) — écran principal d'édition (§7.3) :
 *  - En-tête (zone infosClient A–K) : lecture + correction champ par champ.
 *    Un champ corrigé (saisie ≠ valeur client) affiche un badge « corrigé »,
 *    la valeur client d'origine, et un bouton d'annulation qui retire la
 *    saisie. Une saisie ramenée à la valeur client est élaguée immédiatement
 *    (jamais de fausse correction stockée).
 *  - Section Identification (O, P, Q, R cascade, S, T, U conditionnel, AE, AF,
 *    AG) : `<select>` construits depuis `dossier.listes` (jamais de valeur en
 *    dur), pression (V) recalculée en direct à chaque rendu.
 *  - Section Report (AH…AN).
 *  - Indicateur de complétude, pictogrammes de statut, zone photos (placeholder
 *    Task 16).
 *
 * Enregistrement automatique : chaque `change`/blur reconstruit l'objet
 * `saisies` complet et appelle `majSaisies` — pas de bouton « Enregistrer ».
 * Après chaque sauvegarde, l'écran entier est reconstruit (source unique de
 * vérité : `etat.b`), ce qui propage sans effort les badges, la complétude,
 * les pictogrammes et la pression recalculée partout où c'est nécessaire.
 *
 * Convention de montage asynchrone (voir js/app.js) : le seul `await`
 * nécessaire au premier rendu (`chargerTout()`) est vérifié via `estActif()`
 * avant la première écriture DOM ; un jeton local (`etat.actif`, invalidé par
 * `demonter()`) protège les sauvegardes déclenchées ensuite par l'utilisateur.
 *
 * Règles données par les données réelles (fichier client, absentes de la
 * fixture synthétique) :
 *  1. Les valeurs de `dossier.listes` peuvent être des nombres (ex. le
 *     diamètre PE réel est `[20, 32, 'Autre']`, contre des chaînes dans la
 *     fixture de test) : toute comparaison/affichage de liste passe par
 *     `String()`.
 *  2. Si la valeur effective d'un champ à liste est non vide et absente de la
 *     liste (donnée client historique hors liste), elle est ajoutée comme
 *     option supplémentaire sélectionnée — la donnée client n'est jamais
 *     effacée silencieusement.
 */

import { chargerTout, majSaisies } from '../core/store.js';
import { calculerPression, calculerStatuts, calculerCompletude, valeurEffective } from '../core/regles.js';
import { COLONNES } from '../core/colonnes.js';
import { echapperHtml } from './dom.js';

const LIBELLES = Object.fromEntries(COLONNES.map((c) => [c.cle, c.libelle]));

// Zone infosClient (A–K), dans l'ordre du fichier.
const CHAMPS_ENTETE = COLONNES.filter((c) => c.zone === 'infosClient').map((c) => c.cle);

// I, J, K : saisie libre suggérée par les valeurs déjà présentes dans la colonne (§3.3).
const CHAMPS_SUGGESTION = ['situationCompteur', 'etatTechnique', 'typeClient'];

export async function monter(conteneur, parametre, estActif = () => true) {
  const id = Number(parametre);
  const { dossier, branchements } = await chargerTout();
  if (!estActif()) return;

  const b = branchements.find((item) => item.id === id);

  if (!dossier || !b) {
    conteneur.innerHTML = `
      <section class="ecran">
        <h1>Fiche introuvable</h1>
        <p class="texte-2">Ce branchement n'existe pas ou plus.</p>
        <button class="bouton" id="btn-retour" type="button">← Retour</button>
      </section>
    `;
    conteneur.querySelector('#btn-retour').addEventListener('click', () => history.back());
    return;
  }

  const etat = {
    actif: true,
    b,
    dossier,
    suggestions: construireSuggestions(branchements),
    correctionsOuvertes: new Set(), // clés d'en-tête actuellement en édition
  };

  render(conteneur, etat);

  return function demonter() {
    etat.actif = false;
  };
}

// ---------------------------------------------------------------------------
// Suggestions I/J/K : valeurs distinctes (effectives) présentes dans le dossier.
// ---------------------------------------------------------------------------

function construireSuggestions(branchements) {
  const suggestions = {};
  for (const cle of CHAMPS_SUGGESTION) {
    const ensemble = new Set();
    for (const b of branchements) {
      const v = valeurEffective(b, cle);
      if (v !== undefined && v !== null && v !== '') ensemble.add(String(v));
    }
    suggestions[cle] = [...ensemble].sort((a, bb) => a.localeCompare(bb, 'fr'));
  }
  return suggestions;
}

// ---------------------------------------------------------------------------
// Valeurs effectives (toutes colonnes) + complétude.
// ---------------------------------------------------------------------------

function valeursEffectivesToutes(b) {
  const out = {};
  for (const col of COLONNES) {
    out[col.cle] = valeurEffective(b, col.cle);
  }
  return out;
}

const estNonVide = (v) => v != null && v !== '';

function champsManquants(eff) {
  const requis = ['constatCoffret', 'constatBrt', 'matiere', 'accessoires', 'bague'];
  if (eff.bague === 'DPBE') requis.push('longueurSonde');
  if (eff.matiere === 'PE') requis.push('diametre');
  return requis.filter((cle) => !estNonVide(eff[cle]));
}

// ---------------------------------------------------------------------------
// Rendu principal — reconstruit tout l'écran à chaque sauvegarde.
// ---------------------------------------------------------------------------

function render(conteneur, etat) {
  const b = etat.b;
  const dossier = etat.dossier;
  const eff = valeursEffectivesToutes(b);
  const statuts = calculerStatuts(b);
  const completude = calculerCompletude(eff);
  const manquants = champsManquants(eff);

  const numero = valeurEffective(b, 'numero') || 'SN';
  const rue = valeurEffective(b, 'rue') || '';
  const commune = valeurEffective(b, 'commune') || '';
  const complement = valeurEffective(b, 'complement') || '';
  const nomClient = valeurEffective(b, 'nomClient') || '';
  const pce = valeurEffective(b, 'pce') || '';

  conteneur.innerHTML = `
    <section class="ecran ecran-fiche">
      <div class="fiche-barre-haut">
        <button class="bouton" id="btn-retour" type="button">← Retour</button>
        ${statuts.ajoute ? '<span class="badge badge-ajoute">Ajouté</span>' : ''}
      </div>
      <h1>${echapperHtml(numero)} ${echapperHtml(rue)}</h1>
      <p class="texte-2">${echapperHtml(commune)}${complement ? ` · ${echapperHtml(complement)}` : ''}</p>
      <p class="texte-2">${echapperHtml(nomClient)}${pce ? ` · PCE ${echapperHtml(pce)}` : ''}</p>
      ${pictosFicheHtml(statuts)}
      ${completudeHtml(completude, manquants)}
      <div id="zone-entete"></div>
      <div id="zone-identification"></div>
      <div id="zone-report"></div>
      <div class="carte">
        <h2>Photos</h2>
        <p class="texte-2">Photos — disponible prochainement.</p>
      </div>
    </section>
  `;

  conteneur.querySelector('#btn-retour').addEventListener('click', () => history.back());

  const actions = {
    enregistrer: async (nouvellesSaisies) => {
      try {
        await majSaisies(b.id, nouvellesSaisies);
      } catch (erreur) {
        console.error('Enregistrement impossible :', erreur);
        return;
      }
      if (!etat.actif) return;
      b.saisies = nouvellesSaisies;
      render(conteneur, etat);
    },
  };

  rendreEntete(conteneur.querySelector('#zone-entete'), etat, actions);
  rendreIdentification(conteneur.querySelector('#zone-identification'), etat, actions);
  rendreReport(conteneur.querySelector('#zone-report'), etat, actions);
}

function pictosFicheHtml(statuts) {
  const items = [];
  items.push(statuts.identifie
    ? '<span class="badge badge-ok">✓ Identifié</span>'
    : '<span class="badge">À faire</span>');
  if (statuts.reporte) items.push('<span class="badge badge-report">→ Reporté</span>');
  if (statuts.pointArret) items.push('<span class="badge badge-alerte">⚠ Point d’arrêt</span>');
  if (statuts.diTechnique) items.push('<span class="badge badge-alerte">⚠ DI technique</span>');
  return `<div class="fiche-statuts">${items.join('')}</div>`;
}

function completudeHtml(completude, manquants) {
  const libellesManquants = manquants.map((cle) => LIBELLES[cle]).join(', ');
  return `
    <div class="carte carte-completude">
      <p><strong>${echapperHtml(completude.complets)}/${echapperHtml(completude.requis)} champs requis</strong></p>
      ${manquants.length
        ? `<p class="texte-2">Manque : ${echapperHtml(libellesManquants)}</p>`
        : `<p class="texte-2">Complet.</p>`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// En-tête (A–K) : lecture + correction champ par champ.
// ---------------------------------------------------------------------------

function rendreEntete(zone, etat, actions) {
  const b = etat.b;
  const lignes = CHAMPS_ENTETE.map((cle) => ligneEnteteHtml(cle, b, etat)).join('');
  zone.innerHTML = `
    <div class="carte fiche-section">
      <h2>Informations client</h2>
      <div class="fiche-champs">${lignes}</div>
    </div>
  `;
  attacherEnteteEcouteurs(zone, etat, actions);
}

function ligneEnteteHtml(cle, b, etat) {
  const libelle = LIBELLES[cle];
  const valeurClient = b.valeursClient[cle];
  const corrige = Object.hasOwn(b.saisies, cle);
  const valeurEff = corrige ? b.saisies[cle] : valeurClient;
  const enEdition = etat.correctionsOuvertes.has(cle);

  if (enEdition) {
    return `
      <div class="champ-ligne champ-edition" data-cle="${echapperHtml(cle)}">
        <label for="champ-${echapperHtml(cle)}">${echapperHtml(libelle)}</label>
        ${champInputHtml(cle, valeurEff, etat)}
      </div>
    `;
  }

  const affichage = (valeurEff ?? '') === '' ? '—' : echapperHtml(valeurEff);

  return `
    <div class="champ-ligne" data-cle="${echapperHtml(cle)}">
      <div class="champ-lecture">
        <span class="champ-libelle">${echapperHtml(libelle)}</span>
        <span class="champ-valeur">${affichage}</span>
        ${corrige ? `<span class="badge badge-corrige">corrigé</span>` : ''}
      </div>
      ${corrige ? `<p class="texte-2 champ-client-origine">client : ${(valeurClient ?? '') === '' ? '(vide)' : echapperHtml(valeurClient)}</p>` : ''}
      <div class="rangee-boutons champ-actions">
        <button type="button" class="bouton btn-corriger" data-cle="${echapperHtml(cle)}">Corriger</button>
        ${corrige ? `<button type="button" class="bouton btn-annuler" data-cle="${echapperHtml(cle)}" title="Restaurer la valeur client">↩ Annuler</button>` : ''}
      </div>
    </div>
  `;
}

function champInputHtml(cle, valeurEff, etat) {
  const val = valeurEff ?? '';
  if (CHAMPS_SUGGESTION.includes(cle)) {
    const datalistId = `datalist-${cle}`;
    const options = (etat.suggestions[cle] ?? []).map((v) => `<option value="${echapperHtml(v)}">`).join('');
    return `
      <input type="text" id="champ-${echapperHtml(cle)}" value="${echapperHtml(val)}" list="${datalistId}" autocomplete="off">
      <datalist id="${datalistId}">${options}</datalist>
    `;
  }
  return `<input type="text" id="champ-${echapperHtml(cle)}" value="${echapperHtml(val)}" autocomplete="off">`;
}

function attacherEnteteEcouteurs(zone, etat, actions) {
  zone.querySelectorAll('.btn-corriger').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      const cle = bouton.dataset.cle;
      etat.correctionsOuvertes.add(cle);
      rendreEntete(zone, etat, actions);
      const input = zone.querySelector(`#champ-${cle}`);
      if (input) input.focus();
    });
  });

  zone.querySelectorAll('.btn-annuler').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      const cle = bouton.dataset.cle;
      const nouvelles = { ...etat.b.saisies };
      delete nouvelles[cle];
      etat.correctionsOuvertes.delete(cle);
      actions.enregistrer(nouvelles);
    });
  });

  zone.querySelectorAll('.champ-edition input').forEach((input) => {
    input.addEventListener('change', () => {
      const cle = input.closest('.champ-edition').dataset.cle;
      const brut = input.value.trim();
      const valeurClientStr = String(etat.b.valeursClient[cle] ?? '').trim();
      const nouvelles = { ...etat.b.saisies };
      if (brut === valeurClientStr) delete nouvelles[cle];
      else nouvelles[cle] = brut;
      etat.correctionsOuvertes.delete(cle);
      actions.enregistrer(nouvelles);
    });
  });
}

// ---------------------------------------------------------------------------
// Champs génériques (identification / report) : select depuis listes, texte
// libre avec datalist, textarea, case à cocher (1/absent).
// ---------------------------------------------------------------------------

function selectHtml(cle, libelle, listeValeurs, valeurEff) {
  const valeurEffStr = valeurEff === undefined || valeurEff === null ? '' : String(valeurEff);
  const listeStr = (listeValeurs ?? []).map((v) => String(v));
  const optionsListe = listeStr.map((v) => optionHtml(v, valeurEffStr)).join('');
  const manque = valeurEffStr !== '' && !listeStr.includes(valeurEffStr);
  const optionExtra = manque ? optionHtml(valeurEffStr, valeurEffStr) : '';
  return `
    <div class="champ-ligne">
      <label for="champ-${echapperHtml(cle)}">${echapperHtml(libelle)}</label>
      <select id="champ-${echapperHtml(cle)}">
        <option value=""></option>
        ${optionsListe}
        ${optionExtra}
      </select>
    </div>
  `;
}

function optionHtml(valeur, valeurEffStr) {
  const selectionne = valeur === valeurEffStr ? ' selected' : '';
  return `<option value="${echapperHtml(valeur)}"${selectionne}>${echapperHtml(valeur)}</option>`;
}

function champNumeriqueHtml(cle, libelle, valeur) {
  return `
    <div class="champ-ligne">
      <label for="champ-${echapperHtml(cle)}">${echapperHtml(libelle)}</label>
      <input type="number" step="any" id="champ-${echapperHtml(cle)}" value="${echapperHtml(valeur ?? '')}">
    </div>
  `;
}

function champTexteLibreHtml(cle, libelle, valeur, suggestions) {
  const datalistId = `datalist-${cle}`;
  const options = (suggestions ?? []).map((v) => `<option value="${echapperHtml(String(v))}">`).join('');
  return `
    <div class="champ-ligne">
      <label for="champ-${echapperHtml(cle)}">${echapperHtml(libelle)}</label>
      <input type="text" id="champ-${echapperHtml(cle)}" value="${echapperHtml(valeur ?? '')}" list="${datalistId}" autocomplete="off">
      <datalist id="${datalistId}">${options}</datalist>
    </div>
  `;
}

function champTextareaHtml(cle, libelle, valeur) {
  return `
    <div class="champ-ligne">
      <label for="champ-${echapperHtml(cle)}">${echapperHtml(libelle)}</label>
      <textarea id="champ-${echapperHtml(cle)}" rows="2">${echapperHtml(valeur ?? '')}</textarea>
    </div>
  `;
}

function champCaseHtml(cle, libelle, valeur) {
  const coche = valeur === 1 || valeur === '1' ? ' checked' : '';
  return `
    <label class="champ-case" for="champ-${echapperHtml(cle)}">
      <input type="checkbox" id="champ-${echapperHtml(cle)}"${coche}>
      ${echapperHtml(libelle)}
    </label>
  `;
}

// Enregistre un champ « simple » : élague la saisie si elle redevient égale à
// la valeur client (aucune fausse correction stockée), §7.3 Step 2.
function definirChamp(etat, actions, cle, brut) {
  const valeurClientStr = String(etat.b.valeursClient[cle] ?? '').trim();
  const nouvelles = { ...etat.b.saisies };
  if (String(brut).trim() === valeurClientStr) delete nouvelles[cle];
  else nouvelles[cle] = brut;
  return actions.enregistrer(nouvelles);
}

// Enregistre une case à cocher (valeur { 1 } ou absente) : si la valeur client
// est déjà 1, l'état « décoché » doit explicitement écraser le client avec une
// chaîne vide (une simple suppression de saisie laisserait réapparaître le 1
// client via valeurEffective).
function definirCase(etat, actions, cle, coche) {
  const valeurClient = etat.b.valeursClient[cle];
  const clientEstUn = valeurClient === 1 || valeurClient === '1';
  const nouvelles = { ...etat.b.saisies };
  if (coche) {
    if (clientEstUn) delete nouvelles[cle];
    else nouvelles[cle] = 1;
  } else if (clientEstUn) {
    nouvelles[cle] = '';
  } else {
    delete nouvelles[cle];
  }
  return actions.enregistrer(nouvelles);
}

// ---------------------------------------------------------------------------
// Section Identification (O, P, Q, R cascade, S, T, U conditionnel, V, AE, AF, AG).
// ---------------------------------------------------------------------------

function rendreIdentification(zone, etat, actions) {
  const b = etat.b;
  const dossier = etat.dossier;
  const eff = valeursEffectivesToutes(b);

  const diametreListe = dossier.listes.diametreParMatiere[String(eff.matiere ?? '')] ?? [];
  const pression = calculerPression(
    eff.accessoires === undefined || eff.accessoires === null ? '' : String(eff.accessoires),
    eff.bague === undefined || eff.bague === null ? '' : String(eff.bague),
    dossier.refListes
  );

  zone.innerHTML = `
    <div class="carte fiche-section">
      <h2>Identification</h2>
      ${selectHtml('constatCoffret', LIBELLES.constatCoffret, dossier.listes.constatCoffret, eff.constatCoffret)}
      ${selectHtml('constatBrt', LIBELLES.constatBrt, dossier.listes.constatBrt, eff.constatBrt)}
      ${selectHtml('matiere', LIBELLES.matiere, dossier.listes.matiere, eff.matiere)}
      ${selectHtml('diametre', LIBELLES.diametre, diametreListe, eff.diametre)}
      ${selectHtml('accessoires', LIBELLES.accessoires, dossier.listes.accessoires, eff.accessoires)}
      ${selectHtml('bague', LIBELLES.bague, dossier.listes.bague, eff.bague)}
      ${String(eff.bague ?? '') === 'DPBE' ? champNumeriqueHtml('longueurSonde', LIBELLES.longueurSonde, eff.longueurSonde) : ''}
      <p class="ligne-pression"><strong>Pression :</strong> ${echapperHtml(pression)} (calculée)</p>
      ${champTextareaHtml('commentaireIdent', LIBELLES.commentaireIdent, eff.commentaireIdent)}
      ${champTexteLibreHtml('phaseTerrain', LIBELLES.phaseTerrain, eff.phaseTerrain, dossier.listes.phaseTerrain)}
      ${champCaseHtml('identificationPb', 'Identification réalisée (article 40015900)', eff.identificationPb)}
    </div>
  `;

  attacherIdentificationEcouteurs(zone, etat, actions);
}

function attacherIdentificationEcouteurs(zone, etat, actions) {
  ['constatCoffret', 'constatBrt', 'accessoires', 'diametre'].forEach((cle) => {
    const select = zone.querySelector(`#champ-${cle}`);
    if (select) select.addEventListener('change', () => definirChamp(etat, actions, cle, select.value));
  });

  const selectMatiere = zone.querySelector('#champ-matiere');
  if (selectMatiere) {
    selectMatiere.addEventListener('change', () => {
      const valeurClientStr = String(etat.b.valeursClient.matiere ?? '').trim();
      const nouvelles = { ...etat.b.saisies };
      if (selectMatiere.value.trim() === valeurClientStr) delete nouvelles.matiere;
      else nouvelles.matiere = selectMatiere.value;
      delete nouvelles.diametre; // cascade Q→R : la sélection précédente ne s'applique plus forcément
      actions.enregistrer(nouvelles);
    });
  }

  const selectBague = zone.querySelector('#champ-bague');
  if (selectBague) {
    selectBague.addEventListener('change', () => {
      const valeurClientStr = String(etat.b.valeursClient.bague ?? '').trim();
      const nouvelles = { ...etat.b.saisies };
      if (selectBague.value.trim() === valeurClientStr) delete nouvelles.bague;
      else nouvelles.bague = selectBague.value;
      if (selectBague.value !== 'DPBE') delete nouvelles.longueurSonde; // U masqué ⇒ sa saisie disparaît
      actions.enregistrer(nouvelles);
    });
  }

  const champLongueur = zone.querySelector('#champ-longueurSonde');
  if (champLongueur) {
    champLongueur.addEventListener('change', () => definirChamp(etat, actions, 'longueurSonde', champLongueur.value));
  }

  const champCommentaire = zone.querySelector('#champ-commentaireIdent');
  if (champCommentaire) {
    champCommentaire.addEventListener('change', () => definirChamp(etat, actions, 'commentaireIdent', champCommentaire.value));
  }

  const champPhase = zone.querySelector('#champ-phaseTerrain');
  if (champPhase) {
    champPhase.addEventListener('change', () => definirChamp(etat, actions, 'phaseTerrain', champPhase.value));
  }

  const caseIdentification = zone.querySelector('#champ-identificationPb');
  if (caseIdentification) {
    caseIdentification.addEventListener('change', () => definirCase(etat, actions, 'identificationPb', caseIdentification.checked));
  }
}

// ---------------------------------------------------------------------------
// Section Report (AH…AN).
// ---------------------------------------------------------------------------

function rendreReport(zone, etat, actions) {
  const b = etat.b;
  const dossier = etat.dossier;
  const eff = valeursEffectivesToutes(b);

  zone.innerHTML = `
    <div class="carte fiche-section">
      <h2>Report</h2>
      ${selectHtml('typeReport', LIBELLES.typeReport, dossier.listes.typeReport, eff.typeReport)}
      ${selectHtml('appareil', LIBELLES.appareil, dossier.listes.appareil, eff.appareil)}
      ${selectHtml('classeBrt', LIBELLES.classeBrt, dossier.listes.classeBrt, eff.classeBrt)}
      ${selectHtml('pointArret', LIBELLES.pointArret, dossier.listes.pointArret, eff.pointArret)}
      ${selectHtml('causeDi', LIBELLES.causeDi, dossier.listes.causeDi, eff.causeDi)}
      ${champCaseHtml('ajoutNumero', LIBELLES.ajoutNumero, eff.ajoutNumero)}
      ${champTextareaHtml('commentaireReport', LIBELLES.commentaireReport, eff.commentaireReport)}
    </div>
  `;

  attacherReportEcouteurs(zone, etat, actions);
}

function attacherReportEcouteurs(zone, etat, actions) {
  ['typeReport', 'appareil', 'classeBrt', 'pointArret', 'causeDi'].forEach((cle) => {
    const select = zone.querySelector(`#champ-${cle}`);
    if (select) select.addEventListener('change', () => definirChamp(etat, actions, cle, select.value));
  });

  const caseAjout = zone.querySelector('#champ-ajoutNumero');
  if (caseAjout) {
    caseAjout.addEventListener('change', () => definirCase(etat, actions, 'ajoutNumero', caseAjout.checked));
  }

  const champCommentaire = zone.querySelector('#champ-commentaireReport');
  if (champCommentaire) {
    champCommentaire.addEventListener('change', () => definirChamp(etat, actions, 'commentaireReport', champCommentaire.value));
  }
}
