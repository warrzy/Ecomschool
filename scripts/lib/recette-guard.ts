/**
 * Garde anti-destruction : refuse l'exécution d'une recette destructive
 * contre une base réelle (production ou base sans opt-in explicite).
 * Toute recette manipulant deleteMany/reset DOIT l'importer en premier.
 */
export function assertRecetteEnv(name = "recette") {
  const url = process.env.DATABASE_URL ?? "";
  if (/prod/i.test(url) && !/preprod|verify/i.test(url)) {
    throw new Error(`[${name}] DATABASE_URL semble pointer sur la production — exécution refusée.`);
  }
  if (process.env.ALLOW_RECETTE !== "1") {
    throw new Error(`[${name}] recette destructive : définir ALLOW_RECETTE=1 (bases isolées/préprod uniquement).`);
  }
}
assertRecetteEnv();
