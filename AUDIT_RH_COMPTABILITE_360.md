# Audit RH et comptabilité 360° — ECOM-SCHOOL

**Date :** 14 novembre 2026 (Europe/Paris)  
**Code lu :** `origin/phase-10-production-readiness` @ `ec62b59`  
**Méthode :** schéma Prisma (102 modèles), services `src/lib/services`, pages `src/app`, scripts de recette. Les documents antérieurs ne sont cités que lorsqu'ils sont confirmés ou contredits par le code.

Légende :

| Statut | Définition |
|---|---|
| Code complet + recette versionnée | Modèle, service, écran et script présents. Recette **non relancée** le 14 novembre 2026. |
| Partiel | Parcours réel, périmètre plus étroit que le libellé. |
| Backend seul | Fonction exportée, aucun écran ne l'appelle. |
| Absent | Aucune table, route ou service dédié. |
| Non vérifiable | Dépend de l'état du serveur, illisible depuis le dépôt. |

---

## 1. Verdict

| Question | Réponse |
|---|---|
| Comptabilité générale SYSCOHADA complète ? | **Non.** Amorce de partie double sur encaissements et dépenses. |
| Module RH complet ? | **Non.** Annuaire pédagogique `Teacher` seulement. |
| Paie ? | **Absente.** Une catégorie de dépense peut s'appeler « salaires ». Ce n'est pas un bulletin. |
| Écritures de paie dans la comptabilité ? | **Absentes.** `generateEntries` ne connaît que paiement, annulation, remboursement et dépense. |

---

## 2. Comptabilité — ce qui existe réellement

### 2.1 Modèles (`prisma/schema.prisma`, bloc « H12 — Comptabilité SYSCOHADA »)

| Modèle | Rôle |
|---|---|
| `AccountingAccount` | Compte par établissement : code, intitulé, classe 1–7, statut |
| `AccountingJournal` | Journal (code, libellé, compte de trésorerie par défaut) |
| `AccountingExercise` | Exercice `OPEN` / `CLOSED` |
| `AccountingEntry` | Écriture `POSTED` ou `INCOMPLETE`, origine `REAL` ou `SIMULATION`, lien unique `sourceType` + `sourceId` |
| `AccountingEntryLine` | Ligne débit / crédit en entier (XOF) |
| `AccountingAccountMap` | Correspondance métier → compte (`METHOD:*`, `CAT:*`, `EXPCAT:*`, `FALLBACK:*`) |

Aucun modèle `Budget`, `FixedAsset`, `Depreciation`, `Supplier`, `CustomerSubsidiary`, `BankStatement`, `FiscalYearClosing`.

### 2.2 Service `src/lib/services/accounting.ts`

Fonctions exportées :

- `installStarterPlan` — plan de démarrage, idempotent
- `listAccounts`, `upsertAccount`, `archiveAccount`
- `listJournals`
- `upsertMapping`, `listMappings`
- `listExercises`, `openExercise`, `closeExercise`
- `generateEntries` — génération idempotente
- `listUnposted`
- `createManualEntry` — **aucun appelant dans `src/app`**
- `listEntries`
- `trialBalance` — balance
- `generalLedger` — grand livre d'un compte
- `exportCsv` — `journal` | `ledger` | `balance`, échappement anti-injection de formules

### 2.3 Plan de démarrage réellement codé

`SYSCOHADA_STARTER` installe **10 comptes** et **5 journaux**, pas le plan SYSCOHADA intégral :

| Code | Intitulé | Classe |
|---|---|---|
| 411 | Élèves — créances | 4 |
| 401 | Fournisseurs | 4 |
| 521 | Banques locales | 5 |
| 571 | Caisse siège | 5 |
| 585 | Virements de fonds (Mobile Money) | 5 |
| 605 | Autres achats | 6 |
| 62 | Services extérieurs | 6 |
| 66 | Charges de personnel | 6 |
| 701 | Ventes de marchandises | 7 |
| 706 | Prestations scolaires | 7 |

