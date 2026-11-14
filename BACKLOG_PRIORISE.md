# Backlog priorisé — ECOM-SCHOOL

**Date :** 14 novembre 2026 (Europe/Paris)  
**Référence code :** `ec62b59` sur `phase-10-production-readiness`  
**Règle :** aucun de ces tickets n'est commencé par l'audit. Ils décrivent la suite, après accord.

Taille : S, M, L, XL comme dans `ROADMAP_FINALISATION.md` (ampleur technique, pas une durée).

Priorité : P0 bloque une première offre scolaire honnête. P1 la rend solide. P2 ouvre la comptabilité générale ou la RH. P3 est la vision (LMD, maternelle, cantine).

---

## P0 — Avant toute offre

| ID | Titre | Taille | Dépend de | Preuve du besoin | Critère d'acceptation |
|---|---|---|---|---|---|
| AUD-001 | Aligner `main` sur la phase 10 | S | — | `main` = `9811e0a`, 202 commits derrière, 57 fichiers contre 766 | `main` contient `accounting.ts` et `Teacher`. La phase 10 n'est pas écrasée |
| AUD-002 | Identifier le SHA servi sur `preprod.ecomschool.fr` et `ecomschool.fr` | S | Accès VPS | Les deux domaines répondent avec les mêmes chunks ; le commit n'est pas dans le HTML | SHA écrit dans le journal d'exploitation |
| AUD-003 | Recette jetable : typecheck, lint, build, scripts h5 h6 h12 g2 g3 phase7, e2e sécurité | L | AUD-001 | Ces commandes n'ont pas été relancées le 14 novembre 2026. Pas de CI | Journal vert, ou un ticket par échec |
| AUD-004 | CI GitHub (typecheck + lint) | M | AUD-001 | Aucun `.github/workflows` | Une pull request rouge si `tsc` échoue |
| AUD-005 | Contrôle sauvegarde / cron / restauration témoin sur le VPS | S | AUD-002 | `deploy/tests/run.sh` 39/39 en stub seulement | Dump du jour présent, restauration témoin OK, base active intacte |
| AUD-006 | Menu « Documents administratifs » | S | — | Page G4 absente de `src/app/app/(tenant)/ui/nav.ts` | Visible avec `administrative-docs.read`, masquée sans |
| AUD-007 | README produit et limites de l'offre | S | — | `README.md` est le texte `create-next-app` | Le README cite la branche, le périmètre, et l'absence de RH, de bilan et de LMD |
| AUD-008 | Politique de confidentialité et registre des traitements | M | Juriste | Cases ouvertes dans `docs/production-checklist.md` | Document publié avant élèves réels |
| AUD-009 | Alerte d'exploitation armée ou explicitement différée | S | AUD-002 | `ALERT_WEBHOOK_URL` optionnel dans `deploy/scripts/lib.sh` | Le journal du moniteur montre un canal, ou une décision « pas d'alerte » datée |

## P1 — Solidifier l'existant

| ID | Titre | Taille | Dépend de | Preuve du besoin | Critère d'acceptation |
|---|---|---|---|---|---|
| AUD-010 | Parcours métier complet en préproduction | M | AUD-003, AUD-005 | Les recettes sont unitaires par lot, pas une semaine d'usage | Script de démo exécuté, captures, aucun contournement secret |
| AUD-011 | Bouton grand livre | S | — | `exportCsv` kind `ledger` sans lien dans `comptabilite/page.tsx` | Téléchargement depuis l'écran pour un compte |
| AUD-012 | Écran d'écriture manuelle | M | — | `createManualEntry` sans appelant UI | OD équilibrée, refus si déséquilibrée, contre-passation pour corriger |
| AUD-013 | Décision canaux SMS / e-mail / WhatsApp | M | Contrats | Providers silencieux si variables absentes (`comm/providers.ts`) | Soit un message de test reçu, soit le canal affiché indisponible et hors contrat |
| AUD-014 | PayDunya TEST distant | M | AUD-013 optionnel, contrat PayDunya | Adaptateur inerte tant que les verrous sont faux (`providers/index.ts`) | Intention TEST, webhook signé, paiement unique. Mauvais signature rejetée. Aucun appel LIVE |
| AUD-015 | Documenter séries de lycée et maternelle | S | — | Pas d'entité `Serie` ni de cahier maternelle | Manuel : contournement niveau/section, maternelle non promise |
| AUD-016 | Relecture PDF reçus, bulletins, PV, factures SaaS | S | AUD-010 | pdfkit présent, rendu non rejoué dans l'audit | Fichiers ouverts, montants XOF entiers, pas de chevauchement |
| AUD-017 | Mesure de charge sur le VPS | S | AUD-002 | `docs/phase10-performance.md` est antérieur au VPS | Chiffres datés, seuil d'alerte |
| AUD-018 | Vue mobile 320 px des écrans du pilote | S | AUD-010 | Captures P6 d'octobre, CSS peut avoir bougé | Parcours caisse et notes utilisables au pouce |

