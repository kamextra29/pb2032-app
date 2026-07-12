/**
 * Écran « Ajouter un branchement » (#ajout) — §7.4 : formulaire de création
 * d'un branchement hors fichier source (`ajoute: true`).
 *
 * Commune : choix parmi les communes déjà présentes dans le dossier (le code
 * INSEE est alors déduit automatiquement d'une ligne existante de cette
 * commune) ou « Autre… » (saisie libre commune + INSEE). Rue : suggestions
 * (`<datalist>`, limitées à la commune choisie quand elle est connue, sinon
 * toutes les rues du dossier) avec saisie toujours libre.
 *
 * Préremplissage : `prefiller({commune, rue})` peut être appelé juste avant
 * de naviguer vers `#ajout` (ex. bouton « + Ajouter ici » depuis une rue en
 * recherche) — consommé une seule fois au montage suivant, puis effacé.
 *
 * Validation : commune et rue non vides (erreur en français sinon), le reste
 * est facultatif. `ajoutId` = 1 + le plus grand `ajoutId` existant dans le
 * dossier (calculé à partir de `chargerTout()`, démarre à 1).
 *
 * Création → `ajouterBranchement` → navigation vers `#fiche/<id>` (fiche
 * normale, badge « Ajouté »).
 */

import { chargerTout, ajouterBranchement } from '../core/store.js';
import { valeurEffective } from '../core/regles.js';
import { echapperHtml } from './dom.js';

const VALEUR_AUTRE = '__autre__';

/** Préremplissage en attente, posé par `prefiller()`, consommé au prochain montage. */
let prefillEnAttente = null;

/**
 * Préremplit le prochain formulaire d'ajout (commune + rue). À appeler juste
 * avant de naviguer vers `#ajout`.
 *
 * @param {{commune?: string, rue?: string}} valeurs
 */
export function prefiller(valeurs) {
  prefillEnAttente = { commune: valeurs?.commune ?? '', rue: valeurs?.rue ?? '' };
}

export async function monter(conteneur, _parametre, estActif = () => true) {
  const { dossier, branchements } = await chargerTout();
  if (!estActif()) return;

  const prefill = prefillEnAttente;
  prefillEnAttente = null; // consommé une seule fois, même si le dossier est absent

  if (!dossier) {
    conteneur.innerHTML = `
      <section class="ecran">
        <h1>Ajouter un branchement</h1>
        <p class="texte-2">Aucun dossier importé. Importez d'abord un fichier client.</p>
      </section>
    `;
    return;
  }

  const index = construireIndex(branchements);
  const communeConnue = !!prefill?.commune && index.communes.has(prefill.commune);

  const etat = {
    communeChoisie: prefill?.commune ? (communeConnue ? prefill.commune : VALEUR_AUTRE) : '',
    communeLibreInitiale: prefill?.commune && !communeConnue ? prefill.commune : '',
    rueInitiale: prefill?.rue ?? '',
  };

  render(conteneur, etat, index, dossier, branchements);
}

// ---------------------------------------------------------------------------
// Index en mémoire : communes distinctes → { insee, rues }, + rues globales.
// ---------------------------------------------------------------------------

function construireIndex(branchements) {
  const communes = new Map(); // commune -> { insee: string, rues: Set<string> }
  const toutesRues = new Set();

  for (const b of branchements) {
    const commune = String(valeurEffective(b, 'commune') ?? '').trim();
    if (!commune) continue;
    const rue = String(valeurEffective(b, 'rue') ?? '').trim();
    const insee = String(valeurEffective(b, 'insee') ?? '').trim();

    if (!communes.has(commune)) communes.set(commune, { insee: '', rues: new Set() });
    const entree = communes.get(commune);
    if (!entree.insee && insee) entree.insee = insee;
    if (rue) {
      entree.rues.add(rue);
      toutesRues.add(rue);
    }
  }

  return { communes, toutesRues };
}

function ruesPour(communeChoisie, index) {
  const ensemble = communeChoisie && communeChoisie !== VALEUR_AUTRE
    ? (index.communes.get(communeChoisie)?.rues ?? new Set())
    : index.toutesRues;
  return [...ensemble].sort((a, b) => a.localeCompare(b, 'fr'));
}

// ---------------------------------------------------------------------------
// Rendu (une fois par montage) : la commune pilote deux zones réactives
// (champs commune libre/INSEE, et la datalist des rues) sans jamais toucher
// aux autres champs déjà saisis.
// ---------------------------------------------------------------------------

