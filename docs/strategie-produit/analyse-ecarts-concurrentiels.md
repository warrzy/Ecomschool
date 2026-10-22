# Analyse des écarts concurrentiels — ECOM-SCHOOL

## Cadre

Écart = fonctionnalité documentée chez au moins un concurrent ET absente/incomplète chez nous. Sévérité commerciale : **bloquant** (un dirigeant BF refusera sans), **fort** (argument de vente récurrent), **moyen**, **faible**.

## Écarts bloquants (P0)

### E1 — Paiement en ligne / Mobile Money
- **Concurrents** : Le Major (Orange Money depuis l'app parent — « disponible aujourd'hui au BF »), Noppal (Wave/OM instantanés + reçus auto), PERIS (suivi mobile money), EduX.
- **Nous** : `MOBILE_MONEY` est un libellé d'enum. Aucune intégration, aucun webhook, aucun paiement initié par le parent.
- **Impact** : au Burkina, l'encaissement OM/Wave est LE différenciateur de vente. Les parents veulent payer sans se déplacer.
- **Réaliste** : une première version peut être *semi-manuelle* (référence de paiement + saisie caissier vérifiée) avant l'agrégateur.

### E2 — Notifications externes réelles (SMS/WhatsApp)
- **Concurrents** : Le Major (SMS masse + alertes), EduX (relances auto), MySchool (SMS automatisés), AfricScol (WhatsApp).
- **Nous** : toute la plomberie existe (providers, file Job, consentements, templates, dedup) — mais `WHATSAPP_DRY_RUN=1`, aucun provider SMS configuré, aucun envoi réel en production.
- **Impact** : la promesse « parents informés » n'est pas tenue ; la machine est prête, il manque le branchement + les flux métier (relances, absences, reçus).

### E3 — Portail public de candidature
- **Concurrents** : PERIS (prospection + tests d'admission), EduX (contrat signé mobile), Major (tests d'entrée), Galactis (admission→graduation).
- **Nous** : `/inscription` = signup B2B école. Aucun pipeline candidat élève.
- **Impact** : chaque rentrée commence par des centaines de candidatures papier ; un formulaire public avec suivi en ligne est un argument de vente direct ET une réduction de charge administrative.

## Écarts forts (P1)

### E4 — Attestations, certificats, cartes scolaires
- Concurrents : MySchool (attestation, certificat, badge PVC), Major (cartes+certificats), SMARTI, AfricScol (NFC).
- Nous : aucun document administratif généré. Facile (pdfkit déjà maîtrisé), forte valeur quotidienne perçue.

### E5 — Application mobile / PWA + hors ligne
- Concurrents : PERIS, Major (4 apps), EduX, Noppal (natives) ; EduSahel/Kanda (offline).
- Nous : web responsive correct, mais pas d'app, pas d'offline. Compromis recommandé : **PWA installable** + notifications push plutôt que natif (coût maîtrisé).

### E6 — Relances et messagerie bidirectionnelle
- PERIS : chat intégré, réclamations parents. EduX : relances impayés automatiques.
- Nous : relances internes auto (cron J-3) mais notification in-app seule ; pas de réponse parent possible.

### E7 — Multisite / groupe scolaire
- EduX, Galactis, Kanda, Major proposent multi-établissements. Nous : `School` = tenant plat, aucune consolidation.

### E8 — Délibérations / conseils de classe collectifs
- Données présentes (champs par élève) mais pas de process collégial ; My-Scool/Major/Kanda le vendent.

## Écarts moyens (P2)

| Écart | Concurrents | Note |
|---|---|---|
| Comptabilité OHADA | Galactis, SMARTI, PERIS, Kanda | Gros lot ; cible = écoles avec comptable — export CSV comptable = MVP |
| RH & paie | PERIS, EduX, SchoolERP | Contrats/vacations/pointage d'abord |
| Cantine/transport | PERIS, EduX, Galactis | Services facturables — lien naturel avec nos FeeCategory existantes |
| Discipline/sanctions | SchoolERP | Vie scolaire attendue |
| Bibliothèque/stocks | Galactis, Kanda | Extensibilité |
| Devoins en ligne / rendus | PERIS | Extension cahier de textes |
| Justification parentale d'absence | PERIS annoncé | Petit chantier, grand confort |
| Maternelle (cahier de vie) | Kanda | Segment à adresser explicitement |
| Supérieur (LMD) | PERIS UNIV, Galactis | Produit distinct — arbitrage stratégique requis |

## Écarts faibles / innovation (P3)

- Accusés de réception messages (aucun concurrent ne le prouve).
- Rapprochement bancaire, multi-caisses.
- IA prédictive (Noppal annonce — non vérifié).
- Recherche globale Ctrl+K, dark mode, i18n (marché anglophone = expansion).

## Où ECOM-SCHOOL est DÉJÀ meilleur (à valoriser commercialement)

| Force | Pourquoi c'est différenciant |
|---|---|
| **Rigueur financière** | idempotence, reçus figés, OVERPAYMENT refusé, annulation motivée non destructive, clôture, trésorerie honnête (« non certifiée ») — aucun concurrent ne documente ce niveau |
| **Workflow d'évaluation complet** | DRAFT→PUBLISHED→RECTIFIED + versions de bulletins immuables + verrous période/année |
| **Traçabilité** | GradeRevision auto, AuditLog, snapshots |
| **SaaS mature** | modules activables par abonnement, overrides, facturation plateforme, sessions support autorisées |
| **Sécurité** | lockout, throttle, anti-énumération, IDOR testés, RBAC fin |
| **Résilience réseau** | releases atomiques + rollback + backups — narration de fiabilité |

**Thèse** : notre différenciation ne viendra pas du nombre de modules, mais de la **fiabilité prouvée** (comptes justes, bulletins traçables) associée aux chaînons d'acquisition/relation (candidatures, paiement mobile, notifications) qui font vendre.
