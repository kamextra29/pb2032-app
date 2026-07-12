// Mini-routeur par hash : #accueil, #recherche, #fiche/<id>, #ajout, #dossier.
//
// Contrat d'écran : chaque écran est une fonction
// `async monter(conteneur, parametre, estActif)` qui remplit `conteneur` et peut
// retourner une fonction `demonter()` de nettoyage (arrêt d'un flux caméra,
// retrait d'écouteurs de worker, etc.). Le routeur attend la fin du montage,
// conserve `demonter` et l'appelle avant de monter l'écran suivant.
//
// Convention async-mount (à respecter dans tout écran de js/ui/*) : faire TOUS
// les `await` nécessaires à la décision du contenu initial (chargement IndexedDB,
// etc.) AVANT la toute première écriture dans `conteneur` — jamais de rendu
// intermédiaire vide suivi d'un remplacement (flash visuel). Pour les écrans à
// await avant premier rendu : le routeur passe en 3ᵉ argument un rappel vivant
// `estActif()` (il relit le jeton du routeur à chaque appel) — vérifier
// estActif() après chaque await avant d'écrire dans conteneur, et abandonner
// silencieusement si une navigation plus récente a pris la main. Une fois ce
// premier rendu posé, les mises à jour déclenchées ensuite par l'utilisateur ou
// par un worker (barre de progression, etc.) sont sûres tant qu'elles vérifient
// elles aussi un jeton (ex. `etat.actif` dans js/ui/dossier.js, invalidé par
// `demonter()`) avant d'écrire dans le DOM.

import { echapperHtml } from './ui/dom.js';
import * as dossier from './ui/dossier.js';
import * as accueil from './ui/accueil.js';
import * as recherche from './ui/recherche.js';
import * as fiche from './ui/fiche.js';

const conteneur = document.getElementById('ecran');

function stub(titre) {
  return async (conteneur) => {
    conteneur.innerHTML = `
      <section class="ecran">
        <h1>${echapperHtml(titre)}</h1>
        <p class="texte-2">À venir.</p>
      </section>
    `;
  };
}

const ECRANS = {
  accueil: accueil.monter,
  recherche: recherche.monter,
  fiche: fiche.monter,
  ajout: stub('Ajouter un branchement'),
  dossier: dossier.monter,
};

let demonterCourant = null;
let jeton = 0; // jeton de navigation : invalide les montages devenus obsolètes

async function naviguer() {
  const monJeton = ++jeton;
  if (!location.hash) {
    history.replaceState(null, '', '#accueil');
  }
  const [nom, parametre] = location.hash.replace(/^#\/?/, '').split('/');
  const cle = Object.hasOwn(ECRANS, nom) ? nom : 'accueil';
  if (typeof demonterCourant === 'function') {
    demonterCourant();
  }
  demonterCourant = null;
  conteneur.innerHTML = '';
  let demonter = null;
  try {
    demonter = (await ECRANS[cle](conteneur, parametre, () => monJeton === jeton)) || null;
  } catch (erreur) {
    if (monJeton !== jeton) return; // une navigation plus récente a pris la main
    conteneur.innerHTML = `
      <section class="ecran">
        <h1>Une erreur est survenue.</h1>
        <pre class="texte-2">${echapperHtml(erreur instanceof Error ? erreur.message : erreur)}</pre>
      </section>
    `;
    marquerNavActive(cle);
    return;
  }
  if (monJeton !== jeton) {
    // Montage obsolète : cet écran ne deviendra jamais courant, on le nettoie tout de suite.
    if (typeof demonter === 'function') demonter();
    return;
  }
  demonterCourant = demonter;
  marquerNavActive(cle);
}

function marquerNavActive(cle) {
  document.querySelectorAll('.barre-bas a').forEach((lien) => {
    const cible = lien.getAttribute('href').slice(1);
    lien.classList.toggle('actif', cible === cle);
  });
}

window.addEventListener('hashchange', naviguer);
naviguer();
