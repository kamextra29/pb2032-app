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
 */

import { chargerTout } from '../core/store.js';
import { calculerSynthese } from '../core/regles.js';
import { echapperHtml } from './dom.js';

export async function monter(conteneur, _parametre, estActif = () => true) {
  const { dossier, branchements } = await chargerTout();
  if (!estActif()) return;

  rendre(conteneur, dossier, branchements);
}

function rendre(conteneur, dossier, branchements) {
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
      <button class="bouton bouton-grand" type="button" disabled title="Disponible prochainement">Exporter Excel</button>
      <button class="bouton bouton-grand" type="button" disabled title="Disponible prochainement">Exporter photos</button>
      ${boutonNavHtml('+ Ajouter un branchement', '#ajout', aDossier, false)}
    </section>
  `;
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
