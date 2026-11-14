# AUDIT APPROFONDI — RH & COMPTABILITÉ 360°

14 novembre 2026 — vérification exhaustive sur `prisma/schema.prisma` (102 modèles), routes `src/app`, services `src/lib/services`.

---

## A. RESSOURCES HUMAINES — CONSTAT : MODULE INEXISTANT

Recherche exhaustive des termes `payroll|salar|payslip|conge|leave|contract|employe|staff` dans le schéma : **aucun modèle RH**. Seuls échos : `STAFF` dans un enum de rôles, `contract` dans un commentaire de paramétrage MoMo, `Teacher` (modèle pédagogique, pas RH).

| Fonctionnalité RH | État réel | Preuve |
|---|---|---|
| Dossiers administratifs salariés | **ABSENT** | Aucun modèle `Employee`/`Staff` ; `Teacher` = fiche pédagogique sans contrat ni pièces |
| Personnel non enseignant | **ABSENT** | Aucun modèle |
| Contrats & carrières (types, dates, renouvellements, promotions, mutations) | **ABSENT** | Aucun modèle `Contract` |
| Présences/pointage personnel | **ABSENT** | Présences existent pour les ÉLÈVES uniquement |
| Congés (demandes, validation, soldes) | **ABSENT** | Aucun modèle `Leave`/`Conge` |
| Paie (salaire, primes, heures sup., vacations, retenues, avances, cotisations, bulletins PDF, états mensuels) | **ABSENT** | Aucun modèle `Payroll`/`Payslip` |
| Intégration paie → comptabilité | **ABSENT** | H12 génère des écritures depuis paiements/dépenses ; pas de source « paie » |
| Pilotage RH (effectifs, masse salariale, recrutement, évaluation, alertes contrats) | **ABSENT** | Aucun modèle ni page |

**Dépendances déjà en place utiles pour un futur module RH** : `Teacher` + `SchoolMembership` (identité), journaux/grand livre H12 (comptes 66x charges de personnel SYSCOHADA à mapper), `AuditLog`, permissions fines (clés `hr.*` à créer), modèle dépense (avances/frais réutilisables), `Expense` déjà comptabilisé.

**Charge estimée** : le plus gros chantier restant. Modèles à créer : `Employee`, `Contract`, `LeaveRequest/LeaveBalance`, `Attendance` (personnel), `PayrollRun`, `Payslip`, `SalaryComponent`, `Advance`. Routes `/app/rh`, permissions `hr.read/manage/payroll`, bulletins PDF, écritures comptables 66x/42x/44x, recettes type H12 (isolation + équilibre + idempotence).

---

## B. COMPTABILITÉ — CONSTAT : SOCLE SOLIDE, PAS ENCORE 360°

### Ce qui EXISTE et est testé (H12 — `src/lib/services/accounting.ts`, recette 68/68)

| Fonctionnalité | État | Preuve |
|---|---|---|
| Plan comptable SYSCOHADA configurable par école | ✅ testé | `installStarterPlan` + refus sans `accounting.manage` |
| Journaux comptables (types VE/AC/PAIE-à-venir/OD…) | ✅ | modèles `Journal`, types en enum |
| Exercices comptables (ouverture/clôture, contrôle de plage `EXERCISE_RANGE`) | ✅ testé | entrées refusées hors exercice |
| Écritures équilibrées, numérotation `EC-`, statuts brouillard/validé | ✅ testé | recette prod : écriture postée |
| Mappings comptables (paiement/dépense → comptes) | ✅ | `accountingAccountMap` |
| Génération idempotente depuis paiements/annulations/remboursements/dépenses | ✅ testé | `postEntrySafe` anti-P2002 sous concurrence |
| Grand livre + balance générale | ✅ | pages `/app/comptabilite` |
| Export CSV (injection `= + - @` neutralisée) | ✅ testé | assertion recette |
| Permissions `accounting.read/manage/export` | ✅ | bootstrap H12, liées ADMIN_SCHOOL |

### Ce qui MANQUE pour une comptabilité générale complète

| Fonctionnalité | État | Impact |
|---|---|---|
| Bilan & compte de résultat (états SYSCOHADA) | **ABSENT** | Pas de liasse fiscale — requis « compta complète » |
| Comptes tiers : clients/fournisseurs détaillés | **PARTIEL** | Mappings par nature, pas de balance âgée tiers |
| Rapprochement bancaire | **ABSENT** | Trésorerie = caisse journalière, pas de lettrage bancaire |
| Immobilisations & amortissements | **ABSENT** | Aucun modèle `Asset`/`Depreciation` |
| Écritures de paie | **ABSENT** | Dépend du module RH inexistant |
| Clôture/reprise d'exercice (à-nouveaux) | **PARTIEL** | Exercices ouverts/clos, pas de génération d'à-nouveaux |
| Journal PAIE / OD automatiques | **PARTIEL** | Journaux existent, source paie absente |
| FEC / export réglementaire | **ABSENT** | CSV générique seulement |

### Vérdict comptabilité
**Tenue comptable : fonctionnelle** (plan, journaux, écritures, GL, balance — le quotidien d'un comptable est couvert).
**Reporting réglementaire 360° : non** — sans bilan/CR/immobilisations/tiers/rapprochement, ce n'est pas encore une comptabilité générale complète au sens SYSCOHADA.

### Chemins de finalisation (ordre logique)
1. Comptes tiers + balance âgée (modèle léger : `ThirdPartyAccount`, lettrage)
2. États financiers : bilan + compte de résultat par agrégation de soldes (requêtes sur GL, pas de nouveau moteur)
3. Immobilisations : `Asset` + plan d'amortissement + écriture périodique → H12
4. Rapprochement : `BankStatement` + lettrage (dépend encaissements G3)
5. À-nouveaux de clôture (procédure d'exercice)
6. Écritures paie (dépend module RH)

---
*Détails modules croisés dans `MATRICE_FONCTIONNELLE.md`, priorisation dans `ROADMAP_FINALISATION.md`.*
