// Convention maison : toute valeur dynamique interpolée dans du HTML
// DOIT passer par echapperHtml(). Valable uniquement pour du texte HTML et des
// valeurs d'attributs entre guillemets — jamais pour construire des URL ou du JS.

const REMPLACEMENTS = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function echapperHtml(valeur) {
  if (valeur === null || valeur === undefined) return '';
  return String(valeur).replace(/[&<>"']/g, (caractere) => REMPLACEMENTS[caractere]);
}
