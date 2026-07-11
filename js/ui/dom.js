// Convention maison : toute valeur dynamique interpolée dans du HTML
// DOIT passer par echapperHtml().

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
