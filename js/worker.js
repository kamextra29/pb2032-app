/**
 * Worker web (module) : import / export / fusion du fichier client, hors du
 * thread principal — la feuille PB décompressée pèse ~60 Mo dans le vrai
 * fichier (25 556 lignes). Le thread principal garde IndexedDB (store.js) ;
 * ce worker ne connaît que les modules purs de js/core (aucun DOM, aucun
 * IndexedDB ici).
 *
 * Protocole (postMessage), une requête = un message identifié par un `id`
 * unique généré par l'appelant (js/ui/worker-client.js), qui route la
 * réponse. Une requête peut produire plusieurs messages de progression
 * `{id, progression: 0..1, etape: '…'}` (reconnaissables à l'absence de
 * `ok`), puis exactement un message terminal :
 *
 *  - {id, action:'import', octets: ArrayBuffer}
 *      → {id, ok:true, dossier, branchements, octets}
 *        (`octets` : le même ArrayBuffer, transféré en entrée ET en sortie —
 *        aucune copie des ~60 Mo ; le thread principal en a besoin tel quel
 *        pour stocker le blob original du dossier)
 *      → ou {id, ok:false, erreurs:[...]}
 *  - {id, action:'export', octets, branchements, dossier}
 *      → {id, ok:true, octets} (transféré) ou {id, ok:false, erreurs}
 *  - {id, action:'fusion', anciens, nouveaux}
 *      → {id, ok:true, resultat} ou {id, ok:false, erreurs}
 *
 * Garde-fou : toute exception est interceptée, une requête ne reste jamais
 * sans réponse (sinon la promesse correspondante resterait bloquée côté
 * appelant pour toujours).
 */

import { lireFichier } from './core/xlsx-reader.js';
import { exporterFichier } from './core/xlsx-writer.js';
import { fusionner } from './core/fusion.js';

self.addEventListener('message', (evenement) => {
  const donnees = evenement.data || {};
  const { id, action } = donnees;
  if (id === undefined || action === undefined) return; // message mal formé : ignoré, pas de requête à honorer

  switch (action) {
    case 'import':
      gererImport(id, donnees.octets);
      break;
    case 'export':
      gererExport(id, donnees);
      break;
    case 'fusion':
      gererFusion(id, donnees);
      break;
    default:
      postMessage({ id, ok: false, erreurs: [`Action de worker inconnue : « ${action} ».`] });
  }
});

function progres(id, progression, etape) {
  postMessage({ id, progression, etape });
}

async function gererImport(id, octets) {
  const debut = performance.now();
  try {
    progres(id, 0.1, 'Lecture du fichier…');
    // Vue sans copie sur l'ArrayBuffer transféré (aucune allocation des ~60 Mo).
    const vue = new Uint8Array(octets);
    progres(id, 0.3, 'Analyse du classeur Excel…');
    const { dossier, branchements, erreurs } = await lireFichier(vue);

    if (erreurs.length > 0) {
      postMessage({ id, ok: false, erreurs });
      return;
    }

    progres(id, 0.9, 'Finalisation…');
    const duree = Math.round(performance.now() - debut);
    console.log(`[worker] import terminé en ${duree} ms (${branchements.length} branchements)`);
    // `octets` (le même ArrayBuffer reçu) est retransféré tel quel : le
    // thread principal en a besoin, intact, pour stocker le blob original.
    postMessage({ id, ok: true, dossier, branchements, octets }, [octets]);
  } catch (erreur) {
    postMessage({ id, ok: false, erreurs: [messageErreur(erreur, 'import')] });
  }
}

async function gererExport(id, { octets, branchements, dossier }) {
  try {
    progres(id, 0.1, 'Préparation de l’export…');
    const vue = new Uint8Array(octets);
    const resultat = await exporterFichier(vue, branchements, dossier);
    progres(id, 0.9, 'Finalisation…');
    const octetsResultat = tamponTransferable(resultat);
    postMessage({ id, ok: true, octets: octetsResultat }, [octetsResultat]);
  } catch (erreur) {
    postMessage({ id, ok: false, erreurs: [messageErreur(erreur, 'export')] });
  }
}

async function gererFusion(id, { anciens, nouveaux }) {
  try {
    const resultat = fusionner(anciens, nouveaux);
    postMessage({ id, ok: true, resultat });
  } catch (erreur) {
    postMessage({ id, ok: false, erreurs: [messageErreur(erreur, 'fusion')] });
  }
}

/**
 * Renvoie un ArrayBuffer transférable correspondant exactement au contenu
 * d'un Uint8Array : le buffer sous-jacent tel quel s'il couvre exactement la
 * vue (cas courant, aucune copie), sinon une copie ajustée à la taille utile
 * (jamais transférer un buffer plus grand contenant des données étrangères).
 */
function tamponTransferable(u8) {
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) return u8.buffer;
  return u8.slice().buffer;
}

/** Message d'erreur français, jamais vide, avec le contexte de l'action en échec. */
function messageErreur(erreur, contexte) {
  const brut = erreur instanceof Error ? erreur.message : String(erreur ?? '');
  return brut || `Une erreur inattendue est survenue pendant l'opération « ${contexte} ».`;
}
