// Mini-routeur par hash : #accueil, #recherche, #fiche/<id>, #ajout, #dossier.
// Pour l'instant, chaque écran est un stub « à venir ».

const conteneur = document.getElementById('ecran');

const ECRANS = {
  accueil: () => stub('Accueil'),
  recherche: () => stub('Rechercher'),
  fiche: (id) => stub(id ? `Fiche ${id}` : 'Fiche'),
  ajout: () => stub('Ajouter un branchement'),
  dossier: () => stub('Dossier'),
};

function stub(titre) {
  return `
    <section class="ecran">
      <h1>${titre}</h1>
      <p class="texte-2">À venir.</p>
    </section>
  `;
}

function naviguer() {
  if (!location.hash) {
    history.replaceState(null, '', '#accueil');
  }
  const [nom, param] = location.hash.replace(/^#\/?/, '').split('/');
  const cle = nom || 'accueil';
  const rendu = ECRANS[cle] || ECRANS.accueil;
  conteneur.innerHTML = rendu(param);
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
