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

async function naviguer() {
  if (!location.hash) {
    history.replaceState(null, '', '#accueil');
  }
  const [nom, parametre] = location.hash.replace(/^#\/?/, '').split('/');
  const cle = nom in ECRANS ? nom : 'accueil';
  if (typeof demonterCourant === 'function') {
    demonterCourant();
  }
  demonterCourant = null;
  conteneur.innerHTML = '';
  demonterCourant = (await ECRANS[cle](conteneur, parametre)) || null;
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
