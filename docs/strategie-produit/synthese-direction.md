# Synthèse direction — Audit stratégique ECOM-SCHOOL

> 22/10/2026 · release `20261022_163919` en préprod · inventaire fondé sur le code réel, analyse concurrentielle sur sources officielles.

## Forces actuelles (démontrables)

| Force | Preuve |
|---|---|
| **Fiabilité financière inédite** | Encaissements transactionnels Serializable, idempotence, reçus figés, surpaiement refusé, clôture de caisse, trésorerie honnête, rapports CSV/XLSX/PDF cohérents au centime |
| **Chaîne pédagogique complète** | Évaluations 5 états → moyennes → bulletins versionnés → publication → rectification motivée → portails parent/élève — verrous période/année |
| **Plateforme SaaS mature** | Multitenancy, RBAC 8 rôles, abonnements à modules, signup→onboarding atomique, facturation plateforme avec avoirs |
| **Sécurité éprouvée** | Lockout, anti-énumération, IDOR testés, isolation tenant systématique, consentements |
| **Base technique saine** | ~150 routes, 50 modèles, ~100 recettes + 17 specs e2e, releases atomiques + rollback + backups |

## Lacunes principales (vs marché)

| Lacune | Qui l'a | Gravité |
|---|---|---|
| Aucune notification externe réelle (SMS/WhatsApp) | Major, EduX, MySchool, AfricScol | 🔴 bloquant |
| Pas de paiement en ligne / Mobile Money | Major (OM), Noppal (Wave/OM), PERIS | 🔴 bloquant |
| Pas de candidature publique | PERIS, Major, EduX, Galactis | 🔴 bloquant |
| Pas d'app mobile ni PWA/offline | PERIS, Major, EduX, EduSahel, Kanda | 🟠 fort |
| Pas d'attestations/cartes | MySchool, Major, SMARTI | 🟠 |
| Pas de compta OHADA | Galactis, SMARTI, PERIS | 🟠 (P2) |
| Pas de RH/paie, cantine, transport | PERIS, EduX, SchoolERP | 🟠 (P2) |
| Pas de multisite | EduX, Galactis, Kanda | 🟠 |
| Portail parent 100 % lecture seule | tous (interactif) | 🟠 |

## Fonctionnalités différenciantes à construire

1. **Reçu instantané WhatsApp/SMS** — personne ne le promet « en main ».
2. **Candidature en ligne suivie par le parent** — suivi par code de dossier.
3. **Finances opposables** — démo « essayez de tricher, le système refuse ».
4. **PWA + appels hors ligne** — réponse logicielle à la « Box » d'EduSahel.

## Risques commerciaux

- **Vélocité concurrentielle** : PERIS est burkinabè, mobile-first, avec transport/cantine/chat déjà livrés. L'écart de couverture brute est réel.
- **Course aux modules** : vouloir égaliser en couverture serait perdre — la fiabilité + l'expérience doivent porter la vente.
- **Dépendance provider SMS/WhatsApp** : coûts et contrats à négocier (décision commerciale avant G1).
- **Upload de documents** : première brique de stockage fichier — décision architecture requise avant G2.
- **Tarification** : `/tarifs` doit devenir chiffré et compétitif vs le repère Galactis (5 €/élève/an).

## Top 10 priorités

| # | Priorité | Lot | Pourquoi |
|---|---|---|---|
| 1 | Notifications SMS/WhatsApp réelles | **G1** | Promesse « parents informés » — bloquant de vente |
| 2 | Mobile Money en caisse (réf. externe) | **G3** | Attente culturelle BF — petit chantier, grand signal |
| 3 | Portail de candidature | **G2** | Porte d'entrée de la rentrée — PERIS/Major l'ont |
| 4 | Reçus par messagerie | G1 | Différenciation démontrable |
| 5 | Attestations/certificats/cartes | **G4** | Quotidien visible des écoles — effort faible |
| 6 | Portail parent interactif | H1 | Seul levier de fidélisation famille |
| 7 | PWA installable | H2 | Compenser l'absence d'app native |
| 8 | Délibérations + décisions annuelles UI | H5+H6 | Compléter la fin d'année scolaire |
| 9 | Messagerie bidirectionnelle | H3 | PERIS vend le chat intégré |
| 10 | Export comptable OHADA | H12 | Cible = écoles structurées |

## Prochain lot recommandé : **G1 — Notifications externes réelles**

- **Portée** : reçu par WhatsApp/SMS après encaissement ; alerte absence/retard externe ; relances impayés par SMS/WhatsApp ; statut de livraison réel par canal ; `WHATSAPP_DRY_RUN` conservé par défaut.
- **Critères d'acceptation** : envoi réel configuré par provider, consentement respecté (jamais de WhatsApp sans opt-in tuteur documenté), livraison traçée en base avec erreur, coûts visibles (`costUnits`), pas de fuite de données.
- **Décision externe requise** : choix et contrat du provider SMS (et validation WhatsApp Business) — à fournir avant le GO.
- **Tests** : recettes existantes `comm/` étendues + recette d'envoi réel (compte test).

## Arbitrages assumés

- Pas de compta générale complète (export OHADA seul), pas de natif mobile (PWA), pas d'université dans ce produit, pas de biométrie, pas d'e-learning.
- « MyPreySchool » et « KORTEX » non confirmés comme produits scolaires — à clarifier avec l'utilisateur si ces noms recouvrent d'autres solutions.

## Statut

- Documents produits : `inventaire-fonctionnel.md`, `matrice-concurrentielle-detaillee.md`, `parcours-utilisateurs.md`, `analyse-ecarts-concurrentiels.md`, `differenciation-strategique.md`, `roadmap-priorisee.md`, `synthese-direction.md`.
- **Aucun code applicatif, Prisma, abonnement ou déploiement modifié.**
