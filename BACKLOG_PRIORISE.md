# BACKLOG PRIORISÉ — ECOM-SCHOOL

14 novembre 2026 — ordre strict d'exécution proposé. Chaque item est actionnable, avec critère de fin.

## P0 — Bloquants commerciaux / sécurité

- [ ] **B0.1** Installer cron prod (`/etc/cron.d/ecomschool-prod`) — sécurise backups/monitoring/restore
- [ ] **B0.2** Purger les comptes démo `*@demo.local` de prod après tes tests — 0 résidu vérifié
- [ ] **B0.3** Canal email/SMS familles — 1 relance `FeeReminder` réellement reçue en test
- [ ] **B0.4** Bilan + compte de résultat SYSCOHADA — PDF équilibré sur exercice recette
- [ ] **B0.5** Module RH : `Employee`+contrats+dossiers — dossier salarié complet
- [ ] **B0.6** Paie : `PayrollRun`+bulletins PDF+cotisations BF — paie mensuelle complète
- [ ] **B0.7** PayDunya LIVE + webhook vérification — 1 paiement réel tracé

## P1 — Renforcement produit

- [ ] **B1.1** Écritures paie → compta (OD 66x/42x/44x via H12)
- [ ] **B1.2** Congés/présences personnel (demande→validation→soldes)
- [ ] **B1.3** Rôle `gestionnaire de scolarité` (élèves+inscriptions+présences, sans finance)
- [ ] **B1.4** Récurrence restore-verify — 2 passages hebdo logués
- [ ] **B1.5** Workflow fin d'année automatisé (clôture→réinscriptions)
- [ ] **B1.6** Pilotage RH : effectifs, masse salariale, alertes contrats
- [ ] **B1.7** Comptes tiers + balance âgée

## P2 — Complétude

- [ ] **B2.1** Immobilisations + amortissements → OD auto
- [ ] **B2.2** Rapprochement bancaire + lettrage
- [ ] **B2.3** Portail enseignant self-service
- [ ] **B2.4** Emplois du temps : détection conflits
- [ ] **B2.5** Université : référentiels LMD (`schoolType` + UE/crédits/semestres)
- [ ] **B2.6** Université : inscriptions pédagogiques + sessions
- [ ] **B2.7** Facturation plateforme établissements (au-delà `PlatformCreditNote`)
- [ ] **B2.8** Enforcement dur des quotas de plans
- [ ] **B2.9** Orange/Moov API réelles (dépend contrats opérateur)

## P3 — Optimisation / différenciation

- [ ] **B3.1** WhatsApp notifications
- [ ] **B3.2** Budgets prévisionnels
- [ ] **B3.3** Onboarding self-service public des écoles
- [ ] **B3.4** Université : stages/mémoires/vacataires
- [ ] **B3.5** Export FEC / format réglementaire
- [ ] **B3.6** Résoudre `uuid@8.3.2` via maj `exceljs` (breaking — évaluer)

---

## Règles de gestion du backlog
- Aucun item P0 ne doit passer en production sans recette type H5/H6/H12 (isolation + équilibre + idempotence).
- RH (B0.5/B0.6/B1.1/B1.2/B1.6) forme un lot indivisible — livré ensemble.
- Université (B2.5/B2.6/B3.4) derrière un feature flag `schoolType` pour ne pas impacter primaire/secondaire.
- Paiements LIVE (B0.7) seulement après canal notifications (B0.3) — un paiement sans relance possible n'est pas exploitable.
