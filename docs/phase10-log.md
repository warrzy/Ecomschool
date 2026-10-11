# Phase 10 — Journal : audit, durcissement, préparation production

Branche : `phase-10-production-readiness`.
Base : `phase-9-communications`.

## Déroulé

1. **Audit statique complet** → `docs/phase10-audit.md`
   (3 HIGH, 13 MEDIUM, 10 LOW identifiés et documentés).
2. **Corrections HIGH** : anti-brute-force (throttle mémoire + `lockedUntil`),
   archivage des annonces (`archivedAt`), réinitialisation de mot de passe.
3. **Corrections MEDIUM** : rétention configurable + purge cron, UI de
   consentement tuteur, WhatsApp opt-in, Zod généralisé, `logAudit` traçable,
   batching N+1, stats sans marqueurs de dédup, session 12 h, politique de mot
   de passe centralisée, en-têtes de sécurité, absence différée, filtre de
   statut PDF bulletins, lecture membership vs `User.schoolId`, assistance
   avec `authorizedById` obligatoire.
4. **Tests navigateur** : Playwright + Chromium — 30/30 PASS sur build de
   production (`e2e/`, captures `docs/recette/`).
5. **Test de charge mesuré** : `scripts/phase10/load-test.ts` —
   résultats dans `docs/phase10-performance.md`.
6. **Test de restauration** : `scripts/phase10/backup-restore-test.ts` —
   PASS (comptages identiques sur 12 tables).
7. **Documentation** : security, ux-review, performance, deployment-guide,
   backup-restore, production-checklist.

## Commits

- `dda5faa` — P10 communication : archivage, consentement, absence différée, stats
- Commits sécurité/auth, validations, rétention, membership, tests E2E.
  (voir `git log phase-9-communications..phase-10-production-readiness`)

## Changements de schéma

| Migration | Contenu |
|---|---|
| `…phase10_production_readiness` | `User.lockedUntil`, `Announcement.archivedAt` |
| `…phase10_delivery_nullable_school` | `MessageDelivery.schoolId` nullable (livraisons plateforme) |
| `…phase10_invite_nullable_school` | `AccountInvite.schoolId` nullable (resets plateforme) |

## Infrastructure de test ajoutée

- `playwright.config.ts` + `e2e/` (`@playwright/test` en devDependency) —
  serveur de production auto-démarré, sessions pré-enregistrées
  (`global-setup`) pour respecter le throttle.
- `scripts/phase10/load-test.ts` — seed LOAD-TEST (2 000 élèves) + mesures.
- `scripts/phase10/backup-restore-test.ts` — dump/restore/comptages isolés.

## Résultats de validation

| Vérification | Statut |
|---|---|
| E2E navigateur (auth, IDOR, cron, verrouillage) | PASS 30/30 |
| Régressions Phases 2–9 | PASS (voir historique) |
| Typecheck / lint / build | PASS |
| Charge mesurée (2 000 élèves, 20 concurrents) | PASS — dégradation documentée à 20 // |
| Restauration isolée | PASS |
| Cron authentifié + exécution | PASS |
| PDF vérifiés (bulletins filtrés, inter-tenant 404) | PASS |
| Conformité juridique | NOT_TESTED — expertise requise |
| Charge 100 écoles / requêtes lentes SQL | NOT_TESTED — infrastructure cible |

## Problèmes restants connus

- Throttle mémoire non mutualisé (multi-instance) — verrou DB en secours.
- Pas de sélecteur d'école pour utilisateurs multi-membership.
- `User.schoolId` encore présent en écriture (retrait final planifié).
- Vulnérabilités npm transitives non exploitables (documentées).
- Planification externe du cron à configurer sur la cible.

## Décision

**GO conditionnel** — voir `docs/production-checklist.md`.
Pas de push sur `main` ni déploiement sans validation explicite.
