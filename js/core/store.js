/**
 * Persistance IndexedDB de l'application PB 2032.
 * Base `pb2032` (version 1) avec quatre magasins :
 *  - `dossier` (clé fixe 'actif') : le dossier importé (blob original, listes, refListes…)
 *  - `branchements` (clé auto-incrémentée `id`, index `pce`) : une fiche par branchement
 *  - `photos` (clé auto-incrémentée `id`, index `branchementId`) : photos liées à un branchement
 *  - `parametres` (clé-valeur libre) : préférences de l'application
 *
 * Une seule connexion partagée au niveau du module ; chaque fonction exportée
 * l'ouvre automatiquement si besoin (`ouvrir()` est idempotent). Aucun accès
 * au DOM : ce module fonctionne à l'identique dans la page principale, dans
 * un Web Worker et sous Node (via `fake-indexeddb`).
 */

const NOM_BASE = 'pb2032';
const VERSION_BASE = 1;

/** @type {Promise<IDBDatabase>|null} Connexion partagée, créée à la demande. */
let dbPromise = null;

/**
 * Transforme une IDBRequest en promesse (résolue avec `request.result`,
 * rejetée avec `request.error`).
 *
 * @param {IDBRequest} requete
 * @returns {Promise<*>}
 */
function promesseRequete(requete) {
  return new Promise((resolve, reject) => {
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
}

/**
 * Attend la fin d'une transaction IndexedDB. Rejette la promesse en cas
 * d'erreur ou d'annulation (l'atomicité de la transaction doit se traduire
 * par un échec explicite, jamais par une résolution silencieuse).
 *
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function promesseTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB annulée'));
  });
}

/**
 * Ouvre (ou réutilise) la connexion partagée à la base `pb2032`, en créant
 * le schéma des magasins lors de la toute première ouverture. Idempotente :
 * peut être appelée autant de fois que nécessaire, y compris en parallèle.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function ouvrir() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const requete = indexedDB.open(NOM_BASE, VERSION_BASE);

    requete.onupgradeneeded = () => {
      const db = requete.result;

      if (!db.objectStoreNames.contains('dossier')) {
        db.createObjectStore('dossier');
      }
      if (!db.objectStoreNames.contains('branchements')) {
        const magasin = db.createObjectStore('branchements', { keyPath: 'id', autoIncrement: true });
        magasin.createIndex('pce', 'valeursClient.pce');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const magasin = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        magasin.createIndex('branchementId', 'branchementId');
      }
      if (!db.objectStoreNames.contains('parametres')) {
        db.createObjectStore('parametres');
      }
    };

    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });

  return dbPromise;
}

/**
 * Ferme la connexion partagée si elle est ouverte. Sans effet sinon.
 * Nécessaire pour un teardown propre entre tests (et pour permettre
 * `indexedDB.deleteDatabase` de s'exécuter sans rester bloquée).
 *
 * @returns {Promise<void>}
 */
export async function fermer() {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

/**
 * Remplace intégralement le dossier actif et la liste des branchements, en
 * effaçant aussi les photos existantes. Tout se déroule dans une seule
 * transaction : en cas d'erreur, rien n'est modifié (l'ancien dossier
 * n'est jamais laissé à moitié écrasé).
 *
 * @param {object} dossier
 * @param {object[]} branchements
 * @returns {Promise<void>}
 */
export async function remplacerDossier(dossier, branchements) {
  const db = await ouvrir();
  const tx = db.transaction(['dossier', 'branchements', 'photos'], 'readwrite');

  tx.objectStore('dossier').clear();
  tx.objectStore('branchements').clear();
  tx.objectStore('photos').clear();
  tx.objectStore('dossier').put(dossier, 'actif');
  for (const branchement of branchements) {
    tx.objectStore('branchements').add(branchement);
  }

  await promesseTransaction(tx);
}

/**
 * Alias de `remplacerDossier`, utilisé après confirmation d'une fusion de
 * réimport (Task 17) : même atomicité, même comportement.
 */
export const remplacerApresFusion = remplacerDossier;

/**
 * Charge le dossier actif et l'ensemble des branchements.
 *
 * @returns {Promise<{dossier: object|null, branchements: object[]}>}
 */
export async function chargerTout() {
  const db = await ouvrir();
  const tx = db.transaction(['dossier', 'branchements'], 'readonly');
  const [dossier, branchements] = await Promise.all([
    promesseRequete(tx.objectStore('dossier').get('actif')),
    promesseRequete(tx.objectStore('branchements').getAll()),
  ]);
  await promesseTransaction(tx);

  return { dossier: dossier ?? null, branchements: branchements ?? [] };
}

/**
 * Remplace intégralement l'objet `saisies` d'un branchement (l'appelant
 * envoie l'objet complet déjà élagué) et met à jour `dateModification`
 * (chaîne ISO).
 *
 * @param {number} id
 * @param {object} saisies
 * @returns {Promise<void>}
 */
export async function majSaisies(id, saisies) {
  const db = await ouvrir();
  const tx = db.transaction('branchements', 'readwrite');
  const magasin = tx.objectStore('branchements');

  const enregistrement = await promesseRequete(magasin.get(id));
  if (!enregistrement) {
    tx.abort();
    throw new Error(`Branchement ${id} introuvable`);
  }

  enregistrement.saisies = saisies;
  enregistrement.dateModification = new Date().toISOString();
  magasin.put(enregistrement);

  await promesseTransaction(tx);
}

/**
 * Ajoute un branchement (typiquement un branchement créé hors fichier
 * source, `ajoute:true`) et renvoie son identifiant auto-incrémenté.
 *
 * @param {object} branchement
 * @returns {Promise<number>}
 */
export async function ajouterBranchement(branchement) {
  const db = await ouvrir();
  const tx = db.transaction('branchements', 'readwrite');
  const id = await promesseRequete(tx.objectStore('branchements').add(branchement));
  await promesseTransaction(tx);
  return id;
}

/**
 * Supprime un branchement ajouté (jamais un branchement du fichier client)
 * ainsi que ses photos, dans la même transaction. Refuse explicitement si
 * le branchement visé n'a pas `ajoute === true`.
 *
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function supprimerAjout(id) {
  const db = await ouvrir();
  const tx = db.transaction(['branchements', 'photos'], 'readwrite');
  const magasinBranchements = tx.objectStore('branchements');

  const enregistrement = await promesseRequete(magasinBranchements.get(id));
  if (!enregistrement || enregistrement.ajoute !== true) {
    tx.abort();
    throw new Error(`Impossible de supprimer le branchement ${id} : ce n'est pas un branchement ajouté.`);
  }

  magasinBranchements.delete(id);

  const magasinPhotos = tx.objectStore('photos');
  const photos = await promesseRequete(magasinPhotos.index('branchementId').getAll(id));
  for (const photo of photos) {
    magasinPhotos.delete(photo.id);
  }

  await promesseTransaction(tx);
}

/**
 * Ajoute une photo et renvoie son identifiant auto-incrémenté.
 *
 * @param {object} photo - {branchementId, blob, index, date, nom}
 * @returns {Promise<number>}
 */
export async function ajouterPhoto(photo) {
  const db = await ouvrir();
  const tx = db.transaction('photos', 'readwrite');
  const id = await promesseRequete(tx.objectStore('photos').add(photo));
  await promesseTransaction(tx);
  return id;
}

/**
 * Renvoie les photos d'un branchement donné.
 *
 * @param {number} branchementId
 * @returns {Promise<object[]>}
 */
export async function photosDe(branchementId) {
  const db = await ouvrir();
  const tx = db.transaction('photos', 'readonly');
  const photos = await promesseRequete(tx.objectStore('photos').index('branchementId').getAll(branchementId));
  await promesseTransaction(tx);
  return photos;
}

/**
 * Supprime une photo précise.
 *
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function supprimerPhoto(id) {
  const db = await ouvrir();
  const tx = db.transaction('photos', 'readwrite');
  tx.objectStore('photos').delete(id);
  await promesseTransaction(tx);
}

/**
 * Lit un paramètre libre (clé-valeur). Renvoie `undefined` si absent.
 *
 * @param {string} cle
 * @returns {Promise<*>}
 */
export async function lireParametre(cle) {
  const db = await ouvrir();
  const tx = db.transaction('parametres', 'readonly');
  const valeur = await promesseRequete(tx.objectStore('parametres').get(cle));
  await promesseTransaction(tx);
  return valeur;
}

/**
 * Écrit un paramètre libre (clé-valeur).
 *
 * @param {string} cle
 * @param {*} valeur
 * @returns {Promise<void>}
 */
export async function ecrireParametre(cle, valeur) {
  const db = await ouvrir();
  const tx = db.transaction('parametres', 'readwrite');
  tx.objectStore('parametres').put(valeur, cle);
  await promesseTransaction(tx);
}

/**
 * Estime l'espace de stockage utilisé (wrapper de `navigator.storage.estimate()`).
 * Renvoie `null` quand l'API est absente (sous Node, ou navigateur ancien).
 *
 * @returns {Promise<{usage: number, quota: number, pourcent: number}|null>}
 */
export async function estimerStockage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }
  const { usage, quota } = await navigator.storage.estimate();
  const pourcent = quota ? (usage / quota) * 100 : null;
  return { usage, quota, pourcent };
}
