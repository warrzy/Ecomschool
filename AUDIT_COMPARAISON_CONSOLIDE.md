# COMPARAISON DES AUDITS — DEVIN vs CURSOR (PR #2)

14 novembre 2026 — Croisement de mes livrables et des 5 rapports Cursor (branche `cursor/audit-global-ecom-school-d898`, commits `51650f9` + `9eea714`, code analysé : `ec62b59` — même référence que moi).

---

## 1. DIVERGENCES VÉRIFIÉES

| # | Sujet | Mon audit | Cursor | Vérification réelle | Criticité | Action |
|---|---|---|---|---|---|---|
| D1 | Documents administratifs dans le menu | Non relevé | `/app/documents-administratifs` absente de `appNav` | **CURSOR CORRECT** : `nav.ts:94` pointe `/app/documents` (autre page) ; `documents-administratifs` joignable par URL seule | P1 | AUD-006 : ajouter entrée menu avec `administrative-docs.read` |
| D2 | Écriture manuelle | Non relevé | `createManualEntry` sans UI | **CURSOR CORRECT** : aucun appelant hors `accounting.ts` | P1 | AUD-012 : écran OD équilibrée |
| D3 | Grand livre | « Grand livre + balance ✅ » | Route CSV existe, **pas de bouton** | **NUANCÉ** : service+route OK, page sans lien (aucun « ledger » dans `page.tsx`) | P1 | AUD-011 : bouton export GL |
| D4 | Rôle BURSAR | Non relevé | bootstrap attache des droits à `BURSAR` jamais créé | **CURSOR CORRECT** : seul `bootstrap-accounting-permissions.ts` le cite ; aucun seed ne le crée | P1 | AUD-040 : créer le rôle ou retirer la référence |
| D5 | `allowMultipleEnrollments` | Non relevé | Réglage ignoré (unicité ENROLLED) | **CURSOR CORRECT** : commentaire `enrollments.ts:151` « volontairement [ignoré] » — réglage affiché mais inopérant | P1 | AUD-041 : retirer le réglage ou lever l'unicité |
| D6 | Clôture d'année | Non relevé | `closeYear` avertit puis clôture | **CURSOR CORRECT** : bilan de pré-clôture (compteurs `ENROLLED`) puis `CLOSED` quand même | P1 | AUD-042 : bloquer ou assumer + documenter |
| D7 | `/app/preferences` | Non relevé | Guard `requireSchoolContext`, pas `preferences.read` | **CURSOR CORRECT** (`page.tsx:29`) — discutable : préférences personnelles | P3 | AUD-043 : décision produit |
| D8 | Comptabilité | « Génération idempotente depuis paiements/dépenses ✅ » | **Comptabilité de caisse** : créance 411 jamais mouvementée, encaissement crédite directement 706, pas d'écriture à la facturation | **CURSOR CORRECT et plus précis** : génération déclenchée par bouton, pas à l'encaissement ; aucune écriture d'engagement | P2 | AUD-019 : écritures d'engagement 411/706 (attention double comptage) |
| D9 | Communications familles | « Aucun envoi SMS/email/WhatsApp — bloquant » | Code prêt (`comm/providers.ts`, queue, templates), non prouvé configuré | **LES DEUX PARTIELLEMENT** : le code existe (je l'avais sous-estimé) ; **vérifié serveur : preprod a SMS/EMAIL/WHATSAPP_TOKEN configurés, prod ne les a PAS** ; aucun envoi test prouvé | **P0→P1** | AUD-013 : test d'envoi réel preprod ; si OK, le bloquant commercial tombe à « configurer prod » |
| D10 | Inscription publique école | « Inscriptions publiques désactivées » | `SchoolSignupRequest` + `/inscription` + approbation `/platform/signup-requests` | **CURSOR CORRECT** : page publique de **demande** d'inscription existe (pas de création directe — validation plateforme requise). Mon « désactivé » était inexact | Info | Documenter le pipeline (c'est un atout commercial) |
| D11 | Maternelle | « Primaire au lycée couvert » | Maternelle **dédiée** absente (cahier de vie, compétences) — H14 non implémenté | **CURSOR CORRECT** : gabarit `primary` ≠ cycle maternelle ; pas de suivi par compétences | P3 | AUD-035 + corriger ma matrice |
| D12 | CI / tests | Non relevé | Aucun `.github/workflows`, pas de script `npm test` | **CURSOR CORRECT** : vérifié — 0 workflow, 0 script test | P0 | AUD-004 : CI minimale typecheck+lint |
| D13 | Branche main | « 202 commits non fusionnés » relevé | `main` = `9811e0a`, socle octobre, 57 fichiers vs 766 | **CONVERGENT** — Cursor quantifie mieux : cloner `main` livre un produit d'octobre | **P0** | AUD-001 : stratégie fusion (§4) |
| D14 | SHA déployé | Release `20261108_142517` = `ec62b59` (je l'ai déployée) | « Non vérifiable, même chunks sur les 2 domaines » | **MOI PLUS PRÉCIS** : je connais le SHA — prod ET preprod = `ec62b59` (releases 142517/132348). Les chunks identiques confirment | — | AUD-002 déjà résolu par mon déploiement |
| D15 | Alerting | « Discord opérationnel » | `ALERT_WEBHOOK_URL` optionnel, non vérifiable | **MOI PLUS PRÉCIS** : `ALERT_WEBHOOK_URL` SET sur les 2 envs + test réel passé | — | AUD-009 résolu |
| D16 | Sauvegarde/restauration | « Restauration réelle testée : 97 tables » | « Tests stub 39/39, restauration serveur non vérifiée » | **MOI PLUS PRÉCIS** : `restore-verify` réel exécuté sur VPS (907 objets, `ecomschool_verify`) ; cron reste non installé | — | AUD-005 partiellement résolu — manque seulement le cron |
| D17 | Paiements | « Sandbox + manuel, aucun LIVE » | Adaptateur PayDunya codé mais **inerte** ; Orange/Moov = saisie manuelle, aucune API directe | **CONVERGENT, Cursor plus précis** : `MOBILE_MONEY_LIVE_ENABLED` absent des deux `.env` (vérifié) → LIVE impossible ; verrous `live.ts` OK | — | AUD-014 : PayDunya TEST distant avant tout LIVE |
| D18 | Périmètre compta vendable | « Tenue comptable fonctionnelle » | 22 % du référentiel « comptabilité générale » (2,65/12) — méthode chiffrée | **CONVERGENT** — même conclusion, Cursor ajoute la pondération | — | — |
| D19 | README | Non relevé | Toujours `create-next-app` | **CURSOR CORRECT** : vérifié ligne 1 | P1 | AUD-007 : README produit |
| D20 | Groupe scolaire / messagerie entrante / PWA | Non relevés | Absents (H7, H2 non livrés) ; `SchoolMessage` = émission seule | **CURSOR CORRECT** : 0 `SchoolGroup` dans le schéma | P3 | AUD-037/039/038 |

**Conclusion comparaison** : les deux audits convergent sur les constats majeurs (pas de RH, pas de LMD, compta non certifiable, non commercialisable en 360°). Cursor a trouvé **11 écarts que j'avais manqués** (D1, D2, D4, D5, D6, D12, D19 + nuances D3/D8/D10/D11). J'apporte la **preuve d'exécution** que Cursor n'avait pas (SHA déployé, alerting testé, restauration réelle, recettes rejouées 500+ assertions, état réel des `.env` serveur). La seule correction de fond que Cursor m'impose : le canal notifications est **codé et configuré en preprod** — le bloquant P0 devient « tester + configurer prod », pas « développer ».

---

## 2. POINTS CONVERGENTS (les deux audits d'accord)

- Socle scolaire maternelle→lycée avancé et testé ; maternelle dédiée absente
- Caisse/frais/encaissements solides ; comptabilité = amorce (caisse, pas engagement)
- RH/paie : 0 % (aucun modèle) ; université : ~0 % (aucun modèle LMD)
- Non commercialisable sous l'étiquette « ERP 360° » ; offre bornée « scolaire + caisse » défendable après recette
- Aucun secret exposé ; cloisonnement et RBAC solides

---

## 3. BACKLOG CONSOLIDÉ (références B-x.y = Devin · AUD-0xx = Cursor)

### P0 — Sécurité, intégrité, production

| Refs | Action | Charge |
|---|---|---|
| AUD-001 + B-git | **Aligner `main` sur `phase-10-production-readiness`** (stratégie §4) | S |
| B0.1 + AUD-005 | Installer cron prod + vérifier dump/restore récurrent | S |
| B0.2 | Purger comptes démo prod après tests | S |
| AUD-004 + D12 | CI GitHub minimale (typecheck+lint sur PR) | M |
| AUD-003 | Recette jetable complète (typecheck, lint, build, h5/h6/h12/g2/g3/phase7 + e2e sécurité) | L |
| AUD-013 + D9 | **Test réel d'envoi SMS/email sur preprod** (env déjà armés) + décision canaux | M |
| B0.7 + AUD-014 | PayDunya TEST distant (webhook signé, jamais LIVE) | M |
| AUD-008 | Confidentialité mineurs + registre traitements (bloquant élèves réels) | M |

### P1 — Anomalies fonctionnelles et fiabilité

| Refs | Action | Charge |
|---|---|---|
| AUD-006 + D1 | Menu documents administratifs | S |
| AUD-011 + D3 | Bouton grand livre | S |
| AUD-012 + D2 | Écran écriture manuelle OD | M |
| AUD-040 + D4 | Rôle BURSAR : créer ou retirer | S |
| AUD-041 + D5 | Sort de `allowMultipleEnrollments` | S |
| AUD-042 + D6 | Politique clôture d'année | S |
| AUD-007 + D19 | README produit | S |
| AUD-043 + D7 | Guard `/app/preferences` | S |
| AUD-019 + D8 | Écritures d'engagement 411/706 | L |
| B1.3 | Rôle gestionnaire de scolarité | M |
| AUD-010 + B1.5 | Parcours métier complet preprod + workflow fin d'année | M |
| AUD-016/017/018 | Relecture PDF, mesure charge VPS, mobile 320px | S×3 |

### P2 — Comptabilité 360°, RH, paie

| Refs | Action | Charge |
|---|---|---|
| AUD-020/021 + B-lot2 | Plan étendu + bilan + compte de résultat | L+L |
| AUD-022/023/024/025 | Auxiliaires+lettrage, rapprochement, immobilisations, budgets | L×4 |
| AUD-026 à 031 + B0.5/B0.6/B1.x | Module RH complet : `Employee`, contrats, congés, `PayrollRun`, bulletins PDF, OD paie, vacations, pilotage | XL |
| B1.7 | Comptes tiers + balance âgée | M |

### P3 — Université et extensions

| Refs | Action | Charge |
|---|---|---|
| AUD-032/033/034 + B2.5/B2.6/B3.4 | Spéc LMD → référentiels UE/crédits → stages/mémoires | XL |
| AUD-035 + D11 | Maternelle par compétences | L |
| AUD-037 | Groupe scolaire multi-sites | L |
| AUD-038/039 | PWA, messagerie entrante | M×2 |
| B2.7/B2.8 | Facturation plateforme complète, quotas durs | M |
| B3.5 | Export FEC | M |
| B3.6 + D-uuid | Maj `exceljs` pour `uuid` | S |

---

## 4. STRATÉGIE GIT — aligner `main` (sans exécuter)

**Problème** : `main` (9811e0a, 57 fichiers, octobre) est la branche par défaut ; tout le produit vit sur `phase-10-production-readiness` (ec62b59, 766 fichiers, 202 commits). Historiques divergents mais **aucun chevauchement fonctionnel** (main n'a pas avancé depuis).

**Stratégie recommandée — option A (propre)** :
```bash
# Depuis phase-10-production-readiness
git checkout main
git merge --no-ff phase-10-production-readiness -m "Release : ligne de produit phase 10"
# OU si historique divergent :
git merge -s ours main   # non — préférer :
git checkout phase-10-production-readiness
git merge -s ours main && git checkout main && git merge --ff-only phase-10-production-readiness
```
La 2ᵉ forme (merge `-s ours` de main DANS phase-10 puis fast-forward de main) préserve les deux historiques sans conflit et fait de `main` un ancêtre — puis `git push origin main`. Ensuite : protection de `main`, releases taguées (`v1.0-rc`), `phase-10` supprimée ou renommée `develop`, CI obligatoire sur PR vers `main` (AUD-004).

**Option B (prudente)** : ne pas fusionner — déclarer `phase-10-production-readiness` branche de release officielle, changer la branche par défaut GitHub, archiver `main`. Moins élégant, zéro risque.

Recommandation : **Option A** — `main` reflète le produit réel ; indispensable avant CI et onboarding.

---

## 5. PLAN D'EXÉCUTION PAR LOTS

| Lot | Contenu | Dépendances | Tests/CA | Charge |
|---|---|---|---|---|
| **L0** (1-2 j) | AUD-001/002/005/006/007/040/041/042 + B0.1/B0.2 | VPS, merge main | main à jour, cron actif, menus corrigés, 0 démo résiduelle | S |
| **L1** (3-5 j) | AUD-003/004 + recette jetable complète | L0 | CI verte sur PR, recettes 500+ rejouées sur base jetable | L |
| **L2** (2-3 j) | AUD-011/012/013/016/017/018/043 | L1 | GL exportable, OD écran, envoi SMS réel reçu, PDF relus | M |
| **L3** (4-6 j) | AUD-014 + AUD-019 + AUD-020 | L2 | PayDunya TEST tracé, écritures engagement sans double comptage | L |
| **L4** (8-12 j) | AUD-021→025 : bilan, CR, auxiliaires, rapprochement, immobilisations | L3 | Liasse équilibrée, recette type H12 | XL |
| **L5** (12-18 j) | AUD-026→031 : RH+paie complet | L4 (OD paie) | Bulletin PDF, OD 66x/42x, isolation | XL |
| **L6** (15-20 j) | AUD-032→034 : université LMD derrière `schoolType` | L0 | Parcours LMD complet sans régression lycée | XL |
| **L7** (3-5 j) | Recette commerciale finale + AUD-008 juridique | Tout | Matrice 7 profils signée, docs publiés | M |

Ordre non négociable : **git/CI d'abord** (tout le reste s'appuie dessus), **comms testées avant RH** (un salarié sans notification n'est pas pire, mais une école sans relance impayés n'est pas vendable), **paie après écritures d'engagement** (AUD-030 dépend de AUD-019).
