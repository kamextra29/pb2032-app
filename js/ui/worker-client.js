/**
 * Client léger du worker (js/worker.js) : encapsule le protocole postMessage
 * en promesses identifiées par un id unique, une seule fois pour toute la
 * session (singleton paresseux — le worker n'est créé qu'à la première
 * utilisation, il ne devient jamais inutilement multiple).
 *
 * Piège classique évité ici : seule la résolution des spécificateurs
 * `import` (et `import.meta.url`) est relative au module qui l'exécute.
 * Toute autre URL relative passée à une API web (fetch, `new Worker(...)`,
 * `new Image().src`, …) est résolue par rapport à l'URL du document
 * (index.html), quel que soit le fichier JS où l'appel est écrit. Le chemin
 * ci-dessous est donc bien « ./js/worker.js » (relatif à index.html), même
 * si ce module vit dans js/ui/.
 */

const CHEMIN_WORKER = './js/worker.js';

let worker = null;
let prochainId = 1;
const enAttente = new Map(); // id -> { resolve, reject, onProgres }

/** Erreur portant la liste (française) des messages renvoyés par le worker en cas d'échec. */
export class ErreurWorker extends Error {
  constructor(erreurs) {
    super(erreurs?.[0] ?? 'Erreur inconnue.');
    this.name = 'ErreurWorker';
    this.erreurs = erreurs?.length ? erreurs : [this.message];
  }
}

function rejeterTout(erreur) {
  for (const requete of enAttente.values()) requete.reject(erreur);
  enAttente.clear();
}

function gererMessage(evenement) {
  const donnees = evenement.data || {};
  const requete = enAttente.get(donnees.id);
  if (!requete) return; // réponse à une requête déjà résolue/rejetée (ne devrait pas arriver) ou id inconnu

  if (donnees.ok === undefined) {
    // Message de progression : la requête reste en attente d'un message terminal.
    requete.onProgres?.(donnees.progression, donnees.etape);
    return;
  }

  enAttente.delete(donnees.id);
  if (donnees.ok) {
    requete.resolve(donnees);
  } else {
    requete.reject(new ErreurWorker(donnees.erreurs));
  }
}

function obtenirWorker() {
  if (!worker) {
    const instance = new Worker(CHEMIN_WORKER, { type: 'module' });
    instance.addEventListener('message', gererMessage);
    instance.addEventListener('error', (evenement) => {
      // Erreur non interceptée à l'intérieur du worker (ex. module cassé) :
      // impossible de savoir quelle requête précise est en cause — on
      // rejette tout ce qui est en attente pour ne jamais laisser une
      // promesse orpheline (l'appelant resterait bloqué indéfiniment sinon).
      rejeterTout(new Error(`Erreur interne du worker : ${evenement.message || 'inconnue'}.`));
      // Ce worker est peut-être définitivement cassé (module qui ne se charge
      // pas, état interne corrompu) : on le termine et on réinitialise le
      // singleton pour que la prochaine requête reparte d'un worker neuf —
      // jamais de promesses qui s'accumulent sur un worker mort.
      instance.terminate();
      if (worker === instance) worker = null;
    });
    worker = instance;
  }
  return worker;
}

function envoyer(action, charge, transferables, onProgres) {
  const w = obtenirWorker();
  const id = prochainId++;
  return new Promise((resolve, reject) => {
    enAttente.set(id, { resolve, reject, onProgres });
    try {
      w.postMessage({ id, action, ...charge }, transferables);
    } catch (erreur) {
      // postMessage peut jeter en synchrone (valeur non clonable, ArrayBuffer
      // déjà détaché…) : l'entrée tout juste posée est retirée pour ne pas
      // laisser une requête fantôme, puis l'erreur est relancée (un throw
      // dans l'exécuteur de promesse = rejet de la promesse).
      enAttente.delete(id);
      throw erreur;
    }
  });
}

/**
 * Demande l'import d'un fichier client. `octets` est un ArrayBuffer, transféré
 * au worker (aucune copie) puis restitué dans la réponse (même buffer) pour
 * être stocké tel quel comme blob du dossier.
 * @param {ArrayBuffer} octets
 * @param {(progression: number, etape: string) => void} [onProgres]
 * @returns {Promise<{dossier: object, branchements: object[], octets: ArrayBuffer}>}
 */
export async function demanderImport(octets, onProgres) {
  const reponse = await envoyer('import', { octets }, [octets], onProgres);
  return { dossier: reponse.dossier, branchements: reponse.branchements, octets: reponse.octets };
}

/**
 * Demande l'export du fichier client (Task 17 branchera l'UI dessus). `octets`
 * = fichier original (ArrayBuffer, transféré). Retourne le fichier exporté.
 * @param {ArrayBuffer} octets
 * @param {object[]} branchements
 * @param {object} dossier
 * @param {(progression: number, etape: string) => void} [onProgres]
 * @returns {Promise<ArrayBuffer>}
 */
export async function demanderExport(octets, branchements, dossier, onProgres) {
  const reponse = await envoyer('export', { octets, branchements, dossier }, [octets], onProgres);
  return reponse.octets;
}

/**
 * Demande la fusion d'un réimport (Task 17 branchera l'UI dessus).
 * @param {object[]} anciens
 * @param {object[]} nouveaux
 * @returns {Promise<{branchements: object[], rapport: object}>}
 */
export async function demanderFusion(anciens, nouveaux) {
  const reponse = await envoyer('fusion', { anciens, nouveaux }, []);
  return reponse.resultat;
}