Journaux : `CA` caisse, `BQ` banque, `MM` Mobile Money, `VE` ventes, `OD` opérations diverses.

Le compte 411 est un compte collectif. Il n'y a pas de sous-compte par élève ni par fournisseur. Le libellé « Fournisseurs » ne s'accompagne d'aucun modèle de tiers : le bénéficiaire d'une dépense est un texte (`Expense.beneficiary`).

### 2.4 Ce que la génération d'écritures fait

`generateEntries` (`accounting.ts`, à partir de la ligne 359) n'est pas appelé par l'encaissement. L'écran Comptabilité le lance par une action explicite. Il lit les données financières **sans les modifier** et poste :

| Source | Écriture |
|---|---|
| `Payment` `VALIDATED` | Débit du compte de trésorerie du mode (`METHOD:<PaymentMethod>`), crédit du compte de la catégorie de frais (`CAT:<id>`) ou `FALLBACK:CAT` (706) |
| `Payment` `CANCELLED` | Contre-passation de l'écriture d'origine |
| `PaymentRefund` `CONFIRMED` | Débit du produit, crédit de la trésorerie |
| `Expense` `PAID` | Débit du compte de catégorie de dépense ou `FALLBACK:EXPCAT` (605), crédit de la trésorerie |

Règles codées :