## P2 — Comptabilité générale

| ID | Titre | Taille | Dépend de | Preuve du besoin | Critère d'acceptation |
|---|---|---|---|---|---|
| AUD-019 | Écritures d'engagement (411 / produit, puis règlement / 411) | L | AUD-003 | `generateEntries` crédite le produit à l'encaissement | Jeu d'essai sans double comptage avec les écritures PAYMENT déjà postées |
| AUD-020 | Étendre le plan de démarrage sans écraser l'existant | M | AUD-019 | 11 comptes, pas de classe 1, 2, 3 | Comptes ajoutés, comptes déjà renommés conservés |
| AUD-021 | Compte de résultat et bilan simplifié | L | AUD-019, AUD-020 | Aucune fonction bilan | Totaux = balance, PDF ou CSV, exercice clos figé |
| AUD-022 | Auxiliaires élèves et fournisseurs, lettrage | L | AUD-019 | 411 et 401 collectifs, `Expense.beneficiary` texte | Solde auxiliaire = compte collectif |
| AUD-023 | Rapprochement bancaire | L | AUD-021 | Absent. Ne pas réutiliser `PaymentReconciliation` | Relevé importé, pointage, écart listé |
| AUD-024 | Immobilisations et amortissements | L | AUD-021 | Aucun modèle | Dotation mensuelle = une écriture idempotente |
| AUD-025 | Budgets | M | AUD-021 | Aucun modèle | Prévision vs réalisé par compte |

## P2 — RH et paie (après le point d'extension comptable)

| ID | Titre | Taille | Dépend de | Preuve du besoin | Critère d'acceptation |
|---|---|---|---|---|---|
| AUD-026 | Fiche salarié distincte de `Teacher` | L | AUD-001 | Aucun modèle Employee. `/app/rh` répond 404 | Non-enseignant créé. Enseignant lié sans doublon d'affectation |
| AUD-027 | Contrats et alerte d'échéance | M | AUD-026 | Aucun modèle | Cron signale un contrat à 30 jours, une fois |
| AUD-028 | Congés et présences personnel | L | AUD-026 | `AttendanceRecord` est élève | Une absence élève ne modifie pas un solde de congé |
| AUD-029 | Paie forfaitaire, barème versionné, bulletin PDF | XL | AUD-026, barème fourni par un référent paie | Aucun calcul. Ne pas inventer les taux CNSS | Même mois lancé deux fois = un bulletin. Rôle enseignant aveugle aux salaires |
| AUD-030 | Écriture de paie | M | AUD-029, AUD-019 | `generateEntries` n'a pas d'origine PAYROLL | Écriture équilibrée, pas de dépense manuelle en double |
| AUD-031 | Vacations | L | AUD-029, séances existantes | Pas de taux horaire | Montant = taux × séances validées |

## P3 — Vision, hors première offre

| ID | Titre | Taille | Dépend de | Preuve du besoin | Critère d'acceptation |
|---|---|---|---|---|---|
| AUD-032 | Spécification LMD avant tout code | M | Décision produit | 0 modèle faculté / UE / crédit | Spécification acceptée. Les moyennes d'un lycée pilote inchangées |
| AUD-033 | Référentiel universitaire et relevé de crédits | XL | AUD-032 | — | UE, crédits, relevé, isolation des écoles secondaires |
| AUD-034 | Stages et mémoires | L | AUD-033 | — | Dossier stage rattaché à l'étudiant |
| AUD-035 | Maternelle par compétences | L | Décision produit | Gabarit `primary` seulement | Une classe maternelle n'exige pas de moyenne chiffrée |
| AUD-036 | Cantine et transport | L | — | Catégories de frais seulement | Souscription distincte d'une simple catégorie, si un pilote le demande |
| AUD-037 | Groupe scolaire multi-sites | L | — | Pas de `SchoolGroup` | Consolidation en lecture, cloisonnement conservé |
| AUD-038 | PWA et file d'appel hors ligne | M | — | Lot H2 non livré | Installation et appel de présence rejoué au retour réseau |
| AUD-039 | Messagerie entrante | M | AUD-013 | `SchoolMessage` est une émission | Un parent répond, l'école voit le fil |

---

## Ordre suggéré des dix premiers tickets

1. AUD-001  
2. AUD-002  
3. AUD-006  
4. AUD-007  
5. AUD-003  
6. AUD-005  
7. AUD-004  
8. AUD-009  
9. AUD-008  
10. AUD-010  

AUD-011 peut s'intercaler dès AUD-001, il ne dépend pas de la recette.  
AUD-026 ne démarre pas avant AUD-010 : il n'y a pas de fondation RH à perdre, et le scolaire doit être stable avant d'ouvrir un second domaine.

## Hors backlog

- Réécrire l'application sur `main`.
- Lancer `prisma migrate reset` sur une base partagée.
- Activer `MOBILE_MONEY_LIVE_ENABLED` avant AUD-014.
- Coder des taux de cotisation sans source métier.
- Traiter `Teacher` comme un dossier de paie.
