# Lot A3 — Procédure d'activation coordonnée de la matrice V2

> Suite de `docs/a2-preparation-technique-abonnements.md`.
> **Aucune activation effectuée** — cette procédure attend un GO explicite.

## 1. Configuration cible vérifiée

Correspondance validée par `scripts/a2/matrix-check.ts` (56/56) et le
dry-run de `scripts/a3/migrate-matrix-v2.ts` sur la base réelle :

| Bloc | Essentiel | Professionnel | Premium |
|---|:-:|:-:|:-:|
| ADMINISTRATION, STUDENTS, TEACHERS, CLASSES_SUBJECTS | ✓ | ✓ | ✓ |
| SCHEDULES, ATTENDANCE, GRADES, REPORT_CARDS | ✓ *(nouveau)* | ✓ | ✓ |
| FINANCE_CORE (caisse, reçus, impayés) | ✓ *(nouveau module)* | ✓ | ✓ |
| FINANCE_MGMT (config, remises, clôture) | ✗ | ✓ *(nouveau)* | ✓ |
| PARENT_PORTAL, STUDENT_PORTAL | ✗ | ✓ *(élargi)* | ✓ |
| COMMUNICATION (annonces, messages) | ✗ | ✓ *(élargi)* | ✓ |
| REPORTS (rapports détaillés) | ✗ | ✓ *(élargi)* | ✓ |
| Quotas | 300/15 | 1 000/50 | illimité — **inchangés** |
| Tarifs | 15 k | 30 k | 50 k — **inchangés** |

Non annoncés (non développés) : TREASURY, BUDGETS, SUPPLIERS,
COMMUNICATION_ADVANCED, REPORTS_ADVANCED — ils n'apparaissent ni dans la
matrice cible ni dans `/tarifs`.

Point noté au dry-run : PREMIUM conserve son association `FINANCE`
historique (inerte sous V2 — aucune permission ne la cible). Elle pourra
être retirée dans un lot ultérieur, sans urgence.

## 2. Scripts préparés

| Script | Rôle | Exécuté ? |
|---|---|---|
| `scripts/a3/migrate-matrix-v2.ts` | Crée FINANCE_CORE/FINANCE_MGMT + complète PlanModule (ajouts seuls, upsert idempotent) | Dry-run ✓ |
| `scripts/a3/rollback-matrix-v2.ts` | Restaure PlanModule depuis le snapshot + archive les nouveaux modules | Dry-run impossible sans snapshot (normal) |
| `scripts/a3/scenario-overrides.ts` | Simule un plan sur l'école démo via overrides (réversible, `--set reset`) | Dry-run ✓ |
| `scripts/a3/subscription-recette.ts` | Recette authentifiée profil × scénario (Playwright, lecture seule) | Non exécutée — nécessite l'activation |
| `scripts/a2/matrix-check.ts` | Invariant d'accès + matrice cible (56/56) | ✓ |

Tous les scripts d'écriture sont en **dry-run par défaut** (`--apply`
requis) et produisent un rapport avant/après.

## 3. Rapport des changements prévus (dry-run réel)

```
Catalogue : 23 modules → +FINANCE_CORE, +FINANCE_MGMT

ESSENTIEL      ajout : SCHEDULES, ATTENDANCE, GRADES, REPORT_CARDS, FINANCE_CORE
PROFESSIONNEL  ajout : FINANCE_CORE, FINANCE_MGMT, PARENT_PORTAL,
                       STUDENT_PORTAL, COMMUNICATION, REPORTS
PREMIUM        ajout : FINANCE_CORE, FINANCE_MGMT
```

Aucun retrait, aucun plan de test touché (filtre `commercial: true` +
codes explicites), aucun abonnement ni override modifié.

## 4. Procédure d'activation (à exécuter sur GO, préprod)

1. `bash deploy/scripts/backup.sh` — sauvegarde + SHA256 (procédure habituelle).
2. `npx tsx scripts/a3/migrate-matrix-v2.ts` — dry-run de contrôle.
3. `npx tsx scripts/a3/migrate-matrix-v2.ts --apply` — écriture + snapshot
   `scripts/a3/snapshots/plan-modules-<ts>.json`.
4. Déployer le commit A2+A3 (le code V2 est déjà livré, inerte sans flag).
5. `SUBSCRIPTION_MATRIX_V2=1` dans `/var/www/ecomschool-preprod/shared/.env`
   puis `pm2 restart ecomschool-preprod`.
6. Recette par scénario sur l'école démo (PREMIUM ACTIVE) :
   - `scenario-overrides.ts --school demo --set essentiel --apply`
     → `subscription-recette.ts --scenario essentiel`
   - `--set pro` (reset overrides) → `--scenario pro`
   - `--set reset` → `--scenario premium`
   - `--scenario platform` (owner + sales)