- Écriture équilibrée à la création, `POSTED` immuable, correction par contre-passation.
- Une seule écriture par couple `sourceType` / `sourceId`.
- Opération hors exercice ouvert : ignorée (`skipped`).
- Compte non mappé : comptée `incomplete`, pas d'écriture inventée.
- Les écritures `SIMULATION` sont exclues des exports par défaut.
- **Aucune écriture à la facturation** (création de `StudentFeeCharge`). La créance 411 n'est pas mouvementée par la génération actuelle : l'encaissement crédite directement le produit 706. C'est une comptabilité **de caisse**, pas une comptabilité d'engagement.
- **Aucune écriture de paie**, de dotation aux amortissements, de variation de stock, de TVA, d'impôt ou de clôture d'exercice (le statut `CLOSED` existe ; il n'y a pas d'écritures d'inventaire).

### 2.5 Interface

Page `/app/comptabilite` (`src/app/app/(tenant)/comptabilite/page.tsx`), permission `accounting.read` :

- indicateurs : nombre de comptes, journaux, écritures, opérations à comptabiliser ;
- installation du plan de démarrage si le plan est vide (`accounting.manage`) ;
- comptes, correspondances, exercices (ouverture / clôture), bouton de génération ;
- balance de l'exercice à l'écran ;
- liste des écritures ;
- exports CSV : journal complet, journal par code, balance.

Absent de cette page :

- bouton grand livre (la route `GET /app/comptabilite/export?kind=ledger&exercise=&account=` fonctionne si on connaît l'identifiant du compte) ;
- saisie d'écriture manuelle (`createManualEntry` reste dans le service) ;
- bilan, compte de résultat, grand livre à l'écran, immobilisations.

Menu : entrée « Comptabilité » dans la section Finances (`nav.ts`).

### 2.6 Recette versionnée

- `scripts/h12/comptabilite-recette.ts`
- `scripts/h12/comptabilite-ui-check.ts`
- `scripts/h12/bootstrap-accounting-permissions.ts`

Ces scripts n'ont pas été exécutés pendant l'audit (ils exigent une base migrée).

### 2.7 Référentiel « comptabilité générale » — ligne à ligne

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Plan comptable SYSCOHADA | Partiel | 10 comptes de démarrage, modifiables. Pas le plan complet, pas de classes 1, 2, 3, 8. |
| Journaux | Partiel | CA, BQ, MM, VE, OD créés par le starter. Pas d'écran de création de journal au-delà du seed (liste + compte par défaut). |
| Écritures automatiques d'encaissement et de dépense | Code complet + recette versionnée | `generateEntries` |
| Saisie d'OD manuelle | Backend seul | `createManualEntry` |
| Grand livre | Backend + route CSV | `generalLedger`, `kind=ledger`. Pas de bouton. |
| Balance | Code complet + recette versionnée | `trialBalance` affichée et exportée |
| Grand livre auxiliaire clients (élèves) | Absent | Compte 411 collectif, pas de lettrage par élève |
| Grand livre auxiliaire fournisseurs | Absent | Compte 401 sans fiche fournisseur |
| Rapprochement bancaire | Absent | `PaymentReconciliation` concerne le Mobile Money, pas un relevé bancaire |
| Immobilisations | Absent | Aucun modèle |
| Amortissements | Absent | Aucun modèle, aucune dotation |
| Budgets | Absent | Aucun modèle |
| Bilan | Absent | Aucune fonction |
| Compte de résultat | Absent | Aucune fonction. La balance des classes 6 et 7 permet un calcul manuel hors outil. |
| Liasse / états financiers SYSCOHADA | Absent | |
| Intégration des écritures de paie | Absent | Voir section RH |
| Clôture avec à-nouveaux | Partiel | `closeExercise` change le statut. Pas d'écritures d'à-nouveaux vues dans les exports du service. |

### 2.8 Finances de scolarité — à ne pas confondre avec la comptabilité

Ces briques sont **réelles** et antérieures à H12. Elles alimentent la génération comptable ; elles ne la remplacent pas.

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Catégories et tarifs de frais | Code complet + recette versionnée | `FeeCategory`, `FeeTariff`, `/app/fees/settings` |
| Créances et échéanciers | Code complet + recette versionnée | `StudentFeeCharge`, `FeeInstallment` |
| Remises (6 types) | Code complet | `FeeDiscount`, `DiscountType` |
| Encaissement, reçu PDF, annulation motivée | Code complet + recette versionnée | `Payment`, `PaymentAllocation`, `src/lib/pdf/receipt.ts` |
| Clôture de caisse | Code complet | `CashClosure`, bloque encaissements et paiements de dépenses |
| Impayés | Code complet | `/app/fees/unpaid` |
| Relances | Partiel | `FeeReminder` → notification interne. Pas de SMS dans ce flux tant que le canal n'est pas branché et configuré. |
| Dépenses | Code complet + recette versionnée | `Expense`, `ExpenseCategory`, statuts brouillon / payée / annulée |
| Trésorerie de flux | Code complet | `src/lib/services/finance/treasury.ts`, `/app/treasury`. Entrées = paiements validés, sorties = dépenses avec `paidAt`. Ce n'est pas un compte bancaire rapproché. |
| Rapports | Code complet | `src/lib/services/finance/reports.ts`, `/app/fees/reports`, Excel et PDF |
| Multi-caisses, comptes bancaires nominatifs | Absent | Une caisse logique |
| Facture client hors scolarité (devis, avoir tiers) | Absent | Les factures `PlatformInvoice` facturent **l'établissement client du SaaS**, pas les familles |

---

## 3. Ressources humaines — ligne à ligne

Recherche effectuée sur `ec62b59` : modèles et routes `payroll`, `salary`, `leave`, `congé`, `Staff`, `Employee`, `CNSS`, `vacataire`, pages `/hr`, `/rh`, `/paie`, `/personnel`.  
Résultat : le mot « salaire » n'apparaît que dans la documentation de cadrage des dépenses. Le sondage préproduction du 14 novembre 2026 donne HTTP 404 pour `/app/rh` et `/app/paie`.

### 3.1 Gestion du personnel

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Dossier administratif du salarié | Absent | Pas de modèle |
| Distinction enseignant / personnel non enseignant | Partiel, pédagogique seulement | `Teacher` existe. Pas de `Staff` pour le personnel de vie scolaire, de caisse, de direction en tant que salariés. Ces personnes peuvent être des `User` avec un rôle (`CASHIER`, `ADMIN_SCHOOL`) sans dossier RH. |
| Informations personnelles et professionnelles | Partiel | `Teacher` : `firstName`, `lastName`, `email`, `phone`, `status`, `userId`. Pas de date de naissance, pièce d'identité, adresse, matricule, diplôme, échelon. |
| Documents administratifs du personnel | Absent | `AdministrativeDocument` vise l'élève (attestation, certificat, carte). `DOCUMENT_OWNER_TYPES` dans `documents.ts` prévoit les valeurs `STAFF` et `CONTRACT`, sans aucun appel `ownerType` correspondant dans `src/`. |
| Historique des affectations | Partiel, pédagogique | `TeachingAssignment` relie enseignant, matière, classe, année. Pas d'historique de poste, de service ou de site. |

Fichiers : `prisma/schema.prisma` modèle `Teacher` (vers la ligne 810), `src/lib/services/teachers.ts`, pages `/app/teachers` et `/app/teachers/[id]`, portail `/teacher`.

### 3.2 Contrats et carrières

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Contrat de travail | Absent | |
| Types de contrats | Absent | |
| Dates de début et de fin | Absent | |
| Renouvellements | Absent | |
| Promotions | Absent | |
| Mutations | Absent | |
| Évolution professionnelle | Absent | |

### 3.3 Présences et congés du personnel

Les présences existantes sont celles **des élèves**.

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Pointage du personnel | Absent | `AttendanceRecord` est lié à une séance de cours et à un élève |
| Absences et retards du personnel | Absent | |
| Demandes de congés | Absent | |
| Validation des congés | Absent | |
| Soldes de congés | Absent | |
| Planning du personnel | Absent | `CourseSchedule` est un emploi du temps pédagogique, pas un planning de service |

### 3.4 Paie

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Salaire de base | Absent | |
| Primes et indemnités | Absent | |
| Heures supplémentaires | Absent | |
| Vacations des enseignants | Absent | Pas de taux horaire, pas de relevé de vacation |
| Retenues et avances | Absent | |
| Cotisations sociales et fiscales (CNSS, IUTS, etc.) | Absent | Aucune occurrence CNSS dans le code applicatif |
| Bulletin de salaire PDF | Absent | Les PDF existants sont reçus, bulletins **scolaires**, documents élèves, PV de délibération, factures SaaS |
| Historique de paie | Absent | |
| États de paie mensuels | Absent | |
| Intégration comptable de la paie | Absent | Une dépense manuelle peut débiter le compte 66 si l'établissement mappe la catégorie sur ce compte. Rien ne calcule les charges sociales ni ne ventile net / brut / retenues. |

`docs/f3a-cadrage-depenses-tresorerie.md` et `docs/strategie-produit/inventaire-fonctionnel.md` (section H) disaient déjà « salaires = dépense catégorisée, pas de Payroll ». Le code de novembre 2026 n'a pas changé ce point. Les lots H8 (RH) et H9 (paie) de `docs/strategie-produit/roadmap-priorisee.md` ne correspondent à aucun commit.

### 3.5 Pilotage RH

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Effectifs salariés | Absent | Le tableau de bord compte des élèves et des enseignants actifs, pas une masse salariale |
| Masse salariale | Absent | |
| Recrutement | Absent | Les admissions concernent les **élèves** |
| Évaluation du personnel | Absent | |
| Statistiques RH | Absent | |
| Alertes d'expiration de contrats | Absent | Les alertes d'exploitation (`deploy/scripts/monitor.sh`) portent sur le cron, le disque, les jobs et les sauvegardes |

### 3.6 Indice

34 fonctionnalités du référentiel demandé. Six traces partielles (annuaire enseignant, champs de contact, affectation pédagogique, emploi du temps des cours, liste d'enseignants, dépense « salaires » possible) notées 0,2 ou 0,4. Total **1,4 / 34 ≈ 4 %**. Détail du barème dans `MATRICE_FONCTIONNELLE.md`.

---

## 4. Dépendances avec l'existant

Un futur module RH ne part pas de zéro technique, mais **part de zéro métier**.

| Brique déjà là | Usage possible | Limite |
|---|---|---|
| `User` + rôles | Compte de connexion du salarié | Pas un dossier social |
| `Teacher` | Identité pédagogique à lier à un futur `Employee` | Ne pas surcharger `Teacher` avec la paie : le personnel non enseignant n'y est pas |
| `Expense` + compte 66 | Paiement effectif du net, en attendant la paie | Ne peut pas représenter brut, charges, retenues |
| `AccountingEntry` / `generateEntries` | Ajouter une origine `PAYROLL` à côté de `EXPENSE` | Le générateur actuel ne doit pas être « détourné » en passant les bulletins pour des dépenses libres : les montants ne se recoupent pas |
| `Document` | Pièces du dossier (contrat scanné) | Permissions et rétention à définir pour des données plus sensibles que les pièces d'admission |
| `Job` + cron | Calcul mensuel, alertes de fin de contrat | Le cron existe (`src/app/api/cron/route.ts`) |
| `pdfkit` | Bulletin de paie | Gabarit et mentions légales Burkina Faso à écrire |
| Cloisonnement `schoolId` | Chaque établissement paie son personnel | Un enseignant partagé entre deux écoles n'est pas modélisé |
| Quotas SaaS | Un quota « salariés » pourra suivre `maxUsers` | `maxUsers` compte les comptes, pas les fiches paie |

Ordre de dépendance recommandé, détaillé dans `ROADMAP_FINALISATION.md` :

1. Fiche salarié distincte de `Teacher`, avec lien optionnel.
2. Contrat (type, dates) — sinon les alertes et la paie n'ont pas de borne.
3. Congés et présences personnel — peuvent attendre la première paie si le pilote paie au forfait mensuel.
4. Paie mensuelle (barème à figer avec un expert-comptable burkinabè : ce n'est pas dans le code).
5. Écriture comptable équilibrée brut / charges / net / retenues / organismes.
6. Vacations : dépendent des séances réellement faites (`CourseSession`, `AttendanceRecord`) et d'un taux. À traiter après le forfait mensuel.

---

## 5. Ce qu'il faut développer

### Comptabilité, pour mériter le mot « générale »

1. Écriture d'engagement : débit 411 / crédit 706 à la création de la créance, et encaissement en débit de trésorerie / crédit 411 (aujourd'hui l'encaissement crédite le produit).
2. Bouton et écran grand livre ; journal à l'écran déjà partiellement là.
3. Écran d'OD qui appelle `createManualEntry`, avec les mêmes contrôles d'équilibre.
4. Fiches auxiliaires élèves et fournisseurs, lettrage.
5. Relevés bancaires et rapprochement (distinct du rapprochement Mobile Money déjà codé).
6. Immobilisations et plans d'amortissement.
7. Compte de résultat et bilan produits depuis la balance, puis contrôles de cohérence.
8. Budgets prévisionnels et suivi réalisé.
9. Écritures de paie, après le module RH.
10. Jeu d'essai signé par un comptable SYSCOHADA (le plan de 10 comptes ne suffit pas à une liasse).

### RH et paie, pour mériter le mot « module »

Tout le tableau de la section 3 qui est « Absent », dans l'ordre de la section 4. Aucune page existante n'est à « finir » : il n'y a pas de demi-écran RH caché.

---

## 6. Tests et limites

- Recette comptable versionnée : `scripts/h12/`. Non exécutée ici.
- Aucun test RH : il n'y a pas de code RH à tester.
- La page comptabilité de la préproduction répond (HTTP 200, coquille de chargement). Le contenu authentifié et les écritures en base n'ont pas été lus.
- Les documents `docs/f1-*.md` et l'inventaire stratégique décrivent un état **antérieur à H12** pour la comptabilité, et un état **toujours exact** pour la RH.
