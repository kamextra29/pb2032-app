// Mini-routeur par hash : #accueil, #recherche, #fiche/<id>, #ajout, #dossier.
//
// Contrat d'écran : chaque écran est une fonction `async monter(conteneur, parametre)`
// qui remplit `conteneur` et peut retourner une fonction `demonter()` de nettoyage
// (arrêt d'un flux caméra, retrait d'écouteurs de worker, etc.). Le routeur attend
// la fin du montage, conserve `demonter` et l'appelle avant de monter l'écran suivant.

import { echapperHtml } from './ui/dom.js';

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
  accueil: stub('Accueil'),
  recherche: stub('Rechercher'),
  fiche: async (conteneur, id) => stub(id ? `Fiche ${id}` : 'Fiche')(conteneur),
  ajout: stub('Ajouter un branchement'),
  dossier: stub('Dossier'),
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
    demonter = (await ECRANS[cle](conteneur, parametre)) || null;
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
