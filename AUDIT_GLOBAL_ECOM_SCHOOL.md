# AUDIT GLOBAL — ECOM-SCHOOL

Date : 14 novembre 2026 — Audit réalisé sur le code réel (`phase-10-production-readiness`, commit `ec62b59`), la base déployée et l'infrastructure. Toute affirmation ci-dessous est adossée à des fichiers, modèles ou tests vérifiables.

---

## 1. ARCHITECTURE TECHNIQUE RÉELLE

| Couche | Réalité vérifiée |
|---|---|
| Framework | **Next.js 16.4.1** (version non standard — règles spécifiques dans `node_modules/next/dist/docs/`, cf. `AGENTS.md`) + React 19.3.0 |
| Langage | TypeScript strict, ESLint, `tsx` pour scripts |
| ORM / BDD | Prisma **7.10.1** — PostgreSQL 16.15 — `prisma/schema.prisma` : **102 modèles**, **55 migrations** appliquées en prod |
| Auth | NextAuth credentials — `src/lib/auth/options.ts` : `authorize()` throttle mémoire (5/30s), verrouillage persistant (8 échecs / 15 min), association école via `SchoolMembership` (pas `User.schoolId`) |
| Multi-tenant | `schoolId` porté par `SchoolMembership` + filtrage serveur sur chaque requête ; isolation prouvée par tests (G2-E 91/91, recette prod) |
| Permissions | Clés fines (`accounting.read/manage/export`, ~103 clés ADMIN_SCHOOL) — vérifiées côté serveur dans chaque server action |
| UI | App Router, server actions, server components ; portails séparés `/parent`, `/student`, `/teacher`, `/platform`, `/app` |
| PDF/exports | Documents administratifs (G4), bulletins/délibérations PDF, CSV comptabilité (injection de formules neutralisée) |
| Infra | VPS 147.79.118.212 — PM2 (`ecomschool-prod` :3002, `ecomschool-preprod`), Nginx 1.24 + Certbot, sauvegardes `pg_dump`+SHA256+uploads, restore-verify hebdo, monitoring 15 min, alerting Discord testé |
| Tests | Recettes `tsx` + Playwright : H5 117/117, H6 110/110, H12 68/68, G2-E 91/91, G3-C 71/71, UI 5/5 — tsc/ESLint/build verts |

## 2. ÉTAT DES LIEUX PAR DOMAINE

