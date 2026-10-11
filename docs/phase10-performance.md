# Phase 10 — Performances

Mesures réelles, reproductibles via `npx tsx scripts/phase10/load-test.ts`.

## Conditions de mesure

- Machine : PC portable Windows (LENOVO-L490), Node.js 24, PostgreSQL 18 local.
- Application : build de production (`next start`), port 3000.
- Jeu de données : 17 écoles, ~2 100 élèves dont **2 000** dans l'école
  dédiée `LOAD-TEST`, 51 bulletins, 44 paiements, 1 500+ entrées d'audit.
- Méthode : session authentifiée (cookies), mesures côté client HTTP.

## Résultats mesurés

| Scénario | Statut | Taille | p50 | p95 | max |
|---|---|---|---|---|---|
| GET /app (dashboard) | 200 | 34 Ko | 308 ms | 369 ms | 369 ms |
| GET /app/students p1 (2 000 élèves) | 200 | 64 Ko | 179 ms | 200 ms | 200 ms |
| GET /app/students p50 | 200 | 65 Ko | 188 ms | 239 ms | 239 ms |
| GET /app/students p100 | 200 | 64 Ko | 210 ms | 248 ms | 248 ms |
| GET /app/students?q= (recherche) | 200 | 64 Ko | 188 ms | 297 ms | 297 ms |
| GET /app/students/export (CSV 2 000 lignes) | 200 | 86 Ko | 152 ms | 232 ms | 232 ms |
| GET /app/notifications | 200 | 27 Ko | 121 ms | 128 ms | 128 ms |
| GET /app/messages | 200 | 33 Ko | 140 ms | 162 ms | 162 ms |
| GET /app/fees | 200 | 26 Ko | 145 ms | 295 ms | 295 ms |
| GET /app/students ×20 concurrentes ×3 | 200 | — | **3 041 ms** | **4 667 ms** | 4 715 ms |
| GET /app/report-cards/pdf (tous les bulletins de l'école) | 200 | 7 Ko | 260 ms | 806 ms | 806 ms |

## Lecture des résultats

- **Séquentiel** : toutes les pages < 400 ms à 2 000 élèves — la pagination
  (`skip/take`, pageSize ≤ 100) et les index tenant (`schoolId`) font leur
  travail. La recherche `contains` reste < 300 ms à ce volume.
- **Concurrence** : dégradation nette à 20 requêtes parallèles (p50 ≈ 3 s).
  Causes probables : processus Node unique, plusieurs requêtes DB par page
  (session → user → membership → permissions → entitlements), render
  React serveur. À ce niveau (~150 ms de travail séquentiel par requête),
  20 parallèles saturent le thread du serveur dev-laptop.
  **Recommandation** : dimensionner la production sur plusieurs instances ou
  workers, mesurer à nouveau sur l'infrastructure cible, et envisager un cache
  court sur `getEntitlements`/permissions par requête.
- **PDF collectif** : ~260 ms pour l'école démo (quelques bulletins) ;
  la génération reste linéaire au nombre de bulletins — surveiller les
  exports annuels complets (centaines de pages) et envisager un job asynchrone.
- **Export CSV** : 2 000 lignes en ~150 ms — pas de problème constaté.

## Optimisations déjà appliquées en Phase 10

- Requêtes batchées dans les rappels d'échéances (N+1 → `in` queries).
- Exclusion des marqueurs de déduplication des statistiques de canaux
  (requêtes `findMany` filtrées par `recipientId NOT NULL`).

## Non mesuré / à refaire en préproduction

- Volumes « 100 écoles / plusieurs milliers d'élèves chacune ».
- Requêtes SQL lentes via `pg_stat_statements` (non activé en dev).
- CPU/mémoire serveur sous charge soutenue (mesure process client seulement :
  heap ~55 Mo).
