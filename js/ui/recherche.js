/**
 * Écran « Rechercher » (#recherche) — écran principal terrain (§7.2, ordre
 * imposé par la spec) :
 *  1. Bouton SCAN plein largeur : lance `scannerCodeBarre` (caméra +
 *     `BarcodeDetector`, js/ui/camera.js, Task 16). Repli automatique sur la
 *     saisie manuelle du matricule si l'API est absente ou si la caméra est
 *     refusée/indisponible ; la saisie manuelle sert aussi à proposer une
 *     recherche globale quand un matricule scanné est inconnu du dossier.
 *  2. Champ de recherche globale (filtre instantané ≥ 2 caractères).
 *  3. Filtres cumulables (statut en OR, phase en AND) — placés juste sous le
 *     champ pour agir immédiatement sur le contenu ci-dessous, qu'il
 *     s'agisse des résultats de recherche ou de la navigation hiérarchique.
 *  4. Contenu : résultats de recherche globale, ou par défaut (recherche
 *     vide) navigation hiérarchique Commune → Rue → branchements.
 *
 * Convention de montage asynchrone (voir js/app.js) : `chargerTout()` est
 * attendu avant la première écriture DOM, `estActif()` revérifié ensuite.
 *
 * Perf (931 lignes) : un index en mémoire (valeurs effectives + chaînes
 * normalisées précalculées) est construit une seule fois au montage —
 * aucune frappe clavier ne retouche IndexedDB. Pour ne jamais perdre le
 * focus du champ de recherche pendant la frappe, seule la zone de contenu
 * est réécrite à chaque changement (recherche, filtres, navigation) — jamais
 * le champ lui-même ni la barre de filtres.
 *
 * Navigation interne (commune → rue → branchements, fil d'Ariane) reste dans
 * l'état du module : elle ne modifie jamais le hash (`#recherche` seul).
 */

import { chargerTout } from '../core/store.js';
import { calculerStatuts, normaliser, comparerNumeros, valeurEffective } from '../core/regles.js';
import { echapperHtml } from './dom.js';
import { prefiller } from './ajout.js';
import { scannerCodeBarre } from './camera.js';

const LIMITE_RESULTATS = 50;

const FILTRES_STATUT = [
  { cle: 'aFaire', libelle: 'À faire' },
  { cle: 'identifie', libelle: 'Identifié' },
  { cle: 'reporte', libelle: 'Reporté' },
  { cle: 'pointArret', libelle: "Point d'arrêt" },
  { cle: 'diTechnique', libelle: 'DI technique' },
  { cle: 'ajoute', libelle: 'Ajouté' },
];

export async function monter(conteneur, _parametre, estActif = () => true) {
  const { dossier, branchements } = await chargerTout();
  if (!estActif()) return;

  if (!dossier) {
    conteneur.innerHTML = `
      <section class="ecran">
        <h1>Rechercher</h1>
        <p class="texte-2">Aucun dossier importé. Importez d'abord un fichier client.</p>
      </section>
    `;
    return;
  }

  const etat = {
    index: construireIndex(branchements),
    recherche: '',
    filtresStatut: new Set(),
    filtrePhase: '',
    scanOuvert: false,
    vue: { niveau: 'communes', commune: null, rue: null },
  };

  rendreEcran(conteneur, dossier, etat);
}

// ---------------------------------------------------------------------------
// Index en mémoire (une fois par montage) : valeurs effectives (saisies
// prioritaires sur client, cf. valeurEffective) + chaînes normalisées.
// ---------------------------------------------------------------------------

function construireIndex(branchements) {
  return branchements.map((b) => {
    const commune = String(valeurEffective(b, 'commune') ?? '');
    const rue = String(valeurEffective(b, 'rue') ?? '');
    const numero = String(valeurEffective(b, 'numero') ?? '');
    const complement = String(valeurEffective(b, 'complement') ?? '');
    const nomClient = String(valeurEffective(b, 'nomClient') ?? '');
    const pce = String(valeurEffective(b, 'pce') ?? '');
    const matricule = String(valeurEffective(b, 'matricule') ?? '');
    const phaseTerrain = valeurEffective(b, 'phaseTerrain');
    return {
      id: b.id,
      commune,
      rue,
      numero,
      complement,
      nomClient,
      pce,
      matricule,
      phaseTerrain,
      matriculeNorm: normaliser(matricule),
      texteNorm: normaliser([rue, numero, complement, nomClient, pce, matricule].join(' ')),
      statuts: calculerStatuts(b),
    };
  });
}

