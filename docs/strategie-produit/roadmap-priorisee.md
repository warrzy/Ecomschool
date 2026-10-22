# Roadmap priorisée — ECOM-SCHOOL

> Priorités : **P0** indispensable à la commercialisation initiale · **P1** différenciation forte · **P2** couverture ERP 360° · **P3** innovation.
> Méthode : lots autonomes, chacun déployable en préprod seul.

## P0 — Commercialisation initiale

### Lot G1 — Notifications externes réelles + reçus numériques
- **Métier** : un parent reçoit réellement un SMS/WhatsApp quand son enfant est absent, qu'une échéance approche, et un reçu après encaissement.
- **Réutilisation** : `comm/` complet (providers, Job, templates, consentements, dedup) — le travail est de **brancher les flux métier** : `recordPayment`→reçu, `attendance.absence_notify`→canal externe, `remindUnpaid`→SMS/WhatsApp.
- **Parcours** : caissier encaisse → parent reçoit « Reçu REC-2026-00012, 25 000 FCFA, solde restant X » ; absence non justifiée 2 h → SMS.
- **Critères** : envoi réel configuré (provider SMS BF), DRY_RUN par défaut, consentement respecté, livraison traçée, pas de coût surprise (compteur `costUnits` affiché).
- **Effort** : M · **Risque** : choix du provider SMS local (Twilio/ACI/local) — décision commerciale requise.

### Lot G2 — Portail public de candidature
- **Métier** : un parent postule en ligne sans compte ; l'école instruit, accepte, convertit → l'élève est inscrit avec ses frais générés.
- **Portée** : formulaire public (honeypot/throttle, pattern `SchoolSignupRequest` éprouvé) → `AdmissionApplication` (DRAFT/SUBMITTED/UNDER_REVIEW/ACCEPTED/REJECTED/CONVERTED) → pièces justificatives (upload sécurisé — chantier transversal nouveau) → suivi par code de dossier → décision → conversion atomique en `Student`+`Enrollment`+`StudentFeeCharge` (réutilise `registration.ts`).
- **Critères** : conversion en une transaction, aucun compte requis, notification de statut, pas de doublon avec élève existant.
- **Effort** : M-L · **Risque** : upload de documents = première brique de stockage de fichiers (volume/type/quota à décider).

### Lot G3 — Mobile Money en caisse (mode dégradé honnête)
- **Métier** : avant toute agrégation API, permettre à l'école d'enregistrer « encaissé par OM réf. TXN-xxx » avec référence obligatoire et affichage distinct.
- **Portée** : champ `externalRef` sur Payment pour MOBILE_MONEY, contrôle de format, rapport « encaissements par canal » déjà existant ; pas de promesse d'API.
- **Effort** : S · puis passerelle réelle en P1.

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
- **Prérequis** : décision contractuelle agrégateur.

### Lot H5 — Délibérations / conseils de classe
- Interface collective par classe/période : synthèse élève par élève, décision, signatures, PV PDF. Données existantes, manque la vue collégiale.

### Lot H6 — Redoublement + décisions annuelles en UI
- `StudentAnnualResult.decision` existe mais non saisissable ; `isRepeat` absent de `Enrollment`. Petit chantier à forte valeur de fin d'année.

### Lot H7 — Multisite / groupe scolaire
- `SchoolGroup` + consolidation des rapports — cible : groupes scolaires et franchises.

## P2 — Couverture ERP 360°

| Lot | Contenu | Dépendance |
|---|---|---|
| H8 — RH base | Contrats enseignants, vacations, pointage personnel | — |
| H9 — Paie | Bulletins de paie (barèmes BF à modéliser) | H8 |
| H10 — Cantine/transport | Souscriptions, menus, circuits — liés aux FeeCategory | — |
| H11 — Discipline | Incidents, sanctions, autorisations de sortie | — |
| H12 — Export comptable OHADA | Écritures d'export CSV structuré SYSCOHADA | F3 existant |
| H13 — Devoirs en ligne | Assignation + remise + correction | portail élève |
| H14 — Maternelle | Cahier de vie, compétences, pas de notes | template dédié |

## P3 — Innovation

- Recherche globale (Ctrl+K), dark mode, i18n (expansion anglophone).
- Accusés de réception, rapprochement bancaire, multi-caisses.
- Analytics prédictifs (élèves à risque, recouvrement).
- Université LMD (produit distinct si marché).

## Lot recommandé en premier : **G1 — Notifications externes + reçus**

**Pourquoi G1 avant G2** (candidatures) :
1. **Impact immédiat** sur TOUTES les écoles clientes existantes ; la candidature est saisonnière (rentrée), les notifications sont quotidiennes.
2. **Le code est déjà là** — file de livraison, consentements, templates, providers. Le risque technique est le plus faible du classement P0.
3. **Promesse commerciale** : « votre école parle aux parents » — vendable à chaque démo.
4. G2 (candidatures) débloque une brique nouvelle (upload de fichiers) qui vaut mieux un lot dédié.

**Ordre suggéré** : G1 → G3 → G2 → G4 puis H1/H2 selon retour terrain.
