# Roadmap priorisée — ECOM-SCHOOL

> Priorités : **P0** indispensable à la commercialisation initiale · **P1** différenciation forte · **P2** couverture ERP 360° · **P3** innovation.
> Méthode : lots autonomes, chacun déployable en préprod seul.

## P0 — Commercialisation initiale

### Lot G2 — Portail public de candidature — **retenu en premier**
- **Métier** : un parent postule en ligne sans compte ; l'école instruit, accepte, convertit → l'élève est inscrit avec ses frais générés. Réinscription annuelle en ligne + validation en masse.
- **Portée** : campagne par école → formulaire public (honeypot/throttle, pattern `SchoolSignupRequest` éprouvé) → `AdmissionApplication` (SUBMITTED→UNDER_REVIEW→…→ADMITTED/REJECTED→CONVERTED) → pièces justificatives via brique `Document` (stockage privé VPS, G2-A) → suivi par code de dossier → décision motivée → **conversion atomique en `Student`+`Guardian`+`Enrollment`+`StudentFeeCharge`** via les services existants (`registration.ts`, `enrollments.ts`, `accounts.ts` — zéro duplication).
- **Sous-lots** : G2-A documents · G2-B candidature publique · G2-C instruction · G2-D conversion · G2-E réinscription en ligne. Détail complet : `preparation-g2.md`.
- **Critères** : conversion en une transaction idempotente, aucun compte requis, décisions tracées, pièces sécurisées (magic bytes + quotas), aucun doublon élève.
- **Effort** : L (5 sous-lots M) · **Zéro service payant requis** · démonstration complète en préprod.

### Lot G1 — Notifications externes réelles + reçus numériques — **second**
- **Métier** : un parent reçoit réellement un SMS/WhatsApp quand son enfant est absent, qu'une échéance approche, et un reçu après encaissement.
- **Réutilisation** : `comm/` complet (providers, Job, templates, consentements, dedup) — le travail est de **brancher les flux métier** : `recordPayment`→reçu, `attendance.absence_notify`→canal externe, `remindUnpaid`→SMS/WhatsApp ; les événements `AdmissionNotifier` de G2 deviennent des canaux externes sans refactor.
- **Parcours** : caissier encaisse → parent reçoit « Reçu REC-2026-00012, 25 000 FCFA » ; absence non justifiée 2 h → SMS.
- **Critères** : envoi réel configuré (provider SMS BF), DRY_RUN par défaut, consentement respecté, livraison traçée, coûts visibles.
- **Effort** : M · **Dépendance externe** : contrat provider SMS/WhatsApp — à négocier en parallèle de G2.

### Lot G3 — Mobile Money en caisse (mode dégradé honnête)
- **Métier** : avant toute agrégation API, permettre à l'école d'enregistrer « encaissé par OM réf. TXN-xxx » avec référence obligatoire et affichage distinct.
- **Portée** : champ `externalRef` sur Payment pour MOBILE_MONEY, contrôle de format, rapport « encaissements par canal » déjà existant ; **pas présenté comme du MoMo automatisé**.
- **Effort** : S · puis passerelle réelle en H4.

### Lot G4 — Documents administratifs
- Attestation d'inscription, certificat de scolarité, carte scolaire PDF (photo si URL présente, QR code de vérification).
- **Réutilise** pdfkit + pattern routes PDF. **Effort** : S-M.

## P1 — Différenciation forte

### Lot H1 — Portail parent interactif
- Justification d'absence en ligne, dépôt de pièce, réinscription déclarative, demande de RDV, message à l'école (premier canal bidirectionnel).
- **Prérequis** : upload (G2), messagerie bidirectionnelle.

### Lot H2 — PWA + mobile-first renforcé
- Manifest, icônes, installable, cache de lecture, file d'attente pour appels de présence (offline-lite).
- Pas de natif.

### Lot H3 — Messagerie bidirectionnelle + réclamations
- Réponse parent/élève/enseignant sur fil de message ; statuts lu/accusé.
- Réutilise `SchoolMessage`/`MessageDelivery` + ajout inbound.

### Lot H4 — Paiement Mobile Money automatisé
- Agrégateur réel (webhook), réconciliation référence→reçu, reçu WhatsApp automatique.
- **Prérequis** : décision contractuelle agrégateur + G3.

### Lot H5 — Délibérations / conseils de classe
- Interface collective par classe/période : synthèse élève par élève, décision, signatures, PV PDF. Données existantes, manque la vue collégiale.

### Lot H6 — Redoublement + décisions annuelles en UI
- `StudentAnnualResult.decision` existe mais non saisissable ; `isRepeat` absent de `Enrollment`. Petit chantier à forte valeur de fin d'année.

### Lot H7 — Multisite / groupe scolaire
- `SchoolGroup` + consolidation des rapports — cible : groupes scolaires et franchises.

## P2 — Couverture ERP 360° (vision complète conservée)

| Lot | Contenu | Dépendance |
|---|---|---|
| H8 — RH base | Contrats enseignants, vacations, pointage personnel | — |
| H9 — Paie | Bulletins de paie (barèmes BF à modéliser) | H8 |
| H10 — Cantine/transport | Souscriptions, menus, circuits — liés aux FeeCategory | — |
| H11 — Discipline | Incidents, sanctions, autorisations de sortie | — |
| H12 — Comptabilité OHADA | **Étape 1 : export écritures SYSCOHADA (CSV)** ; étape 2 : journaux/grand livre/balance intégrés | F3 existant |
| H13 — Devoirs en ligne | Assignation + remise + correction | portail élève |
| H14 — Maternelle | Cahier de vie, compétences, pas de notes | template dédié |
| H15 — Enseignement supérieur | Facultés/UE/crédits LMD/stages/mémoires — **produit dérivé planifié**, même socle tenant | vision cible |

## P3 — Innovation

- Recherche globale (Ctrl+K), dark mode, i18n (expansion anglophone).
- Accusés de réception, rapprochement bancaire, multi-caisses.
- Analytics prédictifs (élèves à risque, recouvrement).

## Ordre retenu : **G2 → G3 → G1 → G4** puis H1/H2 selon retour terrain

- **G2 en premier** : entièrement livrable sans service payant, porte d'entrée de la rentrée, pose les fondations (documents, interaction parent) dont G1 et H1 bénéficient.
- **G3** : effort minimal, signal fort sur le paiement mobile sans attendre l'agrégateur.
- **G1** : valeur réelle maximale dès que le contrat provider SMS/WhatsApp est signé — la négociation se fait **pendant** le développement de G2.
- **G4** : documents administratifs, capitalise sur G2-A (stockage fichiers).