// ---------------------------------------------------------------------------
// Filtres : statut cumulable en OR, phase terrain en AND. Appliqués à la
// recherche globale ET à la navigation hiérarchique (badges recalculés).
// ---------------------------------------------------------------------------

function appliquerFiltres(index, etat) {
  return index.filter((item) => {
    if (etat.filtrePhase !== '' && String(item.phaseTerrain ?? '') !== etat.filtrePhase) return false;
    if (etat.filtresStatut.size === 0) return true;
    for (const cle of etat.filtresStatut) {
      if (item.statuts[cle]) return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Rendu principal (une seule fois par montage) + zones réécrites séparément.
// ---------------------------------------------------------------------------

function rendreEcran(conteneur, dossier, etat) {
  conteneur.innerHTML = `
    <section class="ecran ecran-recherche">
      <h1>Rechercher</h1>
      <button class="bouton btn-primaire bouton-scan" id="btn-scan" type="button">📷 SCAN — Matricule compteur</button>
      <div id="zone-scan"></div>
      <input type="search" id="champ-recherche" placeholder="Rue, n°, nom, PCE, matricule…" autocomplete="off">
      <div id="zone-filtres"></div>
      <div id="zone-contenu"></div>
    </section>
  `;

  const zoneScan = conteneur.querySelector('#zone-scan');
  const champRecherche = conteneur.querySelector('#champ-recherche');
  const zoneFiltres = conteneur.querySelector('#zone-filtres');
  const zoneContenu = conteneur.querySelector('#zone-contenu');

  function actualiserContenu() {
    rendreZoneContenu(zoneContenu, etat, actions);
  }

  function basculerVersRechercheGlobale(valeur) {
    etat.scanOuvert = false;
    etat.recherche = valeur;
    zoneScan.innerHTML = '';
    champRecherche.value = valeur;
    champRecherche.focus();
    actualiserContenu();
  }

  const actions = {
    naviguerFiche: (id) => {
      location.hash = `#fiche/${id}`;
    },
    rechercherGlobalement: basculerVersRechercheGlobale,
    actualiserContenu,
  };

  conteneur.querySelector('#btn-scan').addEventListener('click', () => {
    lancerScan(etat, zoneScan, actions);
  });

  champRecherche.value = etat.recherche;
  champRecherche.addEventListener('input', () => {
    etat.recherche = champRecherche.value;
    actualiserContenu();
  });

  rendreZoneScan(zoneScan, etat, actions);
  rendreZoneFiltres(zoneFiltres, dossier, etat, actualiserContenu);
  actualiserContenu();
}

// ---------------------------------------------------------------------------
// 1. SCAN — caméra + BarcodeDetector (js/ui/camera.js), repli sur la saisie
// manuelle du matricule (`etat.scanOuvert` contrôle la visibilité de ce
// panneau de repli, jamais du flux caméra lui-même).
// ---------------------------------------------------------------------------

// Déclenché par le bouton SCAN : tente la caméra ; ne bascule sur le panneau
// manuel qu'en cas d'API absente ou de caméra refusée/indisponible (§8). Un
// « Annuler » explicite pendant le scan ne fait que fermer l'overlay caméra
// (rien d'autre à afficher, l'utilisateur peut relancer SCAN).
function lancerScan(etat, zoneScan, actions) {
  scannerCodeBarre(
    (valeur) => gererValeurScan(valeur, etat, zoneScan, actions),
    (raison) => {
      if (raison === 'indisponible' || raison === 'refus') {
        etat.scanOuvert = true;
        rendreZoneScan(zoneScan, etat, actions);
      }
    }
  );
}

// Correspondance sur le matricule (valeur scannée ou saisie manuellement) :
// trouvé → fiche directement ; sinon → panneau manuel affiché avec message
// « inconnu » + proposition de recherche globale (repli existant conservé).
function gererValeurScan(valeur, etat, zoneScan, actions) {
  const cible = normaliser(valeur);
  const trouve = etat.index.find((item) => item.matriculeNorm === cible);
  if (trouve) {
    actions.naviguerFiche(trouve.id);
    return;
  }
  etat.scanOuvert = true;
  rendreZoneScan(zoneScan, etat, actions);
  const zoneMessage = zoneScan.querySelector('#zone-message-scan');
  if (zoneMessage) remplirMessageIntrouvable(zoneMessage, valeur, actions);
}

function rendreZoneScan(zoneScan, etat, actions) {
  if (!etat.scanOuvert) {
    zoneScan.innerHTML = '';
    return;
  }
  zoneScan.innerHTML = `
    <div class="carte">
      <div class="fiche-barre-haut">
        <strong>Saisir le matricule manuellement</strong>
        <button class="bouton" id="btn-fermer-scan" type="button">Fermer</button>
      </div>
      <label for="champ-matricule">Matricule compteur</label>
      <input type="text" id="champ-matricule" autocomplete="off" autocapitalize="characters">
      <button class="bouton btn-primaire" id="btn-valider-matricule" type="button">Valider</button>
      <div id="zone-message-scan"></div>
    </div>
  `;

  const champMatricule = zoneScan.querySelector('#champ-matricule');
  const zoneMessage = zoneScan.querySelector('#zone-message-scan');
  champMatricule.focus();

  zoneScan.querySelector('#btn-fermer-scan').addEventListener('click', () => {
    etat.scanOuvert = false;
    rendreZoneScan(zoneScan, etat, actions);
  });

  const valider = () => {
    const valeur = champMatricule.value.trim();
    if (!valeur) return;
    traiterScan(valeur, etat, zoneMessage, actions);
  };

  zoneScan.querySelector('#btn-valider-matricule').addEventListener('click', valider);
  champMatricule.addEventListener('keydown', (evenement) => {
    if (evenement.key === 'Enter') {
      evenement.preventDefault();
      valider();
    }
  });
}

function traiterScan(valeur, etat, zoneMessage, actions) {
  const cible = normaliser(valeur);
  const trouve = etat.index.find((item) => item.matriculeNorm === cible);
  if (trouve) {
    actions.naviguerFiche(trouve.id);
    return;
  }
  remplirMessageIntrouvable(zoneMessage, valeur, actions);
}

function remplirMessageIntrouvable(zoneMessage, valeur, actions) {
  zoneMessage.innerHTML = `
    <p class="texte-2">Matricule inconnu dans ce dossier.</p>
    <button class="bouton" id="btn-recherche-globale-scan" type="button">Rechercher « ${echapperHtml(valeur)} » dans le dossier</button>
  `;
  zoneMessage.querySelector('#btn-recherche-globale-scan').addEventListener('click', () => {
    actions.rechercherGlobalement(valeur);
  });
}

// ---------------------------------------------------------------------------
// 3. Filtres : puces de statut (OR) + sélecteur de phase terrain (AND).
// Rendu une seule fois ; les interactions ne touchent que les classes et le
// contenu (jamais le champ de recherche).
// ---------------------------------------------------------------------------

function rendreZoneFiltres(zoneFiltres, dossier, etat, actualiserContenu) {
  const phases = dossier.listes?.phaseTerrain ?? [];

  zoneFiltres.innerHTML = `
    <div class="chips-filtres">
      ${FILTRES_STATUT.map((f) => `<button type="button" class="chip" data-cle="${f.cle}">${echapperHtml(f.libelle)}</button>`).join('')}
    </div>
    ${phases.length ? `
      <select id="select-phase">
        <option value="">Toutes phases</option>
        ${phases.map((p) => `<option value="${echapperHtml(String(p))}">Phase ${echapperHtml(String(p))}</option>`).join('')}
      </select>
    ` : ''}
  `;

  zoneFiltres.querySelectorAll('.chip').forEach((bouton) => {
    const cle = bouton.dataset.cle;
    bouton.classList.toggle('actif', etat.filtresStatut.has(cle));
    bouton.addEventListener('click', () => {
      if (etat.filtresStatut.has(cle)) etat.filtresStatut.delete(cle);
      else etat.filtresStatut.add(cle);
      bouton.classList.toggle('actif', etat.filtresStatut.has(cle));
      actualiserContenu();
    });
  });

  const selectPhase = zoneFiltres.querySelector('#select-phase');
  if (selectPhase) {
    selectPhase.value = etat.filtrePhase;
    selectPhase.addEventListener('change', () => {
      etat.filtrePhase = selectPhase.value;
      actualiserContenu();
    });
  }
}

// ---------------------------------------------------------------------------
// 4. Contenu : résultats de recherche globale, sinon navigation hiérarchique.
// ---------------------------------------------------------------------------

function rendreZoneContenu(zoneContenu, etat, actions) {
  const filtres = appliquerFiltres(etat.index, etat);
  const requeteNorm = normaliser(etat.recherche);

  if (requeteNorm.length >= 2) {
    zoneContenu.innerHTML = rendreResultatsRecherche(filtres, requeteNorm, etat.recherche);
    attacherClicsBranchements(zoneContenu, actions);
    return;
  }

  zoneContenu.innerHTML = rendreNavigationHierarchique(filtres, etat);
  attacherClicsNavigation(zoneContenu, etat, actions);
}

function rendreResultatsRecherche(filtres, requeteNorm, requeteBrute) {
  const correspondances = filtres.filter((item) => item.texteNorm.includes(requeteNorm));
  if (correspondances.length === 0) {
    return `<p class="texte-2">Aucun résultat pour « ${echapperHtml(requeteBrute)} ».</p>`;
  }
  const limites = correspondances.slice(0, LIMITE_RESULTATS);
  const lignes = limites.map((item) => ligneRechercheHtml(item)).join('');
  const suite = correspondances.length > LIMITE_RESULTATS
    ? `<p class="texte-2 affiner">${correspondances.length} résultats — affinez votre recherche.</p>`
    : '';
  return `<div class="liste-branchements">${lignes}</div>${suite}`;
}

function rendreNavigationHierarchique(filtres, etat) {
  const { niveau, commune, rue } = etat.vue;
  if (niveau === 'rues') return rendreListeRues(filtres, commune);
  if (niveau === 'branchements') return rendreListeBranchements(filtres, commune, rue);
  return rendreListeCommunes(filtres);
}

function rendreListeCommunes(filtres) {
  const parCommune = new Map();
  for (const item of filtres) {
    const cle = item.commune || '(commune inconnue)';
    if (!parCommune.has(cle)) parCommune.set(cle, []);
    parCommune.get(cle).push(item);
  }
  if (parCommune.size === 0) {
    return `<p class="texte-2">Aucun branchement ne correspond aux filtres.</p>`;
  }
  const communesTriees = [...parCommune.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  const lignes = communesTriees.map((nomCommune) => {
    const items = parCommune.get(nomCommune);
    return `
      <button type="button" class="ligne-hierarchie" data-niveau="commune" data-commune="${echapperHtml(nomCommune)}">
        <span>${echapperHtml(nomCommune)}</span>
        <span class="badge">${items.length}</span>
      </button>
    `;
  }).join('');
  return `<div class="liste-hierarchie">${lignes}</div>`;
}

function rendreListeRues(filtres, commune) {
  const itemsCommune = filtres.filter((item) => item.commune === commune);
  const parRue = new Map();
  for (const item of itemsCommune) {
    const cle = item.rue || '(rue inconnue)';
    if (!parRue.has(cle)) parRue.set(cle, []);
    parRue.get(cle).push(item);
  }
  const ruesTriees = [...parRue.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  const lignes = ruesTriees.map((nomRue) => {
    const items = parRue.get(nomRue);
    const identifies = items.filter((item) => item.statuts.identifie).length;
    return `
      <button type="button" class="ligne-hierarchie" data-niveau="rue" data-rue="${echapperHtml(nomRue)}">
        <span>${echapperHtml(nomRue)}</span>
        <span class="badge">${identifies}/${items.length} identifiés</span>
      </button>
    `;
  }).join('');
  return `
    ${filDArianeHtml([
      { libelle: 'Communes', niveau: 'communes' },
      { libelle: commune, niveau: 'rues' },
    ])}
    <div class="liste-hierarchie">${lignes || '<p class="texte-2">Aucune rue.</p>'}</div>
  `;
}

function rendreListeBranchements(filtres, commune, rue) {
  const items = filtres
    .filter((item) => item.commune === commune && item.rue === rue)
    .sort((a, b) => comparerNumeros(a.numero, b.numero));
  const lignes = items.map((item) => ligneRueHtml(item)).join('');
  return `
    ${filDArianeHtml([
      { libelle: 'Communes', niveau: 'communes' },
      { libelle: commune, niveau: 'rues' },
      { libelle: rue, niveau: 'branchements' },
    ])}
    <div class="liste-branchements">${lignes || '<p class="texte-2">Aucun branchement.</p>'}</div>
    <button type="button" class="bouton" id="btn-ajouter-ici">+ Ajouter un branchement ici</button>
  `;
}

function filDArianeHtml(segments) {
  const morceaux = segments.map((seg, i) => {
    const estDernier = i === segments.length - 1;
    if (estDernier) return `<span class="fil-ariane-actif">${echapperHtml(seg.libelle)}</span>`;
    return `<button type="button" class="fil-ariane-lien" data-niveau="${seg.niveau}">${echapperHtml(seg.libelle)}</button>`;
  });
  return `<nav class="fil-ariane">${morceaux.join('<span class="fil-ariane-sep">›</span>')}</nav>`;
}

// ---------------------------------------------------------------------------
// Lignes de résultat (recherche globale / liste d'une rue).
// ---------------------------------------------------------------------------

function ligneRechercheHtml(item) {
  const numero = item.numero || 'SN';
  return `
    <button type="button" class="ligne-branchement" data-id="${item.id}">
      <span class="ligne-numero">${echapperHtml(numero)}</span>
      <span class="ligne-corps">
        <span class="ligne-rue">${echapperHtml(item.rue)}</span>
        <span class="ligne-nom">${echapperHtml(item.nomClient)}</span>
      </span>
      <span class="pictos">${pictosHtml(item.statuts)}</span>
    </button>
  `;
}

function ligneRueHtml(item) {
  const numero = [item.numero || 'SN', item.complement].filter(Boolean).join(' ');
  return `
    <button type="button" class="ligne-branchement" data-id="${item.id}">
      <span class="ligne-numero">${echapperHtml(numero)}</span>
      <span class="ligne-corps">
        <span class="ligne-nom">${echapperHtml(item.nomClient)}</span>
      </span>
      <span class="pictos">${pictosHtml(item.statuts)}</span>
    </button>
  `;
}

function pictosHtml(statuts) {
  const parts = [];
  if (statuts.identifie) parts.push('<span class="picto picto-ok" title="Identifié">✓</span>');
  if (statuts.reporte) parts.push('<span class="picto picto-report" title="Reporté">→</span>');
  if (statuts.pointArret || statuts.diTechnique) parts.push('<span class="picto picto-alerte" title="Point d\'arrêt / DI technique">⚠</span>');
  if (statuts.ajoute) parts.push('<span class="picto picto-ajoute" title="Ajouté">+</span>');
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Écouteurs de la zone de contenu (recréée à chaque rendu).
// ---------------------------------------------------------------------------

function attacherClicsNavigation(zoneContenu, etat, actions) {
  zoneContenu.querySelectorAll('.ligne-hierarchie').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      const niveau = bouton.dataset.niveau;
      if (niveau === 'commune') {
        etat.vue = { niveau: 'rues', commune: bouton.dataset.commune, rue: null };
      } else if (niveau === 'rue') {
        etat.vue = { ...etat.vue, niveau: 'branchements', rue: bouton.dataset.rue };
      }
      actions.actualiserContenu();
    });
  });

  zoneContenu.querySelectorAll('.fil-ariane-lien').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      const niveau = bouton.dataset.niveau;
      if (niveau === 'communes') etat.vue = { niveau: 'communes', commune: null, rue: null };
      else if (niveau === 'rues') etat.vue = { ...etat.vue, niveau: 'rues', rue: null };
      actions.actualiserContenu();
    });
  });

  // Ajout depuis une rue (§7.4) : préremplit commune+rue pour le formulaire
  // #ajout avant d'y naviguer. N'apparaît qu'au niveau « branchements »
  // (une rue précise est alors sélectionnée dans etat.vue).
  const boutonAjouter = zoneContenu.querySelector('#btn-ajouter-ici');
  if (boutonAjouter) {
    boutonAjouter.addEventListener('click', () => {
      // Trim ici pour rester cohérent avec construireIndex de ajout.js (qui
      // trim les communes) : une commune à espaces retomberait sinon en « Autre… ».
      prefiller({ commune: (etat.vue.commune ?? '').trim(), rue: (etat.vue.rue ?? '').trim() });
      location.hash = '#ajout';
    });
  }

  attacherClicsBranchements(zoneContenu, actions);
}

function attacherClicsBranchements(zoneContenu, actions) {
  zoneContenu.querySelectorAll('.ligne-branchement').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      actions.naviguerFiche(Number(bouton.dataset.id));
    });
  });
}
