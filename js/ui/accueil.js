/**
 * Écran « Accueil » (#accueil) : nom du dossier, avancement global, boutons
 * d'action principaux (§7.1 de la spec).
 *
 * Convention de montage asynchrone (voir js/app.js) : `chargerTout()` est
 * attendu avant la première écriture DOM, `estActif()` revérifié ensuite —
 * aucun rendu intermédiaire vide suivi d'un remplacement.
 *
 * Sans dossier : les boutons qui en dépendent (Rechercher, Exporter, Ajouter)
 * restent visibles mais désactivés, avec un message d'accroche ; seul
 * « Importer » est actif.
 *
 * Export Excel et export ZIP photos (Task 17, §9/§8) sont rendus inline
 * dans `#zone-export` (jamais un nouvel écran routé) : le même jeton
 * `etat.actif` que dossier.js protège les mises à jour DOM déclenchées après
 * un `await` (export ~1,4 s sur le vrai fichier) contre une navigation
 * entre-temps.
 */

import { chargerTout, toutesLesPhotos } from '../core/store.js';
import { calculerSynthese, valeurEffective } from '../core/regles.js';
import { construireEntreesZip } from '../core/photos-noms.js';
import { demanderExport } from './worker-client.js';
import { echapperHtml } from './dom.js';

const TYPE_MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function monter(conteneur, _parametre, estActif = () => true) {
  const etat = { actif: true };
  const { dossier, branchements } = await chargerTout();
  if (!estActif() || !etat.actif) return;

  rendre(conteneur, etat, dossier, branchements);

  return function demonter() {
    etat.actif = false;
  };
}

function rendre(conteneur, etat, dossier, branchements) {
  const aDossier = !!dossier;

  const blocDossier = aDossier
    ? `
      <div class="carte">
        <h2>${echapperHtml(dossier.nom)}</h2>
        <p class="texte-2">Importé le ${echapperHtml(formaterDate(dossier.dateImport))}</p>
      </div>
      ${blocAvancementHtml(branchements)}
    `
    : `<p class="texte-2">Aucun dossier importé pour l'instant. Importez le fichier client pour commencer.</p>`;

  conteneur.innerHTML = `
    <section class="ecran ecran-accueil">
      <h1>PB 2032</h1>
      ${blocDossier}
      ${boutonNavHtml('Rechercher', '#recherche', aDossier, true)}
      <a class="bouton bouton-grand" href="#dossier">${aDossier ? 'Importer / Mettre à jour' : 'Importer un fichier client'}</a>
      ${boutonActionExportHtml('btn-export-excel', 'Exporter Excel', aDossier)}
      ${boutonActionExportHtml('btn-export-photos', 'Exporter photos', aDossier)}
      ${boutonNavHtml('+ Ajouter un branchement', '#ajout', aDossier, false)}
      <div id="zone-export"></div>
    </section>
  `;

  if (aDossier) {
    conteneur.querySelector('#btn-export-excel').addEventListener('click', () => {
      lancerExportExcel(conteneur, etat, dossier, branchements);
    });
    conteneur.querySelector('#btn-export-photos').addEventListener('click', () => {
      afficherChoixExportPhotos(conteneur, etat, branchements);
    });
  }
}

function boutonActionExportHtml(id, libelle, actif) {
  if (actif) {
    return `<button class="bouton bouton-grand" id="${id}" type="button">${echapperHtml(libelle)}</button>`;
  }
  return `<button class="bouton bouton-grand" type="button" disabled title="Importez un dossier d'abord">${echapperHtml(libelle)}</button>`;
}

function blocAvancementHtml(branchements) {
  const synthese = calculerSynthese(branchements);
  const ajoutes = branchements.filter((b) => b.ajoute === true).length;
  return `
    <div class="carte carte-avancement">
      <div class="stat">
        <span class="stat-valeur">${synthese.identifies}/${synthese.nb}</span>
        <span class="stat-libelle">identifiés</span>
      </div>
      <div class="stat">
        <span class="stat-valeur">${synthese.reportes}</span>
        <span class="stat-libelle">reportés</span>
      </div>
      <div class="stat">
        <span class="stat-valeur">${ajoutes}</span>
        <span class="stat-libelle">ajoutés</span>
      </div>
    </div>
  `;
}