7. `matrix-check.ts` + suites D3/D4/D5 en non-régression.
8. Remise à zéro : `scenario-overrides.ts --set reset --apply`.

## 5. Procédure de rollback complète

> La désactivation du flag **seule n'est pas un rollback** si PlanModule
> a changé — les lignes ajoutées resteraient inertes sous V1 mais
> pollueraient le catalogue admin. Procédure complète :

1. `SUBSCRIPTION_MATRIX_V2=""` → `pm2 restart` (retour immédiat au
   comportement V1 ; les nouvelles lignes PlanModule sont ignorées).
2. `rollback-matrix-v2.ts --snapshot <fichier> --apply` — supprime les
   associations ajoutées et archive FINANCE_CORE/FINANCE_MGMT
   (ARCHIVED — jamais de suppression : des overrides peuvent exister).
3. Vérifications : sortie du script (conformité snapshot) +
   `matrix-check.ts` + recette authentifiée d'un parcours caisse et
   portail sur l'école démo.
4. La sauvegarde SQL du point 1 de l'activation reste le filet de
   sécurité ultime (`deploy/scripts/restore.sh`).

## 6. Plan de recette authentifiée

| Scénario | Profil | Autorisé vérifié | Refusé vérifié |
|---|---|---|---|
| essentiel | ADMIN_SCHOOL | élèves, classes, enseignants, users, EDT, présences, notes, bulletins, paiements, impayés, reçus | fees/settings, annonces, messages |
| essentiel | TEACHER | /teacher, présences, EDT, notes | /app/fees, /app/users |
| essentiel | CASHIER | /app/fees/payments, /app/fees | fees/settings, élèves, annonces |
| essentiel | PARENT / STUDENT | — | portails refusés |
| pro | ADMIN_SCHOOL | + fees/settings, annonces, messages | — |
| pro | FINANCE_MANAGER | fees/settings, impayés | élèves |
| pro | PARENT / STUDENT | portails ouverts | — |
| premium | tous | tout | — |
| platform | OWNER | écoles, demandes, plans, modules | — |
| platform | SALES | abonnements, factures | écoles, demandes |
| suspension | (manuel) | lecture seule + portails | toute écriture |
| quotas | (manuel) | blocage aux seuils maxUsers/maxStudents | — |
| overrides | (via scenario script) | ajout/retrait unitaire effectif | — |

Suspension et quotas : pas de script automatisé — la suspension modifie
le statut de l'abonnement démo (manipulation encadrée manuellement via
`/platform/subscriptions` avec réactivation immédiate), et les quotas
exigeraient de créer des données massives. Vérification manuelle
documentée, ou via une école de test dédiée si souhaité.

Comptes optionnels : `A3_FINANCE_EMAIL` (FINANCE_MANAGER — pas de compte
démo standard), `A3_SALES_EMAIL` — SKIP explicite si absents, jamais
déclaré PASS.

## 7. Points ouverts — décisions requises avant activation

| Sujet | État | Décision à prendre |
|---|---|---|
| Écoles sans abonnement (fail-open) | Inchangé | V1 comme V2 = tout autorisé. Proposition A2 §3 (journaliser → `NO_SUBSCRIPTION_PLAN`). **Pas de durcissement sans GO** |
| Écoles de démonstration | Collège Démo = PREMIUM | Conserver PREMIUM (vitrine complète) ou la laisser en vitrine avec overrides — décision commerciale |
| Invitations portail | Gate V2 prête | Sous flag : module portail requis + quota users. OK pour cohérence commerciale |
| Rapports réels | `finance.reports.read` → FINANCE_CORE | REPORTS ne contrôle aujourd'hui que `reports.attendance` (morte) — le module est vendu « rapports détaillés » mais son périmètre réel reste à enrichir (lot futur) |
| Permissions historiques mortes | 7 clés | Décision : vérifier réellement ou supprimer — hors A3 |
| Module `FINANCE` résiduel sur PREMIUM | Inerte sous V2 | Retirer dans un lot de nettoyage ultérieur |

## 8. Risques résiduels

| Risque | Mitigation |
|---|---|
| Flag activé avant PlanModule | Ordre figé §4 ; matrix-check 2b documente l'impact |
| Overrides pré-existants sur écoles réelles | Aucun en base actuellement ; le script n'y touche pas |
| École démo sous overrides oubliés après recette | Étape 8 de la procédure + `reset` idempotent |
| Recette SKIP faute de comptes | Les SKIP sont explicites — jamais comptés PASS |
| Comportement fail-open exploit | Inchangé — décision ouverte (§7) |
