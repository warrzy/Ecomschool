# Matrice de commercialisation — ECOM-SCHOOL (post-stabilisation, commit cbd51a4)

État validé par : recette métier 360° **30/30** sur préproduction, recette de stabilisation **44/44**, tests ciblés **34/34**, non-régressions RH **98/98**, 64/64 migrations propres depuis zéro.

## ✅ Complètes — commercialisables telles quelles

| Domaine | Fonctionnalités |
|---|---|
| Scolarité | Élèves, inscriptions (tous parcours → créances), réinscriptions, classes/niveaux/matières, enseignants, emplois du temps |
| Pédagogie | Notes, coefficients, bulletins, délibérations, progressions, assiduité élèves |
| Admissions | Campagnes, candidatures publiques, pièces (magic bytes, antivirus logique), décisions, conversion |
| Finance | Frais, échéanciers, encaissements idempotents (conflit de clé détecté), reçus numérotés, impayés, relances, trésorerie |
| Comptabilité SYSCOHADA | Plan de démarrage, journaux, exercices CASH/ACCRUAL, écritures automatiques équilibrées et idempotentes, écritures manuelles validées, tiers + balance âgée, immobilisations (acquisition/dotations/sortie comptabilisées), rapprochement, états (bilan équilibré, compte de résultat), exports CSV, bascule CASH→ACCRUAL sans double-produit, clôture gardée, report à nouveau |
| RH | Employés, contrats, organigramme, congés (règles de dotation par établissement, approbation, soldes), présences, départs |
| Paie (moteur) | Campagnes, calcul déterministe versionné (snapshot), bulletins, avances (octroi/recouvrement FIFO cap configurable), prorata assiduité configurable, OD comptable atomique, rectification par contre-passation |
| Portails | Parent (suivi, finances, notifications, réinscription, demandes), élève, enseignant |
| Multi-tenant | Isolation `schoolId` systématique (prouvée S4 + S-C), RBAC par permissions, audit trail |
| Exploitation | Déploiement durci (releases atomiques, rollback auto, anti-downgrade), monitoring/healthcheck/rollback paramétrés par environnement, sauvegardes SHA-256 + restore-test hebdo, purge rétention |

## 🟡 Partielles — vendables avec restrictions ou opération manuelle

| Fonctionnalité | Limite |
|---|---|
| Paie — décaissement | L'OD génère le net à payer (422) ; le paiement effectif des salaires reste une opération de trésorerie manuelle |
| Immobilisations | Plan d'amortissement linéaire ; pas de réévaluation, cession partielle seulement via sortie totale |
| Mobile Money | Connecteurs PayDunya/manuels opérationnels ; réconciliation des règlements agrégée, pas de lettrage automatique fin |
| Notifications | In-app + préférences ; pas de push/WhatsApp transactionnel systématique |
| Documents administratifs | Génération + PDF + vérification par code ; pas de signature électronique |
| Comptabilité | Plan de démarrage SYSCOHADA — à compléter selon le plan de chaque établissement (comptes détaillés 6xx/7xx) |
| Bulletin de paie | Consultable en UI ; pas de PDF téléchargeable ni d'envoi automatique au salarié |

## 🔒 Dépendantes de validation réglementaire — NE PAS vendre comme « paie conforme BF »

| Fonctionnalité | Blocage |
|---|---|
| Retenues CNSS salariales/patronales | Aucun taux activé — en attente du barème officiel Burkina Faso validé |
| Retenue fiscale sur salaires (IUTS/ITS) | Idem — moteur prêt (`isRegulatory`), taux non configurés |
| Bulletins « officiels » | Les bulletins calculés sont indicatifs tant que les composants réglementaires ne sont pas activés |

> Le moteur de paie est prêt : les composants réglementaires s'activent par configuration de `PayrollComponent` dès réception d'un barème validé, sans changement de code.

## ❌ Absentes (hors périmètre vendu)

Discipline/vie scolaire punitive · cantine · transport scolaire · bibliothèque · messagerie interne complète (brouillon présent).

## Conditions préalables au GO commercial

1. Barème CNSS/fiscal BF officiel → activation des composants réglementaires + recette paie complète.
2. Recette fonctionnelle métier par l'équipe produit avec les comptes démo (preprod).
3. Nginx : appliquer les en-têtes de sécurité + `limit_req_zone` (contexte http) sur le serveur.
4. Restriction d'accès preprod (IP allowlist ou basic auth) avant mise en ligne prod.
5. Restore-drill en environnement de production (premier exercice supervisé).