function boutonNavHtml(libelle, href, actif, primaire) {
  if (actif) {
    return `<a class="bouton bouton-grand${primaire ? ' btn-primaire' : ''}" href="${href}">${echapperHtml(libelle)}</a>`;
  }
  return `<button class="bouton bouton-grand" type="button" disabled title="Importez un dossier d'abord">${echapperHtml(libelle)}</button>`;
}

function formaterDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
}

// ---------------------------------------------------------------------------
// Utilitaires communs export Excel / export photos.
// ---------------------------------------------------------------------------

/** AAAA-MM-JJ (heure locale — un export lancé juste après minuit garde la bonne date pour l'utilisateur). */
function dateDuJourCourte() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formaterTailleOctets(octets) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

function afficherProgressionExport(zone, progression, etape) {
  const pourcent = Math.round(Math.max(0, Math.min(1, progression)) * 100);
  zone.innerHTML = `
    <div class="carte">
      <p>${echapperHtml(etape)}</p>
      <div class="barre-progression"><div class="barre-progression-remplie" style="width:${pourcent}%"></div></div>
    </div>
  `;
}

function afficherErreurExport(zone, titre, erreur) {
  const message = erreur instanceof Error ? erreur.message : String(erreur ?? 'Erreur inconnue.');
  zone.innerHTML = `
    <div class="carte bloc-erreur">
      <h2>${echapperHtml(titre)}</h2>
      <p>${echapperHtml(message)}</p>
    </div>
  `;
}

