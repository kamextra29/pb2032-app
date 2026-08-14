// Service worker cache-first : l'appli fonctionne entièrement hors-ligne.
// Chemins RELATIFS uniquement (l'app vit sous /pb2032-app/ sur GitHub Pages).
const CACHE = 'pb2032-v3';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/worker.js',
  './js/lib/jszip.min.js',
  './js/lib/zip.mjs',
  './js/core/colonnes.js',
  './js/core/fusion.js',
  './js/core/photos-noms.js',
  './js/core/regles.js',
  './js/core/store.js',
  './js/core/xlsx-reader.js',
  './js/core/xlsx-writer.js',
  './js/ui/accueil.js',
  './js/ui/ajout.js',
  './js/ui/camera.js',
  './js/ui/dom.js',
  './js/ui/dossier.js',
  './js/ui/fiche.js',
  './js/ui/recherche.js',
  './js/ui/worker-client.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(CACHE)
      // cache:'reload' pour contourner le cache HTTP du navigateur (sinon une
      // version déjà en cache HTTP heuristique pourrait être précachée figée).
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((cle) => cle !== CACHE).map((cle) => caches.delete(cle))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET' || !requete.url.startsWith(self.location.origin)) return;

  evenement.respondWith(
    caches.match(requete, { ignoreSearch: true }).then((reponse) => {
      if (reponse) return reponse;
      return fetch(requete)
        .then((reponseReseau) => {
          if (reponseReseau.ok) {
            const copie = reponseReseau.clone();
            caches.open(CACHE).then((cache) => cache.put(requete, copie));
          }
          return reponseReseau;
        })
        .catch(() => {
          // Hors ligne et rien en cache pour cette URL : pour une navigation,
          // se replier sur la coquille app (le routeur par hash prend le relais).
          if (requete.mode === 'navigate') return caches.match('./index.html');
          throw new Error('Ressource indisponible hors ligne : ' + requete.url);
        });
    })
  );
});

self.addEventListener('message', (evenement) => {
  if (evenement.data && evenement.data.type === 'skipWaiting') self.skipWaiting();
});