### Modules COMPLETS (testés, accessibles UI, déployés)
- Tenants/écoles, années scolaires, niveaux/classes/matières, référentiels
- Élèves, parents/tuteurs, inscriptions, admissions G2 (pipeline, tests/entretiens, listes d'attente), réinscriptions
- Évaluations, notes, moyennes, classements, bulletins
- Délibérations H5 (règles configurables, propositions vs décisions conseil, validation/publication/dépublication contrôlée, audit, PDF, CSV, protection stale-result, règles par niveau + fallback)
- Progression H6 (promotion/redoublement/orientation/transferts, niveaux terminaux, réconciliation H5→G2)
- Dépenses, trésorerie, frais scolaires + échéanciers, facturation, encaissements, reçus, **relances d'impayés** (`FeeReminder`)
- Comptabilité H12 : plan SYSCOHADA configurable, journaux, exercices, mappings, grand livre, balance, exports CSV, génération idempotente depuis paiements/annulations/remboursements/dépenses
- Documents administratifs G4 (gabarits, PDF)
- Portails parent (H1), élève ; portail enseignant (notes/présences)
- Admin plateforme `/platform` (écoles, admins d'école, plans, modules, gabarits)
- Journalisation d'audit, RGPD de base
- Ops : backups, restore-verify, monitoring, alerting, déploiement atomique + rollback, cron

### Modules PARTIELS
- Paiements en ligne : PayDunya/MoMo **sandbox uniquement + saisie manuelle** — aucun rail LIVE (G3-C 71/71 en sandbox)
- Communications : notifications internes + journal ; **aucun envoi SMS/email/WhatsApp** réel aux familles
- Comptabilité : pas de bilan / compte de résultat / états financiers, pas de rapprochement bancaire, pas d'immobilisations/amortissements, pas de comptes tiers (clients/fournisseurs détaillés)
- Portail enseignant : saisie de notes/présences, mais **pas de self-service RH** (congés, bulletins de paie)
- Emplois du temps : présence de modèles mais couverture fonctionnelle limitée (pas de génération automatique ni de gestion des conflits complète)
- Onboarding école : parcours présent mais pas de self-service public (inscriptions publiques volontairement désactivées)

### Modules ABSENTS
- **RH / paie : aucun modèle** (aucun `Payroll`, `Payslip`, `Contract`, `Leave`, `Staff` en base — vérifié par grep exhaustif du schéma)
- **Gestion universitaire : aucun modèle** (facultés, départements, filières, UE/crédits, semestres, LMD, stages/mémoires, vacataires)
- Rapprochement bancaire, immobilisations/amortissements
- Bilan, compte de résultat, annexes SYSCOHADA
- Rôle « gestionnaire de scolarité » (demandé, inexistant — ADMIN_SCHOOL le couvre de fait)
- Envoi SMS/WhatsApp/email transactionnel vers les familles
- Paiements LIVE (volontairement désactivé)

## 3. DIFFÉRENCES LOCAL / DISTANT / DÉPLOYÉ

- Branche `phase-10-production-readiness` = `origin` = release déployée `20261108_142517` (commit `ec62b59`) — **aucun commit non poussé**
- Non suivis en local : `docs/audit-global-2026-11.md`, `docs/plan-*.md`, `scripts/prod-recette.ts`, `scripts/prod-demo-accounts.ts`, `.agents/.claude/.cursor/.devin`
- Prod `ecomschool.fr` : 55/55 migrations, base vierge + admin plateforme + **comptes démo temporaires** (créés le 08/11 pour tests utilisateur, à purger avant commercialisation)
- Preprod `preprod.ecomschool.fr` : données démo complètes, release `20261108_132348`

## 4. DETTE TECHNIQUE ET RISQUES

| Risque | Gravité | Détail |
|---|---|---|
| Restauration testée une fois | Moyen | `restore-verify` hebdo prévu en cron — déployé sur VPS mais validé une seule fois |
| Dépendance `uuid@8.3.2` | Faible | Transitif via `exceljs@4.4.0` — fix = downgrade cassant, documenté |
| Fin d'année manuelle | Moyen | Pas de workflow automatisé clôture → nouvelle année |
| Notifications sortantes | Élevé | Aucun canal familles (SMS/email/WhatsApp) — bloquant offre Pro |
| Paiements LIVE | Élevé | Aucun rail réel — bloquant Premium |
| RH/paie | Bloquant 360° | Module entier absent |
| Université | Bloquant cible | Modèles LMD inexistants |
| Next.js non standard | Moyen | Règles `AGENTS.md` obligatoires pour tout nouveau code |
| Comptes démo en prod | Faible | Temporaires, purge scriptée prête |

## 5. ÉTAT TESTS / PRÉPROD / PROD

- **Tests** : 500+ assertions de recette (H5 117, H6 110, H12 68, G2-E 91, G3-C 71, UI 5) — couverts : isolation, permissions, compta, délibérations, progression, paiements sandbox, docs. Non couverts : RH (absent), université (absent), envois externes.
- **Preprod** : stable, recettes rejouées, 3 sites voisins intacts.
- **Prod** : HTTPS live, recette 11/11 PASS + purge 0 résidu, backup réel validé, alerting Discord actif, cron proposé non installé (dernier GO attendu : `sudo cp .../ecomschool-prod.cron /etc/cron.d/`).

---
*Livrables associés : `AUDIT_RH_COMPTABILITE_360.md`, `MATRICE_FONCTIONNELLE.md`, `ROADMAP_FINALISATION.md`, `BACKLOG_PRIORISE.md`.*