/** Déclenche un téléchargement via une ancre temporaire, révoquée après un court délai (le temps que le téléchargement démarre). */
function declencherTelechargement(blob, nomFichier) {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function desactiverBoutonsExport(conteneur, desactive) {
  conteneur.querySelector('#btn-export-excel')?.toggleAttribute('disabled', desactive);
  conteneur.querySelector('#btn-export-photos')?.toggleAttribute('disabled', desactive);
}

// ---------------------------------------------------------------------------
// Export Excel (§9).
// ---------------------------------------------------------------------------

async function lancerExportExcel(conteneur, etat, dossier, branchements) {
  const zone = conteneur.querySelector('#zone-export');
  if (!zone) return;
  desactiverBoutonsExport(conteneur, true);
  afficherProgressionExport(zone, 0, 'Préparation de l’export…');

  try {
    // Copie du blob avant transfert au worker : `dossier` reste utilisable
    // tel quel si l'utilisateur relance un export sans quitter l'écran
    // (un transfert direct de dossier.blob.buffer le détacherait).
    const octetsCopie = dossier.blob.slice().buffer;
    const octetsResultat = await demanderExport(octetsCopie, branchements, dossier, (progression, etape) => {
      if (!etat.actif) return;
      const zoneActuelle = conteneur.querySelector('#zone-export');
      if (zoneActuelle) afficherProgressionExport(zoneActuelle, progression, etape);
    });
    if (!etat.actif) return;
    const zoneActuelle = conteneur.querySelector('#zone-export');
    if (zoneActuelle) afficherResultatExportExcel(zoneActuelle, dossier, octetsResultat);
  } catch (erreur) {
    if (!etat.actif) return;
    const zoneActuelle = conteneur.querySelector('#zone-export');
    if (zoneActuelle) {
      afficherErreurExport(zoneActuelle, 'Export impossible', erreur);
    }
  } finally {
    if (etat.actif) desactiverBoutonsExport(conteneur, false);
  }
}

function afficherResultatExportExcel(zone, dossier, octetsResultat) {
  const nomFichier = `${dossier.nom.replace(/\.xlsx$/i, '')} - export ${dateDuJourCourte()}.xlsx`;
  const blob = new Blob([octetsResultat], { type: TYPE_MIME_XLSX });

  declencherTelechargement(blob, nomFichier);

  let fichierPartage = null;
  let peutPartager = false;
  try {
    if (typeof File === 'function') {
      fichierPartage = new File([blob], nomFichier, { type: TYPE_MIME_XLSX });
      peutPartager = typeof navigator.canShare === 'function' && navigator.canShare({ files: [fichierPartage] });
    }
  } catch {
    peutPartager = false; // File/canShare indisponibles ou incompatibles : pas grave, le téléchargement a déjà eu lieu
  }

  zone.innerHTML = `
    <div class="carte carte-succes">
      <p>Export terminé : <strong>${echapperHtml(nomFichier)}</strong> (${formaterTailleOctets(blob.size)}).</p>
      <div class="rangee-boutons">
        <button type="button" class="bouton" id="btn-retelecharger-excel">Télécharger à nouveau</button>
        ${peutPartager ? '<button type="button" class="bouton btn-primaire" id="btn-partager-excel">Partager</button>' : ''}
      </div>
    </div>
  `;

  zone.querySelector('#btn-retelecharger-excel').addEventListener('click', () => {
    declencherTelechargement(blob, nomFichier);
  });

  if (peutPartager) {
    zone.querySelector('#btn-partager-excel').addEventListener('click', async () => {
      try {
        await navigator.share({ files: [fichierPartage], title: nomFichier });
      } catch {
        // Annulation ou échec du partage natif : sans conséquence, le fichier est déjà téléchargé.
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Export photos ZIP (§8) : choix d'étendue puis archive.
// ---------------------------------------------------------------------------

function valeursDistinctes(branchements, cle) {
  const ensemble = new Set();
  for (const b of branchements) {
    const v = valeurEffective(b, cle);
    if (v !== undefined && v !== null && String(v).trim() !== '') ensemble.add(String(v).trim());
  }
  return [...ensemble].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Paires "commune|rue" distinctes, affichées "rue — commune" pour lever l'ambiguïté d'une rue partagée par deux communes. */
function pairesRueDistinctes(branchements) {
  const index = new Map(); // "commune rue" -> {commune, rue}
  for (const b of branchements) {
    const commune = String(valeurEffective(b, 'commune') ?? '').trim();
    const rue = String(valeurEffective(b, 'rue') ?? '').trim();
    if (!rue) continue;
    const cle = `${commune} ${rue}`;
    if (!index.has(cle)) index.set(cle, { commune, rue });
  }
  return [...index.values()].sort((a, b) => a.rue.localeCompare(b.rue, 'fr') || a.commune.localeCompare(b.commune, 'fr'));
}

function afficherChoixExportPhotos(conteneur, etat, branchements) {
  const zone = conteneur.querySelector('#zone-export');
  if (!zone) return;

  const communes = valeursDistinctes(branchements, 'commune');
  const paires = pairesRueDistinctes(branchements);
  const phases = valeursDistinctes(branchements, 'phaseTerrain');

  zone.innerHTML = `
    <div class="carte">
      <h2>Exporter les photos</h2>
      <fieldset class="groupe-radio">
        <legend>Étendue</legend>
        <label><input type="radio" name="portee-photos" value="tout" checked> Tout le dossier</label>
        <label><input type="radio" name="portee-photos" value="commune"${communes.length ? '' : ' disabled'}> Une commune</label>
        <label><input type="radio" name="portee-photos" value="rue"${paires.length ? '' : ' disabled'}> Une rue</label>
        <label><input type="radio" name="portee-photos" value="phase"${phases.length ? '' : ' disabled'}> Une phase terrain</label>
      </fieldset>
      <div id="zone-selecteur-portee"></div>
      <div class="rangee-boutons">
        <button type="button" class="bouton" id="btn-annuler-export-photos">Annuler</button>
        <button type="button" class="bouton btn-primaire" id="btn-lancer-export-photos">Exporter</button>
      </div>
      <div id="zone-resultat-export-photos"></div>
    </div>
  `;

  const zoneSelecteur = zone.querySelector('#zone-selecteur-portee');

  function rendreSelecteur(portee) {
    if (portee === 'commune') {
      zoneSelecteur.innerHTML = `
        <select id="select-portee-valeur">
          ${communes.map((c) => `<option value="${echapperHtml(c)}">${echapperHtml(c)}</option>`).join('')}
        </select>
      `;
    } else if (portee === 'rue') {
      zoneSelecteur.innerHTML = `
        <select id="select-portee-valeur">
          ${paires.map((p, i) => `<option value="${i}">${echapperHtml(p.rue)} — ${echapperHtml(p.commune)}</option>`).join('')}
        </select>
      `;
    } else if (portee === 'phase') {
      zoneSelecteur.innerHTML = `
        <select id="select-portee-valeur">
          ${phases.map((p) => `<option value="${echapperHtml(p)}">${echapperHtml(p)}</option>`).join('')}
        </select>
      `;
    } else {
      zoneSelecteur.innerHTML = '';
    }
  }

  rendreSelecteur('tout');
  zone.querySelectorAll('input[name="portee-photos"]').forEach((radio) => {
    radio.addEventListener('change', () => rendreSelecteur(radio.value));
  });

  zone.querySelector('#btn-annuler-export-photos').addEventListener('click', () => {
    zone.innerHTML = '';
  });

  zone.querySelector('#btn-lancer-export-photos').addEventListener('click', () => {
    const portee = zone.querySelector('input[name="portee-photos"]:checked')?.value ?? 'tout';
    const filtre = {};
    if (portee === 'commune') {
      filtre.commune = zone.querySelector('#select-portee-valeur')?.value ?? '';
    } else if (portee === 'rue') {
      const paire = paires[Number(zone.querySelector('#select-portee-valeur')?.value ?? -1)];
      if (paire) {
        filtre.commune = paire.commune;
        filtre.rue = paire.rue;
      }
    } else if (portee === 'phase') {
      filtre.phase = zone.querySelector('#select-portee-valeur')?.value ?? '';
    }
    lancerExportPhotos(conteneur, etat, branchements, filtre);
  });
}

async function lancerExportPhotos(conteneur, etat, branchements, filtre) {
  const zoneResultat = conteneur.querySelector('#zone-resultat-export-photos');
  if (!zoneResultat) return;
  desactiverBoutonsExport(conteneur, true);
  afficherProgressionExport(zoneResultat, 0.1, 'Chargement des photos…');

  try {
    const toutes = await toutesLesPhotos();
    if (!etat.actif) return;

    const photosParBranchement = new Map();
    for (const photo of toutes) {
      if (!photosParBranchement.has(photo.branchementId)) photosParBranchement.set(photo.branchementId, []);
      photosParBranchement.get(photo.branchementId).push(photo);
    }

    const entrees = construireEntreesZip(branchements, photosParBranchement, filtre);
    if (entrees.length === 0) {
      const zoneActuelle = conteneur.querySelector('#zone-resultat-export-photos');
      if (zoneActuelle) {
        zoneActuelle.innerHTML = `<p class="texte-2">Aucune photo à exporter pour cette sélection.</p>`;
      }
      return;
    }

    const zoneActuelle1 = conteneur.querySelector('#zone-resultat-export-photos');
    if (zoneActuelle1) afficherProgressionExport(zoneActuelle1, 0.3, `Compression du zip (${entrees.length} photo${entrees.length > 1 ? 's' : ''})…`);

    const { default: JSZip } = await import('../lib/zip.mjs');
    const zip = new JSZip();
    for (const entree of entrees) {
      zip.file(entree.nom, entree.photo.blob);
    }
    const blobZip = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (meta) => {
      if (!etat.actif) return;
      const zoneProgres = conteneur.querySelector('#zone-resultat-export-photos');
      if (zoneProgres) afficherProgressionExport(zoneProgres, 0.3 + (meta.percent / 100) * 0.7, 'Compression du zip…');
    });
    if (!etat.actif) return;

    const nomZip = `photos ${dateDuJourCourte()}.zip`;
    declencherTelechargement(blobZip, nomZip);

    const zoneFinale = conteneur.querySelector('#zone-resultat-export-photos');
    if (zoneFinale) {
      zoneFinale.innerHTML = `
        <div class="carte carte-succes">
          <p>Export terminé : <strong>${echapperHtml(nomZip)}</strong> — ${entrees.length} photo${entrees.length > 1 ? 's' : ''} (${formaterTailleOctets(blobZip.size)}).</p>
          <div class="rangee-boutons">
            <button type="button" class="bouton" id="btn-retelecharger-zip">Télécharger à nouveau</button>
          </div>
        </div>
      `;
      zoneFinale.querySelector('#btn-retelecharger-zip').addEventListener('click', () => {
        declencherTelechargement(blobZip, nomZip);
      });
    }
  } catch (erreur) {
    if (!etat.actif) return;
    const zoneActuelle = conteneur.querySelector('#zone-resultat-export-photos');
    if (zoneActuelle) afficherErreurExport(zoneActuelle, 'Export photos impossible', erreur);
  } finally {
    if (etat.actif) desactiverBoutonsExport(conteneur, false);
  }
}