function render(conteneur, etat, index, dossier, branchements) {
  const communesTriees = [...index.communes.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  const typeClientListe = dossier.listes?.typeClient ?? [];

  conteneur.innerHTML = `
    <section class="ecran">
      <h1>Ajouter un branchement</h1>
      <div class="carte">
        <div class="champ-ligne">
          <label for="champ-commune">Commune</label>
          <select id="champ-commune">
            <option value=""></option>
            ${communesTriees.map((c) => `<option value="${echapperHtml(c)}"${etat.communeChoisie === c ? ' selected' : ''}>${echapperHtml(c)}</option>`).join('')}
            <option value="${VALEUR_AUTRE}"${etat.communeChoisie === VALEUR_AUTRE ? ' selected' : ''}>Autre…</option>
          </select>
        </div>
        <div id="zone-commune-extra"></div>
        <div class="champ-ligne">
          <label for="champ-rue">Rue</label>
          <input type="text" id="champ-rue" value="${echapperHtml(etat.rueInitiale)}" list="datalist-rues" autocomplete="off">
          <datalist id="datalist-rues"></datalist>
        </div>
        <div class="champ-ligne">
          <label for="champ-numero">N°</label>
          <input type="text" id="champ-numero" autocomplete="off">
        </div>
        <div class="champ-ligne">
          <label for="champ-complement">Complément adresse</label>
          <input type="text" id="champ-complement" autocomplete="off">
        </div>
        <div class="champ-ligne">
          <label for="champ-nomClient">Nom du client</label>
          <input type="text" id="champ-nomClient" autocomplete="off">
        </div>
        <div class="champ-ligne">
          <label for="champ-pce">N° PCE</label>
          <input type="text" id="champ-pce" autocomplete="off">
        </div>
        <div class="champ-ligne">
          <label for="champ-matricule">Matricule compteur</label>
          <input type="text" id="champ-matricule" autocomplete="off">
        </div>
        <div class="champ-ligne">
          <label for="champ-typeClient">Type client</label>
          <select id="champ-typeClient">
            <option value=""></option>
            ${typeClientListe.map((v) => `<option value="${echapperHtml(String(v))}">${echapperHtml(String(v))}</option>`).join('')}
          </select>
        </div>
        <div id="zone-erreur"></div>
        <button class="bouton btn-primaire bouton-grand" id="btn-creer" type="button">Créer le branchement</button>
      </div>
    </section>
  `;

  const selectCommune = conteneur.querySelector('#champ-commune');
  rendreZoneCommuneExtra(conteneur, etat, index);
  mettreAJourDatalistRues(conteneur, etat, index);

  selectCommune.addEventListener('change', () => {
    etat.communeChoisie = selectCommune.value;
    rendreZoneCommuneExtra(conteneur, etat, index);
    mettreAJourDatalistRues(conteneur, etat, index);
  });

  conteneur.querySelector('#btn-creer').addEventListener('click', () => {
    creer(conteneur, etat, index, branchements);
  });
}

function rendreZoneCommuneExtra(conteneur, etat, index) {
  const zone = conteneur.querySelector('#zone-commune-extra');
  if (etat.communeChoisie === VALEUR_AUTRE) {
    zone.innerHTML = `
      <div class="champ-ligne">
        <label for="champ-commune-libre">Nom de la commune</label>
        <input type="text" id="champ-commune-libre" value="${echapperHtml(etat.communeLibreInitiale)}" autocomplete="off">
      </div>
      <div class="champ-ligne">
        <label for="champ-insee">Code INSEE</label>
        <input type="text" id="champ-insee" autocomplete="off">
      </div>
    `;
    return;
  }
  if (etat.communeChoisie) {
    const insee = index.communes.get(etat.communeChoisie)?.insee || '';
    zone.innerHTML = `<p class="texte-2">Code INSEE : ${insee ? echapperHtml(insee) : '(inconnu)'}</p>`;
    return;
  }
  zone.innerHTML = '';
}

function mettreAJourDatalistRues(conteneur, etat, index) {
  const datalist = conteneur.querySelector('#datalist-rues');
  datalist.innerHTML = ruesPour(etat.communeChoisie, index).map((r) => `<option value="${echapperHtml(r)}">`).join('');
}

// ---------------------------------------------------------------------------
// Validation + création.
// ---------------------------------------------------------------------------

function creer(conteneur, etat, index, branchements) {
  const zoneErreur = conteneur.querySelector('#zone-erreur');
  const selectCommune = conteneur.querySelector('#champ-commune');
  const champRue = conteneur.querySelector('#champ-rue');

  let commune = '';
  let insee = '';
  if (selectCommune.value === VALEUR_AUTRE) {
    commune = (conteneur.querySelector('#champ-commune-libre')?.value ?? '').trim();
    insee = (conteneur.querySelector('#champ-insee')?.value ?? '').trim();
  } else {
    commune = selectCommune.value;
    insee = index.communes.get(commune)?.insee ?? '';
  }
  const rue = champRue.value.trim();

  if (!commune || !rue) {
    zoneErreur.innerHTML = `<p class="texte-2 texte-erreur">La commune et la rue sont obligatoires.</p>`;
    return;
  }
  zoneErreur.innerHTML = '';

  const valeur = (id) => (conteneur.querySelector(id)?.value ?? '').trim();
  const saisies = {};
  const poser = (cle, v) => { if (v !== '') saisies[cle] = v; };
  poser('commune', commune);
  poser('rue', rue);
  poser('numero', valeur('#champ-numero'));
  poser('complement', valeur('#champ-complement'));
  poser('nomClient', valeur('#champ-nomClient'));
  poser('pce', valeur('#champ-pce'));
  poser('matricule', valeur('#champ-matricule'));
  poser('typeClient', valeur('#champ-typeClient'));
  poser('insee', insee);

  const ajoutIdSuivant = 1 + branchements.reduce((max, b) => Math.max(max, Number(b.ajoutId) || 0), 0);

  const boutonCreer = conteneur.querySelector('#btn-creer');
  boutonCreer.disabled = true;

  ajouterBranchement({
    ligne: null,
    ajoute: true,
    ajoutId: ajoutIdSuivant,
    valeursClient: {},
    saisies,
    vEnDur: false,
  }).then((id) => {
    location.hash = `#fiche/${id}`;
  }).catch((erreur) => {
    boutonCreer.disabled = false;
    zoneErreur.innerHTML = `<p class="texte-2 texte-erreur">Création impossible : ${echapperHtml(erreur?.message ?? String(erreur))}</p>`;
  });
}
